import { NextResponse } from "next/server";
import {
  ALLOWED_TOKEN_TTL_DAYS,
  API_SCOPES,
  DEFAULT_TOKEN_TTL_DAYS,
  expiryFromNow,
  hashToken,
  generateApiToken,
  apiTokenPrefix,
  isApiScope,
  isMissingColumnError,
  type ApiScope,
} from "../_shared/apiAuth";
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { limitByIp, limitByUser } from "../_shared/limits";
import { safeError } from "../_shared/safeError";

// ---------------------------------------------------------------------------
// Issues and manages the tokens used against the public v1 API
// ("Authorization: Bearer <token>" — verified in app/api/_shared/apiAuth.ts). This route itself
// is session-authenticated (a signed-in user managing their own tokens from account settings),
// so — same convention as app/api/env/route.ts — it uses supabaseForRequest's RLS-scoped client
// rather than the service-role client, and does no separate ownership check: a query for someone
// else's token simply matches zero rows under RLS.
//
// ASSUMPTIONS, since I don't have the actual api_tokens schema:
// 1. Columns: id (uuid, pk, default gen_random_uuid()), user_id (uuid), name (text),
//    token_hash (text), token_prefix (text, NOT NULL — a short, non-secret slice of the token
//    stored in the clear so the UI can show e.g. "da_a1b2c3d4…" to help identify a token in the
//    list without ever displaying the full secret again), created_at (timestamptz default now()),
//    last_used_at (timestamptz, nullable — bumped by apiAuth.ts on use), revoked_at (timestamptz,
//    nullable).
//    OPTIONAL, added for scoped + expiring tokens: expires_at (timestamptz, nullable) and
//    scopes (text[] or jsonb array, nullable). Until those columns exist the code below falls back
//    to the original column set, so deploy order doesn't matter; a token with no expires_at /
//    scopes keeps its old behaviour (no expiry, full access).
// 2. RLS policies on api_tokens restrict select/insert/update to rows where user_id = auth.uid().
// 3. Revoking is a soft-delete (set revoked_at) rather than a hard delete, so last_used_at /
//    created_at survive for an audit trail and apiAuth.ts's existing "revoked_at is set → reject"
//    check (no change needed there) is what actually invalidates the token.
// 4. The plaintext token is never stored — only its sha256 hash (hashToken, from ../_shared/apiAuth)
//    and its non-secret token_prefix — and the full token is returned to the client exactly once,
//    on creation. There is no way to view it again after that; the UI must tell the user to copy
//    it now.
//
// CONFIRMED against a live error: "null value in column token_prefix ... violates not-null
// constraint" — so token_prefix exists and is NOT NULL; added below. If any other column also
// differs from these assumptions, tell me and I'll adjust this file rather than the schema.
// ---------------------------------------------------------------------------

const MAX_NAME_CHARS = 60;
// The id column is assumed to be a uuid (see above), but a bigint id is accepted too so this check
// can never be what breaks revoking; anything else would only reach Postgres as a type error.
const TOKEN_ID_RE = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{1,18})$/;

const TOKEN_COLUMNS_BASE = "id, name, token_prefix, created_at, last_used_at, revoked_at";
const TOKEN_COLUMNS_FULL = `${TOKEN_COLUMNS_BASE}, expires_at, scopes`;

// Typed loosely on purpose: the full and fallback column sets have different shapes.
type Row = Record<string, unknown>;
type Result<T> = { data: T | null; error: { code?: string; message?: string } | null };

export async function GET(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "tokens-get", 120);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "tokens-get", 60);
    if (limitedUser) return limitedUser;

    let { data, error } = (await supabase
      .from("api_tokens")
      .select(TOKEN_COLUMNS_FULL)
      .order("created_at", { ascending: false })) as unknown as Result<Row[]>;
    if (isMissingColumnError(error)) {
      ({ data, error } = (await supabase
        .from("api_tokens")
        .select(TOKEN_COLUMNS_BASE)
        .order("created_at", { ascending: false })) as unknown as Result<Row[]>);
    }

    if (error) return safeError("tokens.GET", error, 403, "Couldn't load your API tokens.");
    return NextResponse.json({ tokens: data ?? [] });
  } catch (e) {
    return safeError("tokens.GET", e, 500, "Failed to load API tokens.");
  }
}

export async function POST(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "tokens-post", 30);
    if (limitedIp) return limitedIp;

    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Give the token a name, e.g. \"CI pipeline\"." }, { status: 400 });
    if (name.length > MAX_NAME_CHARS) {
      return NextResponse.json({ error: `Name is too long (max ${MAX_NAME_CHARS} characters).` }, { status: 400 });
    }

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "tokens-post", 10);
    if (limitedUser) return limitedUser;

    // Lifetime: a whitelisted number of days (default 90). Tokens that never expire are not offered.
    const requestedDays = body?.expires_in_days === undefined ? DEFAULT_TOKEN_TTL_DAYS : Number(body.expires_in_days);
    if (!(ALLOWED_TOKEN_TTL_DAYS as readonly number[]).includes(requestedDays)) {
      return NextResponse.json(
        { error: `expires_in_days must be one of ${ALLOWED_TOKEN_TTL_DAYS.join(", ")}.` },
        { status: 400 },
      );
    }

    // Scopes: only known values, de-duplicated; omitted means every scope.
    let scopes: ApiScope[] = [...API_SCOPES];
    if (body?.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.length === 0 || !body.scopes.every(isApiScope)) {
        return NextResponse.json({ error: `scopes must be a non-empty list of: ${API_SCOPES.join(", ")}.` }, { status: 400 });
      }
      scopes = Array.from(new Set<ApiScope>(body.scopes));
    }

    const token = generateApiToken();
    const baseRow = {
      user_id: user.id,
      name,
      token_hash: hashToken(token),
      token_prefix: apiTokenPrefix(token),
    };

    let { data, error } = (await supabase
      .from("api_tokens")
      .insert({ ...baseRow, expires_at: expiryFromNow(requestedDays), scopes })
      .select(TOKEN_COLUMNS_FULL)
      .single()) as unknown as Result<Row>;
    if (isMissingColumnError(error)) {
      // Database predates scopes/expiry: issue the token the old way rather than failing.
      ({ data, error } = (await supabase
        .from("api_tokens")
        .insert(baseRow)
        .select(TOKEN_COLUMNS_BASE)
        .single()) as unknown as Result<Row>);
    }

    if (error) return safeError("tokens.POST", error, 403, "Couldn't create the API token.");

    // `token` is only ever present in this one response — the row itself only ever stores the hash.
    return NextResponse.json({ token, ...data });
  } catch (e) {
    return safeError("tokens.POST", e, 500, "Failed to create the API token.");
  }
}

export async function DELETE(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "tokens-delete", 60);
    if (limitedIp) return limitedIp;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    if (!TOKEN_ID_RE.test(id)) return NextResponse.json({ error: "That isn't a valid token id." }, { status: 400 });

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "tokens-delete", 30);
    if (limitedUser) return limitedUser;

    // Soft-delete (see assumption 3 above) — sets revoked_at rather than removing the row.
    const { error } = await supabase
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return safeError("tokens.DELETE", error, 403, "Couldn't revoke the API token.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("tokens.DELETE", e, 500, "Failed to revoke the API token.");
  }
}
