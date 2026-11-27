import { randomInt } from "crypto";
import { getClientIp } from "./limits";

// ---------------------------------------------------------------------------
// Shared bits for the CLI "browser login" (device authorization) flow:
//
//   CLI  -> POST /v1/cli-auth/start        gets a secret device_code + a short user_code
//   CLI  -> shows the user_code, opens {site}/cli-auth in the browser, then polls
//   User -> types the code at /cli-auth, clicks Approve  (GET/POST /api/cli-auth, session-authed)
//   CLI  -> POST /v1/cli-auth/token        once approved, receives a normal API token, exactly once
//
// The CLI ends up holding an ordinary api_tokens token — the rest of the v1 API is unchanged, and
// each login is its own revocable token ("CLI (<machine name>)") in account settings.
// ---------------------------------------------------------------------------

export const CLI_AUTH_TTL_SECONDS = 600; // a login attempt is valid for 10 minutes
export const CLI_AUTH_POLL_INTERVAL_SECONDS = 3;
export const CLI_AUTH_PAGE_PATH = "/cli-auth"; // the approval page (app/cli-auth/page.tsx)

// No vowels (a code can't spell a word) and no look-alikes (no 0/O, no 1/I/L).
const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH = 8;

/** e.g. "KTQM-7XWB". randomInt is unbiased, unlike `byte % alphabet.length`. */
export function generateUserCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Accepts "ktqm 7xwb", "KTQM-7XWB", etc. Returns the canonical form, or null if it can't be a code. */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** The machine name the CLI reports. Untrusted input: strip control chars, cap the length. It's only
 *  ever displayed as plain text and used in a token label — never trusted as proof of anything. */
export function cleanClientName(input: unknown): string {
  const s = typeof input === "string" ? input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) : "";
  return s || "CLI";
}

/** Where the approval page lives. Prefers NEXT_PUBLIC_SITE_URL (already in your README's env list);
 *  falls back to the request's own origin. */
export function siteUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  const base = env && /^https?:\/\//.test(env) ? env : new URL(req.url).origin;
  return base.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Where a login request came from. Shown on the approval page so the person approving can tell
// "that's my terminal" from "that's a stranger's" — a random "Terminal #a3f9" label can't.
// IP comes from the validated getClientIp(); city/country come from Vercel's geo headers (absent
// off Vercel, in which case only the IP is shown). Everything is untrusted text that is stored and
// displayed as plain text only, so it's stripped of control characters and length-capped.
// ---------------------------------------------------------------------------

export interface RequestOrigin {
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

function cleanGeoValue(raw: string | null, max: number): string | null {
  if (!raw) return null;
  let v = raw;
  try {
    v = decodeURIComponent(raw);
  } catch {
    /* keep the raw value */
  }
  v = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return v || null;
}

export function getRequestOrigin(req: Request): RequestOrigin {
  const country = cleanGeoValue(req.headers.get("x-vercel-ip-country"), 2);
  return {
    ip: getClientIp(req),
    city: cleanGeoValue(req.headers.get("x-vercel-ip-city"), 60),
    region: cleanGeoValue(req.headers.get("x-vercel-ip-country-region"), 20),
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
  };
}
