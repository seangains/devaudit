"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Mail, X, AlertCircle } from "lucide-react";
import { supabase } from "@/utils/supabase";

// Invitations to join someone else's project. Nobody is added to a project just because its owner
// typed their name: the invitation waits here until the invited person accepts (or declines it).
// Backed by /api/invites/inbox, which only ever returns this user's own invitations.

type Invite = { id: string; project_name: string; invited_by: string; created_at: string };

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  } catch { return {}; }
}

export default function PendingInvites({ userId, onJoined }: { userId?: string; onJoined: () => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/invites/inbox", { headers: await authHeaders(), cache: "no-store" });
        if (!res.ok) return; // nothing to show is fine; this never blocks the dashboard
        const data = await res.json();
        if (active && Array.isArray(data?.invites)) setInvites(data.invites);
      } catch { /* best-effort */ }
    })();
    return () => { active = false; };
  }, [userId]);

  async function answer(invite: Invite, decision: "accept" | "decline") {
    setBusy(invite.id); setError(null);
    try {
      const res = await fetch("/api/invites/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ inviteId: invite.id, decision }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && typeof data.error === "string" && data.error) || "Couldn't record your answer. Please try again.");
        // A 404 means it's already gone (cancelled, or answered elsewhere), so drop it from the list.
        if (res.status === 404) setInvites((list) => list.filter((i) => i.id !== invite.id));
      } else {
        setInvites((list) => list.filter((i) => i.id !== invite.id));
        if (decision === "accept") onJoined();
      }
    } catch {
      setError("Couldn't reach DevAudit. Check your connection and try again.");
    }
    setBusy(null);
  }

  if (invites.length === 0 && !error) return null;

  return (
    <div className="mx-4 mt-5 space-y-2 sm:mx-8">
      {invites.map((invite) => (
        <div key={invite.id} role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-[0.8125rem] leading-6 text-cyan-100">
          <Mail size={14} className="shrink-0 text-cyan-300" />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-cyan-50">{invite.invited_by}</span> invited you to join{" "}
            <span className="font-medium text-cyan-50">{invite.project_name}</span>. You&apos;ll be able to view and edit its workspace.
          </span>
          <button
            onClick={() => answer(invite, "accept")} disabled={busy === invite.id}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1 font-medium text-slate-950 hover:brightness-110 disabled:opacity-60"
          >
            {busy === invite.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Accept
          </button>
          <button
            onClick={() => answer(invite, "decline")} disabled={busy === invite.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 px-3 py-1 font-medium text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-60"
          >
            <X size={12} />Decline
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-[0.8125rem] leading-6 text-red-300"><AlertCircle size={14} className="mt-1 shrink-0" />{error}</p>
      )}
    </div>
  );
}
