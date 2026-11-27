"use client";

// ---------------------------------------------------------------------------------------------
// Pages of the dashboard that aren't a project tab:
//   • TAB_META      – the heading, explanation and "what you can do" cards for each project tab
//   • HomeView      – what you see before you open a project (a real overview, not an empty box)
//   • SettingsView  – account, GitHub connection, appearance, API tokens and help, each in its own section
//   • NewProjectDialog – the "create a project" form, now a roomy dialog instead of a sidebar squeeze
// They are presentational: page.tsx owns the state and passes it in.
// ---------------------------------------------------------------------------------------------

import { useEffect, type FormEvent, type ReactNode } from "react";
import {
  Code, Bug, FlaskConical, GitCommit, Rocket, GitBranch, FolderGit2,
  Plus, Sparkles, Wand2, Settings, User, Palette, LifeBuoy,
  LogOut, Loader2, RotateCcw, ArrowRight, X, Lock, Globe,
  Check, CheckCircle2, AlertCircle, Clock, Zap, ShieldCheck, Keyboard,
  Server, KeySquare, ExternalLink, FileText, Layers, History, Play,
  Compass, type LucideIcon,
} from "lucide-react";
import { PageHero, TabPage, SectionCard, EmptyState, DetailRow, OptionCard, Pill, type HeroProps } from "./dashboardUi";
import { DefaultAvatar, AppearancePanel, type DaTheme } from "./dashboardTheme";
import { PROJECT_TEMPLATES, type ProjectTemplateKey } from "./templates";
import type { AiScaffoldResult } from "./CodeStudio";
import ApiTokensPanel from "./ApiTokensPanel";
import GithubConnectionPanel from "./GithubConnectionPanel";

export type ProjectLite = { id: string; name: string; repo_url: string; created_at: string; user_id: string };
export type TabKey = "code" | "repo" | "errors" | "tests" | "commits" | "deploy";

// ---------------------------------------------------------------------------------------------
// Tab headings
// ---------------------------------------------------------------------------------------------
export const TAB_META: Record<TabKey, { label: string; icon: LucideIcon; blurb: string; hero: Omit<HeroProps, "actions"> }> = {
  code: {
    label: "Code Studio", icon: Code, blurb: "Edit your files, run them and ask the AI for help",
    hero: {
      icon: Code, eyebrow: "Workspace", title: "Code Studio", compact: true,
      description: "Write code, run it safely in your browser and ask the AI when you're stuck. Edits are saved in this browser until you sync them to GitHub.",
      info: { title: "Code Studio", body: "The file list is on the left, the editor on the right. Press Run Code to try your project in a safe sandbox. Anything that goes wrong is logged for you in Errors & Bugs." },
    },
  },
  repo: {
    label: "Repository", icon: GitBranch, blurb: "Sync with GitHub, visibility and autosave",
    hero: { icon: GitBranch, title: "Repository", description: "Your project's home on GitHub." },
  },
  errors: {
    label: "Errors & Bugs", icon: Bug, blurb: "Everything that has gone wrong, in one list",
    hero: {
      icon: Bug, eyebrow: "Quality", title: "Errors & Bugs",
      description: "A running list of everything that has gone wrong in this project, so nothing gets forgotten. Crashes are caught for you automatically, and you can add your own notes too.",
      info: { title: "Errors & Bugs", body: "Each entry has a severity, the file and line where it happened, and notes. Mark entries resolved once they're fixed. Entries are stored in this browser, separately for each project." },
      tips: [
        { icon: Sparkles, title: "Caught automatically", text: "Crashes from Run Code and Preview show up here by themselves." },
        { icon: Plus, title: "Log your own", text: "Found a bug while testing? Add it with the severity and where it happened." },
        { icon: Wand2, title: "Fix with AI", text: "Press Analyze & Fix and the AI reads the error, then suggests a fix." },
      ],
    },
  },
  tests: {
    label: "Tests", icon: FlaskConical, blurb: "Check your code does what you expect",
    hero: {
      icon: FlaskConical, eyebrow: "Quality", title: "Tests",
      description: "Tests are small checks that prove your code does what you expect. Write them, run them here, and see what passes at a glance. There's nothing to install.",
      info: { title: "Tests", body: "Create a file ending in .test.js or .test.tsx and use describe, it and expect. They're available automatically, with no imports. Tests run in a hidden, sandboxed browser frame." },
      tips: [
        { icon: Zap, title: "Nothing to set up", text: "No install and no server. Just add a .test file and press Run Tests." },
        { icon: Wand2, title: "Let AI write them", text: "Pick a file and the AI drafts tests you can review before adding." },
        { icon: ShieldCheck, title: "Runs safely", text: "Tests run in a sandbox, so they can't touch the rest of the app." },
      ],
    },
  },
  commits: {
    label: "Commit History", icon: GitCommit, blurb: "Every saved change in your GitHub repository",
    hero: {
      icon: GitCommit, eyebrow: "History", title: "Commit History",
      description: "A timeline of every change saved to your GitHub repository: what changed, who changed it and when. It's a safety net you can always roll back to.",
      info: { title: "Commits", body: "A commit is a saved snapshot of your project. Each time you sync to GitHub, a new commit is added here with its message and author." },
      tips: [
        { icon: History, title: "Real history", text: "Pulled straight from your linked GitHub repository." },
        { icon: ExternalLink, title: "Open any commit", text: "Click a commit ID to see exactly what changed on GitHub." },
        { icon: GitBranch, title: "Sync to add more", text: "Each sync from the Repository tab becomes a new commit." },
      ],
    },
  },
  deploy: {
    label: "Pre-Push & Deploy", icon: Rocket, blurb: "Check your project, then send it live",
    hero: {
      icon: Rocket, eyebrow: "Launch", title: "Pre-Push & Deploy",
      description: "Check your project is ready, then send it live to Vercel, Netlify, Cloudflare, Render or GitHub Pages. You choose the host and the AI checks it's compatible first.",
      info: { title: "Deploying", body: "Deploying puts your project on the internet so other people can use it. The pre-push checks catch common problems before you send anything live." },
      tips: [
        { icon: ShieldCheck, title: "Pre-flight checks", text: "Lint, build and environment checks run before anything goes live." },
        { icon: Server, title: "Pick a host", text: "Vercel, Netlify, Cloudflare, Render or GitHub Pages." },
        { icon: KeySquare, title: "Secrets stay secret", text: "Environment variables are write-only, so values are never shown again." },
      ],
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------
const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Code, title: "Code Studio", text: "Edit files, run them in a safe sandbox and ask the AI assistant for help." },
  { icon: GitBranch, title: "Repository", text: "Sync with GitHub, choose who can see your code and turn on autosave." },
  { icon: Bug, title: "Errors & Bugs", text: "Crashes are caught and listed for you, with a one-click AI fix." },
  { icon: FlaskConical, title: "Tests", text: "Write or generate tests and see what passes, with nothing to install." },
  { icon: GitCommit, title: "Commit History", text: "See every saved change to your repository, and who made it." },
  { icon: Rocket, title: "Pre-Push & Deploy", text: "Check your project, then send it live to the host you choose." },
];

export function HomeView({ firstName, projects, loading, handle, onOpen, onNew, onTour }: {
  firstName: string; projects: ProjectLite[]; loading: boolean; handle?: string;
  onOpen: (id: string) => void; onNew: () => void; onTour: () => void;
}) {
  const repoLabel = (p: ProjectLite) => (p.repo_url ? (p.repo_url.includes("/") ? p.repo_url : `${handle ?? "you"}/${p.repo_url}`) : "Local project");
  return (
    <main className="relative z-10">
      <PageHero
        icon={Compass} eyebrow="Overview" title={`Welcome back, ${firstName}`}
        description={projects.length > 0
          ? "Pick up where you left off, or start something new. Every project has its own workspace, repository, tests and deploys."
          : "DevAudit is your command center for building, checking and shipping code. Create your first project to get started. It only takes a minute."}
        actions={<>
          <button type="button" onClick={onNew} className="da-btn-silver" data-tip="Start a new project from a template, or describe it and let AI build it"><Plus size={16} />New project</button>
          <button type="button" onClick={onTour} className="da-btn-ghost" data-tip="A short guided tour of the dashboard"><Play size={15} />Take the tour</button>
        </>}
      />

      <div className="mt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[1.25rem] font-semibold text-zinc-100">Your projects</h2>
            <p className="mt-1 text-[0.8125rem] text-zinc-500">{loading ? "Loading…" : `${projects.length} project${projects.length === 1 ? "" : "s"}`}</p>
          </div>
        </div>
        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="da-shimmer h-40 rounded-2xl" />)}</div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2} title="No projects yet"
            body="A project is a workspace for one piece of software: its files, its GitHub repository, its tests and its deploys. Create one to see it come to life."
            action={<button type="button" onClick={onNew} className="da-btn-silver"><Plus size={16} />Create your first project</button>}
          />
        ) : (
          <ul className="da-stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p.id)} data-tip={`Open ${p.name}`} className="da-card da-card-hover group flex h-full w-full flex-col p-6 text-left">
                  <span className="flex items-center justify-between gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><FolderGit2 size={19} /></span>
                    <ArrowRight size={17} className="text-zinc-600 transition-all duration-300 group-hover:translate-x-1 group-hover:text-zinc-100" />
                  </span>
                  <span className="mt-5 block truncate text-[1.0625rem] font-semibold text-zinc-100">{p.name}</span>
                  <span className="mt-1 block truncate text-[0.8125rem] text-zinc-500">{repoLabel(p)}</span>
                  <span className="mt-5 flex items-center gap-2.5">
                    <Pill tone={p.repo_url ? "emerald" : "zinc"} icon={p.repo_url ? GitBranch : Clock}>{p.repo_url ? "On GitHub" : "Local only"}</Pill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-12">
        <h2 className="text-[1.25rem] font-semibold text-zinc-100">What's inside every project</h2>
        <p className="mt-1 text-[0.8125rem] text-zinc-500">Open a project and you'll find these sections along the top.</p>
        <ul className="da-stagger mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="da-card flex items-start gap-4 p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><f.icon size={19} /></span>
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-semibold text-zinc-100">{f.title}</span>
                <span className="mt-1 block text-[0.8125rem] leading-6 text-zinc-500">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------
export function SettingsView({ displayName, handle, email, userId, theme, signingOut, onSignOut, onReplayTour, onResetExamples }: {
  displayName: string; handle?: string; email?: string; userId?: string; theme: DaTheme; signingOut: boolean;
  onSignOut: () => void; onReplayTour: () => void; onResetExamples: () => void;
}) {
  const shortcuts: [string, string][] = [
    ["Ctrl / ⌘ + K", "Search tabs, projects and settings"],
    ["Esc", "Close a window or menu"],
    ["Enter", "Send a message to the AI assistant"],
    ["Shift + Enter", "New line in an AI message"],
  ];
  return (
    <main className="relative z-10">
      <TabPage
        icon={Settings} eyebrow="Account" title="Settings"
        description="Your account, how DevAudit looks, API access and help. Everything is saved automatically."
      >
        <SectionCard icon={User} title="Account" description="The GitHub account you're signed in with."
          action={<button type="button" onClick={onSignOut} disabled={signingOut} className="da-btn-ghost" data-tip="Sign out of DevAudit on this device">
            {signingOut ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}Sign out</button>}>
          <div className="flex flex-wrap items-center gap-5">
            <DefaultAvatar size={64} />
            <div className="min-w-0">
              <p className="truncate text-[1.125rem] font-semibold text-zinc-100">{displayName}</p>
              <p className="truncate text-[0.875rem] text-zinc-500">{handle ? `@${handle}` : email ?? ""}</p>
            </div>
          </div>
          <div className="-mx-6 mt-7 divide-y divide-zinc-800/80 border-t border-zinc-800/80 sm:-mx-7">
            <DetailRow label="Sign-in provider">GitHub</DetailRow>
            <DetailRow label="Username">{handle ? `@${handle}` : "—"}</DetailRow>
            <DetailRow label="Email">{email ?? "—"}</DetailRow>
            <DetailRow label="User ID" mono>{userId ?? "—"}</DetailRow>
          </div>
        </SectionCard>

        <GithubConnectionPanel />

        <div id="appearance-title" className="scroll-mt-24">
          <SectionCard icon={Palette} title="Appearance" description="Light or dark, background colour and accent. Changes apply instantly, across the site."
            action={<button type="button" onClick={theme.reset} className="da-btn-ghost" data-tip="Put every appearance setting back to its default"><RotateCcw size={14} />Reset</button>}>
            <AppearancePanel theme={theme} compact />
          </SectionCard>
        </div>

        <ApiTokensPanel />

        <SectionCard icon={LifeBuoy} title="Help & tutorial" description="New here, or need a reminder? These are always available.">
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={onReplayTour} className="da-btn-silver" data-tip="Walk through the dashboard again, step by step"><Sparkles size={15} />Replay tutorial</button>
            <button type="button" onClick={onResetExamples} className="da-btn-ghost" data-tip="Show the sample-data boxes you've dismissed"><RotateCcw size={14} />Bring back examples</button>
          </div>
          <div className="mt-8">
            <p className="mb-4 flex items-center gap-2.5 text-[0.9375rem] font-semibold text-zinc-100"><Keyboard size={17} className="text-zinc-400" />Keyboard shortcuts</p>
            <ul className="grid gap-4 sm:grid-cols-2">
              {shortcuts.map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 px-5 py-4">
                  <span className="text-[0.8125rem] text-zinc-400">{v}</span>
                  <kbd className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1 text-[0.75rem] text-zinc-300">{k}</kbd>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>
      </TabPage>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// New project dialog
// ---------------------------------------------------------------------------------------------
export type NewProjectDialogProps = {
  CREATE_REPO: string;
  name: string; onName: (v: string) => void;
  repoSel: string; onRepoSel: (v: string) => void;
  repos: string[] | null; reposError: string | null; onRetryRepos: () => void;
  newRepoName: string; onNewRepoName: (v: string) => void; newRepoPriv: boolean; onNewRepoPriv: (v: boolean) => void;
  repoPreview: string;
  startMode: "template" | "ai"; onStartMode: (m: "template" | "ai") => void;
  templateKey: ProjectTemplateKey; onTemplate: (k: ProjectTemplateKey) => void;
  aiPrompt: string; onAiPrompt: (v: string) => void; scaffolding: boolean; scaffoldResult: AiScaffoldResult | null; scaffoldError: string | null; onGenerate: () => void;
  creating: boolean; canCreate: boolean; summary: string; error: string | null;
  onSubmit: (e: FormEvent) => void; onCancel: () => void;
};

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-start gap-4">
        <span className="da-toggle-on mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[0.8125rem] font-semibold" style={{ color: "var(--da-btn-fg)" }}>{n}</span>
        <div>
          <h3 className="text-[1rem] font-semibold text-zinc-100">{title}</h3>
          {hint && <p className="mt-0.5 text-[0.8125rem] leading-6 text-zinc-500">{hint}</p>}
        </div>
      </div>
      <div className="pl-0 sm:pl-12">{children}</div>
    </section>
  );
}

export function NewProjectDialog(p: NewProjectDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); p.onCancel(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = "w-full rounded-xl border border-zinc-800 bg-[#09090b] px-4 py-3 text-[0.9375rem] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";
  const creatingRepo = p.repoSel === p.CREATE_REPO;

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !p.name.trim()) p.onCancel(); }} className="fixed inset-0 z-[55] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8">
      <form data-tour="project-form" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onSubmit={p.onSubmit}
        className="da-card relative my-auto w-full max-w-2xl !rounded-[1.75rem]">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-7 py-6 sm:px-9">
          <div>
            <h2 id="new-project-title" className="da-silver-text text-[1.5rem] font-semibold">Create a new project</h2>
            <p className="mt-1.5 text-[0.875rem] leading-6 text-zinc-500">Three quick choices and your workspace is ready.</p>
          </div>
          <button type="button" onClick={p.onCancel} aria-label="Close" data-tip="Close without creating (Esc)" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-zinc-800 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"><X size={17} /></button>
        </div>

        <div className="space-y-10 px-7 py-8 sm:px-9">
          <Step n={1} title="Name your project" hint="Something short you'll recognise, like storefront-api.">
            <input autoFocus value={p.name} onChange={(e) => p.onName(e.target.value)} maxLength={80} aria-label="Project name" placeholder="storefront-api" className={field} />
          </Step>

          <Step n={2} title="Where should it live?" hint="You can keep it on this device, or connect it to GitHub now. You can always publish later.">
            <select value={p.repoSel} onChange={(e) => p.onRepoSel(e.target.value)} aria-label="Attach or create a GitHub repository (optional)" className={field}>
              <option value="">{p.repos === null ? "Loading repositories…" : "Keep it local for now (no repository)"}</option>
              <option value={p.CREATE_REPO}>+ Create a new GitHub repository</option>
              {!!p.repos?.length && (
                <optgroup label="Use an existing repository">
                  {p.repos.map((r) => <option key={r} value={r}>{r}</option>)}
                </optgroup>
              )}
            </select>
            {p.reposError && (
              <p className="mt-3 flex items-start gap-2.5 text-[0.8125rem] leading-6 text-amber-400">
                <AlertCircle size={15} className="mt-1 shrink-0" />
                <span>{p.reposError}{" "}<button type="button" onClick={p.onRetryRepos} className="underline hover:text-amber-300">Retry</button></span>
              </p>
            )}
            {creatingRepo && (
              <div className="da-pop mt-5 space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 sm:p-6">
                <div>
                  <label htmlFor="np-repo-name" className="mb-2 block text-[0.8125rem] font-medium text-zinc-300">Repository name</label>
                  <input id="np-repo-name" value={p.newRepoName} onChange={(e) => p.onNewRepoName(e.target.value)} maxLength={100} placeholder="repository-name" className={field} />
                  <p className="mt-2 text-[0.75rem] text-zinc-500">It will be created as <span className="text-zinc-300">{p.repoPreview}</span></p>
                </div>
                <div role="radiogroup" aria-label="Repository visibility" className="grid gap-4 sm:grid-cols-2">
                  <OptionCard selected={p.newRepoPriv} icon={Lock} title="Private" body="Only you can see it." onSelect={() => p.onNewRepoPriv(true)} />
                  <OptionCard selected={!p.newRepoPriv} icon={Globe} title="Public" body="Anyone can see it." onSelect={() => p.onNewRepoPriv(false)} />
                </div>
              </div>
            )}
          </Step>

          <Step n={3} title="How do you want to start?" hint="Begin from a ready-made template, or describe what you want and let the AI build a starter.">
            <div role="tablist" aria-label="Start from" className="mb-5 inline-flex gap-1 rounded-full border border-zinc-800 p-1.5">
              {([["template", "A template", Layers], ["ai", "Describe it", Wand2]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" role="tab" aria-selected={p.startMode === k} onClick={() => p.onStartMode(k)}
                  className={`flex items-center gap-2.5 rounded-full px-5 py-2 text-[0.875rem] font-medium transition-colors ${p.startMode === k ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-200"}`}>
                  <Icon size={15} />{label}
                </button>
              ))}
            </div>
            {p.startMode === "template" ? (
              <div className="da-stagger grid gap-4 sm:grid-cols-2">
                {PROJECT_TEMPLATES.map((t) => {
                  const on = p.templateKey === t.key;
                  return (
                    <button key={t.key} type="button" onClick={() => p.onTemplate(t.key)} aria-pressed={on}
                      className={`relative flex flex-col items-stretch justify-start rounded-2xl border p-5 text-left transition-all duration-300 ${on ? "border-zinc-400 bg-zinc-800/60" : "border-zinc-800 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-zinc-800/30"}`}>
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-[0.9375rem] font-semibold text-zinc-100">{t.label}</span>
                        {on && <span className="da-toggle-on grid h-6 w-6 place-items-center rounded-full"><Check size={13} strokeWidth={3} style={{ color: "var(--da-btn-fg)" }} /></span>}
                      </span>
                      <span className="mt-1.5 block text-[0.8125rem] leading-6 text-zinc-500">{t.description}</span>
                      {!t.runnable && <span className="mt-3 inline-block rounded-full border border-zinc-700 px-3 py-1 text-[0.6875rem] text-zinc-400">Deploys, doesn&apos;t run in Preview</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 sm:p-6">
                <label htmlFor="np-ai" className="mb-2 block text-[0.8125rem] font-medium text-zinc-300">What do you want to build?</label>
                <textarea id="np-ai" value={p.aiPrompt} onChange={(e) => p.onAiPrompt(e.target.value)} maxLength={800} rows={4}
                  placeholder="A todo app with local storage, and a dark theme" className={`${field} resize-none leading-7`} />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                  <span className="text-[0.75rem] text-zinc-500">{p.aiPrompt.length}/800</span>
                  <button type="button" onClick={p.onGenerate} disabled={p.scaffolding || !p.aiPrompt.trim()} className="da-btn-silver disabled:cursor-not-allowed disabled:opacity-40">
                    {p.scaffolding ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{p.scaffolding ? "Generating…" : p.scaffoldResult ? "Regenerate" : "Generate"}
                  </button>
                </div>
                {p.scaffoldError && <p role="alert" className="mt-4 flex items-start gap-2.5 text-[0.8125rem] leading-6 text-red-400"><AlertCircle size={15} className="mt-1 shrink-0" />{p.scaffoldError}</p>}
                {p.scaffoldResult && (
                  <div className="da-pop mt-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
                    <p className="flex items-start gap-3 text-[0.875rem] leading-6 text-emerald-300"><CheckCircle2 size={16} className="mt-1 shrink-0" />{p.scaffoldResult.summary}</p>
                    {p.scaffoldResult.poweredBy === "heuristic" && <p className="mt-2 text-[0.8125rem] leading-6 text-amber-400">AI was unavailable, so this is a close-match starter rather than a custom build.</p>}
                    <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.75rem] text-zinc-500"><FileText size={13} />{Object.keys(p.scaffoldResult.files).join(" · ")}</p>
                  </div>
                )}
              </div>
            )}
          </Step>
        </div>

        <div className="sticky bottom-0 z-10 rounded-b-[1.75rem] border-t border-zinc-800/80 bg-[#121215] px-7 py-5 backdrop-blur sm:px-9">
          {p.error && <p role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[0.8125rem] leading-6 text-red-300"><AlertCircle size={15} className="mt-1 shrink-0" />{p.error}</p>}
          <p className="mb-4 text-[0.8125rem] leading-6 text-zinc-500">{p.summary}</p>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <button type="button" onClick={p.onCancel} className="da-btn-ghost">Cancel</button>
            <button type="submit" disabled={!p.canCreate} className="da-btn-silver !min-h-11 !px-8 disabled:cursor-not-allowed disabled:opacity-40">
              {p.creating && <Loader2 size={15} className="animate-spin" />}{p.creating && creatingRepo ? "Creating repository…" : p.creating ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
