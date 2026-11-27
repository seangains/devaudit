import { NextResponse } from "next/server";
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { supabaseServiceRole } from "../_shared/supabaseServiceRole";
import { limitByIp, limitByUser } from "../_shared/limits";
import { safeError } from "../_shared/safeError";
import { isNotificationKind, loadPendingInvites } from "../_shared/notifications";

// ---------------------------------------------------------------------------
// The notification bell.
//
//   GET  /api/notifications                      what the bell shows, plus the unread count
//   POST /api/notifications {ids} | {all: true}  mark notifications as read
//
// A notification is one of:
//   * "invite": a pending invitation to join someone's project. It comes live from project_invites,
//     is always unread, and goes away once it is answered (POST /api/invites/inbox) or cancelled.
//   * "joined" / "left" / "removed" / "member_joined" / "member_left": something that already
//     happened, stored in notifications (supabase/migrations/20261010_notifications.sql).
//
// Everything is scoped to the signed-in user, and people are only ever named by GitHub username
// (never an email). If the notifications table doesn't exist yet, invitations still show.
// ---------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_LISTED = 30;
const MAX_IDS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signedInUser(req: Request) {
  const {
    data: { user },
  } = await supabaseForRequest(req).auth.getUser();
  return user;
}

export async function GET(req: Request) {
  try {
    // The bell polls this, so the limits are generous and a broken limiter doesn't hide it.
    const limitedIp = await limitByIp(req, "notifications-get", 120, { failOpen: true });
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ notifications: [], unread: 0 }, { headers: NO_STORE });
    const limitedUser = await limitByUser(user.id, "notifications-get", 60, { failOpen: true });
    if (limitedUser) return limitedUser;

    const admin = supabaseServiceRole();
    const [invites, stored, unreadStored] = await Promise.all([
      loadPendingInvites(admin, user.id),
      admin
        .from("notifications")
        .select("id, kind, project_name, actor_name, created_at, read_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(MAX_LISTED),
      admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    ]);
    // Without the notifications table (migration not applied yet) the bell still shows invitations.
    if (stored.error) console.error("[notifications.GET.stored]", stored.error.message);

    const notifications = [
      ...invites.map((i) => ({
        id: `invite:${i.id}`,
        kind: "invite" as const,
        invite_id: i.id,
        project_name: i.project_name,
        actor: i.invited_by,
        created_at: i.created_at,
        read: false,
      })),
      ...(stored.error ? [] : stored.data ?? []).flatMap((r) =>
        isNotificationKind(r.kind)
          ? [{
              id: String(r.id),
              kind: r.kind,
              project_name: String(r.project_name ?? "A project").slice(0, 100),
              actor: r.actor_name ? String(r.actor_name) : null,
              created_at: r.created_at as string,
              read: r.read_at !== null && r.read_at !== undefined,
            }]
          : [],
      ),
    ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    // Invitations count as unread until they are answered. The stored count is exact, not just
    // the length of the (capped) list above.
    const unread = invites.length + (unreadStored.error ? 0 : unreadStored.count ?? 0);

    return NextResponse.json({ notifications, unread }, { headers: NO_STORE });
  } catch (e) {
    return safeError("notifications.GET", e, 500, "Couldn't load your notifications.");
  }
}

export async function POST(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "notifications-post", 60);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "notifications-post", 30);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const markAll = body?.all === true;
    // Invitation ids ("invite:…") and anything else that isn't a notification id are ignored.
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.filter((v: unknown): v is string => typeof v === "string" && UUID_RE.test(v)).slice(0, MAX_IDS)
      : [];
    if (!markAll && ids.length === 0) return NextResponse.json({ ok: true });

    const admin = supabaseServiceRole();
    let query = admin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    if (!markAll) query = query.in("id", ids);
    const { error } = await query;
    if (error) return safeError("notifications.POST", error, 500, "Couldn't update your notifications.");

    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("notifications.POST", e, 500, "Couldn't update your notifications.");
  }
}
