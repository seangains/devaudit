import { NextResponse } from "next/server";
import { supabaseForRequest } from "../../_shared/supabaseForRequest";
import { supabaseServiceRole } from "../../_shared/supabaseServiceRole";
import { limitByIp, limitByUser } from "../../_shared/limits";
import { safeError } from "../../_shared/safeError";
import { ID_PATTERN } from "../../_shared/invites";
import { loadPendingInvites, nameOfUser, notify } from "../../_shared/notifications";

// ---------------------------------------------------------------------------
// Project invitations, from the INVITED person's side. Joining a project needs this person's
// own "accept"; nobody is added to project_members just because an owner typed their name.
//
//   GET  /api/invites/inbox                         invitations waiting for me
//   POST /api/invites/inbox {inviteId, decision}    "accept" or "decline"
//
// Every query is scoped to invitee_id = the signed-in user, so one person can't see or answer
// another person's invitations. The inviter is shown by GitHub username only (never an email).
//
// The notification bell (app/api/notifications) lists these same invitations and answers them here.
// Accepting also leaves two notifications: "You joined X" for the new member and "@name joined X"
// for the project's owner.
// ---------------------------------------------------------------------------

async function signedInUser(req: Request) {
  const {
    data: { user },
  } = await supabaseForRequest(req).auth.getUser();
  return user;
}

export async function GET(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "invites-inbox-get", 120);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ invites: [] }, { headers: { "Cache-Control": "no-store" } });
    const limitedUser = await limitByUser(user.id, "invites-inbox-get", 60);
    if (limitedUser) return limitedUser;

    const invites = await loadPendingInvites(supabaseServiceRole(), user.id);
    return NextResponse.json({ invites }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return safeError("invites.inbox.GET", e, 500, "Couldn't load your invitations.");
  }
}

export async function POST(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "invites-inbox-post", 60);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "invites-inbox-post", 20);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const inviteId = typeof body?.inviteId === "string" ? body.inviteId : "";
    const decision = body?.decision;
    if (!ID_PATTERN.test(inviteId)) return NextResponse.json({ error: "That inviteId isn't valid." }, { status: 400 });
    if (decision !== "accept" && decision !== "decline") {
      return NextResponse.json({ error: 'decision must be "accept" or "decline".' }, { status: 400 });
    }

    const admin = supabaseServiceRole();
    // Scoped to THIS user: someone else's invitation id just isn't found.
    const { data: invite, error: inviteErr } = await admin
      .from("project_invites").select("id, project_id").eq("id", inviteId).eq("invitee_id", user.id).maybeSingle();
    if (inviteErr) return safeError("invites.inbox.POST.invite", inviteErr, 500, "Couldn't record your answer.");
    if (!invite) return NextResponse.json({ error: "That invitation no longer exists." }, { status: 404 });

    // Only set when this answer actually adds the person, so a repeat can't notify twice.
    let joined: { id: string; name: string; ownerId: string } | null = null;

    if (decision === "accept") {
      const { data: project, error: projectErr } = await admin
        .from("projects").select("id, name, user_id").eq("id", invite.project_id).maybeSingle();
      if (projectErr) return safeError("invites.inbox.POST.project", projectErr, 500, "Couldn't record your answer.");
      if (!project) {
        // The project was deleted after the invitation was sent: nothing left to join.
        await admin.from("project_invites").delete().eq("id", invite.id).eq("invitee_id", user.id);
        return NextResponse.json({ error: "That invitation no longer exists." }, { status: 404 });
      }

      const { data: existing, error: existingErr } = await admin
        .from("project_members").select("id").eq("project_id", invite.project_id).eq("user_id", user.id).maybeSingle();
      if (existingErr) return safeError("invites.inbox.POST.existing", existingErr, 500, "Couldn't record your answer.");
      if (!existing) {
        const { error: memberErr } = await admin
          .from("project_members").insert({ project_id: invite.project_id, user_id: user.id, role: "member" });
        if (memberErr) return safeError("invites.inbox.POST.member", memberErr, 500, "Couldn't add you to the project.");
        joined = { id: project.id, name: project.name, ownerId: project.user_id };
      }
    }

    const { error: deleteErr } = await admin.from("project_invites").delete().eq("id", invite.id).eq("invitee_id", user.id);
    if (deleteErr) return safeError("invites.inbox.POST.delete", deleteErr, 500, "Couldn't record your answer.");

    if (joined) {
      await notify(admin, [
        { user_id: user.id, kind: "joined", project_id: joined.id, project_name: joined.name },
        { user_id: joined.ownerId, kind: "member_joined", project_id: joined.id, project_name: joined.name, actor_name: await nameOfUser(admin, user.id) },
      ]);
    }

    return NextResponse.json({ ok: true, decision });
  } catch (e) {
    return safeError("invites.inbox.POST", e, 500, "Couldn't record your answer.");
  }
}
