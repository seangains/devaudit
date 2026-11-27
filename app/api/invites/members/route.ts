import { NextResponse } from "next/server";
import { supabaseForRequest } from "../../_shared/supabaseForRequest";
import { supabaseServiceRole } from "../../_shared/supabaseServiceRole";
import { limitByIp, limitByUser } from "../../_shared/limits";
import { safeError } from "../../_shared/safeError";
import { ID_PATTERN } from "../../_shared/invites";
import { nameOfUser, notify } from "../../_shared/notifications";

// ---------------------------------------------------------------------------
// Leaving a project, or removing someone from it. Both end a project_members row, which is why they
// are here and not in the browser: this is where the notifications get written.
//
//   DELETE /api/invites/members {projectId}             I leave this project (members only)
//   DELETE /api/invites/members {projectId, memberId}   the OWNER removes one of its members
//
//   I leave        -> I get "You left X"; the owner gets "@me left X"
//   owner removes  -> the member gets "@owner removed you from X". The owner chose this, so they
//                     aren't told about it.
//
// Anyone who isn't allowed to do this gets the same "not found" answer as for a project that doesn't
// exist, so the route can't be used to find out which projects or memberships exist. The notifications
// themselves are best-effort (see notify()): a failure to write one never undoes the leave.
// ---------------------------------------------------------------------------

async function signedInUser(req: Request) {
  const {
    data: { user },
  } = await supabaseForRequest(req).auth.getUser();
  return user;
}

const notFound = () => NextResponse.json({ error: "Project not found." }, { status: 404 });

export async function DELETE(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "invites-members-delete", 60);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "invites-members-delete", 30);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    if (!ID_PATTERN.test(projectId)) return NextResponse.json({ error: "That projectId isn't valid." }, { status: 400 });
    // Member row ids are whatever the table uses (usually uuids; a number is accepted too).
    const rawMemberId = typeof body?.memberId === "number" && Number.isFinite(body.memberId) ? String(body.memberId) : body?.memberId;
    const removing = rawMemberId !== undefined && rawMemberId !== null;
    if (removing && (typeof rawMemberId !== "string" || !ID_PATTERN.test(rawMemberId))) {
      return NextResponse.json({ error: "That memberId isn't valid." }, { status: 400 });
    }

    const admin = supabaseServiceRole();
    const { data: project, error: projectErr } = await admin.from("projects").select("id, name, user_id").eq("id", projectId).maybeSingle();
    if (projectErr) return safeError("invites.members.DELETE.project", projectErr, 500, "Couldn't update this project's members.");
    if (!project) return notFound();

    const isOwner = project.user_id === user.id;

    // ---- The owner removes a member -------------------------------------------------------------
    if (removing) {
      if (!isOwner) return notFound();
      const { data: member, error: memberErr } = await admin
        .from("project_members").select("id, user_id").eq("id", rawMemberId).eq("project_id", projectId).maybeSingle();
      if (memberErr) return safeError("invites.members.DELETE.member", memberErr, 500, "Couldn't remove that member.");
      if (!member) return NextResponse.json({ error: "That person isn't a member of this project." }, { status: 404 });

      const { error: deleteErr } = await admin.from("project_members").delete().eq("id", member.id);
      if (deleteErr) return safeError("invites.members.DELETE.remove", deleteErr, 500, "Couldn't remove that member.");

      await notify(admin, [{
        user_id: member.user_id,
        kind: "removed",
        project_id: project.id,
        project_name: project.name,
        actor_name: await nameOfUser(admin, user.id),
      }]);
      return NextResponse.json({ ok: true });
    }

    // ---- I leave -------------------------------------------------------------------------------
    if (isOwner) {
      return NextResponse.json({ error: "You own this project, so you can't leave it. Delete it instead." }, { status: 400 });
    }
    const { data: membership, error: membershipErr } = await admin
      .from("project_members").select("id").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
    if (membershipErr) return safeError("invites.members.DELETE.membership", membershipErr, 500, "Couldn't leave the project.");
    // Not a member: answer exactly as if the project didn't exist.
    if (!membership) return notFound();

    const { error: leaveErr } = await admin.from("project_members").delete().eq("id", membership.id);
    if (leaveErr) return safeError("invites.members.DELETE.leave", leaveErr, 500, "Couldn't leave the project.");

    await notify(admin, [
      { user_id: user.id, kind: "left", project_id: project.id, project_name: project.name },
      { user_id: project.user_id, kind: "member_left", project_id: project.id, project_name: project.name, actor_name: await nameOfUser(admin, user.id) },
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("invites.members.DELETE", e, 500, "Couldn't update this project's members.");
  }
}
