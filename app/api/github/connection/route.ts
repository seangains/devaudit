import { NextResponse } from "next/server";
import { supabaseForRequest } from "../../_shared/supabaseForRequest";
import { saveGithubConnection, deleteGithubConnection } from "../../_shared/githubConnections";
import { limitByIp, limitByUser } from "../../_shared/limits";
import { safeError } from "../../_shared/safeError";

// Session-authenticated (called by components/GithubTokenSync.tsx right after login, via
// POST /api/github/connection with the browser's own Supabase session) — NOT part of the
// public bearer-token v1 API, so it uses supabaseForRequest like app/api/tokens/route.ts does,
// not supabaseServiceRole.
//
// RENAMED from app/api/github/token-sync/route.ts to app/api/github/connection/route.ts —
// GithubTokenSync.tsx posts to "/api/github/connection", so the path has to match exactly.
// The sibling accessToken-based route (previously app/api/github/connect/route.ts) had no
// caller anywhere in the codebase and has been deleted.
export async function POST(req: Request) {
  try {
    // Per-IP first (before the auth lookup, so floods are cut off cheaply), then per user. Both
    // FAIL CLOSED: this route writes an encrypted GitHub token to the database, so a broken
    // limiter must answer 503 rather than let it be called in a tight loop.
    const limitedIp = await limitByIp(req, "github-connection", 30);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const limitedUser = await limitByUser(user.id, "github-connection", 10);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const providerToken = typeof body?.providerToken === "string" ? body.providerToken : "";
    if (!providerToken) return NextResponse.json({ error: "providerToken is required." }, { status: 400 });

    await saveGithubConnection(user.id, providerToken, {
      githubLogin: typeof body?.githubLogin === "string" ? body.githubLogin : undefined,
      scope: typeof body?.scope === "string" ? body.scope : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    // Never echo e.message here: it can be "SECRETS_ENCRYPTION_KEY is not configured…" or a raw
    // database error. It goes to the server log; the client gets a generic message.
    return safeError("github-connection.POST", e, 500, "Failed to save GitHub connection.");
  }
}

// "Disconnect GitHub": deletes the encrypted GitHub token this account has stored server-side.
// Signing out deliberately leaves it in place (CLI/API features that run without a browser still
// need it), so this is the in-app way to actually remove it.
//
// Limits of what this can do: it removes OUR copy. It cannot revoke the grant on GitHub's side (the
// OAuth client secret lives in Supabase, not in this app), so the person should also remove the app
// at https://github.com/settings/applications if they want GitHub to stop honouring the token.
export async function DELETE(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "github-connection-delete", 30);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const limitedUser = await limitByUser(user.id, "github-connection-delete", 10);
    if (limitedUser) return limitedUser;

    await deleteGithubConnection(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("github-connection.DELETE", e, 500, "Failed to disconnect GitHub.");
  }
}
