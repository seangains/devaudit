import { NextResponse } from "next/server";
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { supabaseServiceRole } from "../_shared/supabaseServiceRole";
import { limitByIp, limitByUser } from "../_shared/limits";
import { safeError } from "../_shared/safeError";
import { ID_PATTERN, displayName, parseInviteIdentifier } from "../_shared/invites";

// ---------------------------------------------------------------------------
// Project invitations, from the OWNER's side (the Members dialog). The invited person's side is
// app/api/invites/inbox.
//
//   GET    /api/invites?projectId=…   who is on the project: owner, members, pending invites
//   POST   /api/invites {projectId, identifier}   invite someone by GitHub username or email
//   DELETE /api/invites {inviteId}    cancel a pending invitation
//
// What changed from the old Members dialog, which did all of this from the browser:
//   * Exact lookup. The browser used ilike on the typed text, so `%` and `_` were wildcards that
//     could probe for accounts. The server matches the full username/email only, and only after
//     checking the caller owns the project.
//   * Consent. Inviting no longer adds anyone to project_members. It records a PENDING invitation
//     (project_invites); the person is added only when THEY accept it (inbox route).
//   * No email exposure. People are returned by GitHub username (or a neutral label); an email
//     address is never selected here, so it can't reach the owner or other members.
//   * Same answer whether or not the account exists, so the dialog can't be used to find out who
//     has a DevAudit account. A typo therefore also "succeeds"; the UI says so.
//
// project_invites is read and written only through the service-role client (RLS on, no policies —
// see supabase/migrations/20261009_project_invites.sql), so every query below is scoped by checks
// made in this file.
// ---------------------------------------------------------------------------

const MAX_PENDING_PER_PROJECT = 25;
const MAX_PENDING_PER_INVITEE = 50;

async function signedInUser(req: Request) {
  const {
    data: { user },
  } = await supabaseForRequest(req).auth.getUser();
  return user;
}

const notFound = () => NextResponse.json({ error: "Project not found." }, { status: 404 });

export async function GET(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "invites-get", 120);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "invites-get", 60);
    if (limitedUser) return limitedUser;

    const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
    if (!ID_PATTERN.test(projectId)) return NextResponse.json({ error: "That projectId isn't valid." }, { status: 400 });

    const admin = supabaseServiceRole();
    const { data: project, error: projectErr } = await admin.from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
    if (projectErr) return safeError("invites.GET.project", projectErr, 500, "Couldn't load this project's members.");
    if (!project) return notFound();

    const { data: members, error: membersErr } = await admin
      .from("project_members")
      .select("id, user_id, role")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (membersErr) return safeError("invites.GET.members", membersErr, 500, "Couldn't load this project's members.");

    const isOwner = project.user_id === user.id;
    const isMember = (members ?? []).some((m) => m.user_id === user.id);
    // Not on the project: answer exactly as if it didn't exist.
    if (!isOwner && !isMember) return notFound();

    // Pending invitations are the owner's business only.
    let pending: Array<{ id: string; invitee_id: string; created_at: string }> = [];
    if (isOwner) {
      const { data, error } = await admin
        .from("project_invites")
        .select("id, invitee_id, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) return safeError("invites.GET.pending", error, 500, "Couldn't load this project's members.");
      pending = data ?? [];
    }

    // Only github_username is selected — never email.
    const ids = Array.from(new Set([project.user_id, ...(members ?? []).map((m) => m.user_id), ...pending.map((p) => p.invitee_id)]));
    const { data: profiles, error: profilesErr } = await admin.from("profiles").select("id, github_username").in("id", ids);
    if (profilesErr) return safeError("invites.GET.profiles", profilesErr, 500, "Couldn't load this project's members.");
    const nameOf = (id: string) => displayName((profiles ?? []).find((p) => p.id === id));

    return NextResponse.json({
      isOwner,
      owner: { name: nameOf(project.user_id) },
      members: (members ?? []).map((m) => ({ id: m.id, user_id: m.user_id, role: m.role, name: nameOf(m.user_id) })),
      pending: pending.map((p) => ({ id: p.id, name: nameOf(p.invitee_id), created_at: p.created_at })),
    });
  } catch (e) {
    return safeError("invites.GET", e, 500, "Couldn't load this project's members.");
  }
}

export async function POST(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "invites-post", 30);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    // Each call probes for one account, so this is deliberately tight.
    const limitedUser = await limitByUser(user.id, "invites-post", 10, { windowSeconds: 600 });
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    if (!ID_PATTERN.test(projectId)) return NextResponse.json({ error: "That projectId isn't valid." }, { status: 400 });
    const lookup = parseInviteIdentifier(body?.identifier);
    if (!lookup) {
      return NextResponse.json({ error: "Enter a GitHub username or a full email address." }, { status: 400 });
    }

    const admin = supabaseServiceRole();
    const { data: project, error: projectErr } = await admin.from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
    if (projectErr) return safeError("invites.POST.project", projectErr, 500, "Couldn't send the invitation.");
    // Only the owner invites. Anyone else gets the same answer as for a project that doesn't exist.
    if (!project || project.user_id !== user.id) return notFound();

    // Exact, case-insensitive match (the pattern has its LIKE metacharacters escaped). Two rows
    // would mean the match isn't unique, so that is treated as "no account".
    const { data: matches, error: lookupErr } = await admin.from("profiles").select("id").ilike(lookup.column, lookup.pattern).limit(2);
    if (lookupErr) return safeError("invites.POST.lookup", lookupErr, 500, "Couldn't send the invitation.");

    const sent = NextResponse.json({
      ok: true,
      message: "If that person has a DevAudit account, they now have an invitation to accept. They only join once they do.",
    });

    if (!matches || matches.length !== 1) return sent;
    const inviteeId: string = matches[0].id;
    if (inviteeId === user.id) return NextResponse.json({ error: "You already own this project." }, { status: 400 });

    const { data: existing, error: existingErr } = await admin
      .from("project_members").select("id").eq("project_id", projectId).eq("user_id", inviteeId).maybeSingle();
    if (existingErr) return safeError("invites.POST.existing", existingErr, 500, "Couldn't send the invitation.");
    if (existing) return NextResponse.json({ error: "That person is already a member of this project." }, { status: 409 });

    const { count: projectPending } = await admin
      .from("project_invites").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if ((projectPending ?? 0) >= MAX_PENDING_PER_PROJECT) {
      return NextResponse.json({ error: "This project has too many pending invitations. Cancel some first." }, { status: 429 });
    }
    // Stops one account being buried in invitations. Same reply as success, so it reveals nothing.
    const { count: inviteePending } = await admin
      .from("project_invites").select("id", { count: "exact", head: true }).eq("invitee_id", inviteeId);
    if ((inviteePending ?? 0) >= MAX_PENDING_PER_INVITEE) return sent;

    const { error: insertErr } = await admin
      .from("project_invites")
      .upsert(
        { project_id: projectId, invitee_id: inviteeId, invited_by: user.id },
        { onConflict: "project_id,invitee_id", ignoreDuplicates: true },
      );
    if (insertErr) return safeError("invites.POST.insert", insertErr, 500, "Couldn't send the invitation.");

    return sent;
  } catch (e) {
    return safeError("invites.POST", e, 500, "Couldn't send the invitation.");
  }
}

export async function DELETE(req: Request) {
  try {
    const limitedIp = await limitByIp(req, "invites-delete", 60);
    if (limitedIp) return limitedIp;
    const user = await signedInUser(req);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limitedUser = await limitByUser(user.id, "invites-delete", 30);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    const inviteId = typeof body?.inviteId === "string" ? body.inviteId : "";
    if (!ID_PATTERN.test(inviteId)) return NextResponse.json({ error: "That inviteId isn't valid." }, { status: 400 });

    const admin = supabaseServiceRole();
    const { data: invite, error: inviteErr } = await admin.from("project_invites").select("id, project_id").eq("id", inviteId).maybeSingle();
    if (inviteErr) return safeError("invites.DELETE.invite", inviteErr, 500, "Couldn't cancel the invitation.");
    if (!invite) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });

    const { data: project, error: projectErr } = await admin.from("projects").select("user_id").eq("id", invite.project_id).maybeSingle();
    if (projectErr) return safeError("invites.DELETE.project", projectErr, 500, "Couldn't cancel the invitation.");
    if (!project || project.user_id !== user.id) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });

    const { error } = await admin.from("project_invites").delete().eq("id", inviteId);
    if (error) return safeError("invites.DELETE.delete", error, 500, "Couldn't cancel the invitation.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError("invites.DELETE", e, 500, "Couldn't cancel the invitation.");
  }
}
