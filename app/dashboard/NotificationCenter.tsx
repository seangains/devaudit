"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Bell, Check, CheckCheck, Loader2, LogOut, Mail, UserMinus, UserPlus, X, type LucideIcon } from "lucide-react";
import { authHeaders } from "./membershipApi";

// ---------------------------------------------------------------------------------------------
// Notifications: the bell in the top bar, its list, and the modal for answering an invitation.
//
//   useNotifications()      loads and refreshes the list (api/notifications), owns the unread count
//   <NotificationBell/>     the button + number badge + dropdown list
//   <InviteResponseModal/>  an invitation's details with Accept / Decline
//
// What shows up here:
//   * invitations to join someone else's project. Nobody is added to a project just because its owner
//     typed their name: the invitation waits until the invited person accepts it (or declines).
//   * you joined / you left / you were removed from a project
//   * for project owners: someone joined / someone left their project
// ---------------------------------------------------------------------------------------------

export type NotificationKind = "invite" | "joined" | "left" | "removed" | "member_joined" | "member_left";

export type AppNotification = {
  /** "invite:<id>" for an invitation, otherwise the stored notification's id. */
  id: string;
  kind: NotificationKind;
  project_name: string;
  /** The other person in the story (GitHub username, never an email). */
  actor: string | null;
  created_at: string;
  read: boolean;
  /** Set on invitations: the id to answer through /api/invites/inbox. */
  invite_id?: string;
};

export type AnswerResult = { ok: true } | { ok: false; error: string; gone?: boolean };

export type Notifications = {
  items: AppNotification[];
  /** What the badge shows. Pending invitations count until they're answered. */
  unread: number;
  loaded: boolean;
  refresh: (force?: boolean) => Promise<void>;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  respond: (invite: AppNotification, decision: "accept" | "decline") => Promise<AnswerResult>;
};

const KINDS: readonly string[] = ["invite", "joined", "left", "removed", "member_joined", "member_left"];
const POLL_MS = 30_000;
const MIN_GAP_MS = 2_000;

function parseNotification(raw: unknown): AppNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.kind !== "string" || !KINDS.includes(r.kind)) return null;
  if (typeof r.project_name !== "string" || typeof r.created_at !== "string") return null;
  if (r.kind === "invite" && typeof r.invite_id !== "string") return null;
  return {
    id: r.id,
    kind: r.kind as NotificationKind,
    project_name: r.project_name,
    actor: typeof r.actor === "string" && r.actor ? r.actor : null,
    created_at: r.created_at,
    read: r.read === true,
    invite_id: typeof r.invite_id === "string" ? r.invite_id : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

/** Keeps the notification list fresh: loads it when the page opens, then every 30 seconds while the tab
 *  is visible, and again whenever the person comes back to the tab.
 *  `onProjectsChanged` is called when the project list should be fetched again: after accepting an
 *  invitation, or when an owner has removed you from a project. */
export function useNotifications(userId: string | undefined, onProjectsChanged?: () => void): Notifications {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const itemsRef = useRef<AppNotification[]>([]);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const lastRun = useRef(0);
  const generation = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const changedRef = useRef(onProjectsChanged);
  useEffect(() => { changedRef.current = onProjectsChanged; });

  // Every change to the list goes through here, so the ref always matches what's on screen even when
  // two changes land before React has re-rendered.
  const commit = useCallback((list: AppNotification[]) => { itemsRef.current = list; setItems(list); }, []);

  // A different person signing in must never see the previous person's list.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false; // a request still running for the previous person is ignored when it lands
    rerun.current = false;
    seen.current = null;
    commit([]); setUnread(0); setLoaded(false);
  }, [userId, commit]);

  const refresh = useCallback(async (force = false) => {
    if (!userId) return;
    if (inFlight.current) { if (force) rerun.current = true; return; } // a forced refresh waits for the one running
    if (!force && Date.now() - lastRun.current < MIN_GAP_MS) return;
    inFlight.current = true;
    const mine = generation.current;
    try {
      do {
        rerun.current = false;
        lastRun.current = Date.now();
        const res = await fetch("/api/notifications", { headers: await authHeaders(), cache: "no-store" });
        if (mine !== generation.current) return;
        if (!res.ok) break; // best-effort: the bell just keeps what it has
        const data = await res.json();
        if (mine !== generation.current || !Array.isArray(data?.notifications)) break;

        const list = (data.notifications as unknown[]).map(parseNotification).filter((n): n is AppNotification => n !== null);
        const before = seen.current;
        seen.current = new Set(list.map((n) => n.id));
        // The owner took this person off a project while they had the dashboard open.
        if (before && list.some((n) => n.kind === "removed" && !before.has(n.id))) changedRef.current?.();

        commit(list);
        setUnread(typeof data.unread === "number" && data.unread >= 0 ? data.unread : list.filter((n) => !n.read).length);
        setLoaded(true);
      } while (rerun.current);
    } catch { /* offline or a hiccup: try again on the next tick */ }
    finally { inFlight.current = false; }
  }, [userId, commit]);

  useEffect(() => {
    if (!userId) return;
    void refresh(true);
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visibleRefresh, POLL_MS);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [userId, refresh]);

  const postRead = useCallback(async (body: Record<string, unknown>) => {
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
    } catch { /* the refresh below puts the real state back */ }
    void refresh(true);
  }, [refresh]);

  const markRead = useCallback((ids: string[]) => {
    const targets = new Set(ids.filter((id) => !id.startsWith("invite:")));
    const current = itemsRef.current;
    const flips = current.filter((n) => targets.has(n.id) && !n.read).length;
    if (flips === 0) return;
    commit(current.map((n) => (targets.has(n.id) ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - flips));
    void postRead({ ids: Array.from(targets) });
  }, [commit, postRead]);

  const markAllRead = useCallback(() => {
    // Invitations stay unread until they're answered.
    const current = itemsRef.current;
    commit(current.map((n) => (n.kind === "invite" ? n : { ...n, read: true })));
    setUnread(current.filter((n) => n.kind === "invite").length);
    void postRead({ all: true });
  }, [commit, postRead]);

  const respond = useCallback(async (invite: AppNotification, decision: "accept" | "decline"): Promise<AnswerResult> => {
    if (!invite.invite_id) return { ok: false, error: "That invitation can't be answered.", gone: true };
    const drop = () => {
      if (!itemsRef.current.some((n) => n.id === invite.id)) return;
      commit(itemsRef.current.filter((n) => n.id !== invite.id));
      setUnread((u) => Math.max(0, u - 1));
    };
    try {
      const res = await fetch("/api/invites/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ inviteId: invite.invite_id, decision }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // A 404 means it's already gone (cancelled, or answered somewhere else).
        const gone = res.status === 404;
        if (gone) drop();
        void refresh(true);
        return {
          ok: false, gone,
          error: (data && typeof data.error === "string" && data.error) || "Couldn't record your answer. Please try again.",
        };
      }
      drop();
      void refresh(true); // picks up "You joined …"
      if (decision === "accept") changedRef.current?.();
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't reach DevAudit. Check your connection and try again." };
    }
  }, [commit, refresh]);

  return { items, unread, loaded, refresh, markRead, markAllRead, respond };
}

// ---------------------------------------------------------------------------------------------
// Wording and time
// ---------------------------------------------------------------------------------------------
const TONE = {
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  red: "border-red-500/30 bg-red-500/10 text-red-400",
  zinc: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
};

const strong = (text: string) => <span className="font-medium text-zinc-100">{text}</span>;

function describe(n: AppNotification): { icon: LucideIcon; tone: string; text: ReactNode } {
  const project = strong(n.project_name);
  const who = strong(n.actor ?? "Someone");
  switch (n.kind) {
    case "invite": return { icon: Mail, tone: TONE.cyan, text: <>{who} invited you to join {project}</> };
    case "joined": return { icon: UserPlus, tone: TONE.emerald, text: <>You joined {project}</> };
    case "left": return { icon: LogOut, tone: TONE.zinc, text: <>You left {project}</> };
    case "removed": return { icon: UserMinus, tone: TONE.red, text: n.actor ? <>{who} removed you from {project}</> : <>You were removed from {project}</> };
    case "member_joined": return { icon: UserPlus, tone: TONE.emerald, text: <>{who} joined {project}</> };
    case "member_left": return { icon: LogOut, tone: TONE.zinc, text: <>{who} left {project}</> };
  }
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fullDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

// ---------------------------------------------------------------------------------------------
// The bell
// ---------------------------------------------------------------------------------------------
export function NotificationBell({ notif, onOpenInvite }: { notif: Notifications; onOpenInvite: (invite: AppNotification) => void }) {
  const { items, unread, loaded, refresh, markRead, markAllRead } = notif;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    void refresh(true); // always show the freshest list when it's opened
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, refresh]);

  const badge = unread > 9 ? "9+" : String(unread);
  const hasUnreadEvents = items.some((n) => n.kind !== "invite" && !n.read);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={buttonRef} type="button" onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} aria-haspopup="dialog" aria-expanded={open}
        className={`relative grid h-9 w-9 place-items-center rounded-full border border-zinc-800 text-zinc-300 hover:bg-zinc-800/40 ${open ? "bg-zinc-800/60" : "bg-[#121215]"}`}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums"
            style={{ background: "var(--da-a1, #22d3ee)", color: "var(--da-on, #020617)", boxShadow: "0 0 0 2px var(--da-bg, #09090b)" }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog" aria-label="Notifications"
          className="fixed inset-x-3 top-[3.75rem] z-50 overflow-hidden rounded-2xl border border-zinc-800 bg-[#121215] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <h2 className="text-[0.875rem] font-semibold text-zinc-100">Notifications</h2>
            {hasUnreadEvents && (
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-cyan-300 hover:underline">
                <CheckCheck size={13} />Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[min(26rem,calc(100dvh-8rem))] overflow-y-auto">
            {!loaded ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-800/40" />)}</div>
            ) : items.length === 0 ? (
              <div className="grid place-items-center px-6 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-zinc-800 bg-zinc-800/30 text-zinc-500"><Bell size={17} /></span>
                <p className="mt-3 text-[0.875rem] font-medium text-zinc-200">You&apos;re all caught up</p>
                <p className="mt-1 text-[0.8125rem] leading-5 text-zinc-500">Project invitations and people joining or leaving your projects show up here.</p>
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const { icon: Icon, tone, text } = describe(n);
                  const unreadRow = n.kind === "invite" || !n.read;
                  const body = (
                    <>
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${tone}`}><Icon size={14} /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[0.8125rem] leading-5 [overflow-wrap:anywhere] ${unreadRow ? "text-zinc-300" : "text-zinc-500"}`}>{text}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] leading-4 text-zinc-500">
                          <time dateTime={n.created_at} title={fullDate(n.created_at)}>{timeAgo(n.created_at)}</time>
                          {n.kind === "invite" && <><span aria-hidden>·</span><span className="font-medium text-cyan-300">Review invitation</span></>}
                        </span>
                      </span>
                      {unreadRow && (
                        <>
                          <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--da-a1, #22d3ee)" }} />
                          <span className="sr-only">Unread</span>
                        </>
                      )}
                    </>
                  );
                  return (
                    <li key={n.id} className="border-b border-zinc-800 last:border-b-0">
                      {unreadRow ? (
                        <button
                          type="button"
                          onClick={() => { if (n.kind === "invite") { setOpen(false); onOpenInvite(n); } else markRead([n.id]); }}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800/40"
                        >{body}</button>
                      ) : (
                        <div className="flex w-full items-start gap-3 px-4 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The invitation modal
// ---------------------------------------------------------------------------------------------
const cta = "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 shadow-[0_0_20px_-4px_rgba(34,211,238,.6)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none";

export function InviteResponseModal({ invite, onClose, onAnswer }: {
  invite: AppNotification;
  onClose: () => void;
  onAnswer: (invite: AppNotification, decision: "accept" | "decline") => Promise<AnswerResult>;
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus lands on the dialog itself, so Enter can't accept an invitation by accident.
  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function answer(decision: "accept" | "decline") {
    if (busy) return;
    setBusy(decision); setError(null);
    const result = await onAnswer(invite, decision);
    if (result.ok) { onClose(); return; }
    setBusy(null); setError(result.error);
    if (result.gone) setGone(true);
  }

  const sent = fullDate(invite.created_at);
  const who = invite.actor ?? "Someone";

  return (
    <div role="presentation" onClick={() => { if (!busy) onClose(); }} className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div
        ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="invite-response-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-zinc-800 bg-[#121215] p-5 shadow-[0_0_60px_-12px_rgba(34,211,238,.25)] outline-none"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border ${TONE.cyan}`}><Mail size={16} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="invite-response-title" className="text-sm font-semibold text-zinc-100">Project invitation</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              <span className="font-medium text-zinc-300">{who}</span> invited you to join{" "}
              <span className="font-medium text-zinc-300 [overflow-wrap:anywhere]">{invite.project_name}</span>. You only join if you accept.
            </p>
          </div>
          <button onClick={onClose} disabled={!!busy} aria-label="Close" className="shrink-0 text-zinc-500 hover:text-zinc-200 disabled:opacity-50"><X size={16} /></button>
        </div>

        <dl className="mt-4 rounded border border-zinc-800/80 text-xs">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-3 py-2.5 last:border-b-0">
            <dt className="shrink-0 text-zinc-500">Project</dt>
            <dd className="min-w-0 text-right font-medium text-zinc-200 [overflow-wrap:anywhere]">{invite.project_name}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-3 py-2.5 last:border-b-0">
            <dt className="shrink-0 text-zinc-500">Invited by</dt>
            <dd className="min-w-0 text-right font-mono text-zinc-200 [overflow-wrap:anywhere]">{who}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-3 py-2.5 last:border-b-0">
            <dt className="shrink-0 text-zinc-500">Sent</dt>
            <dd className="min-w-0 text-right text-zinc-200">{sent}{sent && <span className="text-zinc-500"> · {timeAgo(invite.created_at)}</span>}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-3 py-2.5 last:border-b-0">
            <dt className="shrink-0 text-zinc-500">Access</dt>
            <dd className="min-w-0 text-right text-zinc-200">View and edit the project&apos;s workspace</dd>
          </div>
        </dl>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-4 text-red-300">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />{error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {gone ? (
            <button onClick={onClose} className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60">Close</button>
          ) : (
            <>
              <button
                onClick={() => answer("decline")} disabled={!!busy}
                className="flex items-center gap-1.5 rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-60"
              >
                {busy === "decline" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}Decline
              </button>
              <button
                onClick={() => answer("accept")} disabled={!!busy}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${cta}`}
              >
                {busy === "accept" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Accept
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
