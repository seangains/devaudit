import { supabase } from "@/utils/supabase";

export type EnvVarMeta = { id: string; key: string; updated_at: string };

/** The signed-in user's current Supabase access token, as a ready-to-spread Authorization
 *  header — used by every request here, and by HostDeployer's own /api/deploy call so the
 *  deploy route can fetch that project's env vars under the same RLS-scoped identity. */
export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Key names and last-updated times only — values are never returned by the server (see
 *  app/api/env/route.ts's module comment). */
export async function listEnvVars(projectId: string): Promise<EnvVarMeta[]> {
  const res = await fetch(`/api/env?projectId=${encodeURIComponent(projectId)}`, {
    headers: await authHeader(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Couldn't load environment variables (HTTP ${res.status}).`);
  return Array.isArray(data?.vars) ? data.vars : [];
}

/** Creates a variable, or replaces one that already exists — there's no partial edit, matching
 *  the write-only design (you set a new value, you never see the old one). */
export async function setEnvVar(projectId: string, key: string, value: string): Promise<void> {
  const res = await fetch("/api/env", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ projectId, key, value }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Couldn't save that variable (HTTP ${res.status}).`);
}

export async function deleteEnvVar(projectId: string, key: string): Promise<void> {
  const res = await fetch(`/api/env?projectId=${encodeURIComponent(projectId)}&key=${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Couldn't delete that variable (HTTP ${res.status}).`);
}
