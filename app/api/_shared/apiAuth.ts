import { createHash, randomBytes } from "crypto";
import { supabaseServiceRole } from "./supabaseServiceRole";

// ---------------------------------------------------------------------------
// Auth for the public v1 API (the "Authorization: Bearer $DEVAUDIT_TOKEN" scheme on the API
// reference page). Deliberately separate from supabaseForRequest.ts's session-based RLS pattern
// used by the dashboard: a DevAudit API token is an opaque, long-lived secret the user generates
// in account settings, not a Supabase JWT — there's no auth.uid() for RLS to key off. So this
// file verifies the token itself with the service-role key, and every v1 route that calls
// requireApiToken() is responsible for manually scoping its own queries to the returned userId
// (see app/api/v1/repos/route.ts, app/api/v1/errors/route.ts, etc. — they all filter on
// repos.user_id explicitly rather than relying on RLS).
//
// ASSUMPTION: backed by a new `api_tokens` table — see supabase/migrations/xxxx_api_tokens.sql.
// If tokens already live somewhere else under a different shape, point requireApiToken() at that
// instead.
//
// CHANGE from the original version of this file: hashToken is now exported. app/api/tokens/route.ts
// (session-authenticated token issuance) needs to hash a freshly-generated token with the exact
// same function this file uses to verify it later — a second, slightly different implementation
// there would silently break every token it issues.
// ---------------------------------------------------------------------------

export class ApiAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiAuthResult {
  userId: string;
  tokenId: string;
}

// ---------------------------------------------------------------------------
// Token scopes and lifetime. A token only works for the scopes it was issued with, and stops
// working after its expires_at. Tokens issued before this existed have no scopes/expires_at
// recorded and keep working exactly as before (full access, no expiry) until the user revokes or
// replaces them — so rolling this out can't lock anyone out.
// ---------------------------------------------------------------------------

export const API_SCOPES = ["repos:read", "errors:read", "errors:write", "errors:fix"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** What a browser-approved CLI login gets: read repos/errors and trigger fixes. Deliberately NOT
 *  errors:write — pushing errors into DevAudit is a push-watcher / CI job, not an interactive one. */
export const CLI_TOKEN_SCOPES: readonly ApiScope[] = ["repos:read", "errors:read", "errors:fix"];

export const DEFAULT_TOKEN_TTL_DAYS = 90;
export const ALLOWED_TOKEN_TTL_DAYS = [7, 30, 90, 365] as const;

export function expiryFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

/** True when Postgres/PostgREST says a column doesn't exist — used so the scope/expiry columns
 *  can be added to the database after this code is deployed without breaking token issuance. */
export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "42703" || error.code === "PGRST204");
}

/** Call at the top of every v1 route. Throws ApiAuthError (catch it and return
 *  NextResponse.json({ error: e.message }, { status: e.status })) on any failure. Pass the scope
 *  the route needs; a token issued without it gets a 403. */
export async function requireApiToken(req: Request, scope?: ApiScope): Promise<ApiAuthResult> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    throw new ApiAuthError(401, "Missing bearer token. Pass it as `Authorization: Bearer <token>`.");
  }

  const supabase = supabaseServiceRole();
  // select("*") so this keeps working whether or not the optional scopes / expires_at columns exist
  // yet; a missing value means "legacy token" (see above).
  const { data, error } = await supabase
    .from("api_tokens")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error) {
    console.error("[requireApiToken] token lookup failed:", error.message);
    throw new ApiAuthError(500, "Couldn't verify the token. Please try again.");
  }
  if (!data || data.revoked_at) throw new ApiAuthError(401, "Invalid or revoked token.");
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new ApiAuthError(401, "This token has expired. Create a new one (or run `devaudit login` again).");
  }
  if (scope && Array.isArray(data.scopes) && !data.scopes.includes(scope)) {
    throw new ApiAuthError(403, `This token doesn't have the \`${scope}\` scope.`);
  }

  // Best-effort — a failed timestamp bump shouldn't fail the actual request. Awaited (and any
  // failure swallowed) because on serverless the function can be frozen the moment the response is
  // sent, which silently drops any promise still in flight.
  try {
    const { error: touchErr } = await supabase
      .from("api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    if (touchErr) console.error("[requireApiToken] last_used_at update failed:", touchErr.message);
  } catch (e) {
    console.error("[requireApiToken] last_used_at update threw:", e instanceof Error ? e.message : e);
  }

  return { userId: data.user_id, tokenId: data.id };
}

// Token issuance (generate + hash + insert) lives in app/api/tokens/route.ts, not here — that
// route is session-authenticated (account settings, a signed-in user creating their own token),
// so it uses supabaseForRequest.ts's RLS-scoped client directly rather than going through the
// service-role path this file uses for *verifying* already-issued tokens. It imports hashToken
// from here so issuance and verification can never drift out of sync.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Token generation lives next to hashToken for the same reason hashToken is exported: every place
// that ISSUES a token (app/api/tokens/route.ts for settings-page tokens, and
// app/v1/cli-auth/token/route.ts for browser-login tokens) must produce the exact same shape, or
// tokens minted by one path could stop matching what the other path and requireApiToken expect.
// (These can't be exported from a route.ts file — Next.js only allows HTTP-method exports there.)
export function generateApiToken(): string {
  // 24 random bytes → 48 hex chars, prefixed so tokens are recognizable in logs/screenshots
  // (and greppable, e.g. for a leaked-secret scanner) without revealing anything about the value.
  return `da_${randomBytes(24).toString("hex")}`;
}

/** Non-secret slice stored in api_tokens.token_prefix (NOT NULL) so the UI can show "da_a1b2c3d4…"
 *  to tell tokens apart without ever displaying the secret again. "da_" + 8 hex chars. */
export function apiTokenPrefix(token: string): string {
  return token.slice(0, 11);
}
