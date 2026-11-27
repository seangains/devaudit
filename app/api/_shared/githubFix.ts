// ---------------------------------------------------------------------------
// GitHub REST calls needed to apply an AI-suggested fix as a commit on a new branch, used by
// app/api/v1/errors/[id]/fix/route.ts. Plain fetch calls to api.github.com, matching the style
// already used in your example repos-listing route rather than adding an Octokit dependency.
//
// Token storage/retrieval lives in ./githubConnections.ts, not here — see that file.
//
// SECURITY: every function below validates owner/repo/path/branch through pathSafety.ts BEFORE
// building a URL. fetch() normalizes ".." segments, so an unchecked value like
// "../collaborators/x" would silently re-point the request at a different GitHub endpoint (with
// the user's OAuth token attached). Validation lives here, at the single place URLs are built, so
// no caller can forget it.
// ---------------------------------------------------------------------------

import {
  encodeBranchRef,
  encodeOwnerRepo,
  encodeRepoPath,
  InvalidGithubInputError,
  isProtectedRepoPath,
} from "./pathSafety";

export { InvalidGithubInputError } from "./pathSafety";

const GITHUB_API = "https://api.github.com";

/** "https://api.github.com/repos/<owner>/<repo>" with both parts validated and URL-encoded. */
function repoUrl(owner: string, repo: string): string {
  const e = encodeOwnerRepo(owner, repo);
  return `${GITHUB_API}/repos/${e.owner}/${e.repo}`;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "DevAudit",
  };
}

export async function getDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const res = await fetch(repoUrl(owner, repo), { headers: ghHeaders(token) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Failed to look up ${owner}/${repo}.`);
  return body.default_branch as string;
}

/** Looks a repo up with the USER's GitHub token, so the answer reflects what that user can really
 *  see. Returns null when GitHub says 404 (doesn't exist, or the user has no access — GitHub
 *  deliberately doesn't distinguish). Used to verify a repo before DevAudit registers it. */
export async function getRepoInfo(
  token: string,
  owner: string,
  repo: string,
): Promise<{ id: number; fullName: string; private: boolean } | null> {
  const res = await fetch(repoUrl(owner, repo), { headers: ghHeaders(token) });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Failed to look up ${owner}/${repo}.`);
  if (typeof body.id !== "number" || typeof body.full_name !== "string") return null;
  return { id: body.id, fullName: body.full_name, private: !!body.private };
}

export async function getBranchHeadSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const res = await fetch(`${repoUrl(owner, repo)}/git/ref/heads/${encodeBranchRef(branch)}`, {
    headers: ghHeaders(token),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Failed to read ${branch}'s latest commit.`);
  return body.object.sha as string;
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  newBranch: string,
  fromSha: string,
): Promise<void> {
  encodeBranchRef(newBranch); // validate before it goes into the ref name below
  const res = await fetch(`${repoUrl(owner, repo)}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Failed to create branch ${newBranch}.`);
  }
}

async function getFileShaOnBranch(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | undefined> {
  const res = await fetch(`${repoUrl(owner, repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return undefined; // file doesn't exist on this branch yet — a new file, not an edit
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Failed to read ${path} on ${branch}.`);
  return body.sha as string;
}

/** Reads a file's current decoded content on a branch. Returns null if the file doesn't exist
 *  there (404) or isn't a plain file (e.g. a directory). Used to give the AI the file it's
 *  fixing, and to apply its edit against the real content. */
export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | null> {
  const res = await fetch(`${repoUrl(owner, repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Failed to read ${path} on ${branch}.`);
  if (Array.isArray(body) || body.type !== "file" || typeof body.content !== "string") return null;
  if (body.encoding !== "base64") return null;
  return Buffer.from(body.content, "base64").toString("utf8");
}

export async function commitFileToBranch(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
  message: string,
): Promise<{ commitSha: string; htmlUrl: string }> {
  // Refuse before any network call. CI workflows and repo config are never valid targets for an
  // automated fix commit (see isProtectedRepoPath).
  encodeRepoPath(path);
  if (isProtectedRepoPath(path)) {
    throw new InvalidGithubInputError("DevAudit won't commit changes to .github/ or git configuration files.");
  }
  encodeBranchRef(branch);

  const existingSha = await getFileShaOnBranch(token, owner, repo, path, branch);

  const res = await fetch(`${repoUrl(owner, repo)}/contents/${encodeRepoPath(path)}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Failed to commit ${path} to ${branch}.`);
  return { commitSha: body.commit.sha, htmlUrl: body.commit.html_url };
}
