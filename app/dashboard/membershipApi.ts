import { supabase } from "@/utils/supabase";

// Browser-side calls for the parts of project membership that happen on the server, so that the
// people involved get notified (see app/api/invites/members).

export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  } catch { return {}; }
}

async function deleteMembership(body: Record<string, unknown>, fallback: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/invites/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error("Couldn't reach DevAudit. Check your connection and try again.");
  }
  if (res.ok) return;
  const data = await res.json().catch(() => null);
  throw new Error((data && typeof data.error === "string" && data.error) || fallback);
}

/** The signed-in person leaves a project they were invited to. The owner is notified. */
export function leaveProject(projectId: string): Promise<void> {
  return deleteMembership({ projectId }, "Couldn't leave the project. Please try again.");
}

/** The owner removes one of the project's members. The member is notified. */
export function removeMember(projectId: string, memberId: string): Promise<void> {
  return deleteMembership({ projectId, memberId }, "Couldn't remove that member. Please try again.");
}
