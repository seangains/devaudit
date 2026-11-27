import { NextResponse } from "next/server";
import { requireApiToken, ApiAuthError } from "../../../../api/_shared/apiAuth";
import { supabaseServiceRole } from "../../../../api/_shared/supabaseServiceRole";
import { getGithubAccessTokenForUser } from "../../../../api/_shared/githubConnections";
import {
  InvalidGithubInputError,
  getDefaultBranch,
  getBranchHeadSha,
  getFileContent,
  createBranch,
  commitFileToBranch,
} from "../../../../api/_shared/githubFix";
import { generateFixPatch } from "../../../../api/_shared/generateFix";
import { llmConfigured } from "../../../../api/_shared/llm";
import { limitByUser } from "../../../../api/_shared/limits";
import { safeError } from "../../../../api/_shared/safeError";
import { isProtectedRepoPath, isSafeRepoFilePath, parseRepoFullName } from "../../../../api/_shared/pathSafety";

// Trying up to nine models in sequence can take a while; this lifts the platform's default
// function timeout where the host honors it (Vercel does; elsewhere it's ignored).
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /v1/errors/:id/fix — same behavior as before (see the module comment history), plus:
// rate limiting keyed on the caller's tokenId. This is the single most expensive endpoint in
// the app — up to nine AI calls AND a GitHub branch + commit per hit — so a leaked or malicious
// token shouldn't be able to run it in a tight loop. Everything else below is unchanged.
// ---------------------------------------------------------------------------

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId, tokenId } = await requireApiToken(req, "errors:fix");

    // Keyed on the token (not just the user) and FAIL-CLOSED: each hit can cost up to nine AI calls
    // plus a GitHub branch and commit, so if the limiter is down this answers 503 instead of
    // letting the request through unmetered.
    const limited = await limitByUser(tokenId, "fix", 10);
    if (limited) return limited;

    if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: "Error not found." }, { status: 404 });

    const supabase = supabaseServiceRole();

    const { data: err, error } = await supabase
      .from("errors")
      .select(
        "id, file, line, severity, message, cause, suggested_fix, suggested_patch, repositories!inner(full_name, user_id)",
      )
      .eq("id", id)
      .eq("repositories.user_id", userId)
      .maybeSingle();

    if (error) return safeError("v1.errors.fix.lookup", error);
    if (!err) return NextResponse.json({ error: "Error not found." }, { status: 404 });

    if (!err.file) {
      return NextResponse.json(
        { error: "This error has no file recorded, so there's nothing to patch." },
        { status: 409 },
      );
    }
    // errors.file and repositories.full_name are client-writable (POST /v1/errors), and rows
    // written before validation existed may already hold bad values — so re-check them here,
    // right before they're used to build GitHub URLs. Never trust what's stored.
    const filePath = err.file as string;
    if (!isSafeRepoFilePath(filePath)) {
      return NextResponse.json({ error: "This error's file path is invalid, so it can't be patched." }, { status: 409 });
    }
    if (isProtectedRepoPath(filePath)) {
      return NextResponse.json(
        { error: "DevAudit won't apply automatic fixes to .github/ or git configuration files." },
        { status: 409 },
      );
    }

    const repo = (err as any).repositories as { full_name: string };
    const parsedRepo = parseRepoFullName(repo.full_name);
    if (!parsedRepo) {
      return NextResponse.json({ error: "This error's repository name is invalid." }, { status: 409 });
    }
    const { owner, repo: repoName } = parsedRepo;
    const branchName = `devaudit-fix-${err.id}`;

    const githubToken = await getGithubAccessTokenForUser(userId);
    const defaultBranch = await getDefaultBranch(githubToken, owner, repoName);
    const headSha = await getBranchHeadSha(githubToken, owner, repoName, defaultBranch);

    let patch = err.suggested_patch as string | null;
    let generated = false;
    let explanation: string | null = null;

    if (!patch) {
      if (!llmConfigured()) {
        console.error("Fix generation skipped: neither OPENROUTER_API_KEY nor GROQ_API_KEY is set.");
        return NextResponse.json(
          { error: "No fix is stored for this error, and AI fix generation isn't available right now." },
          { status: 409 },
        );
      }

      // Generate against the SAME branch the fix branch is cut from, so the edit is applied to
      // exactly the content the commit will be replacing.
      const current = await getFileContent(githubToken, owner, repoName, filePath, defaultBranch);
      if (current === null) {
        return NextResponse.json(
          { error: `Couldn't read ${filePath} on ${defaultBranch} (missing, renamed, or not a plain file under 1 MB).` },
          { status: 409 },
        );
      }

      const result = await generateFixPatch({
        filePath,
        content: current,
        line: typeof err.line === "number" ? err.line : null,
        severity: (err.severity as string | null) ?? null,
        message: (err.message as string | null) ?? "",
        cause: (err.cause as string | null) ?? null,
        suggestedFix: (err.suggested_fix as string | null) ?? null,
      });

      if (!result) {
        return NextResponse.json(
          { error: "The AI couldn't produce a safe fix for this error. Nothing was committed." },
          { status: 409 },
        );
      }

      patch = result.patched;
      explanation = result.explanation;
      generated = true;

      // Save the patch so a retry (or a failed commit below) doesn't regenerate it. If the row
      // has no human-readable suggested_fix yet, store the model's explanation there too.
      const { error: saveErr } = await supabase
        .from("errors")
        .update({ suggested_patch: patch, ...(err.suggested_fix ? {} : { suggested_fix: explanation }) })
        .eq("id", err.id);
      if (saveErr) console.error(`Failed to save generated patch for error ${err.id}:`, saveErr.message);

      // Mark "generated but not yet committed" BEFORE touching GitHub, so a failed commit is
      // distinguishable from a failed generation. Separate update on purpose: if `status` has
      // a CHECK constraint that rejects this value, the patch above is still saved.
      const { error: statusErr } = await supabase
        .from("errors")
        .update({ status: "fix_generated" })
        .eq("id", err.id);
      if (statusErr) console.error(`Failed to mark error ${err.id} as fix_generated:`, statusErr.message);
    }

    try {
      await createBranch(githubToken, owner, repoName, branchName, headSha);
    } catch (branchErr) {
      const msg = branchErr instanceof Error ? branchErr.message : "";
      if (!/already exists/i.test(msg)) throw branchErr;
    }

    const { commitSha, htmlUrl } = await commitFileToBranch(
      githubToken,
      owner,
      repoName,
      filePath,
      branchName,
      patch,
      `DevAudit: fix ${filePath}`,
    );

    const { error: updateError } = await supabase
      .from("errors")
      .update({ status: "fix_applied", fix_branch: branchName, fix_commit_sha: commitSha })
      .eq("id", err.id);
    if (updateError) {
      console.error(`Failed to record fix status for error ${err.id}:`, updateError.message);
    }

    return NextResponse.json({
      branch: branchName,
      commit_sha: commitSha,
      commit_url: htmlUrl,
      generated, // true when the AI wrote this fix just now; false when a stored patch was used
      explanation, // the model's plain-language explanation when generated, otherwise null
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof InvalidGithubInputError) return NextResponse.json({ error: e.message }, { status: 409 });
    return safeError("v1.errors.fix.POST", e, 500, "Failed to apply fix.");
  }
}
