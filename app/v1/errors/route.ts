import { NextResponse } from "next/server";
import { ApiAuthError, requireApiToken } from "../../api/_shared/apiAuth";
import { supabaseServiceRole } from "../../api/_shared/supabaseServiceRole";
import { safeError } from "../../api/_shared/safeError";
import { isSafeRepoFilePath, parseRepoFullName } from "../../api/_shared/pathSafety";
import { getGithubAccessTokenForUser } from "../../api/_shared/githubConnections";
import { getRepoInfo } from "../../api/_shared/githubFix";

// ---------------------------------------------------------------------------
// Public v1 endpoint your push-watcher calls (Authorization: Bearer <DevAudit token>) whenever it
// catches something on a push. Matches the real schema (confirmed from the Supabase table
// editor):
//
//   repositories(id int8 pk, user_id uuid, github_repo_id int8, full_name text, connected_at)
//   errors(id int8 pk, repository_id int8 fk -> repositories.id, file text, line int4,
//          severity text, message text, cause text, suggested_fix text, suggested_patch text,
//          status text, commit_sha text, fix_branch text, fix_commit_sha text, created_at)
//
// `errors` has no user_id of its own — ownership only flows through repository_id ->
// repositories.user_id — so every query here either resolves a repo through `repositories`
// first (POST) or joins through it with `repositories!inner` to filter (GET). Uses the
// service-role client, same as apiAuth.ts's convention for v1 routes, and never trusts a
// repository_id supplied directly by the caller — it's always looked up scoped to
// repositories.user_id = requireApiToken()'s userId, so one token can never touch another
// user's repo or errors.
//
// fix_branch / fix_commit_sha are intentionally left untouched here — those get set by
// app/v1/errors/[id]/fix/route.ts once a suggested_patch is actually applied as a commit, using
// githubFix.ts.
//
// INPUT IS UNTRUSTED. `repo` and `file` end up inside api.github.com URLs later (the /fix route),
// carrying the user's GitHub token, so only plain "owner/name" and plain relative paths are
// accepted. Every free-text field has a length cap, and the number of items and the body size are
// bounded.
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(["error", "warning"]);

const MAX_ITEMS = 100;
const MAX_BODY_BYTES = 5_000_000;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_CAUSE_CHARS = 4_000;
const MAX_SUGGESTED_FIX_CHARS = 8_000;
const MAX_SUGGESTED_PATCH_CHARS = 500_000; // a whole file's content, see /fix
const MAX_FILTER_CHARS = 140;
const MAX_LINE_NUMBER = 10_000_000;

type RawItem = Record<string, unknown>;

/** Optional text field: absent / wrong type -> null; present but over the cap -> a 400. */
function optionalText(raw: RawItem, key: string, max: number): string | null {
  const v = raw[key];
  if (typeof v !== "string") return null;
  if (v.length > max) throw new ApiAuthError(400, `\`${key}\` is too long (max ${max.toLocaleString("en-US")} characters).`);
  return v;
}

function validateOne(raw: unknown) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ApiAuthError(400, "Each error must be a JSON object.");
  }
  const item = raw as RawItem;

  const repoRaw = typeof item.repo === "string" ? item.repo.trim() : "";
  if (!repoRaw) throw new ApiAuthError(400, 'Each error needs a `repo` ("owner/name").');
  if (!parseRepoFullName(repoRaw)) {
    throw new ApiAuthError(400, '`repo` must look like "owner/name" (letters, numbers, ".", "_" and "-" only).');
  }

  const message = typeof item.message === "string" ? item.message.trim() : "";
  if (!message) throw new ApiAuthError(400, "Each error needs a `message`.");
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new ApiAuthError(400, `\`message\` is too long (max ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters).`);
  }

  let file: string | null = null;
  if (item.file !== undefined && item.file !== null) {
    if (!isSafeRepoFilePath(item.file)) {
      throw new ApiAuthError(
        400,
        '`file` must be a plain relative path inside the repo (no "..", no leading slash, no backslashes, no "?" or "#").',
      );
    }
    file = item.file;
  }

  let commitSha: string | null = null;
  if (item.commitSha !== undefined && item.commitSha !== null) {
    if (typeof item.commitSha !== "string" || !/^[0-9a-fA-F]{7,64}$/.test(item.commitSha)) {
      throw new ApiAuthError(400, "`commitSha` must be a git commit hash (7–64 hex characters).");
    }
    commitSha = item.commitSha;
  }

  const severity = typeof item.severity === "string" && VALID_SEVERITIES.has(item.severity) ? item.severity : "error";
  const line =
    typeof item.line === "number" && Number.isInteger(item.line) && item.line >= 0 && item.line <= MAX_LINE_NUMBER
      ? item.line
      : null;
  const githubRepoId =
    typeof item.githubRepoId === "number" && Number.isSafeInteger(item.githubRepoId) && item.githubRepoId > 0
      ? item.githubRepoId
      : null;

  return {
    repo: repoRaw,
    githubRepoId,
    file,
    line,
    severity,
    message,
    cause: optionalText(item, "cause", MAX_CAUSE_CHARS),
    suggested_fix: optionalText(item, "suggestedFix", MAX_SUGGESTED_FIX_CHARS),
    suggested_patch: optionalText(item, "suggestedPatch", MAX_SUGGESTED_PATCH_CHARS),
    commit_sha: commitSha,
    status: "open",
  };
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireApiToken(req, "errors:write");

    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

    const rawItems: unknown[] = Array.isArray(body) ? body : [body];
    if (rawItems.length === 0) return NextResponse.json({ error: "No errors provided." }, { status: 400 });
    if (rawItems.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Send at most ${MAX_ITEMS} errors per request.` }, { status: 400 });
    }
    const items = rawItems.map(validateOne);

    const supabase = supabaseServiceRole();

    // Resolve every distinct repo full_name -> repository_id, scoped to this token's user.
    const repoNames = Array.from(new Set(items.map((i) => i.repo)));
    const { data: existingRepos, error: repoLookupErr } = await supabase
      .from("repositories")
      .select("id, full_name")
      .eq("user_id", userId)
      .in("full_name", repoNames);
    if (repoLookupErr) return safeError("v1.errors.POST.repoLookup", repoLookupErr, 500, "Failed to record the error(s).");

    const repoIdByName = new Map<string, number>((existingRepos ?? []).map((r) => [r.full_name, r.id]));

    // Auto-register any repo we don't recognize yet, but only if the request told us its GitHub
    // repo id (otherwise we can't tell "repo I haven't seen before" from "typo in repo name"), AND
    // GitHub confirms — using the account owner's own GitHub token — that they can see that repo
    // and that the id matches. Everything is checked BEFORE anything is created, so one bad repo
    // in a batch can't leave the others half-registered.
    const unresolvedNames = repoNames.filter((name) => !repoIdByName.has(name));
    const toRegister: { name: string; githubRepoId: number; canonicalName: string }[] = [];
    if (unresolvedNames.length > 0) {
      let githubToken: string;
      try {
        githubToken = await getGithubAccessTokenForUser(userId);
      } catch (e) {
        console.error("[v1.errors.POST] no usable GitHub connection for repo verification:", e instanceof Error ? e.message : e);
        return NextResponse.json(
          { error: "Connect your GitHub account in DevAudit first, so new repositories can be verified before they're registered." },
          { status: 403 },
        );
      }

      for (const name of unresolvedNames) {
        // Any item for this repo may carry the id — not just the first one.
        const githubRepoId = items.find((i) => i.repo === name && i.githubRepoId)?.githubRepoId;
        if (!githubRepoId) {
          return NextResponse.json(
            {
              error: `Repo "${name}" isn't connected yet. Connect it in DevAudit first, or include its \`githubRepoId\` so it can be auto-registered.`,
            },
            { status: 404 },
          );
        }

        const parsed = parseRepoFullName(name)!; // validated in validateOne
        let info;
        try {
          info = await getRepoInfo(githubToken, parsed.owner, parsed.repo);
        } catch (e) {
          return safeError("v1.errors.POST.verifyRepo", e, 502, "Couldn't verify the repository with GitHub. Try again shortly.");
        }
        if (!info) {
          return NextResponse.json(
            { error: `Repo "${name}" wasn't found on GitHub, or your connected GitHub account can't access it.` },
            { status: 403 },
          );
        }
        if (info.id !== githubRepoId) {
          return NextResponse.json(
            { error: `\`githubRepoId\` doesn't match the GitHub repository "${name}".` },
            { status: 400 },
          );
        }
        toRegister.push({ name, githubRepoId, canonicalName: info.fullName });
      }
    }

    const createdRepoIds: number[] = [];
    for (const { name, githubRepoId, canonicalName } of toRegister) {
      const { data: created, error: createErr } = await supabase
        .from("repositories")
        .insert({ user_id: userId, full_name: canonicalName, github_repo_id: githubRepoId })
        .select("id, full_name")
        .single();

      if (!createErr && created) {
        createdRepoIds.push(created.id);
        repoIdByName.set(name, created.id);
        continue;
      }

      // Unique violation: a concurrent request registered the same repo between our lookup and
      // this insert (or it was already registered under another name). Use the existing row.
      if (createErr?.code === "23505") {
        let { data: existing } = await supabase
          .from("repositories")
          .select("id")
          .eq("user_id", userId)
          .eq("full_name", canonicalName)
          .maybeSingle();
        if (!existing) {
          ({ data: existing } = await supabase
            .from("repositories")
            .select("id")
            .eq("user_id", userId)
            .eq("github_repo_id", githubRepoId)
            .maybeSingle());
        }
        if (existing) {
          repoIdByName.set(name, existing.id);
          continue;
        }
      }

      await removeRepos(supabase, userId, createdRepoIds);
      return safeError("v1.errors.POST.repoCreate", createErr, 500, "Failed to record the error(s).");
    }

    const rows = items.map(({ repo, githubRepoId: _ignored, ...rest }) => ({
      ...rest,
      repository_id: repoIdByName.get(repo)!,
    }));

    const { data, error } = await supabase
      .from("errors")
      .insert(rows)
      .select("id, repository_id, file, message, status, created_at");

    if (error) {
      // Don't leave repositories behind that only exist because of a request that then failed.
      await removeRepos(supabase, userId, createdRepoIds);
      return safeError("v1.errors.POST.insert", error, 500, "Failed to record the error(s).");
    }
    return NextResponse.json({ inserted: data }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return safeError("v1.errors.POST", e, 500, "Failed to record the error(s).");
  }
}

/** Best-effort cleanup of repositories created earlier in the SAME request (they can't have any
 *  errors yet). Scoped to the caller's own user id as a second guard. */
async function removeRepos(supabase: ReturnType<typeof supabaseServiceRole>, userId: string, ids: number[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("repositories").delete().eq("user_id", userId).in("id", ids);
  if (error) console.error("[v1.errors.POST] couldn't roll back newly created repositories:", error.message);
}

export async function GET(req: Request) {
  try {
    const { userId } = await requireApiToken(req, "errors:read");
    const { searchParams } = new URL(req.url);
    const repo = searchParams.get("repo");
    const status = searchParams.get("status");
    if ((repo && repo.length > MAX_FILTER_CHARS) || (status && status.length > MAX_FILTER_CHARS)) {
      return NextResponse.json({ error: "Filter value is too long." }, { status: 400 });
    }
    // Clamped on both sides: a negative or fractional limit would otherwise reach Postgres and 500.
    const requested = Math.floor(Number(searchParams.get("limit")));
    const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 50, 1), 200);

    const supabase = supabaseServiceRole();
    let query = supabase
      .from("errors")
      .select(
        "id, file, line, severity, message, cause, suggested_fix, suggested_patch, commit_sha, status, fix_branch, fix_commit_sha, created_at, repositories!inner(full_name)",
      )
      .eq("repositories.user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (repo) query = query.eq("repositories.full_name", repo);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return safeError("v1.errors.GET", error, 500, "Failed to load errors.");
    return NextResponse.json({ errors: data ?? [] });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return safeError("v1.errors.GET", e, 500, "Failed to load errors.");
  }
}
