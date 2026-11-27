"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Search, Plus, Settings, LogOut, Folder, PanelLeft, PanelLeftClose, Maximize2, Minimize2, X, Palette, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AppearancePanel, DaLogo, ModeSwitch } from "./dashboardTheme";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------
export type ShellProject = { id: string; name: string; subtitle?: string; active?: boolean };
export type ShellNavItem = { id: string; label: string; icon: LucideIcon; active?: boolean; onSelect: () => void };
export type ShellUser = { name: string; handle?: string | null; email?: string | null; avatarUrl?: string | null };

export type DashboardShellProps = {
  children: ReactNode;
  /** Text in the top bar, e.g. the open project's name or "Settings". */
  title: string;

  projects: ShellProject[];
  onSelectProject: (id: string) => void;
  /** Called by every "New project" button. Your page decides what that does (usually toggles the form). */
  onNewProject: () => void;
  /** Your existing inline new-project form. Rendered above the project list while it's non-null. */
  newProjectForm?: ReactNode;
  /** Optional per-row extras, e.g. the invite-members button. */
  renderProjectActions?: (project: ShellProject) => ReactNode;

  /** Optional shortcuts for the open project's tabs (Editor, Pre-Push & Deploy, Tests...). */
  nav?: ShellNavItem[];
  navLabel?: string;

  user: ShellUser;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  settingsActive?: boolean;

  /** What the mobile menu does on first load. "full" is the whole-screen menu. Default "full". */
  mobileStart?: "hidden" | "side" | "full";
};

type MobileState = "hidden" | "side" | "full";
const DESKTOP_KEY = "devaudit:sidebar:desktop";

function useIsDesktop() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setV(mq.matches);
    const on = (e: MediaQueryListEvent) => setV(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return v;
}

// Shared class strings. Everything here sits inside a `.dv` element, so the legacy "chunky control"
// rules in dashboardTheme.tsx leave these alone.
const row = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.875rem] font-medium transition-colors lg:min-h-9";
const iconBtn = "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-da-soft transition-colors hover:bg-da-s2 hover:text-da-ink lg:h-8 lg:w-8";

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------
export default function DashboardShell(props: DashboardShellProps) {
  const {
    children, title, projects, onSelectProject, onNewProject, newProjectForm, renderProjectActions, nav, navLabel = "Workspace",
    user, onOpenSearch, onOpenSettings, onSignOut, settingsActive, mobileStart = "full",
  } = props;

  const isDesktop = useIsDesktop();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobile, setMobile] = useState<MobileState>(mobileStart);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try { if (localStorage.getItem(DESKTOP_KEY) === "closed") setDesktopOpen(false); } catch {}
  }, []);
  const setDesktop = useCallback((open: boolean) => {
    setDesktopOpen(open);
    try { localStorage.setItem(DESKTOP_KEY, open ? "open" : "closed"); } catch {}
  }, []);

  const hidden = isDesktop ? !desktopOpen : mobile === "hidden";
  const overlayOpen = !isDesktop && mobile !== "hidden";

  const toggleFromTopBar = () => (isDesktop ? setDesktop(!desktopOpen) : setMobile("full"));
  const closeOnMobile = useCallback(() => setMobile("hidden"), []);

  // A hidden sidebar must not be reachable with Tab or by screen readers.
  useEffect(() => { asideRef.current?.toggleAttribute("inert", hidden); }, [hidden]);

  // Lock page scroll behind the mobile menu.
  useEffect(() => {
    if (!overlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [overlayOpen]);

  // Keyboard: Ctrl/Cmd+K search, Ctrl/Cmd+B sidebar, Esc closes the mobile menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); onOpenSearch(); }
      else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); toggleFromTopBar(); }
      else if (e.key === "Escape" && overlayOpen) closeOnMobile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Picking something on mobile takes you to it: close the menu.
  const afterPick = () => { if (!isDesktop) setMobile("hidden"); };
  const pick = (fn: () => void) => () => { fn(); afterPick(); };

  const full = mobile === "full";
  const fullScreen = !isDesktop && full; // the whole-screen menu, as opposed to the desktop column
  const mobileWidth = full ? "w-screen" : "w-[84vw] max-w-[22rem]";

  return (
    <div className="min-h-dvh lg:flex">
      {/* Backdrop behind the side-view menu on mobile */}
      {mobile === "side" && !isDesktop && (
        <button type="button" aria-label="Close menu" onClick={closeOnMobile} className="dv fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden" />
      )}

      {/* Desktop: this wrapper animates to width 0 when the sidebar is hidden. Mobile: it's just a positioning parent. */}
      <div className={`lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:overflow-hidden lg:transition-[width] lg:duration-300 lg:ease-[cubic-bezier(.16,1,.3,1)] ${desktopOpen ? "lg:w-[16.5rem]" : "lg:w-0"}`}>
        <aside
          ref={asideRef}
          aria-label="Main menu"
          className={`dv fixed inset-y-0 left-0 z-50 flex flex-col border-r border-da-line bg-da-s1 transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] ${mobileWidth}
            ${mobile === "hidden" ? "-translate-x-full" : "translate-x-0"} ${mobile === "side" ? "shadow-2xl" : ""}
            lg:static lg:h-full lg:w-[16.5rem] lg:max-w-none lg:translate-x-0 lg:shadow-none`}
        >
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
            <DaLogo size={24} />
            <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.02em] text-da-ink">DevAudit</span>
            <div className="ml-auto flex items-center gap-1">
              {/* Mobile: shrink the full-screen menu to a side view, or grow it back */}
              <button type="button" onClick={() => setMobile(full ? "side" : "full")} className={`${iconBtn} lg:hidden`}
                aria-label={full ? "Minimise menu to a side view" : "Expand menu to full screen"}>
                {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button type="button" onClick={closeOnMobile} className={`${iconBtn} lg:hidden`} aria-label="Close menu"><X size={18} /></button>
              {/* Desktop: hide the sidebar completely */}
              <button type="button" onClick={() => setDesktop(false)} className={`${iconBtn} hidden lg:grid`} aria-label="Hide sidebar"><PanelLeftClose size={16} /></button>
            </div>
          </div>

          {/* Everything between header and profile card stretches to fill the height, so the menu never has dead space. */}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-1">
            {/* Primary actions */}
            <div className={`grid gap-1.5 ${fullScreen ? "sm:grid-cols-3" : ""}`}>
              <button type="button" onClick={pick(onNewProject)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-da-ink text-[0.875rem] font-medium text-da-bg transition duration-200 hover:opacity-90 active:scale-[0.97]">
                <Plus size={17} strokeWidth={2.25} />New project
              </button>
              <button type="button" onClick={pick(onOpenSearch)} className={`${row} text-da-ink hover:bg-da-s2`}>
                <Search size={17} className="text-da-soft" />
                <span className="flex-1">Search</span>
                <kbd className="hidden rounded-md border border-da-line-2 px-1.5 py-px font-sans text-[0.6875rem] font-normal text-da-faint lg:block">Ctrl K</kbd>
              </button>
              <button type="button" onClick={pick(onOpenSettings)} aria-current={settingsActive ? "page" : undefined}
                className={`${row} ${settingsActive ? "bg-da-s2 text-da-ink" : "text-da-ink hover:bg-da-s2"}`}>
                <Settings size={17} className="text-da-soft" />Settings
              </button>
            </div>

            {/* The open project's tabs */}
            {nav && nav.length > 0 && (
              <div>
                <p className="mb-1.5 px-3 text-[0.75rem] font-medium text-da-faint">{navLabel}</p>
                <div className="grid gap-0.5">
                  {nav.map((n) => {
                    const Icon = n.icon;
                    return (
                      <button key={n.id} type="button" onClick={pick(n.onSelect)} aria-current={n.active ? "page" : undefined}
                        className={`${row} ${n.active ? "bg-da-s2 text-da-ink" : "text-da-soft hover:bg-da-s2 hover:text-da-ink"}`}>
                        <Icon size={17} className={n.active ? "text-da-accent" : ""} />{n.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Projects */}
            <div className="flex min-h-0 flex-col">
              <div className="mb-1.5 flex items-center justify-between px-3">
                <p className="text-[0.75rem] font-medium text-da-faint">Projects{projects.length > 0 && <span className="ml-1.5 tabular-nums text-da-faint/70">{projects.length}</span>}</p>
              </div>

              {newProjectForm && (
                <div className="mb-2 rounded-xl border border-da-line-2 bg-da-s2 p-3">{newProjectForm}</div>
              )}

              <div className="flex flex-col gap-0.5">
                {projects.map((p) => (
                  <div key={p.id} className={`group relative flex min-h-11 items-center rounded-xl transition-colors ${p.subtitle ? "" : "lg:min-h-9"} ${p.active ? "bg-da-s2" : "hover:bg-da-s2"}`}>
                    {p.active && <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-da-a1" />}
                    <button type="button" onClick={pick(() => onSelectProject(p.id))} aria-current={p.active ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-left">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-da-line bg-da-s1 text-da-accent"><Folder size={14} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.875rem] font-medium leading-5 text-da-ink">{p.name}</span>
                        {p.subtitle && <span className="block truncate text-[0.75rem] leading-4 text-da-faint">{p.subtitle}</span>}
                      </span>
                      {!renderProjectActions && <ChevronRight size={14} className="shrink-0 text-da-faint" />}
                    </button>
                    {renderProjectActions && <div className="flex shrink-0 items-center gap-1 pr-2">{renderProjectActions(p)}</div>}
                  </div>
                ))}

                {projects.length === 0 ? (
                  <button type="button" onClick={pick(onNewProject)}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-da-line-2 px-4 py-8 text-center text-da-soft transition-colors hover:border-da-a1 hover:bg-da-s2 hover:text-da-ink">
                    <Plus size={20} />
                    <span className="text-[0.875rem] font-medium">Create your first project</span>
                    <span className="max-w-[14rem] text-[0.75rem] leading-4 text-da-faint">Start from a template, describe it, or connect a GitHub repository.</span>
                  </button>
                ) : (
                  <button type="button" onClick={pick(onNewProject)}
                    className="mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-dashed border-da-line-2 px-3 text-[0.875rem] font-medium text-da-soft transition-colors hover:border-da-a1 hover:bg-da-s2 hover:text-da-ink lg:min-h-9">
                    <Plus size={15} />New project
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Profile card */}
          <div className="shrink-0 border-t border-da-line p-2">
            <div className="flex items-center gap-2.5 rounded-xl bg-da-s2 p-2">
              <Avatar src={user.avatarUrl} name={user.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-medium leading-4 text-da-ink">{user.name}</p>
                <p className="truncate text-[0.75rem] leading-4 text-da-faint">{user.handle ? `@${user.handle.replace(/^@/, "")}` : user.email}</p>
              </div>
              <button type="button" onClick={pick(onOpenSettings)} className={iconBtn} aria-label="Settings"><Settings size={16} /></button>
              <button type="button" onClick={onSignOut} className={`${iconBtn} hover:text-red-400`} aria-label="Sign out"><LogOut size={16} /></button>
            </div>
          </div>
        </aside>
      </div>

      {/* Content column */}
      <div className="min-w-0 flex-1">
        <header className="dv sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-da-line bg-da-bg/85 px-3 backdrop-blur-md sm:px-5">
          <button type="button" onClick={toggleFromTopBar} className={`${iconBtn} border border-da-line bg-da-s1`}
            aria-label={isDesktop ? (desktopOpen ? "Hide sidebar" : "Show sidebar") : "Open menu"} aria-expanded={!hidden}>
            {isDesktop && desktopOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>

          <h1 className="min-w-0 flex-1 truncate font-display text-[1rem] font-semibold tracking-[-0.015em] text-da-ink">{title}</h1>

          <button type="button" onClick={onOpenSearch} aria-label="Search tabs, projects and settings"
            className="hidden h-9 w-[min(20rem,30vw)] items-center gap-2.5 rounded-full border border-da-line bg-da-s1 px-3.5 text-left text-[0.8125rem] text-da-faint transition-colors hover:border-da-line-2 md:flex">
            <Search size={15} />
            <span className="flex-1 truncate">Search</span>
            <kbd className="rounded-md border border-da-line-2 px-1.5 py-px font-sans text-[0.6875rem]">Ctrl K</kbd>
          </button>
          <button type="button" onClick={onOpenSearch} aria-label="Search" className={`${iconBtn} border border-da-line bg-da-s1 md:hidden`}><Search size={16} /></button>

          <ModeSwitch />

          <div className="relative">
            <button type="button" onClick={() => setAppearanceOpen((o) => !o)} aria-expanded={appearanceOpen} aria-label="Customise colours"
              className={`${iconBtn} border border-da-line ${appearanceOpen ? "bg-da-s2 text-da-ink" : "bg-da-s1"}`}><Palette size={16} /></button>
            {appearanceOpen && (
              <AppearancePopover onClose={() => setAppearanceOpen(false)} onMore={() => { setAppearanceOpen(false); onOpenSettings(); }} />
            )}
          </div>
        </header>

        <div className="relative">
          {/* Soft accent glow, controlled by Settings > Appearance */}
          <div aria-hidden className="da-glow pointer-events-none absolute inset-x-0 top-0 h-72" />
          <div className="relative">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Quick colour popover from the top bar
// ---------------------------------------------------------------------------------------------
function AppearancePopover({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-label="Customise colours"
      className="dv absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100dvh-5rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-da-line bg-da-s1 p-4 shadow-2xl">
      <AppearancePanel compact />
      <button type="button" onClick={onMore}
        className="mt-4 flex h-9 w-full items-center justify-center rounded-xl border border-da-line text-[0.8125rem] text-da-ink transition-colors hover:bg-da-s2">
        More options in Settings
      </button>
    </div>
  );
}
