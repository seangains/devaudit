import type { supabaseServiceRole } from "./supabaseServiceRole";
import { displayName } from "./invites";

// ---------------------------------------------------------------------------
// Shared pieces for the notification bell (app/api/notifications) and for the routes that cause
// notifications (accepting an invitation, leaving or being removed from a project).
//
// Two sources feed the bell:
//   * pending invitations, read live from project_invites (loadPendingInvites). They are never
//     copied into the notifications table, so a cancelled or answered invitation just disappears.
//   * events that already happened, stored in notifications (see
//     supabase/migrations/20261010_notifications.sql) and written with notify().
//
// Like project_invites, the notifications table is service-role only (RLS on, no policies), so
// every query that touches it is scoped by user_id in the route that makes it.
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof supabaseServiceRole>;

export const NOTIFICATION_KINDS = ["joined", "left", "removed", "member_joined", "member_left"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export type NewNotification = {
  /** Who receives it. */
  user_id: string;
  kind: NotificationKind;
  project_id: string;
  project_name: string;
  /** The other person in the story (@username, never an email). Null when the story is about the recipient. */
  actor_name?: string | null;
};

/** Records notifications. Best-effort on purpose: someone who has just joined or left a project must
 *  not see that fail because a notification couldn't be written (for example, the migration for the
 *  notifications table hasn't been applied yet). Failures are only logged. */
export async function notify(admin: Admin, rows: NewNotification[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await admin.from("notifications").insert(
      rows.map((r) => ({
        user_id: r.user_id,
        kind: r.kind,
        project_id: String(r.project_id).slice(0, 64),
        project_name: String(r.project_name ?? "A project").slice(0, 100),
        actor_name: r.actor_name ? String(r.actor_name).slice(0, 60) : null,
      })),
    );
    if (error) console.error("[notifications.notify]", error.message);
  } catch (e) {
    console.error("[notifications.notify]", e instanceof Error ? e.message : String(e));
  }
}

/** How a person is named in a notification: their GitHub username, or a neutral label. Never an email. */
export async function nameOfUser(admin: Admin, userId: string): Promise<string> {
  try {
    const { data } = await admin.from("profiles").select("github_username").eq("id", userId).maybeSingle();
    return displayName(data);
  } catch {
    return displayName(null);
  }
}

export type PendingInvite = { id: string; project_name: string; invited_by: string; created_at: string };

/** The invitations waiting for this person, newest first. Throws on a database error so each route
 *  can answer with its own safeError(). Invitations to projects that no longer exist are left out. */
export async function loadPendingInvites(admin: Admin, userId: string, limit = 50): Promise<PendingInvite[]> {
  const { data: invites, error } = await admin
    .from("project_invites")
    .select("id, project_id, invited_by, created_at")
    .eq("invitee_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!invites || invites.length === 0) return [];

  const { data: projects } = await admin.from("projects").select("id, name").in("id", invites.map((i) => i.project_id));
  const { data: inviters } = await admin.from("profiles").select("id, github_username").in("id", invites.map((i) => i.invited_by));

  return invites.flatMap((i) => {
    const project = (projects ?? []).find((p) => p.id === i.project_id);
    if (!project) return []; // the project is gone
    return [{
      id: String(i.id),
      project_name: String(project.name ?? "A project").slice(0, 100),
      invited_by: displayName((inviters ?? []).find((p) => p.id === i.invited_by)),
      created_at: i.created_at as string,
    }];
  });
}
