import { createClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_* variables are inlined at build time, and only when they are referenced as
// literal `process.env.NEXT_PUBLIC_X` expressions (no destructuring, no dynamic keys).
//
// There is deliberately no fallback URL or key here: a hardcoded fallback silently points a
// misconfigured deployment (a preview, a fork, a staging project) at the production database
// instead of telling you the environment is wrong. Fail loudly instead.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "(they must be present at build time).",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
