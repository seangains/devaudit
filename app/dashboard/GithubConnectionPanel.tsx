"use client";

// "GitHub connection" card for Settings: shows whether this account has a GitHub token stored on
// the server and lets the person delete it. Signing out deliberately leaves the stored token in
// place (the CLI and API features that run without a browser still need it), so without this
// there was no in-app way to remove it.
//
// Talks to DELETE /api/github/connection (session-authenticated, bearer header like the other
// settings panels). That removes OUR encrypted copy. It cannot revoke the grant on GitHub's side,
// so the panel also points to github.com/settings/applications for a full revoke.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { SectionCard } from "./dashboardUi";
import { clearGithubToken, hasGithubToken, onGithubConnectionChange, refreshGithubConnection } from "./CodeStudio";
import { scrubProviderTokens } from "@/components/GithubTokenSync";

export default function GithubConnectionPanel() {
  const [connected, setConnected] = useState<boolean | null>(null); // null = still checking
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justDisconnected, setJustDisconnected] = useState(false);

  useEffect(() => {
    let active = true;
    refreshGithubConnection().then((ok) => { if (active) setConnected(ok); });
    // Stay in step with the rest of the dashboard (e.g. GitHub rejecting a dead token elsewhere).
    const off = onGithubConnectionChange(() => { if (active) setConnected(hasGithubToken()); });
    return () => { active = false; off(); };
  }, []);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You're signed out. Sign in again to manage the GitHub connection.");
      const res = await fetch("/api/github/connection", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body?.error === "string" && body.error ? body.error : `Couldn't disconnect GitHub (error ${res.status}).`);
      }
      // Also drop any raw provider token still sitting in this browser's saved session, so the
      // next page load can't quietly hand it back to the server and undo the disconnect.
      scrubProviderTokens();
      clearGithubToken();
      setConnected(false);
      setJustDisconnected(true);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disconnect GitHub. Try again.");
    }
    setBusy(false);
  }

  return (
    <SectionCard
      icon={ShieldCheck}
      title="GitHub connection"
      description="The GitHub access DevAudit keeps for your account, stored encrypted on the server."
    >
      <div className="space-y-4 text-[0.875rem] leading-6 text-zinc-400">
        {connected === null ? (
          <p className="flex items-center gap-2 text-zinc-500"><Loader2 size={15} className="animate-spin" />Checking…</p>
        ) : connected ? (
          <>
            <p className="flex items-center gap-2 text-zinc-200"><CheckCircle2 size={16} className="text-emerald-400" />Connected</p>
            <p>
              This lets Code Studio read and sync your repositories and lets the CLI and API apply fixes. Disconnecting deletes the stored
              token: those features stop working until you sign in with GitHub again. Signing out does <em>not</em> remove it.
            </p>
            {confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={disconnect} disabled={busy} className="da-btn-ghost !border-red-500/40 !text-red-300">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}Yes, disconnect GitHub
                </button>
                <button type="button" onClick={() => { setConfirming(false); setError(null); }} disabled={busy} className="da-btn-ghost">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="da-btn-ghost" data-tip="Delete the GitHub token DevAudit has stored for you">
                <LogOut size={15} />Disconnect GitHub
              </button>
            )}
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-zinc-300">
              {justDisconnected ? <CheckCircle2 size={16} className="text-emerald-400" /> : null}
              {justDisconnected ? "Disconnected. The stored GitHub token has been deleted." : "Not connected. Sign in with GitHub to connect."}
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-red-400"><AlertCircle size={15} className="mt-1 shrink-0" />{error}</p>
        )}

        <p className="text-[0.8125rem] text-zinc-500">
          This removes DevAudit&apos;s copy only. To make GitHub itself stop honouring the access, also remove DevAudit under{" "}
          <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline hover:text-zinc-300">
            GitHub &rarr; Settings &rarr; Applications<ExternalLink size={12} />
          </a>.
        </p>
      </div>
    </SectionCard>
  );
}
