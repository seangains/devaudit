import { NextResponse } from "next/server";
import { encryptValue, envVarAad } from "./crypto";
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { safeError } from "../_shared/safeError";
import { limitByIp, limitByUser } from "../_shared/limits";

// ---------------------------------------------------------------------------
// Write-only, encrypted, per-project environment variables (the Deploy tab's "Environment
// Variables" panel). Assumptions this file makes — check them against your actual setup:
//
// 1. Env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, plus a server-only
//    ENV_VARS_ENCRYPTION_KEY (see crypto.ts's error message for how to generate one).
// 2. Authorization is delegated to Postgres RLS: supabaseForRequest builds a Supabase client using
//    the *caller's own* access token, so every query below is scoped to rows that
//    project_env_vars' RLS policies say this user may touch. This file now ALSO requires a valid
//    sign-in on every method (GET and DELETE used to rely on RLS alone).
//    IMPORTANT: whoever RLS lets read these rows can deploy the project, and the deploy step
//    decrypts the values and sends them to the host — so RLS should allow only people you'd trust
//    with the secrets (owners/editors), not every project member.
// 3. Schema: projects(id, user_id) and project_members(project_id, user_id, role).
// 4. Nothing in this route ever decrypts a value or returns one to the client — only key names and
//    timestamps. Setting a variable always replaces the whole value (upsert).
// 5. Values are encrypted bound to their project + key name (see crypto.ts, "v2"), so a stored
//    value copied into another project or under another name fails to decrypt.
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_KEY_CHARS = 128;
const MAX_VALUE_CHARS = 8000;
const MAX_VARS_PER_PROJECT = 50;
// Accepts UUIDs and other plain id shapes; rejects anything that isn't a short, simple identifier.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Postgres "insufficient_privilege" — what an RLS policy violation on write looks like.
const RLS_VIOLATION = "42501";

function dbFail(context: string, error: { code?: string; message: string }, action: string) {
  if (error.code === RLS_VIOLATION) {
    return safeError(context, new Error(error.message), 403, `You don't have permission to ${action}.`);
  }
  return safeError(context, new Error(error.message));
}

export async function GET(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "env", 120);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "env-read", 60);
    if (limitedUser) return limitedUser;

    const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
    if (!projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    if (!ID_PATTERN.test(projectId)) return NextResponse.json({ error: "That projectId isn't valid." }, { status: 400 });

    const { data, error } = await supabase
      .from("project_env_vars")
      .select("id, key, updated_at")
      .eq("project_id", projectId)
      .order("key", { ascending: true });

    if (error) return dbFail("env.GET", error, "view this project's environment variables");
    return NextResponse.json({ vars: data ?? [] });
  } catch (e) {
    return safeError("env.GET", e, 500, "Failed to load environment variables.");
  }
}

export async function POST(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "env-write", 60);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "env-write", 20);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const value = typeof body?.value === "string" ? body.value : "";

    if (!projectId || !key) return NextResponse.json({ error: "projectId and key are required." }, { status: 400 });
    if (!ID_PATTERN.test(projectId)) return NextResponse.json({ error: "That projectId isn't valid." }, { status: 400 });
    if (key.length > MAX_KEY_CHARS || !KEY_PATTERN.test(key)) {
      return NextResponse.json(
        { error: "Keys must be UPPER_SNAKE_CASE, start with a letter, and be under 128 characters, e.g. API_URL or STRIPE_SECRET_KEY." },
        { status: 400 },
      );
    }
    if (!value) return NextResponse.json({ error: "Give the variable a value." }, { status: 400 });
    if (value.length > MAX_VALUE_CHARS) {
      return NextResponse.json({ error: `That value is too long (max ${MAX_VALUE_CHARS} characters).` }, { status: 400 });
    }

    // Cap variables per project so one account can't create unbounded rows. Replacing an existing
    // variable is always allowed, even at the cap.
    const { count, error: countError } = await supabase
      .from("project_env_vars")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (countError) return dbFail("env.POST.count", countError, "change this project's environment variables");
    if ((count ?? 0) >= MAX_VARS_PER_PROJECT) {
      const { data: existing, error: existingError } = await supabase
        .from("project_env_vars")
        .select("id")
        .eq("project_id", projectId)
        .eq("key", key)
        .maybeSingle();
      if (existingError) return dbFail("env.POST.existing", existingError, "change this project's environment variables");
      if (!existing) {
        return NextResponse.json(
          { error: `A project can have at most ${MAX_VARS_PER_PROJECT} environment variables. Delete one first.` },
          { status: 400 },
        );
      }
    }

    const encrypted_value = encryptValue(value, envVarAad(projectId, key));
    const { error } = await supabase.from("project_env_vars").upsert(
      {
        project_id: projectId,
        key,
        encrypted_value,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,key" },
    );

    if (error) return dbFail("env.POST", error, "change this project's environment variables");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("env.POST", e, 500, "Failed to save the environment variable.");
  }
}

export async function DELETE(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "env-write", 60);
    if (limitedIp) return limitedIp;

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "env-write", 20);
    if (limitedUser) return limitedUser;

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") ?? "";
    const key = searchParams.get("key") ?? "";
    if (!projectId || !key) return NextResponse.json({ error: "projectId and key are required." }, { status: 400 });
    if (!ID_PATTERN.test(projectId) || key.length > MAX_KEY_CHARS || !KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "projectId or key isn't valid." }, { status: 400 });
    }

    // RLS silently filters rows the caller can't touch, so "nothing deleted" covers both
    // "no such variable" and "not yours" without revealing which.
    const { data, error } = await supabase
      .from("project_env_vars")
      .delete()
      .eq("project_id", projectId)
      .eq("key", key)
      .select("id");
    if (error) return dbFail("env.DELETE", error, "delete this environment variable");
    if (!data || data.length === 0) return NextResponse.json({ error: "Variable not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("env.DELETE", e, 500, "Failed to delete the environment variable.");
  }
}
