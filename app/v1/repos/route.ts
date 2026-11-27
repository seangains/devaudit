import { NextResponse } from "next/server";
import { requireApiToken, ApiAuthError } from "../../api/_shared/apiAuth";
import { supabaseServiceRole } from "../../api/_shared/supabaseServiceRole";
import { safeError } from "../../api/_shared/safeError";

// ---------------------------------------------------------------------------
// GET /v1/repos — "List repositories watched on your account" per the API reference page.
//
// Confirmed schema (public.repositories): id int8, user_id uuid, github_repo_id int8,
// full_name text, connected_at timestamptz. No default_branch column here — the fix route
// looks that up live from GitHub instead of trusting a possibly-stale stored copy.
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const { userId } = await requireApiToken(req, "repos:read");
    const supabase = supabaseServiceRole();

    const { data, error } = await supabase
      .from("repositories")
      .select("id, github_repo_id, full_name, connected_at")
      .eq("user_id", userId)
      .order("full_name", { ascending: true });

    if (error) return safeError("v1.repos.GET", error, 500, "Failed to list repositories.");

    return NextResponse.json({
      repos: (data ?? []).map((r) => ({
        id: r.id,
        full_name: r.full_name,
        github_repo_id: r.github_repo_id,
        watched_since: r.connected_at,
      })),
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return safeError("v1.repos.GET", e, 500, "Failed to list repositories.");
  }
}
