"use client";

import { Component, FormEvent, Fragment, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Loader2, LogOut, Settings, Menu, X, Bug,
  GitCommit, Rocket, AlertCircle, GitBranch, FolderGit2, Sparkles, ArrowRight,
  MoreHorizontal, Pencil, Trash2, ExternalLink, Lock, Globe, CheckCircle2,
  RefreshCw, UserPlus, FlaskConical, Copy, Search, PanelLeftClose, PanelLeft,
  Minimize2, Maximize2, Sun, Moon, Compass, type LucideIcon,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/utils/supabase";
import { clearPreviewAssets } from "./previewAssets";
import CodeStudio, {
  clearGithubToken, refreshGithubConnection, GhError, listRepos, publishToGithub, syncToGithub, loadLocalFiles, saveLocalFiles, DEFAULT_FILES,
  listCommits, type CommitInfo, getEsbuild, EXT_LOADER, loadLastTestRun, loadLastDeploy, type ErrorTarget, type CaughtError,
  onGithubTokenInvalid, requestAiScaffold, type AiScaffoldResult,
  saveSyncBase, SyncConflictError, getDefaultBranch,
} from "./CodeStudio";
import InviteModal from "./InviteModal";
import { useNotifications, NotificationBell, InviteResponseModal, type AppNotification } from "./NotificationCenter";
import { leaveProject as leaveProjectRequest } from "./membershipApi";
import TestRunner from "./TestRunner";
import HostDeployer from "./HostDeployer";
import { DEFAULT_TEMPLATE_KEY, getTemplate, type ProjectTemplateKey } from "./templates";
import GithubTokenSync from "@/components/GithubTokenSync";
import TabSearch, { type SearchItem } from "./TabSearch";
import { LogoMark } from "@/components/Logo";
import { DefaultAvatar, ThemeStyles, DaThemeContext, useDaThemeState, mono, poppins } from "./dashboardTheme";
import { TipLayer, PageHero, TabPage, StatTile, TONES, EmptyState as UiEmpty } from "./dashboardUi";
import { TAB_META, HomeView, SettingsView, NewProjectDialog, type TabKey } from "./DashboardViews";

type Project = { id: string; name: string; repo_url: string; created_at: string; user_id: string };
type Tab = TabKey;
type Tone = "emerald" | "red" | "amber" | "zinc";

const COLUMNS = "id,name,repo_url,created_at,user_id";
const CREATE_REPO = "__create__";
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const panel = "da-card";
const cta = "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 shadow-[0_0_20px_-4px_rgba(34,211,238,.6)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none";
const aiCta = "bg-gradient-to-r from-fuchsia-400 to-cyan-400 text-slate-950 shadow-[0_0_20px_-4px_rgba(217,70,239,.6)] hover:brightness-110";
const aiCtaDisabled = "border border-zinc-800 text-zinc-600 cursor-not-allowed";
// Shared building blocks so the Errors, Deploy and Repository panels all read like the rest of the dashboard.
const btn = "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[0.8125rem] font-medium transition";
const btnPrimary = `${btn} ${cta}`;
const btnDanger = `${btn} border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-60`;
const field = "min-w-0 rounded-xl border border-zinc-800 bg-[#09090b] px-3.5 py-2.5 text-[0.8125rem] text-zinc-100 transition-colors placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none";
const segWrap = "inline-flex gap-1 rounded-full border border-zinc-800 bg-zinc-900/40 p-1";
const seg = (on: boolean) => `inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors ${on ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`;
const th = "px-4 py-3 text-[0.75rem] font-medium text-zinc-500";
const cardTitle = "text-[0.9375rem] font-semibold text-zinc-100";
const TONE: Record<Tone, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  red: "border-red-500/30 bg-red-500/10 text-red-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  zinc: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
};
const Badge = ({ tone = "zinc", children }: { tone?: Tone; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.6875rem] leading-4 ${TONE[tone]}`}>{children}</span>
);
function ConfirmDialog({ title, body, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-zinc-800 bg-[#121215] p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${danger ? "bg-red-500/90 text-white hover:bg-red-500" : "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 hover:brightness-110"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const CHECKS: { n: string; cmd: string; s: "passed" | "warning" | "failed"; note: string }[] = [
  { n: "Linting", cmd: "eslint . --max-warnings 0", s: "passed", note: "0 problems" },
  { n: "Build check", cmd: "next build", s: "passed", note: "compiled in 42s" },
  { n: "Environment check", cmd: ".env.local vs .env.example", s: "warning", note: "STRIPE_KEY is not set" },
];

type CheckStatus = "pass" | "fail" | "warn" | "skip";
type CheckResult = { name: string; status: CheckStatus; detail: string };

async function runPreflightChecks(projectId: string, files: Record<string, string>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const esbuild = await getEsbuild();
    const sourcePaths = Object.keys(files).filter((p) => /\.(tsx?|jsx?|mjs|cjs)$/.test(p));
    const failures: string[] = [];
    for (const p of sourcePaths) {
      const ext = p.split(".").pop()!.toLowerCase();
      try { await esbuild.transform(files[p], { loader: EXT_LOADER[ext] ?? "jsx" }); }
      catch { failures.push(p); }
    }
    results.push(
      sourcePaths.length === 0
        ? { name: "Syntax check", status: "skip", detail: "No .js/.ts/.jsx/.tsx files to check." }
        : failures.length === 0
        ? { name: "Syntax check", status: "pass", detail: `${sourcePaths.length} file(s) parsed cleanly.` }
        : { name: "Syntax check", status: "fail", detail: `Syntax errors in: ${failures.join(", ")}` },
    );
  } catch {
    results.push({ name: "Syntax check", status: "warn", detail: "Couldn't load the in-browser checker (esbuild failed to load)." });
  }

  if (files["package.json"] !== undefined) {
    try { JSON.parse(files["package.json"]); results.push({ name: "package.json", status: "pass", detail: "Valid JSON." }); }
    catch { results.push({ name: "package.json", status: "fail", detail: "package.json isn't valid JSON." }); }
  } else {
    results.push({ name: "package.json", status: "skip", detail: "No package.json in this project." });
  }

  const openCritical = loadBugs(projectId).filter((b) => !b.resolved && b.sev === "Critical").length;
  results.push(
    openCritical === 0
      ? { name: "Errors & Bugs", status: "pass", detail: "No unresolved critical issues." }
      : { name: "Errors & Bugs", status: "fail", detail: `${openCritical} unresolved critical issue(s).` },
  );

  const lastRun = loadLastTestRun(projectId);
  results.push(
    !lastRun
      ? { name: "Tests", status: "skip", detail: "No tests have been run yet — see the Tests tab." }
      : lastRun.failed === 0
      ? { name: "Tests", status: "pass", detail: `${lastRun.passed}/${lastRun.total} passed (last run).` }
      : { name: "Tests", status: "fail", detail: `${lastRun.failed}/${lastRun.total} failing (last run).` },
  );

  return results;
}

type BugSeverity = "Critical" | "Warning" | "Info";
type BugSource = "manual" | "auto" | "preview" | "build" | "ai_scan";
type BugEntry = { id: string; sev: BugSeverity; msg: string; file: string; line: string; notes: string; when: number; resolved: boolean; source: BugSource };

const bugsKey = (projectId: string) => `devaudit:bugs:${projectId}`;
function loadBugs(projectId: string): BugEntry[] {
  try {
    const raw = localStorage.getItem(bugsKey(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((b: any) => ({ source: "manual", ...b })) : [];
  } catch { return []; }
}
function saveBugs(projectId: string, bugs: BugEntry[]) {
  try { localStorage.setItem(bugsKey(projectId), JSON.stringify(bugs)); } catch {}
}
function resolveBug(projectId: string, bugId: string) {
  saveBugs(projectId, loadBugs(projectId).map((b) => (b.id === bugId ? { ...b, resolved: true } : b)));
}
const bugTone = (s: BugSeverity): Tone => (s === "Critical" ? "red" : s === "Warning" ? "amber" : "zinc");

const fmtWhen = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ProjectHealthCard({ project, tab, onGoTo, compact = false }: { project: Project; tab: Tab; onGoTo: (t: Tab) => void; compact?: boolean }) {
  const [bugs, setBugs] = useState<BugEntry[]>([]);
  const [lastRun, setLastRun] = useState<ReturnType<typeof loadLastTestRun>>(null);
  const [lastDeploy, setLastDeploy] = useState<ReturnType<typeof loadLastDeploy>>(null);

  useEffect(() => {
    setBugs(loadBugs(project.id));
    setLastRun(loadLastTestRun(project.id));
    setLastDeploy(loadLastDeploy(project.id));
  }, [project.id, tab]);

  const openCritical = bugs.filter((b) => !b.resolved && b.sev === "Critical").length;
  const openWarning = bugs.filter((b) => !b.resolved && b.sev === "Warning").length;
  const published = !!project.repo_url;

  const tiles: { tab: Tab; label: string; icon: typeof Bug; tone: Tone; value: string; detail: string }[] = [
    {
      tab: "errors",
      label: "Bugs",
      icon: Bug,
      tone: openCritical > 0 ? "red" : openWarning > 0 ? "amber" : "emerald",
      value: openCritical > 0 ? `${openCritical} critical` : openWarning > 0 ? `${openWarning} warning` : "All clear",
      detail: openCritical > 0 || openWarning > 0 ? "Unresolved — open Errors & Bugs" : "No unresolved issues",
    },
    {
      tab: "tests",
      label: "Tests",
      icon: FlaskConical,
      tone: !lastRun ? "zinc" : lastRun.failed > 0 ? "red" : "emerald",
      value: !lastRun ? "Not run yet" : `${lastRun.passed}/${lastRun.total} passed`,
      detail: !lastRun ? "Run your tests to see results here" : fmtWhen(lastRun.when),
    },
    {
      tab: "deploy",
      label: "Deploy",
      icon: Rocket,
      tone: !lastDeploy ? "zinc" : lastDeploy.success ? "emerald" : "red",
      value: !lastDeploy ? "Not deployed yet" : lastDeploy.success ? `Live on ${lastDeploy.host}` : `Failed — ${lastDeploy.host}`,
      detail: !lastDeploy ? "Deploy from the tab below" : fmtWhen(lastDeploy.when),
    },
    {
      tab: "repo",
      label: "Repository",
      icon: GitBranch,
      tone: published ? "emerald" : "zinc",
      value: published ? "Published" : "Local only",
      detail: published ? "Sync and visibility live here" : "Publish any time from Pre-Push & Deploy",
    },
  ];

  if (compact) {
    // On Code Studio the editor is the star, so the four health cards shrink to a slim strip that keeps it near the top.
    return (
      <div className="da-stagger mt-6 flex flex-wrap gap-3">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={() => onGoTo(t.tab)} data-tip={`${t.label}: ${t.detail}. Click to open.`}
            className="da-card da-card-hover flex items-center gap-3.5 !rounded-2xl py-3 pl-3.5 pr-5 text-left">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${TONES[t.tone].chip}`}><t.icon size={16} /></span>
            <span className="min-w-0">
              <span className="block text-[0.6875rem] font-medium uppercase tracking-[.12em] text-zinc-500">{t.label}</span>
              <span className={`block truncate text-[0.875rem] font-semibold ${t.tone === "zinc" ? "text-zinc-100" : TONES[t.tone].text}`}>{t.value}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="da-stagger mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <StatTile key={t.label} icon={t.icon} label={t.label} value={t.value} detail={t.detail} tone={t.tone} onClick={() => onGoTo(t.tab)} tip={`Open ${t.label}`} />
      ))}
    </div>
  );
}

function logCaughtError(
  projectId: string, sev: BugSeverity, msg: string, notes: string, source: BugSource = "auto",
  file = "", line = "", bugId?: string,
) {
  const bugs = loadBugs(projectId);
  const recentDup = bugs.find((b) => b.source !== "manual" && b.msg === msg && Date.now() - b.when < 10_000);
  if (recentDup) return;
  const entry: BugEntry = {
    id: bugId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    sev, msg, file, line, notes, when: Date.now(), resolved: false, source,
  };
  saveBugs(projectId, [entry, ...bugs]);
}

function logRuntimeCrash(projectId: string, err: CaughtError) {
  const source: BugSource = err.source ?? "preview";
  const sev: BugSeverity = source === "ai_scan" ? "Warning" : "Critical";
  logCaughtError(projectId, sev, err.message, err.stack ?? "", source, err.file, String(err.line), err.bugId);
}

function useAutoCaptureErrors(projectId: string | null) {
  useEffect(() => {
    if (!projectId) return;
    const onError = (e: ErrorEvent) => {
      logCaughtError(projectId, "Critical", e.message || "Uncaught error", e.error?.stack ?? `${e.filename ?? ""}:${e.lineno ?? ""}:${e.colno ?? ""}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
      logCaughtError(projectId, "Warning", `Unhandled promise rejection: ${reason}`, e.reason instanceof Error ? e.reason.stack ?? "" : "");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, [projectId]);
}

class ErrorBoundary extends Component<{ projectId: string | null; children: React.ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: Error, info: { componentStack: string }) {
    if (this.props.projectId) logCaughtError(this.props.projectId, "Critical", err.message || "Unhandled render error", `${err.stack ?? ""}\n${info.componentStack}`);
  }
  render() {
    if (this.state.crashed) {
      return (
        <div className="grid min-h-screen place-items-center bg-[#09090b] p-6 text-center text-zinc-300">
          <div>
            <AlertCircle size={24} className="mx-auto text-red-400" />
            <p className="mt-3 text-sm font-medium text-zinc-100">Something went wrong in DevAudit</p>
            <p className="mt-1 max-w-sm text-xs text-zinc-500">This was logged to this project&apos;s Errors &amp; Bugs tab.</p>
            <button onClick={() => window.location.reload()} className={`mt-4 rounded px-3 py-1.5 text-xs font-medium ${cta}`}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function BugTracker({ projectId, onAnalyzeAndFix }: { projectId: string; onAnalyzeAndFix: (target: ErrorTarget) => void }) {
  const [bugs, setBugs] = useState<BugEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sev, setSev] = useState<BugSeverity>("Warning");
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState("");
  const [line, setLine] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => { setBugs(loadBugs(projectId)); setOpen(null); setAdding(false); }, [projectId]);

  useEffect(() => {
    const id = setInterval(() => {
      setBugs((prev) => {
        const fresh = loadBugs(projectId);
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 3000);
    return () => clearInterval(id);
  }, [projectId]);

  function commit(next: BugEntry[]) { setBugs(next); saveBugs(projectId, next); }

  function addBug(e: FormEvent) {
    e.preventDefault();
    if (!msg.trim()) return;
    const entry: BugEntry = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      sev, msg: msg.trim(), file: file.trim(), line: line.trim(), notes: notes.trim(), when: Date.now(), resolved: false, source: "manual",
    };
    commit([entry, ...bugs]);
    setMsg(""); setFile(""); setLine(""); setNotes(""); setSev("Warning"); setAdding(false);
  }
  function toggleResolved(id: string) { commit(bugs.map((b) => (b.id === id ? { ...b, resolved: !b.resolved } : b))); }
  function remove(id: string) { commit(bugs.filter((b) => b.id !== id)); if (open === id) setOpen(null); }
  const [confirmResolveAll, setConfirmResolveAll] = useState(false);
  function resolveAll() {
    commit(bugs.map((b) => (b.resolved ? b : { ...b, resolved: true })));
    setConfirmResolveAll(false);
  }

  const activeErrors = bugs.filter((b) => !b.resolved);
  const hasActiveErrors = activeErrors.length > 0;

  function analyzeAndFix() {
    if (!hasActiveErrors) return;
    const bug = activeErrors[0];
    const parsedLine = parseInt(bug.line, 10);
    onAnalyzeAndFix({
      bugId: bug.id, message: bug.msg, file: bug.file || "",
      line: Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : 1,
      stack: bug.notes || undefined,
    });
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={analyzeAndFix} disabled={!hasActiveErrors} title={hasActiveErrors ? undefined : "No active errors to analyze"}
            className={`${btn} ${hasActiveErrors ? aiCta : aiCtaDisabled}`}
          >
            <Sparkles size={14} />Analyze &amp; Fix with AI{hasActiveErrors && ` [${activeErrors.length}]`}
          </button>
          {hasActiveErrors && (
            <button
              onClick={() => setConfirmResolveAll(true)} title="Mark every unresolved entry as resolved — use once you've confirmed stale entries no longer apply"
              className="da-btn-ghost"
            >
              <CheckCircle2 size={14} />Resolve all
            </button>
          )}
        </div>
        <button onClick={() => setAdding((a) => !a)} className={btnPrimary}>
          <Plus size={14} />{adding ? "Cancel" : "Log an error or bug"}
        </button>
      </div>
      {adding && (
        <form onSubmit={addBug} className={`${panel} mb-5 space-y-3 p-4 sm:p-5`}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select value={sev} onChange={(e) => setSev(e.target.value as BugSeverity)} aria-label="Severity" className={`${field} font-mono sm:w-36`}>
              <option value="Critical">Critical</option><option value="Warning">Warning</option><option value="Info">Info</option>
            </select>
            <input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Error message" aria-label="Error message" className={`${field} flex-1`} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={file} onChange={(e) => setFile(e.target.value)} placeholder="File (optional)" aria-label="File" className={`${field} flex-1 font-mono`} />
            <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Line (optional)" aria-label="Line" className={`${field} font-mono sm:w-32`} />
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Stack trace or notes (optional)" aria-label="Notes" rows={3} className={`${field} w-full font-mono`} />
          <button type="submit" disabled={!msg.trim()} className={btnPrimary}><Bug size={14} />Save</button>
        </form>
      )}
      {bugs.length === 0 ? (
        <Empty icon={Bug} title="No errors captured" body="Log runtime errors or bugs here as you find them while testing this project. They're saved in your browser, isolated to this project." />
      ) : (
        <div className={`${panel} overflow-x-auto`}>
          <table className="w-full min-w-[640px] text-left text-[0.8125rem]">
            <thead className="border-b border-zinc-800/80 bg-zinc-900/60"><tr>{["Severity", "Error", "Location", "Time", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {bugs.map((b) => (
                <Fragment key={b.id}>
                  <tr onClick={() => setOpen(open === b.id ? null : b.id)} className={`cursor-pointer border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/30 ${b.resolved ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3"><Badge tone={bugTone(b.sev)}>{b.sev}</Badge></td>
                    <td className="max-w-md truncate px-4 py-3 text-zinc-200">
                      {b.resolved && <CheckCircle2 size={13} className="mr-1.5 inline text-emerald-400" />}
                      {b.source !== "manual" && (
                        <span
                          title={
                            b.source === "preview" ? "Caught while running the live preview"
                            : b.source === "build" ? "The bundler failed to build this project"
                            : b.source === "ai_scan" ? "Flagged by the AI's static read before running — not a confirmed crash"
                            : "Caught automatically"
                          }
                          className="mr-1.5 inline-block rounded-full border border-zinc-700 px-2 py-0 text-[0.625rem] uppercase tracking-wide text-zinc-500"
                        >
                          {b.source}
                        </span>
                      )}
                      {b.msg}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-400">{b.file}{b.file && b.line ? `:${b.line}` : b.line}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{fmtWhen(b.when)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex gap-1">
                        <button onClick={() => toggleResolved(b.id)} aria-label={b.resolved ? "Mark unresolved" : "Mark resolved"} title={b.resolved ? "Mark unresolved" : "Mark resolved"} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-emerald-400"><CheckCircle2 size={15} /></button>
                        <button onClick={() => remove(b.id)} aria-label="Delete" title="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-red-400"><Trash2 size={15} /></button>
                      </span>
                    </td>
                  </tr>
                  {open === b.id && (
                    <tr className="border-b border-zinc-800/60 bg-[#09090b]">
                      <td colSpan={5} className="px-4 py-3"><pre className="whitespace-pre-wrap font-mono text-[0.75rem] leading-5 text-zinc-400">{b.notes || "No additional notes."}</pre></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmResolveAll && (
        <ConfirmDialog
          title="Resolve all"
          body={`Mark all ${activeErrors.length} unresolved entr${activeErrors.length === 1 ? "y" : "ies"} as resolved? Use this to clear out stale entries once you've confirmed they no longer apply.`}
          confirmLabel="Resolve all"
          onConfirm={resolveAll}
          onCancel={() => setConfirmResolveAll(false)}
        />
      )}
    </div>
  );
}

function CommitHistory({ repoFull, onGoToDeploy }: { repoFull?: string; onGoToDeploy: () => void }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoFull) { setCommits(null); setError(null); setLoading(false); return; }
    let active = true;
    setLoading(true); setError(null);
    listCommits(repoFull)
      .then((c) => { if (active) { setCommits(c); setLoading(false); } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : "Couldn't load commit history."); setLoading(false); } });
    return () => { active = false; };
  }, [repoFull]);

  if (!repoFull) {
    return (
      <UiEmpty
        icon={GitCommit} title="Not published to GitHub yet"
        body="Publish this project to see its real commit history here: every change, who made it and when."
        action={<button onClick={onGoToDeploy} className="da-btn-silver" data-tip="Opens Pre-Push & Deploy, where you can publish to GitHub"><Rocket size={15} />Go to Pre-Push &amp; Deploy</button>}
      />
    );
  }
  if (loading) return <div className={`${panel} space-y-2 p-4`}>{[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-zinc-800/40" style={{ width: `${70 - i * 10}%` }} />)}</div>;
  if (error) return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-red-500/30 px-6 py-10 text-center">
      <AlertCircle size={20} className="text-red-400" /><p className="mt-3 text-sm font-medium text-zinc-200">Couldn&apos;t load commit history</p><p className="mt-1 max-w-sm text-xs text-zinc-500">{error}</p>
    </div>
  );
  if (!commits || commits.length === 0) return <Empty icon={GitCommit} title="No commits yet" body="Pushes to this repository will be listed here with their commit message and author." />;

  return (
    <div className={`${panel} overflow-x-auto`}>
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="border-b border-zinc-800/80 bg-[#18181b] text-zinc-500"><tr>{["Commit", "Message", "Author", "Time"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {commits.map((c) => (
            <tr key={c.sha} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30">
              <td className="px-3 py-2"><a href={c.url} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:underline">{c.sha}</a></td>
              <td className="max-w-md truncate px-3 py-2 text-zinc-200">{c.message}</td>
              <td className="px-3 py-2 text-zinc-400">{c.author}</td>
              <td className="px-3 py-2 text-zinc-500">{c.when ? new Date(c.when).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeployExample() {
  const tone = { passed: "emerald", warning: "amber", failed: "red" } as const;
  return (
    <div className="max-w-2xl">
      <div className={`${panel} divide-y divide-zinc-800/80`}>
        {CHECKS.map((c) => (
          <div key={c.n} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0"><p className="text-[0.875rem] font-medium text-zinc-100">{c.n}</p><p className="mt-0.5 truncate font-mono text-[0.75rem] text-zinc-500">{c.cmd} · {c.note}</p></div>
            <Badge tone={tone[c.s]}>{c.s}</Badge>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-[0.8125rem] text-zinc-500">Target branch<span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-zinc-200">main</span></span>
        <button disabled className={btnPrimary}><Rocket size={14} />Create & Push to GitHub</button>
      </div>
    </div>
  );
}

function DeployPanel({ project, owner, onPublished, onRedirectToRepo }: { project: Project; owner?: string; onPublished: (repoUrl: string) => void; onRedirectToRepo?: () => void }) {
  const published = !!project.repo_url;
  const full = published ? (project.repo_url.includes("/") ? project.repo_url : `${owner ?? ""}/${project.repo_url}`) : "";

  const files = loadLocalFiles(project.id) ?? {};

  const [mode, setMode] = useState<"create" | "attach">("create");
  const [isChangingRepo, setIsChangingRepo] = useState(false);

  const [repoName, setRepoName] = useState(() => slugify(project.name) || "project");
  const [priv, setPriv] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [repos, setRepos] = useState<string[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [attachSel, setAttachSel] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // The repository's real default branch (looked up, never assumed to be "main").
  const [branch, setBranch] = useState("default branch");
  const [syncConflict, setSyncConflict] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [detaching, setDetaching] = useState(false);

  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  async function runChecks() {
    setChecking(true);
    const localFiles = loadLocalFiles(project.id) ?? {};
    const results = await runPreflightChecks(project.id, localFiles);
    setChecks(results);
    setChecking(false);
  }

  useEffect(() => { runChecks(); }, [project.id]);

  useEffect(() => {
    if (!published) return;
    let active = true;
    // Through the authenticated proxy, so private repositories resolve too (an anonymous request
    // can't see them and would always have fallen back to a guess).
    getDefaultBranch(full)
      .then((b) => { if (active) setBranch(b); })
      .catch(() => {});
    return () => { active = false; };
  }, [published, full]);

  function loadRepos() {
    setReposError(null);
    refreshGithubConnection()
      .then((ok) => {
        if (!ok) { setRepos([]); setReposError("GitHub isn't connected for this session — sign out and sign in again to grant access."); return; }
        return listRepos().then((r) => setRepos(r));
      })
      .catch((e) => { setRepos([]); setReposError(e instanceof GhError || e instanceof Error ? e.message : "Couldn't load your repositories."); });
  }
  useEffect(() => {
    if ((published && !isChangingRepo) || mode !== "attach" || repos) return;
    loadRepos();
  }, [published, isChangingRepo, mode, repos]);

  async function handlePublish() {
    const slug = slugify(repoName);
    if (!slug) return setPublishError("Give the repository a name.");
    setPublishing(true); setPublishError(null);
    try {
      const localFiles = loadLocalFiles(project.id) ?? {};
      if (Object.keys(localFiles).length === 0) throw new Error("There are no files to publish yet. Add some in Code Studio first.");
      const { full: newFull, branch: newBranch, commit } = await publishToGithub(slug, priv, localFiles);
      // The workspace now matches this commit exactly, so later syncs can tell if GitHub moves on.
      saveSyncBase(project.id, { repo: newFull, branch: newBranch, commit });
      const { error } = await supabase.from("projects").update({ repo_url: newFull }).eq("id", project.id);
      if (error) throw error;
      setBranch(newBranch);
      setIsChangingRepo(false);
      onPublished(newFull);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Couldn't publish to GitHub.");
    }
    setPublishing(false);
  }

  async function handleAttach() {
    if (!attachSel) return setAttachError("Choose a repository to attach.");
    setAttaching(true); setAttachError(null);
    const { error } = await supabase.from("projects").update({ repo_url: attachSel }).eq("id", project.id);
    if (error) { setAttachError(error.message); setAttaching(false); return; }
    setIsChangingRepo(false);
    onPublished(attachSel);
    setAttaching(false);
  }

  async function handleDetach() {
    setDetaching(true);
    const { error } = await supabase.from("projects").update({ repo_url: "" }).eq("id", project.id);
    if (!error) {
      onPublished("");
      setIsChangingRepo(false);
    }
    setDetaching(false);
  }

  async function runSync(force: boolean) {
    setSyncing(true); setSyncError(null); setSyncConflict(null);
    try {
      const localFiles = loadLocalFiles(project.id) ?? {};
      const result = await syncToGithub(full, localFiles, { projectId: project.id, force });
      setBranch(result.branch);
      setSyncedAt(Date.now());
    } catch (e) {
      if (e instanceof SyncConflictError) setSyncConflict(e.message); // stopped on purpose; the person decides
      else setSyncError(e instanceof Error ? e.message : "Couldn't sync changes to GitHub.");
    }
    setSyncing(false);
  }
  // Separate no-argument wrappers: both are used directly as onClick handlers, which would pass a
  // click event as `force` (truthy) and turn every normal sync into an overwrite.
  function handleSync() { void runSync(false); }
  function handleForceSync() { void runSync(true); }

  return (
    <div className="max-w-2xl space-y-5">
      <div className={`${panel} divide-y divide-zinc-800/80`}>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <span className={cardTitle}>Preflight checks</span>
          <button onClick={runChecks} disabled={checking} className="da-btn-ghost disabled:opacity-60">
            <RefreshCw size={13} className={checking ? "animate-spin" : ""} />{checking ? "Checking…" : "Re-run"}
          </button>
        </div>
        {(checks ?? []).map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0"><p className="text-[0.875rem] font-medium text-zinc-100">{c.name}</p><p className="mt-0.5 truncate font-mono text-[0.75rem] text-zinc-500">{c.detail}</p></div>
            <Badge tone={c.status === "pass" ? "emerald" : c.status === "fail" ? "red" : c.status === "warn" ? "amber" : "zinc"}>
              {c.status === "pass" ? "passed" : c.status === "fail" ? "failed" : c.status === "warn" ? "warning" : "skipped"}
            </Badge>
          </div>
        ))}
        {checking && !checks && <div className="px-5 py-4 text-[0.8125rem] text-zinc-500"><Loader2 size={13} className="mr-1.5 inline animate-spin" />Running checks…</div>}
      </div>

      <div id="repo-config" className={`${panel} scroll-mt-6 p-5`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className={cardTitle}>Manage Repositories</h3>
          {published && !isChangingRepo && (
            <button onClick={() => setIsChangingRepo(true)} className="inline-flex items-center gap-1.5 text-[0.8125rem] text-cyan-300 transition-colors hover:text-cyan-200">
              <Pencil size={13} />Change repository
            </button>
          )}
        </div>

        {!published || isChangingRepo ? (
          <>
            <div className={`${segWrap} w-full`}>
              <button type="button" onClick={() => setMode("create")} className={`${seg(mode === "create")} flex-1`}><Rocket size={13} />Create new</button>
              <button type="button" onClick={() => setMode("attach")} className={`${seg(mode === "attach")} flex-1`}><GitBranch size={13} />Attach existing</button>
            </div>

            {mode === "create" ? (
              <>
                <div className="mt-5 flex items-center gap-2.5 text-[0.9375rem] font-semibold text-zinc-100"><Rocket size={16} className="text-cyan-300" />Create & push to GitHub</div>
                <p className="mt-1.5 text-[0.8125rem] leading-6 text-zinc-500">Creating a repository publishes every file currently in Code Studio.</p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input value={repoName} onChange={(e) => { setRepoName(e.target.value); setPublishError(null); }} maxLength={100} aria-label="Repository name"
                    className={`${field} flex-1 font-mono`} />
                  <div className={segWrap}>
                    <button type="button" onClick={() => setPriv(true)} className={seg(priv)}><Lock size={12} />Private</button>
                    <button type="button" onClick={() => setPriv(false)} className={seg(!priv)}><Globe size={12} />Public</button>
                  </div>
                </div>
                {slugify(repoName) && <p className="mt-2 font-mono text-[0.75rem] text-zinc-600">{owner ?? "you"}/{slugify(repoName)}</p>}
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <button onClick={handlePublish} disabled={publishing} className={btnPrimary}>
                    {publishing ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}{publishing ? "Creating repository…" : "Create & Push to GitHub"}
                  </button>
                  {isChangingRepo && (
                    <button onClick={() => setIsChangingRepo(false)} className="da-btn-ghost">Cancel</button>
                  )}
                </div>
                {publishError && <p className="mt-3 flex items-start gap-1.5 text-[0.8125rem] text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{publishError}</p>}
              </>
            ) : (
              <>
                <div className="mt-5 flex items-center gap-2.5 text-[0.9375rem] font-semibold text-zinc-100"><GitBranch size={16} className="text-cyan-300" />Attach an existing repository</div>
                <p className="mt-1.5 text-[0.8125rem] leading-6 text-zinc-500">Links this project to a repository you already have on GitHub.</p>
                <select value={attachSel} onChange={(e) => { setAttachSel(e.target.value); setAttachError(null); }} aria-label="Repository to attach"
                  className={`${field} mt-4 w-full font-mono`}>
                  <option value="">{repos === null ? "Loading repositories…" : repos.length ? "Choose a repository" : "No repositories found"}</option>
                  {repos?.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {reposError && (
                  <p className="mt-2 flex items-start gap-1.5 text-[0.75rem] leading-5 text-amber-400">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    {reposError}{" "}
                    <button type="button" onClick={loadRepos} className="underline hover:text-amber-300">Retry</button>
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <button onClick={handleAttach} disabled={attaching || !attachSel} className={btnPrimary}>
                    {attaching ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}{attaching ? "Attaching…" : "Attach Repository"}
                  </button>
                  {isChangingRepo && (
                    <button onClick={() => setIsChangingRepo(false)} className="da-btn-ghost">Cancel</button>
                  )}
                </div>
                {attachError && <p className="mt-3 flex items-start gap-1.5 text-[0.8125rem] text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{attachError}</p>}
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-zinc-100"><CheckCircle2 size={16} className="text-emerald-400" />Published to GitHub</div>
              <a href={`https://github.com/${full}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[0.8125rem] text-cyan-300 transition-colors hover:text-cyan-200">Open Repository on GitHub<ExternalLink size={13} /></a>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.8125rem] text-zinc-500">
              <span className="font-mono text-zinc-300">{full}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1"><GitBranch size={13} />{branch}</span>
              {syncedAt && <span className="text-emerald-400">Synced just now</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button onClick={handleSync} disabled={syncing} className={btnPrimary}>
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{syncing ? "Syncing…" : "Sync Changes to GitHub"}
              </button>
              <button onClick={handleDetach} disabled={detaching} className={btnDanger}>
                {detaching ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}Detach Repo
              </button>
            </div>
            {syncError && <p className="mt-3 flex items-start gap-1.5 text-[0.8125rem] text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{syncError}</p>}
            {syncConflict && (
              <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
                <p className="flex items-start gap-1.5 text-[0.8125rem] leading-6 text-amber-200"><AlertCircle size={14} className="mt-1 shrink-0" />{syncConflict}</p>
                <button onClick={handleForceSync} disabled={syncing} className={`${btnDanger} mt-3`}>Overwrite GitHub with my files</button>
              </div>
            )}
          </>
        )}
      </div>

      <HostDeployer
        projectId={project.id}
        codeFiles={files}
        projectName={project.name}
        repoUrl={project.repo_url}
        onRedirectToRepoConfig={() => {
          if (onRedirectToRepo) onRedirectToRepo();
          setTimeout(() => {
            document.getElementById("repo-config")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }}
      />
    </div>
  );
}

const Empty = ({ icon, title, body }: { icon: LucideIcon; title: string; body: string }) => <UiEmpty icon={icon} title={title} body={body} />;

function ExampleBox({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-700/80 p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2"><Badge tone="amber">Example</Badge><span className="text-xs text-zinc-500">Sample data showing what this tab will look like.</span></div>
        <button onClick={onDismiss} className="flex shrink-0 items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60"><X size={12} />Dismiss</button>
      </div>
      {children}
    </div>
  );
}

function ProjectRow({
  p, handle, active, isOwner, menuOpen, renaming, renameVal, deleting, duplicating,
  onOpen, onToggleMenu, onStartRename, onRenameChange, onRenameSubmit, onRenameCancel,
  onRequestInvite, onRequestDelete, onRequestDuplicate, onRequestLeave,
}: {
  p: Project; handle?: string; active: boolean; isOwner: boolean; menuOpen: boolean; renaming: boolean; renameVal: string; deleting: boolean; duplicating: boolean;
  onOpen: () => void; onToggleMenu: () => void; onStartRename: () => void;
  onRenameChange: (v: string) => void; onRenameSubmit: () => void; onRenameCancel: () => void;
  onRequestInvite: () => void; onRequestDelete: () => void; onRequestDuplicate: () => void; onRequestLeave: () => void;
}) {
  if (renaming) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <FolderGit2 size={16} className="shrink-0 text-zinc-500" />
        <input
          autoFocus value={renameVal} maxLength={80} aria-label={`Rename ${p.name}`}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onRenameSubmit(); if (e.key === "Escape") onRenameCancel(); }}
          onBlur={onRenameSubmit}
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-[#09090b] px-2.5 py-1.5 text-sm text-zinc-100 focus:border-cyan-500/60 focus:outline-none"
        />
      </div>
    );
  }
  const full = p.repo_url.includes("/") ? p.repo_url : `${handle ?? ""}/${p.repo_url}`;
  return (
    <div className={`group/row relative flex items-center rounded-lg ${active ? "bg-zinc-800/60 text-zinc-100 shadow-[inset_2px_0_0_#22d3ee]" : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200"}`}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[0.875rem] font-medium">
        <FolderGit2 size={16} className="shrink-0" /><span className="truncate">{p.name}</span>
        {!isOwner && <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800/60 px-1 py-0.5 font-mono text-[9px] text-zinc-500">shared</span>}
      </button>
      <button
        onClick={onToggleMenu} aria-label={`Configure ${p.name}`} aria-expanded={menuOpen}
        className={`mr-1.5 shrink-0 rounded-md p-1.5 hover:bg-zinc-700/60 hover:text-zinc-200 focus:opacity-100 focus:outline-none ${menuOpen ? "bg-zinc-700/60 text-zinc-200 opacity-100" : "text-zinc-500 opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100"}`}
      >
        {deleting ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={15} />}
      </button>
      {menuOpen && (
        <div role="menu" data-project-menu onClick={(e) => e.stopPropagation()} className="absolute right-2 top-10 z-50 w-52 overflow-hidden rounded-xl border border-zinc-800 bg-[#18181b] py-1 text-[0.8125rem] shadow-[0_8px_30px_-8px_rgba(0,0,0,.8)]">
          <button role="menuitem" onClick={onStartRename} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-zinc-300 hover:bg-zinc-800/60"><Pencil size={14} />Rename</button>
          <button
            role="menuitem" onClick={onRequestDuplicate} disabled={duplicating}
            title="Clone this project's current files into a new project — handy for starting from a template-based project without re-picking a template."
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-60"
          >
            {duplicating ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}{duplicating ? "Duplicating…" : "Duplicate"}
          </button>
          {p.repo_url && <a role="menuitem" href={`https://github.com/${full}`} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-zinc-300 hover:bg-zinc-800/60"><ExternalLink size={14} />Open on GitHub</a>}
          {isOwner && <button role="menuitem" onClick={onRequestInvite} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-zinc-300 hover:bg-zinc-800/60"><UserPlus size={14} />Invite Members…</button>}
          {!isOwner && <div className="my-1 border-t border-zinc-800/80" />}
          {!isOwner && <button role="menuitem" onClick={onRequestLeave} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-red-400 hover:bg-red-500/10"><LogOut size={14} />Leave project…</button>}
          {isOwner && <div className="my-1 border-t border-zinc-800/80" />}
          {isOwner && <button role="menuitem" onClick={onRequestDelete} disabled={deleting} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-red-400 hover:bg-red-500/10 disabled:opacity-60"><Trash2 size={14} />{deleting ? "Deleting…" : "Delete"}</button>}
        </div>
      )}
    </div>
  );
}

function DeleteProjectModal({ project, deleting, onCancel, onConfirm }: { project: Project; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !deleting) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleting, onCancel]);
  return (
    <div role="presentation" onClick={onCancel} className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-red-500/20 bg-[#121215] p-5 shadow-[0_0_60px_-12px_rgba(239,68,68,.35)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/10"><Trash2 size={16} className="text-red-400" /></span>
          <div className="min-w-0">
            <h2 id="delete-project-title" className="text-sm font-semibold text-zinc-100">Delete &ldquo;{project.name}&rdquo;?</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">This removes the project from DevAudit and can&apos;t be undone. Your GitHub repository won&apos;t be affected — it stays exactly as it is.</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={deleting} className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-60">Cancel</button>
          <button onClick={onConfirm} disabled={deleting} className="flex items-center gap-1.5 rounded bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60">
            {deleting && <Loader2 size={12} className="animate-spin" />}{deleting ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveProjectModal({ project, leaving, onCancel, onConfirm }: { project: Project; leaving: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !leaving) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [leaving, onCancel]);
  return (
    <div role="presentation" onClick={() => { if (!leaving) onCancel(); }} className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="leave-project-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-red-500/20 bg-[#121215] p-5 shadow-[0_0_60px_-12px_rgba(239,68,68,.35)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/10"><LogOut size={16} className="text-red-400" /></span>
          <div className="min-w-0">
            <h2 id="leave-project-title" className="text-sm font-semibold text-zinc-100">Leave &ldquo;{project.name}&rdquo;?</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">You&apos;ll lose access to this project&apos;s workspace and the owner will be notified. To join again, you&apos;ll need a new invitation.</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={leaving} className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-60">Cancel</button>
          <button onClick={onConfirm} disabled={leaving} className="flex items-center gap-1.5 rounded bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60">
            {leaving && <Loader2 size={12} className="animate-spin" />}{leaving ? "Leaving…" : "Leave project"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { k: "welcome", title: "Welcome to DevAudit", body: "A quick tour: create your first project, then see where errors, commits and deploys live." },
  { k: "create", title: "Create your first project", body: "Click New Project, name it (for example storefront-api) and press Create. Each project gets its own workspace." },
  { k: "code", title: "Code Studio", body: "Browse your project files and edit them in the built-in editor. Edits are kept while you move between tabs; push them to GitHub from the Repository tab." },
  { k: "repo", title: "Repository", body: "Publish this project to GitHub, attach a repository you already have, and sync your latest edits. Sync and visibility live here." },
  { k: "errors", title: "Errors & Bugs", body: "Runtime errors for this project only, with severity, file and line, and an expandable stack trace." },
  { k: "commits", title: "Commit History", body: "Every commit with its build result, so you can see which push broke things." },
  { k: "deploy", title: "Pre-Push & Deploy", body: "Run the lint, build and environment checks, pick a target branch, then push to GitHub." },
  { k: "done", title: "You're all set", body: "Switch projects from the sidebar any time. Each tab shows a dismissible example until real data arrives. You can replay this tour or bring examples back from Settings." },
] as const;

function Tour({ i, target, hasProject, onNext, onSkip }: { i: number; target: string | null; hasProject: boolean; onNext: () => void; onSkip: () => void }) {
  const s = STEPS[i];
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!target) { setR(null); return; }
    const measure = () => { const el = document.querySelector(`[data-tour="${target}"]`); setR(el ? el.getBoundingClientRect() : null); };
    measure();
    const id = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => { clearInterval(id); window.removeEventListener("resize", measure); };
  }, [target]);
  const last = i === STEPS.length - 1;
  const waiting = s.k === "create" && !hasProject;
  const card = (
    <div role="dialog" aria-label={s.title} className="pointer-events-auto w-full max-w-[21rem] rounded-lg border border-zinc-700/80 bg-[#121215] p-4 shadow-[0_0_60px_-12px_rgba(34,211,238,.35)]">
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="text-cyan-300" /><span className="font-mono text-[11px] text-zinc-500">{i + 1} / {STEPS.length}</span>
        <div className="ml-auto flex gap-1">{STEPS.map((_, n) => <span key={n} className={`h-1 w-4 rounded-full ${n <= i ? "bg-gradient-to-r from-cyan-400 to-indigo-500" : "bg-zinc-800"}`} />)}</div>
      </div>
      <h2 className="mt-3 text-sm font-semibold text-white">{s.title}</h2>
      <p className="mt-1.5 text-xs leading-5 text-zinc-400">{s.body}</p>
      <div className="mt-4 flex items-center justify-between">
        {last ? <span /> : <button onClick={onSkip} className="text-xs text-zinc-500 hover:text-zinc-300">Skip tour</button>}
        {waiting ? <span className="font-mono text-[11px] text-zinc-500">waiting for your project…</span> : (
          <button onClick={onNext} className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium ${cta}`}>{i === 0 ? "Start tour" : last ? "Get started" : "Next"}<ArrowRight size={12} /></button>
        )}
      </div>
    </div>
  );
  if (!r) return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4">{card}</div>;
  const vw = window.innerWidth, vh = window.innerHeight, mobile = vw < 640;
  const pos: React.CSSProperties = mobile ? {} : r.left < 260 ? { top: Math.min(Math.max(r.top, 12), vh - 240), left: r.right + 16 } : { top: r.bottom + 14, left: Math.min(Math.max(r.left, 12), vw - 348) };
  return (
    <>
      <div className="pointer-events-none fixed z-[60] rounded-md ring-2 ring-cyan-400 shadow-[0_0_0_9999px_rgba(0,0,0,.7),0_0_24px_rgba(34,211,238,.5)]" style={{ top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 }} />
      <div className={`pointer-events-none fixed z-[61] ${mobile ? "inset-x-3 bottom-3 flex justify-center" : ""}`} style={pos}>{card}</div>
    </>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("code");
  const [aiTourTarget, setAiTourTarget] = useState<ErrorTarget | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    if (searchParams.get("settings") === "1") setSettings(true);
  }, [searchParams]);
  const [menu, setMenu] = useState(false);
  const [compact, setCompact] = useState(false);       // mobile: full-screen menu vs. narrow side view
  const [sideHidden, setSideHidden] = useState(false);  // desktop: sidebar collapsed for a full-screen workspace
  const [searchOpen, setSearchOpen] = useState(false);
  const theme = useDaThemeState();
  const openMenu = () => { setCompact(false); setMenu(true); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((o) => !o); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [repos, setRepos] = useState<string[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [githubExpired, setGithubExpired] = useState(false);
  const [repoSel, setRepoSel] = useState("");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPriv, setNewRepoPriv] = useState(true);
  const [templateKey, setTemplateKey] = useState<ProjectTemplateKey>(DEFAULT_TEMPLATE_KEY);
  const [startMode, setStartMode] = useState<"template" | "ai">("template");
  const [aiPrompt, setAiPrompt] = useState("");
  const [scaffolding, setScaffolding] = useState(false);
  const [scaffoldResult, setScaffoldResult] = useState<AiScaffoldResult | null>(null);
  const [scaffoldError, setScaffoldError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<Project | null>(null);
  const [inviteView, setInviteView] = useState<AppNotification | null>(null); // the invitation open in the answer modal
  const [leaveTarget, setLeaveTarget] = useState<Project | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const key = tour === null ? null : STEPS[tour].k;
  useAutoCaptureErrors(activeId);
  useEffect(() => { setAiTourTarget(null); }, [activeId]);

  function handleAnalyzeAndFix(target: ErrorTarget) {
    setAiTourTarget(target);
    setTab("code");
  }

  useEffect(() => onGithubTokenInvalid(() => setGithubExpired(true)), []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) return router.replace("/login");
      refreshGithubConnection().then((ok) => { if (active && ok) setGithubExpired(false); });
      setUser(session.user);
      setChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) { setUser(null); router.replace("/login"); } else {
        refreshGithubConnection().then((ok) => { if (ok) setGithubExpired(false); });
        setUser(session.user);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [router]);

  const userId = user?.id;
  // Bumped when an invitation is accepted, so the project list is fetched again and the new project appears.
  const [projectsReload, setProjectsReload] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoadingProjects(true);
    supabase.from("projects").select(COLUMNS).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message); else setProjects((data as Project[]) ?? []);
        setLoadingProjects(false);
      });
    return () => { active = false; };
  }, [userId, projectsReload]);

  // The bell in the top bar. The project list is fetched again when an invitation is accepted, or when an
  // owner removes this person from a project they have open.
  const notif = useNotifications(userId, () => setProjectsReload((n) => n + 1));

  function loadRepos() {
    setReposError(null);
    refreshGithubConnection()
      .then((ok) => {
        if (!ok) { setRepos([]); setReposError("GitHub isn't connected for this session — sign out and sign in again to grant access."); return; }
        return listRepos().then((r) => setRepos(r));
      })
      .catch((e) => { setRepos([]); setReposError(e instanceof GhError || e instanceof Error ? e.message : "Couldn't load your repositories."); });
  }
  useEffect(() => {
    if (!adding || repos) return;
    loadRepos();
  }, [adding, repos]);

  useEffect(() => {
    if (!userId || loadingProjects) return;
    let seen = !!user?.user_metadata?.onboarded;
    try { seen = seen || !!localStorage.getItem(`devaudit:tour:${userId}`); } catch {}
    if (!seen) setTour(0);
  }, [userId, loadingProjects]);

  useEffect(() => {
    if (!key) return;
    if (key === "create") {
      if (activeId) setTour((t) => (t === null ? t : t + 1));
      else if (projects.length) setActiveId(projects[0].id);
      else setMenu(true);
    } else if (key !== "welcome" && key !== "done") {
      setTab(key); setSettings(false); setMenu(false);
    } else setMenu(false);
  }, [key, activeId, projects.length]);

  useEffect(() => {
    if (!userId) return;
    try { setDismissed(JSON.parse(localStorage.getItem(`devaudit:examples:${userId}`) ?? "{}")); } catch {}
  }, [userId]);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-project-menu]")) return;
      setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuFor(null); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", onKey); };
  }, [menuFor]);

  function startRename(p: Project) {
    setMenuFor(null);
    setRenameId(p.id); setRenameVal(p.name);
  }

  async function submitRename() {
    const id = renameId;
    setRenameId(null);
    if (!id) return;
    const prev = projects.find((p) => p.id === id);
    const trimmed = renameVal.trim();
    if (!prev || !trimmed || trimmed === prev.name) return;
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
    const { error } = await supabase.from("projects").update({ name: trimmed }).eq("id", id);
    if (error) { setError(error.message); setProjects((ps) => ps.map((p) => (p.id === id ? prev : p))); }
  }

  async function deleteProject(id: string): Promise<boolean> {
    setDeletingId(id);
    let res;
    try {
      res = await supabase.from("projects").delete({ count: "exact" }).eq("id", id);
    } catch (thrown) {
      setError(thrown instanceof Error ? `Delete request failed: ${thrown.message}` : "Delete request failed unexpectedly.");
      setDeletingId(null);
      return false;
    }
    const { error, count } = res;
    if (error) { setError(error.message); setDeletingId(null); return false; }
    if (!count) {
      setError("The project wasn't deleted. Supabase's row-level security likely has no DELETE policy for the projects table.");
      setDeletingId(null);
      return false;
    }
    setProjects((ps) => ps.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
    void clearPreviewAssets(id); // the images and fonts kept for this project's Preview
    setDeletingId(null); setMenuFor(null);
    return true;
  }

  async function leaveProject(p: Project): Promise<boolean> {
    setLeavingId(p.id);
    try {
      await leaveProjectRequest(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't leave the project. Please try again.");
      setLeavingId(null);
      return false;
    }
    setProjects((ps) => ps.filter((x) => x.id !== p.id));
    if (activeId === p.id) setActiveId(null);
    setLeavingId(null); setMenuFor(null);
    void notif.refresh(true); // "You left …" appears in the bell
    return true;
  }

  async function duplicateProject(p: Project) {
    if (!user || duplicatingId) return;
    setMenuFor(null);
    setDuplicatingId(p.id);
    setError(null);
    try {
      const sourceFiles = loadLocalFiles(p.id) ?? { ...DEFAULT_FILES };
      const base = `${p.name} copy`;
      let candidate = base;
      let n = 2;
      while (projects.some((x) => x.name.toLowerCase() === candidate.toLowerCase())) { candidate = `${base} ${n}`; n++; }
      const { data, error } = await supabase.from("projects").insert({ name: candidate, repo_url: "", user_id: user.id }).select(COLUMNS).single();
      if (error) { setError(error.message); return; }
      if (data) {
        const project = data as Project;
        saveLocalFiles(project.id, sourceFiles);
        setProjects((ps) => [project, ...ps]);
        setActiveId(project.id); setSettings(false); setTab("code");
      }
    } finally {
      setDuplicatingId(null);
    }
  }

  async function generateWithAi() {
    const prompt = aiPrompt.trim();
    if (!prompt || scaffolding) return;
    setScaffolding(true); setScaffoldError(null); setScaffoldResult(null);
    try {
      const result = await requestAiScaffold(prompt);
      setScaffoldResult(result);
      if (!name.trim() && result.suggestedName) setName(result.suggestedName.replace(/-/g, " "));
    } catch (e) {
      setScaffoldError(e instanceof Error ? e.message : "Couldn't generate a project from that description.");
    }
    setScaffolding(false);
  }

  function resetCreateForm() {
    setAdding(false);
    setName(""); setRepoSel(""); setNewRepoName(""); setNewRepoPriv(true); setTemplateKey(DEFAULT_TEMPLATE_KEY);
    setStartMode("template"); setAiPrompt(""); setScaffoldResult(null); setScaffoldError(null); setScaffolding(false);
  }

  async function createProject(e: FormEvent) {
    e.preventDefault();
    const creatingRepo = repoSel === CREATE_REPO;
    const trimmed = name.trim() || (!creatingRepo && repoSel.split("/")[1]) || "";
    if (!trimmed || !user) return;
    if (startMode === "ai" && !scaffoldResult) return;
    if (projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return setError(`A project named "${trimmed}" already exists.`);
    setCreating(true); setError(null);

    const seedFiles = startMode === "ai" && scaffoldResult ? scaffoldResult.files : getTemplate(templateKey).files;

    let repoUrl = creatingRepo ? "" : repoSel;
    let publishedBase: { repo: string; branch: string; commit: string } | null = null;
    if (creatingRepo) {
      const slug = slugify(newRepoName) || slugify(trimmed);
      if (!slug) { setError("Give the new repository a name."); setCreating(false); return; }
      try {
        const published = await publishToGithub(slug, newRepoPriv, seedFiles);
        repoUrl = published.full;
        publishedBase = { repo: published.full, branch: published.branch, commit: published.commit };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create the GitHub repository.");
        setCreating(false);
        return;
      }
    }

    const { data, error } = await supabase.from("projects").insert({ name: trimmed, repo_url: repoUrl, user_id: user.id }).select(COLUMNS).single();
    if (error) setError(creatingRepo ? `Created ${repoUrl} on GitHub, but couldn't save the project: ${error.message}` : error.message);
    else if (data) {
      const project = data as Project;
      if (!repoSel || creatingRepo) saveLocalFiles(project.id, seedFiles);
      if (publishedBase) saveSyncBase(project.id, publishedBase);
      setProjects((p) => [project, ...p]); setActiveId(project.id); setSettings(false); setTab("code");
      resetCreateForm(); setMenu(false);
    }
    setCreating(false);
  }

  function saveDismissed(next: Record<string, boolean>) {
    setDismissed(next);
    try { if (userId) localStorage.setItem(`devaudit:examples:${userId}`, JSON.stringify(next)); } catch {}
  }

  function finishTour() {
    setTour(null); setMenu(false);
    try { if (userId) localStorage.setItem(`devaudit:tour:${userId}`, "1"); } catch {}
    supabase.auth.updateUser({ data: { onboarded: true } }).catch(() => {});
  }

  async function signOut() {
    setSigningOut(true);
    clearGithubToken();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (checking) return <div className="grid min-h-screen place-items-center bg-[#09090b] text-zinc-500"><Loader2 size={18} className="animate-spin" aria-label="Checking session" /></div>;

  const meta = user?.user_metadata ?? {};
  const handle: string | undefined = meta.user_name || meta.preferred_username;
  const active = projects.find((p) => p.id === activeId) ?? null;
  const displayName: string = meta.full_name || meta.name || handle || user?.email?.split("@")[0] || "You";
  const TABS: { t: Tab; label: string; icon: LucideIcon; blurb: string }[] = (["code", "repo", "errors", "tests", "commits", "deploy"] as const)
    .map((t) => ({ t, label: TAB_META[t].label, icon: TAB_META[t].icon, blurb: TAB_META[t].blurb }));
  const openNewProject = () => { setAdding(true); setMenu(false); };
  const goHome = () => { setActiveId(null); setSettings(false); setMenu(false); };
  const activeRepoFull = active?.repo_url ? (active.repo_url.includes("/") ? active.repo_url : `${handle ?? "you"}/${active.repo_url}`) : undefined;

  const searchItems: SearchItem[] = [
    ...(active ? TABS.map(({ t, label, icon }) => ({ id: `tab-${t}`, group: "Tabs" as const, label, hint: active.name, icon, run: () => { setTab(t); setSettings(false); setMenu(false); } })) : []),
    ...projects.map((p) => ({ id: `p-${p.id}`, group: "Projects" as const, label: p.name, hint: p.repo_url || undefined, icon: FolderGit2, run: () => { setActiveId(p.id); setSettings(false); setMenu(false); } })),
    { id: "act-new", group: "Actions" as const, label: "New project", hint: "Create a workspace", icon: Plus, run: openNewProject },
    { id: "act-home", group: "Actions" as const, label: "Overview", hint: "All your projects", icon: Compass, run: goHome },
    { id: "act-tour", group: "Actions" as const, label: "Replay tutorial", icon: Sparkles, run: () => { setTour(0); setMenu(false); } },
    { id: "act-theme", group: "Actions" as const, label: theme.resolved === "dark" ? "Switch to light mode" : "Switch to dark mode", icon: theme.resolved === "dark" ? Sun : Moon, run: () => theme.update({ mode: theme.resolved === "dark" ? "light" : "dark" }) },
    { id: "settings", group: "Settings" as const, label: "Settings", icon: Settings, run: () => { setSettings(true); setMenu(false); } },
    { id: "appearance", group: "Settings" as const, label: "Appearance & colours", icon: theme.resolved === "dark" ? Moon : Sun, run: () => { setSettings(true); setMenu(false); setTimeout(() => document.getElementById("appearance-title")?.scrollIntoView({ behavior: "smooth" }), 60); } },
  ];

  return (
    <ErrorBoundary projectId={activeId}>
    <DaThemeContext.Provider value={{ resolved: theme.resolved, editorBg: theme.editorBg }}>
    <ThemeStyles />
    <div data-mode={theme.resolved} style={theme.vars} className={`da-root ${mono.variable} ${poppins.variable} flex h-[100dvh] bg-[#09090b] text-zinc-300`}>
      <GithubTokenSync onSynced={refreshGithubConnection} />
      <TipLayer />
      {menu && compact && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMenu(false)} />}
      <aside data-sidebar className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-zinc-800 bg-[#121215] transition-[width,transform] duration-300 lg:static ${menu ? (compact ? "w-[17.5rem] max-w-[86vw] translate-x-0" : "w-full translate-x-0") : "w-full -translate-x-full"} ${sideHidden ? "lg:hidden" : "lg:w-[16.5rem] lg:translate-x-0"}`}>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2.5"><LogoMark size={24} /><span className="truncate font-display text-[1.0625rem] font-semibold tracking-[-0.02em] text-white">DevAudit</span></div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => setSearchOpen(true)} aria-label="Search" className="grid h-9 w-9 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"><Search size={16} /></button>
            {menu && !compact ? (
              <button onClick={() => setCompact(true)} aria-label="Minimise menu to a side view" className="grid h-9 w-9 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 lg:hidden"><Minimize2 size={16} /></button>
            ) : (
              <>
                <button onClick={() => setCompact(false)} aria-label="Expand menu to full screen" className="grid h-9 w-9 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 lg:hidden"><Maximize2 size={16} /></button>
                <button onClick={() => setMenu(false)} aria-label="Close menu" className="grid h-9 w-9 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 lg:hidden"><X size={18} /></button>
              </>
            )}
            <button onClick={() => setSideHidden(true)} aria-label="Hide sidebar" className="hidden h-9 w-9 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 lg:grid"><PanelLeftClose size={16} /></button>
          </div>
        </div>

        <nav className="space-y-1.5 px-4 pt-1">
          <button data-tour="new-project" onClick={openNewProject} data-tip="Create a new project from a template, or describe it and let AI build it" className="mb-3 flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 text-[0.875rem] font-medium text-slate-950"><Plus size={17} strokeWidth={2.25} />New project</button>
          <button onClick={goHome} data-tip="See all your projects in one place" className={`flex h-10 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-[0.875rem] font-medium transition-colors ${!active && !settings ? "bg-zinc-800/60 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/40"}`}>
            <Compass size={16} className="text-zinc-500" />Overview
          </button>
          <button onClick={() => setSearchOpen(true)} data-tip="Jump to any tab, project or setting" className="flex h-10 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-[0.875rem] font-medium text-zinc-300 transition-colors hover:bg-zinc-800/40">
            <Search size={16} className="text-zinc-500" /><span className="flex-1">Search</span><kbd className="hidden rounded-md border border-zinc-700 px-1.5 py-px font-sans text-[0.6875rem] font-normal text-zinc-500 sm:block">Ctrl K</kbd>
          </button>
          <button onClick={() => { setSettings(true); setMenu(false); }} data-tip="Account, appearance, API tokens and help" className={`flex h-10 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-[0.875rem] font-medium transition-colors ${settings ? "bg-zinc-800/60 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/40"}`}>
            <Settings size={16} className="text-zinc-500" />Settings
          </button>
        </nav>

        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-zinc-800 px-4 pt-4">
          <div className="mb-1.5 flex items-center justify-between px-2 text-[0.75rem] font-medium text-zinc-500">
            <span>Projects</span><span className="tabular-nums">{projects.length}</span>
          </div>
          <div className="da-stagger-r min-h-0 flex-1 space-y-1 overflow-y-auto pb-2">
          {loadingProjects ? [0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-zinc-800/40" />)
            : projects.length === 0 ? (
              <div className="grid h-full min-h-[8rem] place-items-center rounded-xl border border-dashed border-zinc-800 p-4 text-center">
                <div><FolderGit2 size={22} className="mx-auto text-zinc-600" /><p className="mt-2 text-sm font-medium text-zinc-300">No projects yet</p><p className="mt-0.5 text-xs text-zinc-500">Create one to open its workspace.</p></div>
              </div>
            )
            : projects.map((p) => (
              <ProjectRow key={p.id} p={p} handle={handle}
                isOwner={p.user_id === userId}
                active={p.id === activeId && !settings}
                menuOpen={menuFor === p.id}
                renaming={renameId === p.id}
                renameVal={renameVal}
                deleting={deletingId === p.id}
                duplicating={duplicatingId === p.id}
                onOpen={() => { setActiveId(p.id); setSettings(false); setMenu(false); }}
                onToggleMenu={() => setMenuFor((m) => (m === p.id ? null : p.id))}
                onStartRename={() => startRename(p)}
                onRenameChange={setRenameVal}
                onRenameSubmit={submitRename}
                onRenameCancel={() => setRenameId(null)}
                onRequestInvite={() => { setMenuFor(null); setInviteTarget(p); }}
                onRequestDelete={() => { setMenuFor(null); setDeleteTarget(p); }}
                onRequestLeave={() => { setMenuFor(null); setLeaveTarget(p); }}
                onRequestDuplicate={() => duplicateProject(p)}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-800 p-2">
          <div className="flex items-center gap-2.5 rounded-xl bg-zinc-800/30 p-2">
            <DefaultAvatar size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium leading-4 text-zinc-100">{displayName}</p>
              <p className="truncate text-[0.75rem] leading-4 text-zinc-500">{handle ? `@${handle}` : user?.email ?? ""}</p>
            </div>
            <button onClick={() => { setSettings(true); setMenu(false); }} aria-label="Settings" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"><Settings size={16} /></button>
            <button onClick={signOut} disabled={signingOut} aria-label="Sign out" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg lg:h-8 lg:w-8 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 disabled:opacity-60">
              {signingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            </button>
          </div>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div aria-hidden className="da-glow pointer-events-none absolute inset-x-0 top-0 h-80" />
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-800 bg-[#09090b] px-3 sm:px-5">
          <button onClick={openMenu} aria-label="Open menu" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-300 lg:h-8 lg:w-8 hover:bg-zinc-800/60 lg:hidden"><Menu size={18} /></button>
          <button onClick={() => setSideHidden((h) => !h)} aria-label={sideHidden ? "Show sidebar" : "Hide sidebar"} className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-300 lg:h-8 lg:w-8 hover:bg-zinc-800/60 lg:grid">
            {sideHidden ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <span className="min-w-0 flex-1 truncate font-display text-[1rem] font-semibold tracking-[-0.015em] text-zinc-100">{settings ? "Settings" : active?.name ?? "DevAudit"}</span>
          <button onClick={() => setSearchOpen(true)} aria-label="Search tabs" className="flex h-9 items-center gap-2.5 rounded-full border border-zinc-800 bg-[#121215] px-3.5 text-[0.8125rem] text-zinc-400 hover:bg-zinc-800/40 sm:min-w-[15rem]">
            <Search size={15} /><span className="hidden flex-1 text-left sm:block">Search tabs…</span><kbd className="hidden rounded-md border border-zinc-700 px-1.5 py-px font-sans text-[0.6875rem] text-zinc-500 md:block">Ctrl K</kbd>
          </button>
          <NotificationBell notif={notif} onOpenInvite={setInviteView} />
          <button onClick={() => theme.update({ mode: theme.resolved === "dark" ? "light" : "dark" })} aria-label="Toggle light / dark" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-zinc-800 bg-[#121215] text-zinc-300 hover:bg-zinc-800/40">
            {theme.resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </header>

        {githubExpired && (
          <div role="alert" className="mx-4 mt-5 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[0.8125rem] leading-6 text-amber-300 sm:mx-8">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">Your GitHub connection expired, so repos, publish, and sync won't work until you reconnect. Sign out and sign in again with GitHub to fix this.</span>
            <button onClick={signOut} disabled={signingOut} className="shrink-0 rounded border border-amber-500/30 px-2 py-0.5 font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-60">
              {signingOut ? <Loader2 size={12} className="animate-spin" /> : "Sign Out"}
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="mx-4 mt-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[0.8125rem] leading-6 text-red-300 sm:mx-8">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss"><X size={13} /></button>
          </div>
        )}

        {settings ? (
          <SettingsView
            displayName={displayName} handle={handle} email={user?.email ?? undefined} userId={user?.id} theme={theme}
            signingOut={signingOut} onSignOut={signOut} onReplayTour={() => setTour(0)} onResetExamples={() => saveDismissed({})}
          />
        ) : !active ? (
          <HomeView
            firstName={displayName.split(" ")[0] || displayName} projects={projects} loading={loadingProjects} handle={handle}
            onOpen={(id) => { setActiveId(id); setSettings(false); setMenu(false); }} onNew={openNewProject} onTour={() => setTour(0)}
          />
        ) : (
          <main className="relative z-10 mx-auto w-full max-w-[90rem]">
            <div className="da-page flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <button type="button" onClick={goHome} data-tip="Back to all your projects" className="mb-3 inline-flex items-center gap-2 text-[0.8125rem] text-zinc-500 transition-colors hover:text-zinc-200"><Compass size={14} />All projects</button>
                <h1 className="da-silver-text truncate pb-1 text-[1.875rem] font-semibold leading-tight sm:text-[2.5rem]">{active.name}</h1>
                <p className="mt-1.5 truncate text-[0.875rem] text-zinc-500">{activeRepoFull ?? "Not published to GitHub yet"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {active.repo_url && <span data-tip="The branch your changes are synced to" className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-[0.8125rem] font-medium text-zinc-200"><GitBranch size={14} className="text-zinc-400" />default branch</span>}
                {activeRepoFull && <a href={`https://github.com/${activeRepoFull}`} target="_blank" rel="noreferrer" className="da-btn-ghost" data-tip="Open this repository on github.com"><ExternalLink size={14} />GitHub</a>}
              </div>
            </div>
            <ProjectHealthCard project={active} tab={tab} onGoTo={setTab} compact={tab === "code"} />
            <div role="tablist" aria-label="Project sections" className={`${tab === "code" ? "mt-6" : "mt-10"} flex gap-2 overflow-x-auto pb-2`}>
              {TABS.map(({ t, label, icon: Icon, blurb }) => (
                <button key={t} data-tour={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-tip={blurb} className="da-tab">
                  <Icon size={16} />{label}
                </button>
              ))}
            </div>
            <div className="mt-6">
              {(tab === "code" || tab === "repo") && (
                <div key="studio">
                  {tab === "code" && <PageHero {...TAB_META.code.hero} />}
                  <div className={tab === "code" ? "mt-8" : ""}>
                    <CodeStudio key={active.id} projectId={active.id} owner={handle} projectName={active.name}
                      pane={tab === "repo" ? "repository" : "workspace"}
                      repoFull={active.repo_url ? (active.repo_url.includes("/") ? active.repo_url : `${handle ?? ""}/${active.repo_url}`) : undefined}
                      onGoToDeploy={() => setTab("deploy")}
                      onGoToErrors={() => setTab("errors")}
                      onGoToRepository={() => setTab("repo")}
                      onGoToWorkspace={() => setTab("code")}
                      onCaughtError={(err) => logRuntimeCrash(active.id, err)}
                      errorTarget={aiTourTarget}
                      onErrorHandled={() => setAiTourTarget(null)}
                      onResolveError={(bugId) => resolveBug(active.id, bugId)} />
                  </div>
                </div>
              )}
              {tab === "errors" && (
                <TabPage key="errors" {...TAB_META.errors.hero}>
                  <BugTracker projectId={active.id} onAnalyzeAndFix={handleAnalyzeAndFix} />
                </TabPage>
              )}
              {tab === "tests" && (
                <TabPage key="tests" {...TAB_META.tests.hero}>
                  <TestRunner projectId={active.id} />
                </TabPage>
              )}
              {tab === "commits" && (
                <TabPage key="commits" {...TAB_META.commits.hero}
                  actions={activeRepoFull ? <a href={`https://github.com/${activeRepoFull}/commits`} target="_blank" rel="noreferrer" className="da-btn-ghost" data-tip="See the full history on github.com"><ExternalLink size={14} />View on GitHub</a> : undefined}>
                  <CommitHistory repoFull={activeRepoFull} onGoToDeploy={() => setTab("deploy")} />
                </TabPage>
              )}
              {tab === "deploy" && (
                <TabPage key="deploy" {...TAB_META.deploy.hero}>
                  <DeployPanel
                    project={active}
                    owner={handle}
                    onPublished={(repoUrl) => setProjects((ps) => ps.map((p) => (p.id === active.id ? { ...p, repo_url: repoUrl } : p)))}
                    onRedirectToRepo={() => setTab("deploy")}
                  />
                  {!dismissed.deploy && (
                    <ExampleBox onDismiss={() => saveDismissed({ ...dismissed, deploy: true })}>
                      <DeployExample />
                    </ExampleBox>
                  )}
                </TabPage>
              )}
            </div>
          </main>
        )}
      </div>
      {tour !== null && <Tour i={tour} target={key === "create" ? (adding ? "project-form" : "new-project") : key && key !== "welcome" && key !== "done" ? key : null} hasProject={!!activeId} onNext={() => (tour === STEPS.length - 1 ? finishTour() : setTour(tour + 1))} onSkip={finishTour} />}
      {adding && (
        <NewProjectDialog
          CREATE_REPO={CREATE_REPO}
          name={name} onName={(v) => { setName(v); setError(null); }}
          repoSel={repoSel} onRepoSel={(v) => { setRepoSel(v); setError(null); }}
          repos={repos} reposError={reposError} onRetryRepos={loadRepos}
          newRepoName={newRepoName} onNewRepoName={(v) => { setNewRepoName(v); setError(null); }} newRepoPriv={newRepoPriv} onNewRepoPriv={setNewRepoPriv}
          repoPreview={`${handle ?? "you"}/${slugify(newRepoName) || slugify(name) || "repository-name"}`}
          startMode={startMode} onStartMode={setStartMode} templateKey={templateKey} onTemplate={setTemplateKey}
          aiPrompt={aiPrompt} onAiPrompt={(v) => { setAiPrompt(v); if (scaffoldResult) setScaffoldResult(null); }}
          scaffolding={scaffolding} scaffoldResult={scaffoldResult} scaffoldError={scaffoldError} onGenerate={generateWithAi}
          creating={creating} error={error}
          canCreate={!(creating || (startMode === "ai" && !scaffoldResult) || (repoSel === CREATE_REPO ? !name.trim() : !name.trim() && !repoSel))}
          summary={
            startMode === "ai" && !scaffoldResult
              ? "Describe your project above and press Generate. Create unlocks once there's something to start the project with."
              : repoSel === CREATE_REPO
              ? `Creates ${handle ?? "you"}/${slugify(newRepoName) || slugify(name) || "repository-name"} on GitHub, starts it with ${startMode === "ai" ? "the AI-generated project" : `the ${getTemplate(templateKey).label} template`}, and links it.`
              : repoSel
              ? `Starts linked to ${repoSel} and imports that repository's own files. (The template or AI choice only applies to new or local projects.)`
              : `Starts as a local project using ${startMode === "ai" ? "the AI-generated project" : `the ${getTemplate(templateKey).label} template`}. You can publish it to GitHub any time from Pre-Push & Deploy.`
          }
          onSubmit={createProject} onCancel={resetCreateForm}
        />
      )}
      {searchOpen && <TabSearch items={searchItems} onClose={() => setSearchOpen(false)} />}
      {inviteTarget && <InviteModal project={inviteTarget} onClose={() => setInviteTarget(null)} />}
      {inviteView && <InviteResponseModal invite={inviteView} onClose={() => setInviteView(null)} onAnswer={notif.respond} />}
      {leaveTarget && (
        <LeaveProjectModal
          project={leaveTarget}
          leaving={leavingId === leaveTarget.id}
          onCancel={() => setLeaveTarget(null)}
          onConfirm={async () => { const ok = await leaveProject(leaveTarget); if (ok) setLeaveTarget(null); }}
        />
      )}
      {deleteTarget && (
        <DeleteProjectModal
          project={deleteTarget}
          deleting={deletingId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => { const ok = await deleteProject(deleteTarget.id); if (ok) setDeleteTarget(null); }}
        />
      )}
    </div>
    </DaThemeContext.Provider>
    </ErrorBoundary>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-[#09090b] text-zinc-500"><Loader2 size={18} className="animate-spin" aria-label="Loading dashboard" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}