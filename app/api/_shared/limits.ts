import { NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "./rateLimit";

// ---------------------------------------------------------------------------
// Shared per-IP and per-user rate limiting for routes. Wraps rateLimit() (which FAILS OPEN on a
// database error) so each route can choose:
//   * failOpen: false (default) — if the limiter itself is broken, answer 503. Use for anything
//     that costs money, writes data, or guards secrets (AI, deploy, tokens, env vars, login).
//   * failOpen: true — if the limiter is broken, let the request through. Fine for cheap,
//     read-mostly routes where the limiter is only a courtesy.
//
// Usage (IP first, BEFORE the auth lookup, so floods are cut off cheaply; user second):
//   const limited = await limitByIp(req, "tokens", 60);        if (limited) return limited;
//   ...authenticate...
//   const limited2 = await limitByUser(user.id, "tokens", 20); if (limited2) return limited2;
// ---------------------------------------------------------------------------

// Best-effort client IP. On Vercel, x-real-ip / x-forwarded-for are set by the platform and can't be
// spoofed by the client. Behind a different proxy (e.g. Cloudflare in front of Vercel), or when
// self-hosted, configure that proxy to overwrite them, or every request may look like one IP. The
// value is strictly validated because it becomes a database key: a junk or oversized header must
// not be able to create unbounded rows in the rate-limit table. IPv6 is bucketed by /64 (one
// household/host owns a whole /64), so rotating addresses inside it doesn't dodge the limit.
// Returns null when there's no usable IP.
export function getClientIp(req: Request): string | null {
  const raw = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  const ip = raw.trim();
  if (ip.length === 0 || ip.length > 45 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;

  if (!ip.includes(":")) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : null;

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i); // IPv4-mapped IPv6
  if (mapped) return mapped[1];
  if (ip.includes(".")) return null;

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, "0")).join(":")}::/64`;
}

interface LimitOpts {
  windowSeconds?: number;
  failOpen?: boolean;
  /** For UNAUTHENTICATED routes: when no usable client IP can be determined (header missing or
   *  malformed), apply this limit to one shared "unknown" bucket instead of skipping the check.
   *  Without it, an attacker who gets their requests classed as "no IP" would bypass the limiter. */
  unknownIpLimit?: number;
}

function verdict(r: { allowed: boolean; ok: boolean }, windowSeconds: number, failOpen: boolean): Response | null {
  if (!r.ok) {
    return failOpen
      ? null
      : NextResponse.json({ error: "Service temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
  return r.allowed ? null : rateLimitResponse(windowSeconds);
}

/** Per-IP limit. Returns a Response to send back if limited/unavailable, otherwise null. */
export async function limitByIp(req: Request, scope: string, limit: number, opts: LimitOpts = {}): Promise<Response | null> {
  const ip = getClientIp(req);
  const windowSeconds = opts.windowSeconds ?? 60;
  if (!ip) {
    // Authenticated routes: the per-user limit still applies, so skipping is fine. Unauthenticated
    // routes opt in to a shared bucket so a missing IP can't be used to dodge the limit.
    if (opts.unknownIpLimit === undefined) return null;
    const shared = await rateLimit(`${scope}-ip:unknown`, { limit: opts.unknownIpLimit, windowSeconds });
    return verdict(shared, windowSeconds, opts.failOpen ?? false);
  }
  const r = await rateLimit(`${scope}-ip:${ip}`, { limit, windowSeconds });
  return verdict(r, windowSeconds, opts.failOpen ?? false);
}

/** Per-user limit. Returns a Response to send back if limited/unavailable, otherwise null. */
export async function limitByUser(userId: string, scope: string, limit: number, opts: LimitOpts = {}): Promise<Response | null> {
  const windowSeconds = opts.windowSeconds ?? 60;
  const r = await rateLimit(`${scope}:${userId}`, { limit, windowSeconds });
  return verdict(r, windowSeconds, opts.failOpen ?? false);
}
