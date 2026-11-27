import { createClient } from "@supabase/supabase-js";

/** Service-role Supabase client, used only by the public v1 API (see app/api/_shared/apiAuth.ts
 *  for why: a DevAudit API token isn't a Supabase session, so there's no caller JWT for
 *  supabaseForRequest.ts's RLS-scoped pattern to key off). Every query made with this client
 *  bypasses RLS entirely, so callers MUST filter by the userId that apiAuth.ts resolved — never
 *  query with this client on unvalidated input.
 *
 *  ASSUMPTION: a new SUPABASE_SERVICE_ROLE_KEY env var (from Project Settings → API in Supabase)
 *  is configured server-side, alongside the existing NEXT_PUBLIC_SUPABASE_URL. Never expose this
 *  key to the client — it must not be prefixed NEXT_PUBLIC_. */
export function supabaseServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
