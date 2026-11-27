import { NextResponse } from "next/server";
// Adjust this import path to match your other routes (the ones that use supabaseForRequest).
import { supabaseForRequest } from "../../_shared/supabaseForRequest";
import { findGithubAccessTokenForUser } from "../../_shared/githubConnections";
import { limitByIp, limitByUser } from "../../_shared/limits";
import { safeError } from "../../_shared/safeError";

const PER_PAGE = 100; // GitHub's maximum page size
const MAX_PAGES = 10; // up to 1,000 repositories per request

// Lists the signed-in user's GitHub repositories.
// The GitHub token comes from the server-side github_connections vault — the browser no longer
// sends it (the old x-github-token request header is ignored).
export async function GET(req: Request) {
  try {
    // Rate limited per IP (before the auth lookup) and per user; both fail closed. Each call spends
    // the user's GitHub API quota, so it must not be callable in a loop.
    const limitedIp = await limitByIp(req, "github-repos", 60);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const limitedUser = await limitByUser(user.id, "github-repos", 20);
    if (limitedUser) return limitedUser;

    const githubAccessToken = await findGithubAccessTokenForUser(user.id);
    if (!githubAccessToken) {
      return NextResponse.json({ error: "GitHub isn't connected for this account. Sign out and sign in again." }, { status: 401 });
    }

    // GitHub returns at most 100 repositories per page, so walk the pages (most recently updated
    // first) until a short page signals the end. MAX_PAGES bounds how much GitHub quota and time one
    // request can spend; an account with more than MAX_PAGES * 100 repos gets the most recent ones.
    const repos: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`https://api.github.com/user/repos?per_page=${PER_PAGE}&sort=updated&page=${page}`, {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "DevAudit",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.error("[github-repos.GET] GitHub responded", res.status, "on page", page);
        // A failure after the first page still returns what we already have rather than nothing.
        if (page > 1) break;
        // GitHub's own error text isn't passed through to the client; map the status to our wording.
        const message =
          res.status === 401 ? "GitHub rejected the saved connection. Sign out and sign in again."
          : res.status === 403 || res.status === 429 ? "GitHub denied the request or the rate limit was reached. Try again later."
          : "Failed to fetch repositories.";
        return NextResponse.json({ error: message }, { status: res.status });
      }

      const batch = await res.json();
      if (!Array.isArray(batch)) break;
      repos.push(...batch);
      if (batch.length < PER_PAGE) break;
    }

    return NextResponse.json({ repos });
  } catch (e) {
    return safeError("github-repos.GET", e, 500, "Internal server error.");
  }
}
