import { createClient } from "@supabase/supabase-js";

/** Builds a Supabase client scoped to whoever's access token is on this request (sent as a
 *  normal Authorization: Bearer header — see envVars.ts's authHeader()), so every query made
 *  with it is already restricted by Postgres RLS to rows that user may touch. Used instead of a
 *  service-role key anywhere a route just needs to act "as the caller" rather than as an admin. */
export function supabaseForRequest(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured on the server.");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
