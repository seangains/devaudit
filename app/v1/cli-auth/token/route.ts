import { NextResponse } from "next/server";
import {
  CLI_TOKEN_SCOPES,
  DEFAULT_TOKEN_TTL_DAYS,
  expiryFromNow,
  hashToken,
  generateApiToken,
  apiTokenPrefix,
  isMissingColumnError,
} from "../../../api/_shared/apiAuth";
import { supabaseServiceRole } from "../../../api/_shared/supabaseServiceRole";
import { limitByIp } from "../../../api/_shared/limits";
import { safeError } from "../../../api/_shared/safeError";

// ---------------------------------------------------------------------------
// POST /v1/cli-auth/token — step 3 of the CLI's browser login: the CLI polls this with its secret
// device_code. Also UNAUTHENTICATED (possession of the device_code is the credential).
//
// Always answers 200 with { status } so the CLI's loop stays simple:
//   pending   → keep polling
//   denied    → the user clicked Deny
//   expired   → the 10-minute window passed
//   consumed  → this request already handed out its token (or a concurrent poll just won it)
//   approved  → { status: "approved", token } — the ONLY time the plaintext token ever exists
//
// The token is minted here, at the moment of collection, and is never stored in
// cli_auth_requests — only its hash goes into api_tokens, exactly like tokens made in settings.
// ---------------------------------------------------------------------------

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  try {
    // This route is deliberately unauthenticated (possession of device_code is the credential,
    // per the header comment above), so it's rate limited by IP instead — a legitimate CLI
    // polls every couple of seconds, which is well under this limit. Uses the validated
    // getClientIp (not the raw x-forwarded-for header, which a client can set to anything off
    // Vercel), fails CLOSED if the limiter is down, and a missing/invalid IP shares one bucket
    // rather than skipping the check.
    const limited = await limitByIp(req, "cli-auth-token", 60, { unknownIpLimit: 120 });
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const deviceCode = typeof body?.device_code === "string" ? body.device_code.trim() : "";
    // Cheap shape check first (64 hex chars, what /start issues) so junk never reaches the DB.
    if (!/^[0-9a-f]{64}$/.test(deviceCode)) {
      return NextResponse.json({ error: "Invalid device_code." }, { status: 400 });
    }

    const supabase = supabaseServiceRole();
    const { data: row, error } = await supabase
      .from("cli_auth_requests")
      .select("id, status, user_id, client_name, expires_at")
      .eq("device_code_hash", hashToken(deviceCode))
      .maybeSingle();

    if (error) return safeError("cli-auth-token.lookup", error);
    if (!row) {
      return NextResponse.json({ error: "Unknown login request. Run `devaudit login` again." }, { status: 404 });
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ status: "expired" }, { headers: noStore });
    }
    if (row.status === "pending") return NextResponse.json({ status: "pending" }, { headers: noStore });
    if (row.status === "denied") return NextResponse.json({ status: "denied" }, { headers: noStore });
    if (row.status !== "approved" || !row.user_id) {
      return NextResponse.json({ status: "consumed" }, { headers: noStore });
    }

    // Claim the request atomically: this UPDATE only matches while status is still 'approved', so
    // if two polls race, exactly one gets a row back and the other is told "consumed". Only the
    // winner goes on to mint a token — one approval can never produce two tokens.
    const { data: claimed, error: claimErr } = await supabase
      .from("cli_auth_requests")
      .update({ status: "consumed" })
      .eq("id", row.id)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();

    if (claimErr) return safeError("cli-auth-token.claim", claimErr);
    if (!claimed) return NextResponse.json({ status: "consumed" }, { headers: noStore });

    // CLI logins get a limited-scope token that expires (the person just runs `devaudit login`
    // again after that) instead of an all-powerful one that lives forever.
    const token = generateApiToken();
    const baseRow = {
      user_id: row.user_id,
      name: `CLI (${row.client_name})`.slice(0, 60),
      token_hash: hashToken(token),
      token_prefix: apiTokenPrefix(token),
    };
    let { error: insertErr } = await supabase.from("api_tokens").insert({
      ...baseRow,
      expires_at: expiryFromNow(DEFAULT_TOKEN_TTL_DAYS),
      scopes: [...CLI_TOKEN_SCOPES],
    });
    if (isMissingColumnError(insertErr)) {
      // Database predates scopes/expiry — issue the token the old way rather than failing the login.
      ({ error: insertErr } = await supabase.from("api_tokens").insert(baseRow));
    }

    if (insertErr) {
      // Couldn't mint the token — put the request back so the CLI's next poll can retry, rather
      // than burning the user's approval.
      await supabase.from("cli_auth_requests").update({ status: "approved" }).eq("id", row.id);
      return safeError("cli-auth-token.insert", insertErr);
    }

    return NextResponse.json({ status: "approved", token }, { headers: noStore });
  } catch (e) {
    return safeError("cli-auth-token.POST", e, 500, "Failed to check CLI login.");
  }
}
