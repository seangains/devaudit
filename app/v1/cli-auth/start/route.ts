import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { hashToken, isMissingColumnError } from "../../../api/_shared/apiAuth";
import { supabaseServiceRole } from "../../../api/_shared/supabaseServiceRole";
import { limitByIp } from "../../../api/_shared/limits";
import { safeError } from "../../../api/_shared/safeError";
import {
  CLI_AUTH_TTL_SECONDS,
  CLI_AUTH_POLL_INTERVAL_SECONDS,
  CLI_AUTH_PAGE_PATH,
  generateUserCode,
  getRequestOrigin,
  siteUrl,
} from "../../../api/_shared/cliAuth";

// ---------------------------------------------------------------------------
// POST /v1/cli-auth/start — step 1 of the CLI's browser login. Deliberately UNAUTHENTICATED (the
// CLI has no token yet — that's the whole point), so it does nothing but create a pending request:
// no user is attached until a signed-in person approves it at the approval page.
//
// Returns the two codes:
//   device_code — the CLI's secret. Only its sha256 is stored, so it can't be recovered from the DB.
//   user_code   — short, human-typed at the approval page to link that browser session to this CLI.
//
// The label for this login (shown on the approval page and used in the token's name) is generated
// HERE, never taken from the client. An unauthenticated caller — including an old CLI version that
// still sends its machine name — can't put personal or misleading text on the approval page.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    // Unauthenticated and writes a row on every call, so cap it per IP — and fail CLOSED if the
    // limiter is down (an open write endpoint with no limit is how tables get bloated). A real
    // person starts a login a handful of times per hour at most. A request with no usable IP
    // shares one stricter-than-nothing bucket instead of skipping the check.
    const limited = await limitByIp(req, "cli-auth-start", 10, { windowSeconds: 600, unknownIpLimit: 60 });
    if (limited) return limited;

    const supabase = supabaseServiceRole();
    const origin = getRequestOrigin(req);

    // This endpoint is unauthenticated, so keep the table from growing forever: drop anything that
    // expired more than a day ago. Best-effort — a failed cleanup must never block a login.
    await supabase
      .from("cli_auth_requests")
      .delete()
      .lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const deviceCode = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + CLI_AUTH_TTL_SECONDS * 1000).toISOString();
    // e.g. "Terminal #a3f9" -> token is named "CLI (Terminal #a3f9)"
    const clientName = `Terminal #${randomBytes(2).toString("hex")}`;

    // user_code has a unique constraint; on the (astronomically unlikely) collision, draw another.
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = generateUserCode();
      const baseRow = {
        device_code_hash: hashToken(deviceCode),
        user_code: userCode,
        client_name: clientName,
        expires_at: expiresAt,
      };
      // requester_* record where this request came from so the approval page can show it. If those
      // columns haven't been added to the database yet, fall back to the plain row so login keeps
      // working (the approval page then just has less to show).
      let { error } = await supabase.from("cli_auth_requests").insert({
        ...baseRow,
        requester_ip: origin.ip,
        requester_city: origin.city,
        requester_region: origin.region,
        requester_country: origin.country,
      });
      if (isMissingColumnError(error)) {
        ({ error } = await supabase.from("cli_auth_requests").insert(baseRow));
      }

      if (!error) {
        return NextResponse.json({
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${siteUrl(req)}${CLI_AUTH_PAGE_PATH}`,
          expires_in: CLI_AUTH_TTL_SECONDS,
          interval: CLI_AUTH_POLL_INTERVAL_SECONDS,
        });
      }
      if (error.code !== "23505") return safeError("cli-auth-start.insert", error, 500, "Failed to start CLI login.");
    }

    return NextResponse.json({ error: "Couldn't allocate a login code. Please try again." }, { status: 500 });
  } catch (e) {
    return safeError("cli-auth-start.POST", e, 500, "Failed to start CLI login.");
  }
}
