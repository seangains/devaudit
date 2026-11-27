"use client";

// ---------------------------------------------------------------------------
// Drop this into page.tsx's existing Settings panel (the `{settings ? <main>...` block around
// line 1360) — it doesn't render its own page/route, since this app keeps settings as an in-app
// view rather than a separate Next.js route. Example wiring:
//
//   {settings ? (
//     <main className="relative z-10 p-4 sm:p-6">
//       <div className="mb-4 flex items-center justify-between">...</div>
//       <div className={`${panel} max-w-lg divide-y divide-zinc-800/80 text-xs`}>...</div>
//       <ApiTokensPanel />   {/* <-- add this line */}
//     </main>
//   ) : ...
//
// Talks to app/api/tokens/route.ts, which is session-authenticated — every request below sends
// the current Supabase access token as a normal Authorization: Bearer header, same pattern
// app/api/env/route.ts expects from its caller.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Key, Plus, Loader2, Trash2, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { SectionCard } from "./dashboardUi";

interface ApiToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at?: string | null;
  scopes?: string[] | null;
}

// Keep in sync with API_SCOPES / ALLOWED_TOKEN_TTL_DAYS in app/api/_shared/apiAuth.ts.
const SCOPE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "repos:read", label: "Read repos", hint: "List the repositories DevAudit watches" },
  { value: "errors:read", label: "Read errors", hint: "List and view errors and suggested fixes" },
  { value: "errors:write", label: "Report errors", hint: "Send new errors in (push-watchers, CI)" },
  { value: "errors:fix", label: "Apply fixes", hint: "Open fix branches and commits on your GitHub repos" },
];
const EXPIRY_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

async function authedFetch(path: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body;
}

export default function ApiTokensPanel() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState(90);
  // Least privilege by default: "Apply fixes" (commits to your GitHub repos) is opt-in.
  const [scopes, setScopes] = useState<string[]>(["repos:read", "errors:read", "errors:write"]);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    setError(null);
    authedFetch("/api/tokens")
      .then((body) => setTokens(body.tokens))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load API tokens."));
  }
  useEffect(load, []);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const body = await authedFetch("/api/tokens", { method: "POST", body: JSON.stringify({ name: name.trim(), expires_in_days: expiryDays, scopes }) });
      setFreshToken(body.token);
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the token.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      await authedFetch(`/api/tokens?id=${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't revoke the token.");
    } finally {
      setRevokingId(null);
    }
  }

  function copyFreshToken() {
    if (!freshToken) return;
    navigator.clipboard.writeText(freshToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const active = tokens?.filter((t) => !t.revoked_at) ?? [];

  function toggleScope(value: string) {
    setScopes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }

  function expiryLabel(t: ApiToken): string {
    if (!t.expires_at) return "no expiry";
    const d = new Date(t.expires_at);
    return d.getTime() <= Date.now() ? "expired" : `expires ${d.toLocaleDateString()}`;
  }

  return (
    <SectionCard
      icon={Key} title="API tokens"
      description={<>Used to sign in to the public v1 API (push-watcher integrations, external tools). Send one as{" "}<code className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-zinc-300">Authorization: Bearer &lt;token&gt;</code>.</>}
      info={{ title: "API tokens", body: "A token is like a password for a tool or script. Give each tool its own token so you can revoke just that one later. A new token is only shown once." }}
    >

      {error && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[0.8125rem] leading-6 text-red-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {freshToken && (
        <div className="da-pop mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-[0.8125rem] text-emerald-200">
          <p className="mb-2 flex items-center gap-1.5 font-medium"><CheckCircle2 size={13} />Copy this now — it won't be shown again.</p>
          <div className="flex items-center gap-2 rounded border border-emerald-500/20 bg-[#0b0f0d] px-2.5 py-1.5">
            <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-emerald-100">{freshToken}</code>
            <button onClick={copyFreshToken} className="shrink-0 text-emerald-300 hover:text-emerald-100" aria-label="Copy token">
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button onClick={() => setFreshToken(null)} className="mt-2 text-[11px] text-emerald-300/80 hover:text-emerald-200 underline">
            Done, dismiss
          </button>
        </div>
      )}

      <form onSubmit={createToken} className="mb-6 flex flex-wrap gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name, e.g. CI pipeline"
          aria-label="Token name"
          className="min-w-[14rem] flex-1 rounded-xl border border-zinc-800 bg-[#09090b] px-4 py-3 text-[0.875rem] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || !name.trim() || scopes.length === 0}
          className="da-btn-silver disabled:cursor-not-allowed disabled:opacity-40" data-tip="Create a token. You'll see it once, so copy it straight away."
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          Create token
        </button>

        <div className="flex basis-full flex-wrap items-center gap-x-5 gap-y-2 text-[0.75rem] text-zinc-400">
          <label className="flex items-center gap-2">
            Expires in
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="rounded-lg border border-zinc-800 bg-[#09090b] px-2 py-1.5 text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>{o.label}</option>
              ))}
            </select>
          </label>
          {SCOPE_OPTIONS.map((o) => (
            <label key={o.value} title={o.hint} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={scopes.includes(o.value)}
                onChange={() => toggleScope(o.value)}
                className="accent-zinc-300"
              />
              {o.label}
            </label>
          ))}
        </div>
      </form>

      <div className="divide-y divide-zinc-800/80 overflow-hidden rounded-2xl border border-zinc-800/80 text-[0.8125rem]">
        {tokens === null ? (
          <div className="flex items-center gap-2 p-3 text-zinc-500"><Loader2 size={13} className="animate-spin" />Loading…</div>
        ) : active.length === 0 ? (
          <div className="p-3 text-zinc-500">No active tokens yet.</div>
        ) : (
          active.map((t) => (
            <div key={t.id} className="da-fade flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-200">{t.name}</p>
                <p className="truncate text-[11px] text-zinc-500">
                  Created {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleDateString()}` : " · never used"}
                  {` · ${expiryLabel(t)}`}
                  {t.scopes && t.scopes.length > 0 ? ` · ${t.scopes.join(", ")}` : ""}
                </p>
              </div>
              <button
                onClick={() => revoke(t.id)}
                disabled={revokingId === t.id}
                data-tip="Stop this token working. Tools that use it will lose access."
                className="da-btn-ghost !min-h-9 shrink-0 hover:!border-red-500/30 hover:!text-red-300 disabled:opacity-50"
              >
                {revokingId === t.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}
