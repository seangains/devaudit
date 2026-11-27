import { NextResponse } from "next/server";
import { requireApiToken, ApiAuthError } from "../../../api/_shared/apiAuth";
import { supabaseServiceRole } from "../../../api/_shared/supabaseServiceRole";
import { safeError } from "../../../api/_shared/safeError";

// ---------------------------------------------------------------------------
// GET /v1/errors/:id — "Fetch a single error's full autopsy, including cause and suggested fix"
// per the API reference page.
// ---------------------------------------------------------------------------

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireApiToken(req, "errors:read");
    const supabase = supabaseServiceRole();
    const { id } = await params;
    // ids are int8; anything else would reach Postgres as a type error and come back as a 500.
    if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: "Error not found." }, { status: 404 });

    const { data, error } = await supabase
      .from("errors")
      .select(
        "id, file, line, severity, message, cause, suggested_fix, suggested_patch, status, commit_sha, created_at, repositories!inner(full_name, user_id)",
      )
      .eq("id", id)
      .eq("repositories.user_id", userId)
      .maybeSingle();

    if (error) return safeError("v1.errors.id.GET", error, 500, "Failed to fetch error.");
    if (!data) return NextResponse.json({ error: "Error not found." }, { status: 404 });

    return NextResponse.json({
      id: data.id,
      repo: (data as any).repositories?.full_name,
      file: data.file,
      line: data.line,
      severity: data.severity,
      message: data.message,
      cause: data.cause,
      suggested_fix: data.suggested_fix,
      status: data.status,
      commit_sha: data.commit_sha,
      created_at: data.created_at,
      // suggested_patch deliberately omitted from the public shape — it's raw file content, not
      // something an API consumer needs to see; /v1/errors/:id/fix applies it server-side.
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return safeError("v1.errors.id.GET", e, 500, "Failed to fetch error.");
  }
}
