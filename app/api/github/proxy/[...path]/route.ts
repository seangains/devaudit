import { NextRequest, NextResponse } from "next/server";
import { supabaseForRequest } from "@/api/_shared/supabaseForRequest";
import { findGithubAccessTokenForUser, deleteGithubConnection } from "@/api/_shared/githubConnections";
import { limitByIp, limitByUser } from "@/api/_shared/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Browser -> GitHub proxy. The browser sends only its Supabase bearer token; the GitHub token is
 * looked up server-side in github_connections and never leaves the server.
 *
 * Allowlist: exactly the GitHub endpoints CodeStudio uses, nothing else. `keys` restricts which
 * body fields may be sent, so this can't be used to rename/archive/delete repos, etc. */
const SEG = "[A-Za-z0-9._-]+";
const ONE = "[^/]+"; // one URL-encoded segment (branch names arrive as feature%2Fx)
const REPO = `/repos/${SEG}/${SEG}`;
type Rule = { method: string; re: RegExp; keys?: string[] };
const RULES: Rule[] = [
  { method: "GET", re: /^\/user\/repos$/ },
  { method: "POST", re: /^\/user\/repos$/, keys: ["name", "private", "auto_init"] },
  { method: "GET", re: new RegExp(`^${REPO}$`) },
  { method: "PATCH", re: new RegExp(`^${REPO}$`), keys: ["private"] },
  { method: "GET", re: new RegExp(`^${REPO}/commits$`) },
  { method: "GET", re: new RegExp(`^${REPO}/git/trees/${ONE}$`) },
  { method: "GET", re: new RegExp(`^${REPO}/contents/.+$`) },
  { method: "GET", re: new RegExp(`^${REPO}/git/ref/heads/${ONE}$`) },
  { method: "GET", re: new RegExp(`^${REPO}/git/commits/[0-9a-f]{7,40}$`) },
  { method: "POST", re: new RegExp(`^${REPO}/git/blobs$`), keys: ["content", "encoding"] },
  { method: "POST", re: new RegExp(`^${REPO}/git/trees$`), keys: ["base_tree", "tree"] },
  { method: "POST", re: new RegExp(`^${REPO}/git/commits$`), keys: ["message", "tree", "parents"] },
  { method: "PATCH", re: new RegExp(`^${REPO}/git/refs/heads/${ONE}$`), keys: ["sha"] },
  // The first commit of a repository that has none (GitHub's Git Data endpoints above refuse an empty
  // repo). Deliberately narrow: one root-level file, and no `branch`/`sha` keys, so it can only
  // create a file on the default branch, never replace or move anything.
  { method: "PUT", re: new RegExp(`^${REPO}/contents/${SEG}$`), keys: ["message", "content"] },
];

/* Path-traversal guard. The path is matched against the allowlist in its raw (still percent-encoded)
 * form, but GitHub decodes it, so a check on the raw string alone misses things like `%2f..%2f`.
 * We therefore also look at the decoded forms: no "." / ".." segments (split on both slashes) and no
 * control characters, in the path as sent, after one decode, and after a second decode (which is what
 * catches double-encoding such as `%252e%252e`). A malformed escape on the first decode is rejected.
 * Legitimate encoded values still pass: a branch `feature/x` arrives as `feature%2Fx` and decodes to
 * segments `feature`, `x`; a file called `100%.txt` arrives as `100%25.txt`, and its second decode
 * simply fails and is ignored. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
function hasUnsafeShape(p: string): boolean {
  return CONTROL_CHARS.test(p) || p.split(/[/\\]/).some((seg) => seg === "." || seg === "..");
}
function tryDecode(p: string): string | null {
  try {
    return decodeURIComponent(p);
  } catch {
    return null;
  }
}
function isSafePath(raw: string): boolean {
  if (hasUnsafeShape(raw)) return false;
  const once = tryDecode(raw);
  if (once === null || hasUnsafeShape(once)) return false;
  const twice = tryDecode(once);
  return twice === null || !hasUnsafeShape(twice);
}
const ACCEPTS = new Set(["application/vnd.github+json", "application/vnd.github.raw+json"]);
const MAX_BODY = 2_000_000;

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/github\/proxy/, "");

  if (!isSafePath(path)) return fail(400, "Bad path");
  const rule = RULES.find((r) => r.method === req.method && r.re.test(path));
  if (!rule) return fail(403, "Endpoint not allowed");

  // Rate limits. This route spends the signed-in user's stored GitHub token, so it must not be
  // callable in a tight loop. Per-IP first (before the auth lookup, so floods are cut off cheaply),
  // then per user. Both FAIL CLOSED: if the limiter is down this answers 503 instead of running
  // unmetered. The caps are generous on purpose — Code Studio makes one request per file when it
  // imports or syncs a repository (a few hundred in a burst), and a real person never gets near
  // these numbers by hand. The 429/503 bodies are { error } JSON; callers only look at the status.
  const limitedIp = await limitByIp(req, "gh-proxy", 900);
  if (limitedIp) return limitedIp;

  // Auth is a bearer header (not a cookie), so a cross-site page can't ride along — no CSRF surface.
  const {
    data: { user },
  } = await supabaseForRequest(req).auth.getUser();
  if (!user) return fail(401, "Not signed in.");

  const limitedUser = await limitByUser(user.id, "gh-proxy", 400);
  if (limitedUser) return limitedUser;

  let token: string | null;
  try {
    token = await findGithubAccessTokenForUser(user.id);
  } catch {
    return fail(500, "Couldn't load the GitHub connection.");
  }
  if (!token) return fail(401, "Not connected to GitHub");

  let body: string | undefined;
  if (rule.keys) {
    const text = await req.text();
    if (text.length > MAX_BODY) return fail(413, "Body too large");
    try {
      const j = JSON.parse(text);
      if (!j || typeof j !== "object" || Array.isArray(j) || Object.keys(j).some((k) => !rule.keys!.includes(k))) throw 0;
    } catch {
      return fail(400, "Bad body");
    }
    body = text;
  }

  const accept = req.headers.get("accept") ?? "";
  let upstream: Response;
  try {
    upstream = await fetch(`https://api.github.com${path}${url.search}`, {
      method: req.method,
      headers: {
        Accept: ACCEPTS.has(accept) ? accept : "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DevAudit",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return fail(504, "GitHub did not respond in time");
  }

  // GitHub says the token is dead (revoked/expired): drop it so the UI shows "reconnect".
  if (upstream.status === 401) await deleteGithubConnection(user.id).catch(() => {});

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT };
