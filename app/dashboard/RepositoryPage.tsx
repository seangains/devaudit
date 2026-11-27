"use client";

// ---------------------------------------------------------------------------------------------
// The Repository page: everything about a project's GitHub repository in one roomy place, instead of
// the small "Manage Repository" box that used to be squeezed into the file explorer. It is purely
// presentational: CodeStudio owns the state (visibility, autosave, sync) and passes it in, so the
// behaviour — including debounced autosave — is exactly what it was before.
// ---------------------------------------------------------------------------------------------

import { useState } from "react";
import {
  GitBranch, Globe, Lock, RefreshCw, ExternalLink, FolderGit2, Zap, ShieldCheck, Check, Loader2, AlertCircle,
  Clock, FileText, Code2, Rocket, CloudOff, ArrowLeftRight,
} from "lucide-react";
import { TabPage, SectionCard, StatTile, OptionCard, Toggle, DetailRow, Pill, EmptyState, HowItWorks } from "./dashboardUi";

type AsyncState = "idle" | "syncing" | "synced" | "error";

export type RepositoryPageProps = {
  repoFull?: string;
  isPrivate: boolean;
  visibilityLoading: boolean;
  visibilityError: string | null;
  onVisibility: (nextPrivate: boolean) => void;
  autosave: boolean;
  autosaveStatus: AsyncState;
  autosaveError: string | null;
  onAutosave: (next: boolean) => void;
  syncState: AsyncState;
  syncError: string | null;
  syncedAt: number | null;
  onSync: () => void;
  /** The repository's real default branch (null while it is being looked up). */
  branch: string | null;
  /** Set when a sync stopped because it could overwrite changes on GitHub; asks the person to decide. */
  syncConflict: string | null;
  /** Syncs anyway, replacing the GitHub copies. Only ever wired to an explicit button click. */
  onForceSync: () => void;
  fileCount: number;
  fromGithub: boolean;
  onOpenWorkspace: () => void;
  onGoToDeploy?: () => void;
  onDetach?: () => void;
  onChange?: () => void;
};

function ago(ms: number | null): string {
  if (!ms) return "Not yet this session";
  const d = Date.now() - ms;
  if (d < 45_000) return "Just now";
  if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))} min ago`;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RepositoryPage(p: RepositoryPageProps) {
  const [confirmPublic, setConfirmPublic] = useState(false);
  const branchName = p.branch ?? "default";

  const steps = [
    { title: "You edit in Code Studio", text: "Every change is saved in your browser immediately, so you never lose work by closing the tab." },
    { title: "Sync sends it to GitHub", text: "Press Sync now (or switch on Autosave) to copy your files into the repository's default branch. If GitHub has changes your workspace doesn't, you're asked before anything is replaced." },
    { title: "Everything stays in step", text: "Commit History shows each sync as a commit, and Pre-Push & Deploy can ship the repository to a host." },
  ];

  if (!p.repoFull) {
    return (
      <TabPage
        icon={GitBranch} eyebrow="Repository" title="Repository"
        description="This project lives in your browser for now. Publish it to GitHub to back it up, share it and deploy it."
        info={{ title: "Repository", body: "A repository (repo) is a project's home on GitHub. It keeps your files and a full history of every change." }}
      >
        <EmptyState
          icon={CloudOff} title="Not on GitHub yet"
          body="Nothing is lost. Your files are saved in this browser. When you're ready, publishing creates a GitHub repository for you and uploads everything in one go."
          action={<>
            {p.onGoToDeploy && <button type="button" onClick={p.onGoToDeploy} className="da-btn-silver" data-tip="Opens Pre-Push & Deploy, where you can create the repository"><Rocket size={16} />Publish to GitHub</button>}
            <button type="button" onClick={p.onOpenWorkspace} className="da-btn-ghost" data-tip="Go back to your files and editor"><Code2 size={16} />Back to Code Studio</button>
          </>}
        />
        <HowItWorks title="How publishing works" steps={steps} />
      </TabPage>
    );
  }

  const [owner, name] = p.repoFull.split("/");
  const url = `https://github.com/${p.repoFull}`;
  const syncing = p.syncState === "syncing";

  return (
    <TabPage
      icon={GitBranch} eyebrow="Repository" title={name || p.repoFull}
      description={<>Your project's home on GitHub — <span className="text-zinc-200">{p.repoFull}</span>. Sync your work, choose who can see it, and keep an eye on its status here.</>}
      info={{ title: "Repository", body: "A repository (repo) holds your project's files and the full history of every change. Syncing copies what you see in Code Studio into it." }}
      actions={<>
        <a href={url} target="_blank" rel="noreferrer" className="da-btn-ghost" data-tip="Open this repository on github.com in a new tab"><ExternalLink size={15} />Open on GitHub</a>
        <button type="button" onClick={p.onSync} disabled={syncing} className="da-btn-silver" data-tip="Copy your current files to GitHub now">
          {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{syncing ? "Syncing…" : "Sync now"}
        </button>
      </>}
    >
      <div className="da-stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={p.isPrivate ? Lock : Globe} label="Visibility" value={p.isPrivate ? "Private" : "Public"} detail={p.isPrivate ? "Only you and collaborators" : "Anyone can view"} tone={p.isPrivate ? "amber" : "emerald"} />
        <StatTile icon={GitBranch} label="Branch" value={p.branch ?? "…"} detail="Where syncs are sent" />
        <StatTile icon={FileText} label="Files" value={String(p.fileCount)} detail="In this project" onClick={p.onOpenWorkspace} tip="Open these files in Code Studio" />
        <StatTile icon={Clock} label="Last synced" value={ago(p.syncedAt)} detail={p.autosave ? "Autosave is on" : "Manual sync"} tone={p.syncState === "error" ? "red" : p.syncedAt ? "emerald" : "zinc"} />
      </div>

      <SectionCard
        icon={RefreshCw} title="Sync with GitHub"
        description="Send the files you've edited to the repository, or let Autosave do it for you."
        info={{ title: "Sync", body: "Your edits are always saved in this browser. GitHub only receives them when you sync, either with the button or automatically with Autosave." }}
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 sm:p-6">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold text-zinc-100">Sync changes now</p>
              <p className="mt-1 text-[0.8125rem] leading-6 text-zinc-500">Copies all {p.fileCount} file{p.fileCount === 1 ? "" : "s"} to the <span className="text-zinc-300">{branchName}</span> branch of {p.repoFull}.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {p.syncState === "synced" && <Pill tone="emerald" icon={Check}>Synced</Pill>}
              <button type="button" onClick={p.onSync} disabled={syncing} className="da-btn-silver">
                {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{syncing ? "Syncing…" : "Sync changes"}
              </button>
            </div>
          </div>
          {p.syncError && (
            <p role="alert" className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[0.8125rem] leading-6 text-red-300"><AlertCircle size={16} className="mt-1 shrink-0" />{p.syncError}</p>
          )}
          {p.syncConflict && (
            <div role="alert" className="da-pop flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
              <p className="flex min-w-0 flex-1 items-start gap-3 text-[0.8125rem] leading-6 text-amber-200"><AlertCircle size={16} className="mt-1 shrink-0" />{p.syncConflict}</p>
              <button type="button" onClick={p.onForceSync} disabled={syncing} className="da-btn-silver" data-tip="Replace the GitHub copies of your files with the ones in this workspace">Overwrite GitHub with my files</button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 sm:p-6">
            <div className="flex min-w-0 items-start gap-4">
              <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><Zap size={18} /></span>
              <div className="min-w-0">
                <p className="text-[0.9375rem] font-semibold text-zinc-100">Autosave to GitHub</p>
                <p className="mt-1 max-w-xl text-[0.8125rem] leading-6 text-zinc-500">Sends your edits to GitHub in the background once you've stopped typing for about 30 seconds (and at most every couple of minutes). It only runs while Code Studio or this page is open. Each autosave is a commit on <span className="text-zinc-300">{branchName}</span>, so if this repository deploys automatically when that branch changes, autosave can trigger deploys. Leave it off in that case, and use Sync changes when you&apos;re ready.</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {p.autosaveStatus === "syncing" && <span className="flex items-center gap-2 text-[0.8125rem] text-zinc-400"><Loader2 size={14} className="animate-spin" />Saving…</span>}
              {p.autosaveStatus === "synced" && <span className="flex items-center gap-2 text-[0.8125rem] text-emerald-400"><Check size={14} />Saved</span>}
              {p.autosaveStatus === "error" && <span className="flex items-center gap-2 text-[0.8125rem] text-red-400"><AlertCircle size={14} />Failed</span>}
              <Toggle checked={p.autosave} onChange={p.onAutosave} label="Autosave to GitHub" />
            </div>
          </div>
          {p.autosaveError && <p role="alert" className="text-[0.8125rem] leading-6 text-red-400">{p.autosaveError}</p>}
        </div>
      </SectionCard>

      <SectionCard
        icon={ShieldCheck} title="Who can see this repository"
        description="Switch between public and private whenever you like. This changes the repository on GitHub straight away."
        info={{ title: "Visibility", body: "Public repositories can be seen by anyone on the internet. Private ones can only be seen by you and the people you invite." }}
      >
        <div role="radiogroup" aria-label="Repository visibility" className="grid gap-5 md:grid-cols-2">
          <OptionCard
            selected={p.isPrivate} icon={Lock} title="Private" loading={p.visibilityLoading && !p.isPrivate}
            body="Only you and people you invite can see the code. A good default while you're still building."
            onSelect={() => { setConfirmPublic(false); if (!p.isPrivate) p.onVisibility(true); }}
          />
          <OptionCard
            selected={!p.isPrivate} icon={Globe} title="Public" loading={p.visibilityLoading && p.isPrivate}
            body="Anyone can see and copy the code. Good for portfolios and open-source projects."
            onSelect={() => { if (p.isPrivate) setConfirmPublic(true); }}
          />
        </div>
        {confirmPublic && p.isPrivate && (
          <div role="alert" className="da-pop mt-6 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="flex min-w-0 flex-1 items-start gap-3 text-[0.875rem] leading-6 text-amber-200"><AlertCircle size={17} className="mt-1 shrink-0" />Make {p.repoFull} public? Anyone on the internet will be able to read your code. Check there are no passwords or keys in your files first.</p>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => { setConfirmPublic(false); p.onVisibility(false); }} className="da-btn-silver">Yes, make it public</button>
              <button type="button" onClick={() => setConfirmPublic(false)} className="da-btn-ghost">Cancel</button>
            </div>
          </div>
        )}
        {p.visibilityError && <p role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[0.8125rem] leading-6 text-red-300"><AlertCircle size={16} className="mt-1 shrink-0" />{p.visibilityError}</p>}
      </SectionCard>

      <SectionCard icon={FolderGit2} title="Repository details" description="The basics, for reference.">
        <div className="-mx-6 divide-y divide-zinc-800/80 sm:-mx-7">
          <DetailRow label="Owner">{owner}</DetailRow>
          <DetailRow label="Repository">{name}</DetailRow>
          <DetailRow label="Default branch" mono>{p.branch ?? "Looking up…"}</DetailRow>
          <DetailRow label="Address"><a href={url} target="_blank" rel="noreferrer" className="underline decoration-zinc-600 underline-offset-4 hover:decoration-zinc-300">{url}</a></DetailRow>
          <DetailRow label="Started from">{p.fromGithub ? "Imported from GitHub" : "A local workspace"}</DetailRow>
        </div>
      </SectionCard>

      {(p.onChange || p.onDetach) && (
        <SectionCard icon={ArrowLeftRight} title="Change or disconnect" description="Point this project at a different repository, or unlink it. Your files are never deleted.">
          <div className="flex flex-wrap items-center gap-4">
            {p.onChange && <button type="button" onClick={p.onChange} className="da-btn-ghost" data-tip="Choose another GitHub repository for this project"><ArrowLeftRight size={15} />Change repository</button>}
            {p.onDetach && <button type="button" onClick={p.onDetach} className="da-btn-ghost" data-tip="Unlink this project from GitHub. The repository itself stays untouched."><CloudOff size={15} />Disconnect from GitHub</button>}
          </div>
        </SectionCard>
      )}

      <HowItWorks title="How syncing works" steps={steps} />
    </TabPage>
  );
}
