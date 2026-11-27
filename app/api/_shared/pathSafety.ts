// ---------------------------------------------------------------------------
// Validators for values that get interpolated into api.github.com URLs. Anything that comes from
// a client, a database row a client could write to (errors.file, repositories.full_name), or
// GitHub itself is validated here BEFORE it is used to build a URL.
//
// Why this matters: fetch() normalizes ".." and "." path segments, so an unvalidated value like
// "../collaborators/attacker" doesn't stay a file name — it rewrites which GitHub endpoint gets
// called, with the user's OAuth token attached. The same goes for an owner or repo called ".."
// (the character class below allows ".", so "." and ".." are rejected explicitly).
// ---------------------------------------------------------------------------

const MAX_REPO_PATH_CHARS = 300;

// Same character class as the deploy route's SAFE_GH_NAME, applied to both halves of "owner/repo".
const GH_NAME_PART = /^[A-Za-z0-9._-]{1,100}$/;
const CONTROL_OR_URL_BREAKING = /[\u0000-\u001f\u007f\\?#]/;

/** Thrown when a value fails validation, so callers can answer 4xx instead of a generic 500. */
export class InvalidGithubInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGithubInputError";
  }
}

/** True for a plain GitHub name part ("owner" or "repo"): safe characters only, and never "." or "..". */
export function isSafeGithubName(part: unknown): part is string {
  return typeof part === "string" && part !== "." && part !== ".." && GH_NAME_PART.test(part);
}

/** Splits "owner/repo" into its parts, or returns null if it isn't exactly that shape. */
export function parseRepoFullName(fullName: unknown): { owner: string; repo: string } | null {
  if (typeof fullName !== "string") return null;
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  return isSafeGithubName(owner) && isSafeGithubName(repo) ? { owner, repo } : null;
}

export function isValidRepoFullName(fullName: unknown): fullName is string {
  return parseRepoFullName(fullName) !== null;
}

/** A path inside a repo must be a plain relative path: not empty, no leading/trailing slash, no
 *  empty / "." / ".." segments, no backslashes, no control characters, and no "?" or "#" (which
 *  would change what URL a GitHub call ends up pointing at). */
export function isSafeRepoFilePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > MAX_REPO_PATH_CHARS) return false;
  if (CONTROL_OR_URL_BREAKING.test(p)) return false;
  return p.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}

/** Paths a code-fix tool has no business writing: CI workflows and repo config run with
 *  elevated trust (Actions secrets, CODEOWNERS, submodule URLs), so an auto-commit there is a
 *  privilege-escalation route even when the path itself is perfectly well-formed. Case-insensitive
 *  because some checkouts (Windows, macOS) treat ".GitHub" and ".github" as the same folder. */
export function isProtectedRepoPath(p: string): boolean {
  const segs = p.toLowerCase().split("/");
  if (segs[0] === ".github") return true;
  if (segs.includes(".git")) return true;
  return segs[segs.length - 1] === ".gitmodules";
}

/** Encode each path segment separately so "src/app/page.tsx" stays a real path instead of
 *  becoming "src%2Fapp%2Fpage.tsx". Throws on anything isSafeRepoFilePath rejects, so no caller
 *  can build a URL from an unchecked path by accident. */
export function encodeRepoPath(p: string): string {
  if (!isSafeRepoFilePath(p)) throw new InvalidGithubInputError("Invalid file path.");
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Encode a branch name for use inside a URL path ("feature/x" keeps its slash; "a#b" and "a?b"
 *  are escaped). Branch names that come back from GitHub can legitimately contain characters like
 *  "#", so this encodes them rather than rejecting — but it still refuses ".." / empty segments. */
export function encodeBranchRef(branch: string): string {
  if (typeof branch !== "string" || branch.length === 0 || branch.length > 255) {
    throw new InvalidGithubInputError("Invalid branch name.");
  }
  if (/[\u0000-\u001f\u007f\\]/.test(branch)) throw new InvalidGithubInputError("Invalid branch name.");
  const segs = branch.split("/");
  if (segs.some((s) => s.length === 0 || s === "." || s === "..")) {
    throw new InvalidGithubInputError("Invalid branch name.");
  }
  return segs.map(encodeURIComponent).join("/");
}

/** Validates owner + repo and returns both URL-encoded, ready to drop into `/repos/${o}/${r}`. */
export function encodeOwnerRepo(owner: string, repo: string): { owner: string; repo: string } {
  if (!isSafeGithubName(owner) || !isSafeGithubName(repo)) {
    throw new InvalidGithubInputError("Invalid repository name.");
  }
  return { owner: encodeURIComponent(owner), repo: encodeURIComponent(repo) };
}
