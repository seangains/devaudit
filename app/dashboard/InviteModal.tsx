"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, X, UserPlus, Trash2, AlertCircle } from "lucide-react";
import { authHeaders, removeMember as removeMemberRequest } from "./membershipApi";

// Minimal shape — only what this modal needs from a project row.
type Project = { id: string; name: string; user_id: string };
// What /api/invites returns. People are named by GitHub username (or a neutral label); an email
// address is never sent to this dialog, so it can't be shown to the owner or other members.
type Person = { id: string; user_id: string; role: "owner" | "member"; name: string };
type Pending = { id: string; name: string };
type People = { isOwner: boolean; owner: { name: string }; members: Person[]; pending: Pending[] };

const cta = "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 shadow-[0_0_20px_-4px_rgba(34,211,238,.6)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none";

/** Calls the invites API as the signed-in user. Resolves to the parsed body, or throws an Error
 *  whose message is safe to show (the server never puts internal details in it). */
async function invitesApi(method: "GET" | "POST" | "DELETE", projectId: string, body?: Record<string, unknown>) {
  const res = await fetch(method === "GET" ? `/api/invites?projectId=${encodeURIComponent(projectId)}` : "/api/invites", {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()) },
    body: body ? JSON.stringify({ projectId, ...body }) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Request failed (HTTP ${res.status}).`);
  return data;
}

export default function InviteModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [people, setPeople] = useState<People | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    try {
      setPeople((await invitesApi("GET", project.id)) as People);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't load this project's members.");
    }
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    invitesApi("GET", project.id)
      .then((d) => { if (active) setPeople(d as People); })
      .catch((e) => { if (active) setNotice(e instanceof Error ? e.message : "Couldn't load this project's members."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query || inviting) return;
    setInviting(true); setNotice(null); setInfo(null);
    try {
      // The server does the lookup (exact match only) and records a PENDING invitation. The person
      // joins when they accept it, and the answer is the same whether or not the account exists.
      const data = await invitesApi("POST", project.id, { identifier: query });
      setInfo(typeof data?.message === "string" ? data.message : "Invitation sent.");
      setInput("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't send the invitation.");
    }
    setInviting(false);
  }

  async function cancelInvite(invite: Pending) {
    setRemovingId(invite.id); setNotice(null); setInfo(null);
    try {
      await invitesApi("DELETE", project.id, { inviteId: invite.id });
      setPeople((p) => (p ? { ...p, pending: p.pending.filter((x) => x.id !== invite.id) } : p));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't cancel the invitation.");
    }
    setRemovingId(null);
  }

  async function removeMember(member: Person) {
    setRemovingId(member.id); setNotice(null); setInfo(null);
    const prev = people;
    setPeople((p) => (p ? { ...p, members: p.members.filter((x) => x.id !== member.id) } : p));
    try {
      // Goes through the server so the person who was removed is told about it.
      await removeMemberRequest(project.id, member.id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't remove that member. Please try again.");
      setPeople(prev);
    }
    setRemovingId(null);
  }

  return (
    <div role="presentation" onClick={onClose} className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div
        role="dialog" aria-modal="true" aria-labelledby="invite-modal-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-zinc-800 bg-[#121215] p-5 shadow-[0_0_60px_-12px_rgba(34,211,238,.25)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="invite-modal-title" className="truncate text-sm font-semibold text-zinc-100">Members — {project.name}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Members can view and edit this project&apos;s workspace. People you invite join only after they accept.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
        </div>

        {people?.isOwner && (
          <form onSubmit={handleInvite} className="mt-4 flex gap-2">
            <input
              value={input} onChange={(e) => setInput(e.target.value)} placeholder="GitHub username or full email" maxLength={254}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-[#09090b] px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none"
            />
            <button type="submit" disabled={inviting || !input.trim()} className={`flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${cta}`}>
              {inviting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}Invite
            </button>
          </form>
        )}

        {info && (
          <p role="status" className="mt-3 rounded border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-[11px] leading-4 text-cyan-200">{info}</p>
        )}

        {notice && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-4 text-red-300">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />{notice}
          </p>
        )}

        <div className="mt-4 max-h-64 overflow-y-auto rounded border border-zinc-800/80">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-zinc-800/40" />)}</div>
          ) : (
            <ul className="divide-y divide-zinc-800/80">
              <li className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate font-mono text-xs text-zinc-200">{people?.owner.name ?? "Owner"}</span>
                <span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">Owner</span>
              </li>
              {people && people.members.length === 0 && people.pending.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-zinc-600">No collaborators yet.{people.isOwner ? " Invite someone above." : ""}</li>
              )}
              {people?.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate font-mono text-xs text-zinc-200">{m.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">Contributor</span>
                    <button
                      onClick={() => removeMember(m)} disabled={removingId === m.id} aria-label={`Remove ${m.name}`}
                      className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                    >
                      {removingId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </li>
              ))}
              {people?.pending.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate font-mono text-xs text-zinc-400">{inv.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">Invited</span>
                    <button
                      onClick={() => cancelInvite(inv)} disabled={removingId === inv.id} aria-label={`Cancel invitation for ${inv.name}`}
                      className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                    >
                      {removingId === inv.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
