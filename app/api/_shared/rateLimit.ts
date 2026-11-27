import { supabaseServiceRole } from "./supabaseServiceRole";

// Sliding-window rate limiter backed by the `rate_limits` table + `rate_limit_hit` function
// (see supabase/migrations/xxxx_add_rate_limiting.sql). A plain in-memory counter doesn't work
// here because Vercel runs each request on any of several serverless instances with no shared
// memory, so the count has to live somewhere all of them can see — Postgres, in this case.
//
// Fails OPEN on any database error (logs it, but lets the request through) so a rate-limiter
// bug can never take the whole app down. If you'd rather fail closed for a specific route,
// check the return value's `ok` field yourself instead of just `allowed`.
export async function rateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<{ allowed: boolean; remaining: number; ok: boolean }> {
  try {
    const supabase = supabaseServiceRole();
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_key: key,
      p_window_seconds: opts.windowSeconds,
      p_limit: opts.limit,
    });
    if (error || !data?.[0]) {
      console.error("rateLimit: rate_limit_hit failed, failing open:", error?.message);
      return { allowed: true, remaining: opts.limit, ok: false };
    }
    return { allowed: data[0].allowed, remaining: data[0].remaining, ok: true };
  } catch (e) {
    console.error("rateLimit: unexpected error, failing open:", e instanceof Error ? e.message : e);
    return { allowed: true, remaining: opts.limit, ok: false };
  }
}

/** Standard 429 response, with a Retry-After header so well-behaved clients back off cleanly. */
export function rateLimitResponse(windowSeconds: number) {
  return new Response(JSON.stringify({ error: "Too many requests. Slow down and try again shortly." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(windowSeconds) },
  });
}
