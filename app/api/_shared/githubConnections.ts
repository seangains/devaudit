import { supabaseServiceRole } from "./supabaseServiceRole";
import { encryptValue, decryptValue } from "./crypto";

// ---------------------------------------------------------------------------
// Persists the GitHub access token DevAudit gets at sign-in (Supabase Auth + GitHub OAuth, repo
// scope) so it's still available later for server-to-server calls that have no browser session —
// like app/api/v1/errors/[id]/fix, which is called by an external API client, not a logged-in
// user's browser.
//
// IMPORTANT: Supabase does NOT persist session.provider_token anywhere past the initial
// exchangeCodeForSession() call in your OAuth callback — it's only ever present in that one
// response. If you want it later, that callback is the only place to grab and save it. Call
// saveGithubConnection() from there; see the snippet in chat for where exactly.
//
// Uses the service-role client (not supabaseForRequest) for both read and write: the callback
// context can be awkward to get a clean RLS-scoped client from depending on your exact Supabase
// SSR setup, and the v1 fix route has no user session to scope with anyway.
// ---------------------------------------------------------------------------

export async function saveGithubConnection(
  userId: string,
  accessToken: string,
  opts?: { githubLogin?: string; scope?: string },
): Promise<void> {
  const supabase = supabaseServiceRole();
  const { error } = await supabase.from("github_connections").upsert({
    user_id: userId,
    access_token_encrypted: encryptValue(accessToken),
    github_login: opts?.githubLogin ?? null,
    scope: opts?.scope ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save GitHub connection: ${error.message}`);
}

export async function getGithubAccessTokenForUser(userId: string): Promise<string> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("github_connections")
    .select("access_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load GitHub connection: ${error.message}`);
  if (!data?.access_token_encrypted) {
    throw new Error("No GitHub connection found for this account. Reconnect GitHub in account settings.");
  }
  return decryptValue(data.access_token_encrypted);
}

// ---------------------------------------------------------------------------
// Used by app/api/github/proxy and app/api/github/session (the browser-facing GitHub proxy).
// ---------------------------------------------------------------------------

/** Like getGithubAccessTokenForUser, but returns null when there's no connection (throws only on real failures). */
export async function findGithubAccessTokenForUser(userId: string): Promise<string | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("github_connections")
    .select("access_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load GitHub connection: ${error.message}`);
  return data?.access_token_encrypted ? decryptValue(data.access_token_encrypted) : null;
}

/** True if a connection row exists (doesn't decrypt anything). */
export async function hasGithubConnection(userId: string): Promise<boolean> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("github_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to check GitHub connection: ${error.message}`);
  return !!data;
}

/** Drops a connection whose token GitHub has rejected (revoked/expired). */
export async function deleteGithubConnection(userId: string): Promise<void> {
  const supabase = supabaseServiceRole();
  const { error } = await supabase.from("github_connections").delete().eq("user_id", userId);
  if (error) throw new Error(`Failed to delete GitHub connection: ${error.message}`);
}
