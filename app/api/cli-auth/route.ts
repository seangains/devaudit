import { NextResponse } from "next/server";
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { supabaseServiceRole } from "../_shared/supabaseServiceRole";
import { getRequestOrigin, normalizeUserCode } from "../_shared/cliAuth";
import { limitByIp, limitByUser } from "../_shared/limits";
import { safeError } from "../_shared/safeError";

// ---------------------------------------------------------------------------
// Session-authenticated half of the CLI's browser login (the /cli-auth page calls this).
// Same convention as app/api/tokens/route.ts: supabaseForRequest identifies WHO is signed in — but
// cli_auth_requests has RLS enabled with no policies (see the migration), so the actual read/write
// goes through the service-role client, always scoped by the code the person typed.
//
//   GET  /api/cli-auth?code=KTQM-7XWB   → what is this code asking for? (so the page can show
//                                          "Approve login from <machine>?" before anything changes)
//   POST /api/cli-auth {code, decision} → decision is "approve" or "deny"
//
// Approving stamps the request with the approver's user_id. The CLI's next poll then mints an
// ordinary API token for THAT user. A code that's unknown, expired, or already used gets the same
// 404 as one that never existed, so the page can't be used to probe which codes are live.
// ---------------------------------------------------------------------------

const NOT_FOUND_MESSAGE = "That code is invalid, expired, or has already been used.";

async function signedInUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const supabase = supabaseForRequest(req);
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return user?.id ?? null;
}

export async function GET(req: Request) {
  try {
    // Per-IP first (cheap, before any auth lookup), then per-user once we know who's asking. Both
    // fail closed: this endpoint is a code-guessing oracle if it's ever left unmetered.
    const limitedIp = await limitByIp(req, "cli-auth-lookup", 30);
    if (limitedIp) return limitedIp;

    const userId = await signedInUserId(req);
    if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(userId, "cli-auth-lookup", 10);
    if (limitedUser) return limitedUser;

    const code = normalizeUserCode(new URL(req.url).searchParams.get("code"));
    if (!code) return NextResponse.json({ error: "That doesn't look like a valid code." }, { status: 400 });

    const admin = supabaseServiceRole();
    // select("*") so this works before and after the requester_* columns exist (see
    // v1/cli-auth/start): older rows / an older schema just have nothing to show for them.
    const { data, error } = await admin
      .from("cli_auth_requests")
      .select("*")
      .eq("user_code", code)
      .maybeSingle();

    if (error) return safeError("cli-auth.GET", error, 500, "Failed to look up the code.");
    if (!data || data.status !== "pending" || new Date(data.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    // Where the request came from vs. where the person approving is right now. A mismatch isn't
    // proof of anything (SSH sessions, VPNs), but it's exactly what a phished approval looks like,
    // so the page shows both side by side and warns on a difference.
    const viewer = getRequestOrigin(req);
    const requesterIp: string | null = data.requester_ip ?? null;
    return NextResponse.json({
      code,
      client_name: data.client_name,
      created_at: data.created_at,
      expires_at: data.expires_at,
      requested_from: {
        ip: requesterIp,
        city: data.requester_city ?? null,
        region: data.requester_region ?? null,
        country: data.requester_country ?? null,
      },
      your_ip: viewer.ip,
      same_network: requesterIp && viewer.ip ? requesterIp === viewer.ip : null,
    });
  } catch (e) {
    return safeError("cli-auth.GET", e, 500, "Failed to look up the code.");
  }
}

export async function POST(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "cli-auth-decide", 30);
    if (limitedIp) return limitedIp;

    const userId = await signedInUserId(req);
    if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(userId, "cli-auth-decide", 10);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const code = normalizeUserCode(body?.code);
    const decision = body?.decision;
    if (!code) return NextResponse.json({ error: "That doesn't look like a valid code." }, { status: 400 });
    if (decision !== "approve" && decision !== "deny") {
      return NextResponse.json({ error: 'decision must be "approve" or "deny".' }, { status: 400 });
    }

    // One conditional UPDATE: only a still-pending, unexpired request can change state, so a code
    // can be decided exactly once and an expired one can never be approved late.
    const admin = supabaseServiceRole();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("cli_auth_requests")
      .update(
        decision === "approve"
          ? { status: "approved", user_id: userId, approved_at: now }
          : { status: "denied" },
      )
      .eq("user_code", code)
      .eq("status", "pending")
      .gt("expires_at", now)
      .select("id")
      .maybeSingle();

    if (error) return safeError("cli-auth.POST", error, 500, "Failed to record your decision.");
    if (!data) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

    return NextResponse.json({ ok: true, decision });
  } catch (e) {
    return safeError("cli-auth.POST", e, 500, "Failed to record your decision.");
  }
}
