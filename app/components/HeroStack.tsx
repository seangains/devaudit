import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUp, BookOpen, Bug, Check, CheckCircle2, ChevronRight, Clock, Code2, Compass, Copy, ExternalLink, File as FileIcon, FileCode2, FilePlus,
  FileText, FlaskConical, Folder, FolderGit2, GitBranch, GitCommit, Globe, History, Image as ImageIcon, Layers, Link2, Loader2,
  LogOut, MessageSquare, PanelLeftClose, Paperclip, Play, Plus, RefreshCw, Rocket, RotateCcw, Search, Settings, Sparkles, Sun, Trash2,
  Upload, Wand2, X, Zap,
} from "lucide-react";
import { LogoMark } from "./Logo";

/* Everything animates with compositor-friendly CSS (transform/opacity/clip-path) on shared loops,
   so it stays smooth and needs no JS. Windows below are % of each loop. */
const EASE = "cubic-bezier(.22,1,.36,1)";
const an = (n: string, d = 18, e = EASE): CSSProperties => ({ animation: `${n} ${d}s ${e} infinite` });
const show = (n: string, a: number, b: number) =>
  `@keyframes ${n}{0%,${a}%{opacity:0;transform:translate3d(0,8px,0)}${b}%,93%{opacity:1;transform:none}99%,100%{opacity:0}}`;
const typed = (n: string, a: number, b: number) =>
  `@keyframes ${n}{0%,${a}%{clip-path:inset(0 100% 0 0);opacity:1}${b}%,93%{clip-path:inset(0);opacity:1}99%,100%{clip-path:inset(0);opacity:0}}`;
const pan = (n: string, a: number, b: number) =>
  `@keyframes ${n}{0%,${a}%{opacity:0;transform:translate3d(0,10px,0)}${a + 5}%,${b}%{opacity:1;transform:none}${b + 5}%,100%{opacity:0;transform:translate3d(0,-6px,0)}}`;
const clicks = (n: string, cs: number[]) =>
  `@keyframes ${n}{0%{opacity:0;transform:scale(.3)}${cs.map((c) => `${c - 0.5}%{opacity:0;transform:scale(.3)}${c}%{opacity:.8;transform:scale(.3)}${c + 2.5}%{opacity:0;transform:scale(2.4)}`).join("")}100%{opacity:0;transform:scale(.3)}}`;
const CLICKS = [32, 52, 65, 73];

/* The cursor's stops, as % of the dashboard body (the same box the click targets are laid out in). Each click lands on:
   32 = "Errors & Bugs" tab, 52 = first row of the bug table, 65 = "Repository" tab, 73 = "Sync now" (page header, top-right of the tab area). */
const STOPS = {
  start: [62, 62], browse1: [46, 30], browse2: [64, 38],
  errorsTab: [57.8, 41.2], table: [60, 74], row: [48, 63.7], repoTab: [42.7, 41.2], rest: [60, 55],
} as const;
const SYNC = ["calc(100% - 36px)", "52.4cqh"] as const; // "Sync now": right-aligned in the header, so anchored to the body's right edge
/* Deploy card cursor stops, relative to its panel: Netlify card (from the top), token field and Deploy button (from the bottom / right edge). */
const STOPS2 = {
  start: ["88%", "26px"], host: ["24%", "88px"], token: ["24%", "calc(100% - 14px)"], deploy: ["calc(100% - 44px)", "calc(100% - 14px)"], rest: ["60%", "62%"],
} as const;
const at2 = ([x, y]: readonly [string, string]) => `transform:translate3d(${x},${y},0)`;
const at = ([x, y]: readonly [number, number]) => `transform:translate3d(${x}%,${y}%,0)`;

const CSS = [
  `.hsin{animation:hsin 1.3s ${EASE} backwards;animation-delay:var(--d,0s)}`,
  `@keyframes hsin{from{opacity:0;transform:translate3d(0,36px,0) scale(.96)}to{opacity:1;transform:none}}`,
  // lg+: the side cards slide out from behind the dashboard and settle into the fan (below lg they just rise like the rest)
  `@keyframes hsfl{from{opacity:0;transform:translate3d(34%,18px,0) rotate(7deg) scale(.94)}to{opacity:1;transform:none}}`,
  `@keyframes hsfr{from{opacity:0;transform:translate3d(-34%,18px,0) rotate(-7deg) scale(.94)}to{opacity:1;transform:none}}`,
  `@media (min-width:1024px){.hsfl{animation-name:hsfl}.hsfr{animation-name:hsfr}}`,
  `@keyframes hsfloat{to{transform:translate3d(0,-7px,0)}}`,
  `@keyframes hsblink{50%{opacity:0}}`,
  // dashboard loop (18s): cursor path, active-tab highlight, panel crossfades, row/sync events
  `@keyframes hsmove{0%{${at(STOPS.start)}}12%{${at(STOPS.browse1)}}24%{${at(STOPS.browse2)}}31%,33%{${at(STOPS.errorsTab)}}45%{${at(STOPS.table)}}52%,54%{${at(STOPS.row)}}64%,66%{${at(STOPS.repoTab)}}72%,74%{${at2(SYNC)}}92%{${at(STOPS.rest)}}100%{${at(STOPS.start)}}}`,
  clicks("hsclick", CLICKS),
  `@keyframes hsa1{0%,32%{opacity:1}37%,95%{opacity:0}100%{opacity:1}}`,
  `@keyframes hsa2{0%,32%{opacity:0}37%,65%{opacity:1}70%,100%{opacity:0}}`,
  `@keyframes hsa3{0%,65%{opacity:0}70%,95%{opacity:1}100%{opacity:0}}`,
  `@keyframes hsp1{0%,32%{opacity:1;transform:none}37%,95%{opacity:0;transform:translate3d(0,-6px,0)}100%{opacity:1;transform:none}}`,
  pan("hsp2", 32, 60), pan("hsp3", 65, 90),
  `@keyframes hsrow{0%,51%{background-color:transparent}54%,100%{background-color:rgb(39 39 42/.3)}}`,
  `@keyframes hsexp{0%,52%{grid-template-rows:0fr;opacity:0}57%,100%{grid-template-rows:1fr;opacity:1}}`,
  `@keyframes hsla{0%,73%{opacity:1}75%,82%{opacity:0}85%,100%{opacity:1}}`,
  `@keyframes hslb{0%,73%{opacity:0}75%,82%{opacity:1}85%,100%{opacity:0}}`,
  `@keyframes hslc{0%,82%{opacity:0;transform:translate3d(0,4px,0)}86%,100%{opacity:1;transform:none}}`,
  `@keyframes hsld{0%,82%{opacity:1}86%,100%{opacity:0}}`,
  // deploy loop (12s): pick Netlify (17) → click token field (32) → token typed as password dots (34-62) → Deploy (73, just after the AI card's Apply) → deploying (74-84) → live (85-93)
  `@keyframes hsmove2{0%{${at2(STOPS2.start)}}15%,18%{${at2(STOPS2.host)}}30%,62%{${at2(STOPS2.token)}}71%,74%{${at2(STOPS2.deploy)}}92%{${at2(STOPS2.rest)}}100%{${at2(STOPS2.start)}}}`,
  clicks("hsclick2", [17, 32, 73]),
  `@keyframes hsvA{0%,17%{opacity:1}18%,95%{opacity:0}100%{opacity:1}}`,
  `@keyframes hsvB{0%,17%{opacity:0}18%,95%{opacity:1}100%{opacity:0}}`,
  `@keyframes hspl{0%,33%{opacity:1}34%,95%{opacity:0}100%{opacity:1}}`,
  `@keyframes hsfoc{0%,31%{opacity:0}32%,70%{opacity:1}72%,100%{opacity:0}}`,
  `@keyframes hskc{0%,31%{opacity:0;transform:translateX(-100%)}32%,34%{opacity:1;transform:translateX(-100%)}62%,70%{opacity:1;transform:none}72%,100%{opacity:0;transform:none}}`,
  typed("hstk", 34, 62),
  `@keyframes hsdA{0%,73%{opacity:1}74%,84%{opacity:0}85%,100%{opacity:1}}`,
  `@keyframes hsdB{0%,73%{opacity:0}74%,84%{opacity:1}85%,100%{opacity:0}}`,
  `@keyframes hsdis{0%,73%{opacity:1}74%,84%{opacity:.4}85%,100%{opacity:1}}`,
  `@keyframes hsk1{0%,73%{opacity:1}74%,95%{opacity:0}100%{opacity:1}}`,
  `@keyframes hsn1{0%,73%{opacity:0;transform:translate3d(0,4px,0)}75%,84%{opacity:1;transform:none}86%,100%{opacity:0}}`,
  `@keyframes hsn2{0%,84%{opacity:0;transform:translate3d(0,4px,0)}87%,93%{opacity:1;transform:none}99%,100%{opacity:0}}`,
  // AI loop (12s)
  `@keyframes hsti{0%,3%{clip-path:inset(0 100% 0 0);opacity:1}18%,19%{clip-path:inset(0);opacity:1}21%,100%{clip-path:inset(0);opacity:0}}`,
  `@keyframes hstc{0%,3%{transform:translateX(-100%);opacity:1}18%,19%{transform:none;opacity:1}21%,100%{transform:none;opacity:0}}`,
  // empty state → draft typed (3-18) → send (~20) → bubble, thinking dots, reply (29-49) → suggested changes (52-59) → Apply (70-72)
  show("hsu", 20, 24), show("hsav", 24, 27), typed("hsr1", 29, 39), typed("hsr2", 40, 49), show("hss1", 52, 59),
  `@keyframes hsth{0%,24%{opacity:0}25%,28%{opacity:1}29%,100%{opacity:0}}`,
  `@keyframes hsph{0%,3%{opacity:1}4%,20%{opacity:0}22%,100%{opacity:1}}`,
  `@keyframes hssnd{0%,3%{opacity:.4}5%,19%{opacity:1}21%,100%{opacity:.4}}`,
  `@keyframes hsia{0%,20%{opacity:1}21%,29%{opacity:0}30%,100%{opacity:1}}`,
  `@keyframes hsib{0%,20%{opacity:0}21%,29%{opacity:1}30%,100%{opacity:0}}`,
  `@keyframes hsem{0%,19%{opacity:1;transform:none}23%,95%{opacity:0;transform:translate3d(0,-6px,0)}99%,100%{opacity:1;transform:none}}`,
  `@keyframes hshA{0%,20%{opacity:1}21%,96%{opacity:0}100%{opacity:1}}`,
  `@keyframes hshB{0%,20%{opacity:0}21%,96%{opacity:1}100%{opacity:0}}`,
  `@keyframes hsrc{0%,20%{grid-template-rows:0fr;opacity:0}24%,95%{grid-template-rows:1fr;opacity:1}99%,100%{grid-template-rows:0fr;opacity:0}}`,
  `@keyframes hsapa{0%,70%{opacity:1}72%,99%{opacity:0}100%{opacity:1}}`,
  `@keyframes hsapb{0%,70%{opacity:0}72%,99%{opacity:1}100%{opacity:0}}`,
  `.hsdot{animation:hsdot 1.2s ease-in-out infinite}.hsdot:nth-child(2){animation-delay:.16s}.hsdot:nth-child(3){animation-delay:.32s}@keyframes hsdot{0%,80%,100%{opacity:.3;transform:scale(.7)}40%{opacity:1;transform:none}}`,
  `@media (prefers-reduced-motion:reduce){.hs *{animation:none!important}.hs .hsp2,.hs .hsp3,.hs .hscur{display:none}}`,
].join("");

/* "mock" = the dark preview windows with traffic-light dots; "app" = the real dashboard in a bare browser bar (no dots, just the URL). */
function Win({ title, children, variant = "mock" }: { title: string; children: ReactNode; variant?: "mock" | "app" }) {
  const app = variant === "app";
  return (
    <div className={`overflow-hidden rounded-2xl border shadow-[0_30px_80px_-24px_rgba(0,0,0,.6)] ${app ? "border-zinc-800 bg-[#09090b]" : "border-surface-dark-border bg-surface-dark"}`}>
      <div className={`flex items-center gap-1.5 border-b px-3 py-2.5 ${app ? "border-zinc-800" : "border-surface-dark-border"}`}>
        {!app && <><i className="h-2 w-2 rounded-full bg-rose-500" /><i className="h-2 w-2 rounded-full bg-amber-400" /><i className="h-2 w-2 rounded-full bg-emerald-400" /></>}
        <span className={`flex-1 text-center font-mono text-[10px] ${app ? "text-zinc-500" : "pr-10 text-surface-dark-ink-soft"}`}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ---- The dashboard card: a scaled-down copy of the real /dashboard (sidebar, header, project title, health tiles, tab pills, tabs). ----
   Every click target is placed with % / cqh units of the card body, so the cursor (also in % of that body) lands on it at any card size. */
const NAV = [[Compass, "Overview"], [Search, "Search"], [Settings, "Settings"]] as const;
const PROJECTS = [["storefront", true], ["billing", false], ["mobile-app", false]] as const;
const TILES = [
  [Bug, "Bugs", "1 critical", "red"], [FlaskConical, "Tests", "12/12 passed", "emerald"],
  [Rocket, "Deploy", "Live on Vercel", "emerald"], [GitBranch, "Repository", "Published", "emerald"],
] as const;
const CHIP = { red: "border-red-500/30 bg-red-500/10 text-red-400", emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
const INK = { red: "text-red-400", emerald: "text-emerald-400" };
// Real tab order. widths are % of the strip so the click targets stay put; the strip scrolls in the real app, so the last pill is cut off here too.
const TABS = [
  [Code2, "Code Studio", 18.5, "hsa1"], [GitBranch, "Repository", 17, "hsa3"], [Bug, "Errors & Bugs", 20.5, "hsa2"],
  [FlaskConical, "Tests", 11.5, ""], [GitCommit, "Commit History", 21.5, ""], [Rocket, "Pre-Push & Deploy", 24, ""],
] as const;
const BUGS = [
  ["Critical", "red", "preview", "TypeError: Cannot read 'id' of undefined", "api/checkout.ts:48", "Oct 2, 20:28"],
  ["Warning", "amber", "auto", "Unhandled promise rejection: 401 /session", "auth/session.ts:12", "Oct 2, 20:27"],
  ["Warning", "amber", "ai_scan", "RangeError: Invalid array length", "lib/cart.ts:90", "Oct 2, 20:21"],
] as const;
const BADGE = { red: "border-red-500/30 bg-red-500/10 text-red-400", amber: "border-amber-500/30 bg-amber-500/10 text-amber-400" };
const COLS = "grid grid-cols-[2.9rem_minmax(0,1fr)_4.4rem] items-center gap-1.5 px-2 sm:grid-cols-[2.9rem_minmax(0,1fr)_4.9rem_3.5rem]";
const GHOST = "inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2 text-[8px] font-medium text-zinc-300";
const SILVER = "bg-gradient-to-b from-white to-zinc-300 text-zinc-900"; // the real primary button ("New project", "AI Host Matchmaker", the AI modal's Send / Apply)
const KW = "text-[#569cd6]", FN = "text-[#dcdcaa]", VR = "text-[#9cdcfe]", TY = "text-[#4ec9b0]";
const CODE: [number, ReactNode][] = [
  [45, <><span className={KW}>async function</span> <span className={FN}>checkout</span>(<span className={VR}>cart</span>: <span className={TY}>Cart</span>) {"{"}</>],
  [46, <>{"  "}<span className={KW}>const</span> <span className={VR}>total</span> = <span className={FN}>sum</span>(<span className={VR}>cart</span>.items);</>],
  [47, <>{"  "}<span className={KW}>const</span> <span className={VR}>item</span> = <span className={VR}>cart</span>.items[0];</>],
  [48, <>{"  "}<span className={KW}>return</span> <span className={FN}>charge</span>(<span className={VR}>item</span>.id, <span className={VR}>cart</span>.total);</>],
  [49, "}"],
  [50, ""],
  [51, <><span className={KW}>export default</span> <span className={VR}>checkout</span>;</>],
];
const TREE = [[0, true, "api"], [1, false, "checkout.ts"], [1, false, "session.ts"], [0, true, "lib"], [1, false, "cart.ts"], [0, false, "package.json"], [0, false, "README.md"]] as const;

// The mock dashboard is always dark, even when the site itself is in light mode, so pin the logo to its dark-theme
// grey here rather than letting LogoMark fall back to the page's --logo (dark grey in light mode, i.e. invisible).
const DARK_LOGO = { "--da-logo": "#e4e4e7" } as CSSProperties;

function Sidebar() {
  return (
    <aside className="absolute inset-y-0 left-0 flex w-[20%] flex-col border-r border-zinc-800 bg-[#121215]" style={DARK_LOGO}>
      <div className="flex h-[8cqh] shrink-0 items-center justify-center gap-1.5 px-1.5 sm:justify-between sm:px-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <LogoMark size={13} className="shrink-0" />
          <span className="hidden truncate font-display text-[10px] font-semibold tracking-[-0.02em] text-white sm:block">DevAudit</span>
        </span>
        <PanelLeftClose className="hidden h-2.5 w-2.5 shrink-0 text-zinc-400 sm:block" />
      </div>
      <nav className="px-1.5 sm:px-2.5">
        <span className={`mb-[1.6cqh] flex h-[5.4cqh] items-center justify-center gap-1 rounded-full text-[8px] font-medium ${SILVER}`}>
          <Plus className="h-2.5 w-2.5" strokeWidth={2.5} /><span className="hidden sm:inline">New project</span>
        </span>
        {NAV.map(([Icon, label]) => (
          <span key={label} className="mb-[0.8cqh] flex h-[5cqh] items-center justify-center gap-1.5 rounded-lg text-[8px] font-medium text-zinc-300 sm:justify-start sm:px-1.5">
            <Icon className="h-2.5 w-2.5 shrink-0 text-zinc-500" /><span className="hidden sm:inline">{label}</span>
          </span>
        ))}
      </nav>
      <div className="mx-1.5 mt-[2.5cqh] border-t border-zinc-800 pt-[1.8cqh] sm:mx-2.5">
        <p className="mb-[0.8cqh] hidden items-center justify-between px-1.5 text-[7px] font-medium text-zinc-500 sm:flex"><span>Projects</span><span>3</span></p>
        {PROJECTS.map(([name, on]) => (
          <span key={name} className={`mb-[0.6cqh] flex h-[5cqh] items-center justify-center gap-1.5 rounded-lg text-[8px] font-medium sm:justify-start sm:px-1.5 ${on ? "bg-zinc-800/60 text-zinc-100 shadow-[inset_2px_0_0_#22d3ee]" : "text-zinc-400"}`}>
            <FolderGit2 className="h-2.5 w-2.5 shrink-0" /><span className="hidden truncate sm:inline">{name}</span>
          </span>
        ))}
      </div>
      <div className="mt-auto border-t border-zinc-800 p-1.5">
        <div className="flex items-center justify-center gap-1.5 rounded-lg bg-zinc-800/30 p-1 sm:justify-start">
          <i className="h-3.5 w-3.5 shrink-0 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700" />
          <span className="hidden min-w-0 flex-1 sm:block"><span className="block truncate text-[7px] font-medium leading-[9px] text-zinc-100">Alex Rivera</span><span className="block truncate text-[6px] leading-[8px] text-zinc-500">@arivera</span></span>
          <Settings className="hidden h-2.5 w-2.5 shrink-0 text-zinc-400 sm:block" /><LogOut className="hidden h-2.5 w-2.5 shrink-0 text-zinc-400 sm:block" />
        </div>
      </div>
    </aside>
  );
}

function CodePanel() {
  return (
    <div className="absolute inset-0 grid grid-cols-[27%_minmax(0,1fr)] overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40" style={an("hsp1")}>
      <div className="flex min-w-0 flex-col border-r border-zinc-800/80">
        <div className="flex h-[7cqh] shrink-0 items-center justify-between gap-1 border-b border-zinc-800/80 bg-[#18181b] px-1.5">
          <span className="truncate font-mono text-[7px] text-zinc-300">acme/storefront</span>
          <span className="hidden gap-1 text-zinc-500 sm:flex"><Upload className="h-2 w-2" /><Search className="h-2 w-2" /><FilePlus className="h-2 w-2" /></span>
        </div>
        <div className="border-b border-zinc-800/80 px-1.5 py-[1cqh]">
          <div className="flex items-center justify-between gap-1">
            <span className="flex min-w-0 items-center gap-1 text-[7px] font-medium text-zinc-200"><GitBranch className="h-2 w-2 shrink-0 text-zinc-400" /><span className="truncate">storefront</span></span>
            <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1 text-[5.5px] font-medium text-emerald-400">Public</span>
          </div>
          <div className="mt-[0.8cqh] flex items-center justify-between gap-1 text-[6px] text-zinc-500">
            <span className="flex items-center gap-0.5"><Check className="h-1.5 w-1.5 text-emerald-400" />Autosave on</span>
            <span className="font-medium text-zinc-300 underline decoration-zinc-700 underline-offset-2">Manage</span>
          </div>
        </div>
        <div className="p-1">
          {TREE.map(([depth, dir, name]) => (
            <div key={name} className={`flex h-[4cqh] items-center gap-1 rounded font-mono text-[7px] ${name === "checkout.ts" ? "bg-zinc-800/60 text-zinc-100" : dir ? "text-zinc-300" : "text-zinc-400"}`} style={{ paddingLeft: 3 + depth * 8 + (dir ? 0 : 8) }}>
              {dir ? <><ChevronRight className="h-2 w-2 shrink-0 rotate-90" /><Folder className="h-2 w-2 shrink-0 text-zinc-300" /></> : <FileIcon className="h-2 w-2 shrink-0" />}
              <span className="truncate">{name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-[7cqh] shrink-0 items-center justify-between gap-1.5 border-b border-zinc-800/80 bg-[#18181b] px-1.5">
          <span className="truncate font-mono text-[7px] text-zinc-400">api/checkout.ts</span>
          <span className="flex shrink-0 items-center gap-1">
            <span className={`inline-flex h-[4.4cqh] items-center gap-0.5 rounded-full px-1.5 text-[7px] font-medium ${SILVER}`}><Play className="h-1.5 w-1.5" />Run Code</span>
            <span className="hidden h-[4.4cqh] items-center gap-0.5 rounded-full border border-zinc-800 px-1.5 text-[7px] font-medium text-zinc-300 sm:inline-flex"><Sparkles className="h-1.5 w-1.5" />AI Assistant</span>
            <span className="hidden items-center rounded-full border border-zinc-800 p-px text-[7px] font-medium sm:flex"><span className="rounded-full bg-zinc-800 px-1.5 py-px text-zinc-100">Code</span><span className="px-1.5 text-zinc-500">Preview</span></span>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden bg-[#09090b] py-1 font-mono text-[8px] leading-[12px]">
          {CODE.map(([n, line]) => (
            <div key={n} className={`flex whitespace-pre ${n === 48 ? "bg-red-500/15" : ""}`}>
              <span className="grid w-3 shrink-0 place-items-center">{n === 48 && <i className="h-[5px] w-[5px] rounded-full bg-red-400" />}</span>
              <span className="w-4 shrink-0 text-right text-zinc-600">{n}</span>
              <span className="pl-2 text-[#d4d4d4]">{line}</span>
            </div>
          ))}
        </div>
        <div className="flex h-[4.5cqh] shrink-0 items-center gap-2 border-t border-zinc-800/80 bg-[#18181b] px-1.5 font-mono text-[6.5px] text-zinc-500">
          <span>typescript</span><span>Ln 48, Col 36</span>
          <span className="ml-auto flex items-center gap-1"><Check className="h-1.5 w-1.5 text-emerald-400" />Saved locally 20:28</span>
        </div>
      </div>
    </div>
  );
}

function ErrorsPanel() {
  return (
    <div className="hsp2 absolute inset-0 opacity-0" style={an("hsp2")}>
      <div className="flex h-[5.6cqh] items-center justify-between gap-2">
        <span className="flex h-full items-center gap-1.5">
          <span className={`inline-flex h-full items-center gap-1 rounded-full px-2 text-[8px] font-medium ${SILVER}`}><Sparkles className="h-2 w-2" />Analyze &amp; Fix with AI [3]</span>
          <span className={`${GHOST} hidden h-[5.6cqh] sm:inline-flex`}><CheckCircle2 className="h-2 w-2" />Resolve all</span>
        </span>
        <span className={`inline-flex h-[5.6cqh] shrink-0 items-center gap-1 rounded-full px-2 text-[8px] font-medium ${SILVER}`}><Plus className="h-2 w-2" strokeWidth={2.5} /><span className="hidden sm:inline">Log an error or bug</span></span>
      </div>
      <div className="mt-[2cqh] overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-[8px]">
        <div className={`${COLS} h-[4.6cqh] border-b border-zinc-800/80 bg-zinc-900/60 text-[7px] font-medium text-zinc-500`}>
          <span>Severity</span><span>Error</span><span>Location</span><span className="hidden sm:block">Time</span>
        </div>
        {BUGS.map(([sev, tone, src, msg, loc, when], i) => (
          <div key={msg}>
            <div className={`${COLS} h-[7cqh] border-b border-zinc-800/60`} style={i === 0 ? an("hsrow") : undefined}>
              <span className={`w-fit rounded-full border px-1.5 py-px font-mono text-[7px] leading-[9px] ${BADGE[tone]}`}>{sev}</span>
              <span className="flex min-w-0 items-center gap-1 text-[8px] text-zinc-200">
                <span className="hidden shrink-0 rounded-full border border-zinc-700 px-1 text-[5px] uppercase leading-[7px] tracking-wide text-zinc-500 sm:inline-block">{src}</span>
                <span className="truncate">{msg}</span>
              </span>
              <span className="truncate font-mono text-[7px] text-zinc-400">{loc}</span>
              <span className="hidden whitespace-nowrap text-[7px] text-zinc-500 sm:block">{when}</span>
            </div>
            {i === 0 && (
              <div className="grid" style={{ gridTemplateRows: "0fr", ...an("hsexp") }}>
                <div className="min-h-0 overflow-hidden bg-[#09090b]">
                  <pre className="whitespace-pre-wrap border-b border-zinc-800/60 px-2 py-1 font-mono text-[6.5px] leading-[10px] text-zinc-400">{"TypeError: Cannot read 'id' of undefined\n    at checkout (api/checkout.ts:48:21)"}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const TILE = "min-w-0 items-center rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-1.5 flex";
/* One StatTile from the real Repository page (icon chip, small uppercase label, toned value, detail line). */
function RepoTile({ icon: Icon, label, value, detail, tone }: { icon: typeof Bug; label: string; value: string; detail: string; tone: "zinc" | "emerald" }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-md border ${tone === "zinc" ? "border-zinc-700 bg-zinc-800/40 text-zinc-400" : CHIP[tone]}`}><Icon className="h-2 w-2" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[5px] font-medium uppercase leading-[7px] tracking-[.12em] text-zinc-500">{label}</span>
        <span className={`block truncate text-[7.5px] font-semibold leading-[9px] ${tone === "zinc" ? "text-zinc-100" : INK[tone]}`}>{value}</span>
        <span className="block truncate text-[5px] leading-[7px] text-zinc-600">{detail}</span>
      </span>
    </span>
  );
}

/* The Repository tab: a scaled copy of the real RepositoryPage (page header with "Open on GitHub" / "Sync now", the four stat tiles,
   then the "Sync with GitHub" section with Autosave). "Sync now" is where the cursor's last click lands; its label, the section's button,
   the "Synced" pill and the "Last synced" tile all follow that click. */
function RepoPanel() {
  const syncLabels = (idle: string) => (
    <span className={`inline-grid place-items-center rounded-full px-2 text-[7px] font-medium ${SILVER}`} style={{ height: "5.4cqh" }}>
      <span className="col-start-1 row-start-1 flex items-center gap-1" style={an("hsla")}><RefreshCw className="h-2 w-2" />{idle}</span>
      <span className="col-start-1 row-start-1 flex items-center gap-1 opacity-0" style={an("hslb")}><Loader2 className="h-2 w-2 animate-spin" />Syncing…</span>
    </span>
  );
  const row = "mt-1 flex items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/30 px-1.5 py-[0.9cqh]";
  return (
    <div className="hsp3 absolute inset-0 overflow-hidden opacity-0" style={an("hsp3")}>
      {/* page header */}
      <div className="flex h-[8.5cqh] items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate bg-gradient-to-b from-white to-zinc-400 bg-clip-text pb-px font-display text-[11px] font-semibold leading-[13px] text-transparent">storefront</p>
          <p className="truncate text-[6px] leading-[8px] text-zinc-500">Your project's home on GitHub — <span className="text-zinc-200">acme/storefront</span>. Sync your work, choose who can see it, and keep an eye on its status here.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden items-center gap-1 rounded-full border border-zinc-700 px-2 text-[7px] font-medium text-zinc-300 sm:inline-flex" style={{ height: "5.4cqh" }}><ExternalLink className="h-2 w-2" />Open on GitHub</span>
          {syncLabels("Sync now")}
        </div>
      </div>

      {/* stat tiles */}
      <div className="mt-[1.5cqh] grid h-[10.5cqh] grid-cols-4 gap-1.5">
        <div className={TILE}><RepoTile icon={Globe} label="Visibility" value="Public" detail="Anyone can view" tone="emerald" /></div>
        <div className={TILE}><RepoTile icon={GitBranch} label="Branch" value="main" detail="Where syncs are sent" tone="zinc" /></div>
        <div className={TILE}><RepoTile icon={FileText} label="Files" value="5" detail="In this project" tone="zinc" /></div>
        <div className={`${TILE} grid`}>
          <span className="col-start-1 row-start-1 flex items-center" style={an("hsld")}><RepoTile icon={Clock} label="Last synced" value="Not yet this session" detail="Autosave is on" tone="zinc" /></span>
          <span className="col-start-1 row-start-1 flex items-center opacity-0" style={an("hslc")}><RepoTile icon={Clock} label="Last synced" value="Just now" detail="Autosave is on" tone="emerald" /></span>
        </div>
      </div>

      {/* "Sync with GitHub" section */}
      <div className="mt-[1.5cqh] rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-[1.4cqh]">
        <p className="flex items-center gap-1 text-[7.5px] font-semibold leading-[10px] text-zinc-100"><span className="grid h-3.5 w-3.5 place-items-center rounded-md border border-zinc-800 bg-zinc-800/40 text-zinc-300"><RefreshCw className="h-2 w-2" /></span>Sync with GitHub</p>
        <div className={row}>
          <span className="min-w-0">
            <span className="block truncate text-[7px] font-semibold leading-[9px] text-zinc-100">Sync changes now</span>
            <span className="block truncate text-[5.5px] leading-[7px] text-zinc-500">Copies all 5 files to the <span className="text-zinc-300">main</span> branch of acme/storefront.</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[6px] font-medium text-emerald-400 opacity-0" style={an("hslc")}><Check className="h-1.5 w-1.5" />Synced</span>
            {syncLabels("Sync changes")}
          </span>
        </div>
        <div className={row}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-800/40 text-zinc-200"><Zap className="h-2 w-2" /></span>
            <span className="min-w-0">
              <span className="block truncate text-[7px] font-semibold leading-[9px] text-zinc-100">Autosave to GitHub</span>
              <span className="block truncate text-[5.5px] leading-[7px] text-zinc-500">Sends your edits to GitHub a couple of seconds after you stop typing.</span>
            </span>
          </span>
          <span className="relative h-3 w-5 shrink-0 rounded-full bg-gradient-to-b from-white to-zinc-300"><i className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-zinc-900" /></span>
        </div>
      </div>
    </div>
  );
}

/* The dashboard's sticky top bar (project name, tab search, theme toggle). */
function DashTopBar() {
  return (
    <div className="absolute inset-x-0 top-0 flex h-[8cqh] items-center gap-1.5 border-b border-zinc-800 bg-[#09090b] px-2">
      <PanelLeftClose className="hidden h-2.5 w-2.5 shrink-0 text-zinc-300 sm:block" />
      <span className="min-w-0 flex-1 truncate font-display text-[9.5px] font-semibold tracking-[-0.015em] text-zinc-100">storefront</span>
      <span className="flex h-[5.4cqh] items-center gap-1.5 rounded-full border border-zinc-800 bg-[#121215] px-2 text-[7.5px] text-zinc-400"><Search className="h-2 w-2" /><span className="hidden sm:inline">Search tabs…</span><kbd className="hidden rounded border border-zinc-700 px-1 font-sans text-[6px] text-zinc-500 sm:block">Ctrl K</kbd></span>
      <span className="grid h-[5.4cqh] w-[5.4cqh] shrink-0 place-items-center rounded-full border border-zinc-800 bg-[#121215] text-zinc-300"><Sun className="h-2 w-2" /></span>
    </div>
  );
}

/* The static top of the dashboard (top bar, project title, health tiles). Shared by the animated Dashboard and the dimmed backdrop behind the AI modal. */
function DashHead() {
  return (
    <>
      <DashTopBar />

      {/* project title */}
      <div className="absolute inset-x-2 top-[10cqh] flex h-[14cqh] items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[7px] text-zinc-500"><Compass className="h-2 w-2" />All projects</p>
          <h1 className="mt-[1cqh] truncate bg-gradient-to-b from-white to-zinc-400 bg-clip-text pb-px font-display text-[14px] font-semibold leading-[1.15] text-transparent">storefront</h1>
          <p className="mt-[0.5cqh] truncate text-[7px] text-zinc-500">acme/storefront</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pb-px">
          <span className="inline-flex h-[5.4cqh] items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/50 px-2 text-[7.5px] font-medium text-zinc-200"><GitBranch className="h-2 w-2 text-zinc-400" />main</span>
          <span className={`${GHOST} hidden h-[5.4cqh] border-zinc-800 sm:inline-flex`}><ExternalLink className="h-2 w-2" />GitHub</span>
        </div>
      </div>

      {/* project health tiles */}
      <div className="absolute inset-x-2 top-[26cqh] grid h-[9cqh] grid-cols-4 gap-1.5">
        {TILES.map(([Icon, label, value, tone]) => (
          <div key={label} className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-1.5 sm:justify-start">
            <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-md border ${CHIP[tone]}`}><Icon className="h-2 w-2" /></span>
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-[5.5px] font-medium uppercase leading-[7px] tracking-[.12em] text-zinc-500">{label}</span>
              <span className={`block truncate text-[8px] font-semibold leading-[10px] ${INK[tone]}`}>{value}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* The dashboard as it looks behind the AI modal: sidebar, header, tab pills and an empty panel, blurred (the dark overlay goes on top). */
function DashBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 blur-[1.5px]">
      <Sidebar />
      <div className="absolute inset-y-0 left-[20%] right-0">
        <DashHead />
        <div className="absolute inset-x-2 top-[38cqh] flex h-[7cqh] gap-[0.8%] overflow-hidden">
          {TABS.map(([Icon, label, w]) => (
            <span key={label} className="flex h-full shrink-0 items-center justify-center gap-1 rounded-full border border-zinc-800 text-[8px] font-medium text-zinc-300" style={{ width: `${w}%` }}><Icon className="h-2.5 w-2.5 shrink-0" /><span className="hidden sm:inline">{label}</span></span>
          ))}
        </div>
        <div className="absolute inset-x-2 bottom-[3cqh] top-[48cqh] rounded-lg border border-zinc-800/80 bg-zinc-900/40" />
      </div>
    </div>
  );
}

function Dashboard() {
  return (
    <Win variant="app" title="https://devaudit.org/dashboard">
      <div className="relative aspect-[4/3] bg-[#09090b] text-[9px] leading-[1.3] text-zinc-300 [container-type:size] sm:aspect-[16/9]">
        <Sidebar />

        <div className="absolute inset-y-0 left-[20%] right-0">
          <DashHead />

          {/* tab pills */}
          <div className="absolute inset-x-2 top-[38cqh] flex h-[7cqh] gap-[0.8%] overflow-hidden [mask-image:linear-gradient(to_right,#000_93%,transparent)]">
            {TABS.map(([Icon, label, w, active]) => (
              <span key={label} className="relative flex h-full shrink-0 items-center justify-center gap-1 rounded-full border border-zinc-800 text-[8px] font-medium text-zinc-300" style={{ width: `${w}%` }}>
                {active && <span aria-hidden className={`absolute -inset-px rounded-full bg-zinc-800 ring-1 ring-zinc-600/60 ${active === "hsa1" ? "" : "opacity-0"}`} style={an(active)} />}
                <Icon className="relative h-2.5 w-2.5 shrink-0" /><span className="relative hidden truncate sm:inline">{label}</span>
              </span>
            ))}
          </div>

          {/* tab content: Code Studio → Errors & Bugs → Repository, one after another */}
          <div className="absolute inset-x-2 bottom-[3cqh] top-[48cqh]">
            <CodePanel />
            <ErrorsPanel />
            <RepoPanel />
          </div>
        </div>

        {/* Looping mouse (wrapper = full box, so % translates move across the dashboard) */}
        <div className="hscur pointer-events-none absolute inset-0 z-20" style={an("hsmove", 18, "cubic-bezier(.65,0,.35,1)")}>
          <span className="absolute left-0 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" style={an("hsclick")} />
          <svg width="16" height="16" viewBox="0 0 16 16" className="absolute left-0 top-0 drop-shadow-md"><path d="M1 1l5 13 2-5 5-2z" fill="#fff" stroke="#0b0f17" /></svg>
        </div>
      </div>
    </Win>
  );
}

/* ---- The AI card: a scaled-down copy of the real AI Assistant modal (AiAssistantModal), floating in front of the dashboard.
   Like the real thing, the page behind is dimmed and blurred (bg-black/60 + backdrop blur) and the modal sits centred on it.
   At lg+ the dashboard card overlaps the left ~17% of this card, so the modal starts to the right of that overlap.
   It replays the real flow: empty state → type → send → thinking dots → reply → "Suggested changes" card → Apply. ---- */
const AI_NAV = [[MessageSquare, "Chat", 0], [History, "Recent chats", 2], [BookOpen, "Prompt library", 0], [Paperclip, "Attachments", 0], [Layers, "Project context", 0]] as const;
const AI_RECENT = ["Explain checkout.ts", "Find bugs in cart.ts"] as const;
const AI_ASK = [
  [FileText, "Explain checkout.ts", "Explain what api/checkout.ts does, step by step."],
  [Bug, "Find bugs", "Read api/checkout.ts and list any bugs or mistakes, most serious first."],
  [FlaskConical, "Write tests", "Write tests for api/checkout.ts using describe / it / expect."],
  [Wand2, "Make it cleaner", "Refactor api/checkout.ts to be easier to read."],
] as const;
const RND = "grid h-3.5 w-3.5 place-items-center rounded-full";
const DOT = "hsdot block h-[3px] w-[3px] rounded-full bg-zinc-400";
const CODE_CHIP = "rounded bg-zinc-800/80 px-[3px] text-[0.85em] text-zinc-100";

function AiPreview() {
  return (
    <Win variant="app" title="https://devaudit.org/dashboard">
      <div className="relative h-60 overflow-hidden bg-[#09090b] text-[9px] leading-[1.3] text-zinc-300 [container-type:size]">
        <DashBackdrop />
        <div aria-hidden className="absolute inset-0 bg-black/60" />

        {/* the modal */}
        <div className="absolute inset-x-[10%] inset-y-[4.5cqh] flex overflow-hidden rounded-[10px] border border-zinc-700/60 bg-[#121215] shadow-[0_20px_50px_-12px_rgba(0,0,0,.9)] lg:left-[17%] lg:right-[4%]">
          {/* left rail */}
          <aside className="hidden w-[30%] shrink-0 flex-col border-r border-zinc-800/80 bg-[#0d0d0f] sm:flex">
            <div className="flex items-center gap-1.5 px-2 pb-[2cqh] pt-[3cqh]">
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-md ${SILVER}`}><Sparkles className="h-2 w-2" /></span>
              <span className="min-w-0">
                <span className="block truncate font-display text-[8px] font-semibold leading-[10px] text-zinc-50">DevAudit AI</span>
                <span className="block truncate text-[6px] leading-[8px] text-zinc-500">storefront</span>
              </span>
            </div>
            <div className="px-2"><span className={`flex h-[6cqh] items-center justify-center gap-1 rounded-full text-[7px] font-medium ${SILVER}`}><Plus className="h-2 w-2" strokeWidth={2.5} />New chat</span></div>
            <nav className="mt-[2.5cqh] space-y-[0.5cqh] px-1">
              {AI_NAV.map(([Icon, label, n], i) => (
                <span key={label} className={`flex h-[5cqh] items-center gap-1 rounded-md px-1.5 text-[6.5px] font-medium ${i === 0 ? "bg-zinc-800/70 text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]" : "text-zinc-300"}`}>
                  <Icon className="h-2 w-2 shrink-0" /><span className="flex-1 truncate">{label}</span>
                  {n > 0 && <span className="rounded-full bg-zinc-800 px-1 text-[5px] leading-[7px] text-zinc-400">{n}</span>}
                </span>
              ))}
            </nav>
            <div className="mt-[3cqh] min-h-0 flex-1 overflow-hidden px-1">
              <p className="px-1.5 pb-[0.8cqh] text-[5px] font-medium uppercase tracking-[.16em] text-zinc-600">Recent</p>
              {/* the new chat slots in at the top when the message is sent */}
              <div className="grid" style={{ gridTemplateRows: "0fr", ...an("hsrc") }}>
                <div className="min-h-0 overflow-hidden"><span className="mb-px block truncate rounded-md bg-zinc-800/50 px-1.5 py-[2.5px] text-[6px] text-zinc-100">Why does checkout crash for guests?</span></div>
              </div>
              {AI_RECENT.map((t) => <span key={t} className="mb-px block truncate rounded-md px-1.5 py-[2.5px] text-[6px] text-zinc-500">{t}</span>)}
            </div>
            <div className="border-t border-zinc-800/80 px-2 py-[1.6cqh]">
              <p className="truncate text-[5.5px] leading-[8px] text-zinc-500">5 files in project</p>
              <p className="truncate text-[5.5px] leading-[8px] text-zinc-600">Open: api/checkout.ts</p>
            </div>
          </aside>

          {/* main column */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <header className="flex h-[10cqh] shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 px-2.5">
              <span className="relative h-full min-w-0 flex-1">
                <span className="absolute inset-0 flex flex-col justify-center" style={an("hshA", 12)}>
                  <span className="truncate text-[8px] font-semibold leading-[10px] text-zinc-50">New chat</span>
                  <span className="hidden truncate text-[6px] leading-[8px] text-zinc-500 sm:block">Talk to the assistant about your project</span>
                </span>
                <span className="absolute inset-0 flex flex-col justify-center opacity-0" style={an("hshB", 12)}>
                  <span className="truncate text-[8px] font-semibold leading-[10px] text-zinc-50">Why does checkout crash for guests?</span>
                  <span className="hidden truncate text-[6px] leading-[8px] text-zinc-500 sm:block">2 messages · Just now</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className={`${RND} border border-zinc-800 text-zinc-400 opacity-0`} style={an("hshB", 12)}><Trash2 className="h-2 w-2" /></span>
                <span className={`${RND} border border-zinc-800 text-zinc-400`}><X className="h-2 w-2" /></span>
              </span>
            </header>

            <div className="relative min-h-0 flex-1 overflow-hidden px-2.5 pt-[2cqh]">
              {/* empty state (what the real modal shows before the first message) */}
              <div className="absolute inset-x-2.5 top-[2.6cqh] flex flex-col items-center text-center" style={an("hsem", 12)}>
                <span className="grid h-4 w-4 place-items-center rounded-lg border border-zinc-700/70 bg-zinc-800/40 text-zinc-100"><Sparkles className="h-2 w-2" /></span>
                <p className="mt-1 bg-gradient-to-b from-white to-zinc-400 bg-clip-text pb-px font-display text-[10px] font-semibold leading-[12px] text-transparent">What can I help you build?</p>
                <p className="mt-0.5 text-[6.5px] leading-[9px] text-zinc-500">Ask about <span className="text-zinc-300">api/checkout.ts</span>, paste an error, attach a screenshot or share a link.</p>
                <div className="mt-[2.2cqh] grid w-full grid-cols-2 gap-1">
                  {AI_ASK.map(([Icon, title, text]) => (
                    <span key={title} className="flex min-w-0 items-center gap-1 rounded-md border border-zinc-800/80 bg-zinc-900/40 p-1 text-left">
                      <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-zinc-800 bg-zinc-800/40 text-zinc-200"><Icon className="h-2 w-2" /></span>
                      <span className="min-w-0"><span className="block truncate text-[6.5px] font-medium text-zinc-100">{title}</span><span className="block truncate text-[5.5px] text-zinc-500">{text}</span></span>
                    </span>
                  ))}
                </div>
              </div>

              {/* the conversation */}
              <div className="ml-auto w-fit max-w-[88%] rounded-[7px] rounded-br-[3px] border border-zinc-700/70 bg-zinc-800/70 px-2 py-1 text-[8px] leading-[11px] text-zinc-100 opacity-0" style={an("hsu", 12)}>Why does checkout crash for guests?</div>
              <div className="mt-[2.2cqh] flex items-start gap-1.5">
                <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-md border border-zinc-700/70 bg-zinc-800/50 text-zinc-100 opacity-0" style={an("hsav", 12)}><Sparkles className="h-2 w-2" /></span>
                <div className="min-w-0 flex-1">
                  <div className="relative text-[8px] leading-[12px] text-zinc-200">
                    <span className="absolute left-0 top-[4px] flex gap-[3px] opacity-0" style={an("hsth", 12)}><i className={DOT} /><i className={DOT} /><i className={DOT} /></span>
                    <span className="block w-fit whitespace-nowrap opacity-0" style={an("hsr1", 12, "steps(34,end)")}>Guest session expires mid-checkout,</span>
                    <span className="block w-fit whitespace-nowrap opacity-0" style={an("hsr2", 12, "steps(34,end)")}>so <code className={CODE_CHIP}>cart.items[0]</code> is undefined at <code className={CODE_CHIP}>:48</code>.</span>
                  </div>
                  <div className="opacity-0" style={an("hss1", 12)}>
                    <div className="mt-[2cqh] rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-1">
                      <p className="flex items-center gap-1 text-[7px] font-medium leading-[9px] text-emerald-300"><FileCode2 className="h-2 w-2" />Suggested changes to 1 file</p>
                      <div className="mt-[3px] flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-1.5 py-[2px] text-[6.5px] text-zinc-200"><span className="truncate font-medium">api/checkout.ts</span><span className="shrink-0 text-zinc-500">3 lines · preview</span></div>
                      <span className="mt-1 inline-grid justify-items-start">
                        <span className={`col-start-1 row-start-1 inline-flex h-3.5 items-center gap-1 rounded-full px-2 text-[7px] font-medium ${SILVER}`} style={an("hsapa", 12)}><Check className="h-2 w-2" />Apply 1 file change</span>
                        <span className="col-start-1 row-start-1 inline-flex h-3.5 items-center gap-1 rounded-full border border-zinc-700 px-2 text-[7px] font-medium text-zinc-300 opacity-0" style={an("hsapb", 12)}><Check className="h-2 w-2" />Applied to your project</span>
                      </span>
                    </div>
                    <div className="mt-[1cqh] flex items-center gap-2 text-[6px] leading-[8px] text-zinc-500">
                      <span className="inline-flex items-center gap-0.5"><Copy className="h-1.5 w-1.5" />Copy</span>
                      <span className="inline-flex items-center gap-0.5"><RotateCcw className="h-1.5 w-1.5" />Regenerate</span>
                      <span className="ml-auto text-zinc-600">Just now</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* composer */}
            <div className="shrink-0 px-2.5 pb-[2cqh]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
                <div className="relative h-4 px-1 text-[8px] leading-4 text-zinc-100">
                  <span className="absolute inset-x-1 truncate text-zinc-600" style={an("hsph", 12)}>Ask anything about api/checkout.ts…</span>
                  <span className="relative inline-block whitespace-nowrap">
                    <span className="inline-block opacity-0" style={an("hsti", 12, "steps(34,end)")}>Why does checkout crash for guests?</span>
                    <span className="absolute inset-y-0 left-0 w-full border-r border-zinc-100 opacity-0" style={an("hstc", 12, "steps(34,end)")} />
                  </span>
                </div>
                <div className="mt-[3px] flex items-center justify-between gap-1.5">
                  <span className="flex items-center gap-px text-zinc-500">
                    <span className={`${RND} border border-zinc-800 text-zinc-400`}><Plus className="h-2 w-2" /></span>
                    <span className={RND}><ImageIcon className="h-2 w-2" /></span>
                    <span className={RND}><Link2 className="h-2 w-2" /></span>
                    <span className={RND}><Paperclip className="h-2 w-2" /></span>
                  </span>
                  {/* disabled (dim) until there's a draft, spins while the reply is on its way */}
                  <span className={`inline-flex h-3.5 items-center gap-0.5 rounded-full px-2 text-[7px] font-medium opacity-40 ${SILVER}`} style={an("hssnd", 12)}>
                    <span className="inline-grid">
                      <span className="col-start-1 row-start-1" style={an("hsia", 12)}><ArrowUp className="h-2 w-2" strokeWidth={2.5} /></span>
                      <span className="col-start-1 row-start-1 opacity-0" style={an("hsib", 12)}><Loader2 className="h-2 w-2 animate-spin" /></span>
                    </span>Send
                  </span>
                </div>
              </div>
              <p className="mt-[1.2cqh] truncate text-center text-[5px] leading-[7px] text-zinc-600">The assistant can make mistakes. Suggested file changes are only applied when you press Apply.</p>
            </div>
          </div>
        </div>
      </div>
    </Win>
  );
}

/* ---- The deploy card: a scaled-down copy of the real dashboard on its Deploy tab: sidebar, top bar, and the Universal Host Deployer (HostDeployer).
   Loop (12s, in step with the AI card): pick Netlify → click the token field → the token types in as password dots → Deploy
   (lands just after the AI card's "Apply") → "Deploying…" → "Successfully deployed … View Deployment ↗".
   The token row + Deploy button are pinned to the panel's bottom edge and the cursor is anchored to that same edge (calc), so it can't drift
   off them. At lg+ the dashboard card overlaps the right ~18% of this card, so the panel stops short of it. ---- */
const HOSTS = [
  ["Vercel", "95% Match", "Next.js, React, and frontend frameworks", "Serverless / Edge • $0/mo on Hobby Tier", "hsvA"],
  ["GitHub Pages", "90% Match", "Pure frontend or static sites", "Static / Jamstack • 100% Free", ""],
  ["Netlify", "88% Match", "JAMstack applications and static builds", "Static / Jamstack • Free Tier Available", "hsvB"],
  ["Render", "85% Match", "Full-stack Express apps and Dockerized API services", "PaaS • $0 - $7/mo", ""],
  ["Cloudflare Pages", "90% Match", "Static sites, Jamstack, and single-page apps", "Edge Network • $0/mo", ""],
  ["Custom", "Bring your own", "Any host with its own deploy webhook", "Webhook • Varies", ""],
] as const;
const TOKEN_DOTS = "•".repeat(26); // the real token field is type="password", so a typed token shows as dots

/* Crossfades between the two host variants (Vercel is selected until the click, then Netlify). */
const Swap = ({ a, b }: { a: ReactNode; b: ReactNode }) => (
  <span className="inline-grid">
    <span className="col-start-1 row-start-1" style={an("hsvA", 12)}>{a}</span>
    <span className="col-start-1 row-start-1 opacity-0" style={an("hsvB", 12)}>{b}</span>
  </span>
);

function DeployPreview() {
  return (
    <Win variant="app" title="https://devaudit.org/dashboard">
      <div className="relative h-60 overflow-hidden bg-[#09090b] text-[9px] leading-[1.3] text-gray-200 [container-type:size]">
        <Sidebar />
        <div className="absolute inset-y-0 left-[20%] right-0">
          <DashTopBar />

          <div className="absolute bottom-[3cqh] left-2 right-2 top-[10cqh] rounded-lg border border-gray-800 bg-[#0e1017] p-1.5 lg:right-[22.5%]">
            {/* header */}
            <div className="flex items-center justify-between gap-2 border-b border-gray-800 pb-[3px]">
              <div className="min-w-0">
                <p className="truncate text-[8px] font-semibold leading-[10px] text-gray-100">Universal Host Deployer</p>
                <p className="truncate text-[5.5px] leading-[8px] text-gray-400">Evaluate project architecture with AI and ship straight to live cloud providers.</p>
              </div>
              <span className={`inline-flex h-3.5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[6px] font-medium ${SILVER}`}><Sparkles className="h-1.5 w-1.5 text-amber-500" />AI Host Matchmaker</span>
            </div>

            {/* search + host cards */}
            <div className="mt-[3px] flex h-[11px] items-center truncate rounded-md border border-gray-800 bg-gray-900 px-1.5 text-[6px] text-gray-600">Search hosts by name, category, or use case…</div>
            <div className="mt-1 grid grid-cols-2 gap-[3px]">
              {HOSTS.map(([name, meta, best, cat, sel]) => (
                <div key={name} className={`relative min-w-0 rounded-md border px-1.5 py-[2.5px] ${name === "Custom" ? "border-dashed border-gray-700 bg-gray-900/30" : "border-gray-800 bg-gray-900/50"}`}>
                  {sel && <span aria-hidden className={`absolute -inset-px rounded-md border border-indigo-500 bg-indigo-950/30 ring-1 ring-indigo-500 ${sel === "hsvA" ? "" : "opacity-0"}`} style={an(sel, 12)} />}
                  <div className="relative">
                    <div className="flex items-center justify-between gap-1"><span className="truncate text-[7px] font-medium leading-[9px] text-white">{name}</span><span className="shrink-0 font-mono text-[5.5px] text-indigo-400">{meta}</span></div>
                    <p className="truncate text-[5.5px] leading-[7px] text-gray-400">{best}</p>
                    <p className="truncate font-mono text-[5px] leading-[7px] text-gray-500">{cat}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* deploy + token (pinned to the bottom edge) */}
            <div className="absolute inset-x-1.5 bottom-1.5 border-t border-gray-800 pt-[3px]">
              <div className="flex h-[9px] items-center justify-between text-[7px] leading-[9px]">
                <span className="inline-flex items-center gap-[2px] font-medium text-gray-300">Deploying to <b className="font-bold text-indigo-400"><Swap a="Vercel" b="Netlify" /></b></span>
                <span className="inline-flex items-center gap-[2px] font-medium text-indigo-400 underline">Get <Swap a="Vercel" b="Netlify" /> Token ↗</span>
              </div>

              {/* the real panel shows the "quick steps" box and, once you deploy, the notice; here they share one slot */}
              <div className="relative mt-[2px] h-[14px]">
                <div className="absolute inset-0 flex items-center overflow-hidden whitespace-nowrap rounded-md border border-gray-800 bg-gray-900/80 px-1.5 text-[6px] text-gray-400 [mask-image:linear-gradient(to_right,#000_92%,transparent)]" style={an("hsk1", 12)}>
                  <b className="mr-1 font-medium text-gray-300">Quick steps to get your token:</b>
                  <Swap a="1. Click “Get Vercel Token” to open Account Settings." b="1. Click “Get Netlify Token” to open Personal Access Tokens." />
                </div>
                <div className="absolute inset-0 flex items-center gap-1 rounded-md border border-indigo-800/60 bg-indigo-950/50 px-1.5 text-[6px] text-indigo-200 opacity-0" style={an("hsn1", 12)}>
                  <Loader2 className="h-2 w-2 shrink-0 animate-spin" /><span className="truncate">Deploying 'storefront' to Netlify...</span>
                </div>
                <div className="absolute inset-0 flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/50 px-1.5 text-[6px] text-emerald-200 opacity-0" style={an("hsn2", 12)}>
                  <CheckCircle2 className="h-2 w-2 shrink-0" /><span className="truncate">Successfully deployed 'storefront' to Netlify!</span>
                  <span className="shrink-0 font-bold underline">View Deployment ↗</span><X className="ml-auto h-2 w-2 shrink-0 text-gray-400" />
                </div>
              </div>

              <div className="mt-[3px] flex h-[15px] gap-1">
                <div className="relative flex min-w-0 flex-1 items-center rounded-md border border-gray-800 bg-gray-900 px-1.5 font-mono text-[7px] text-white" style={an("hsdis", 12)}>
                  <span aria-hidden className="absolute -inset-px rounded-md border border-indigo-500 opacity-0" style={an("hsfoc", 12)} />
                  <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-gray-600" style={an("hspl", 12)}><Swap a="Enter your Vercel token..." b="Enter your Netlify token..." /></span>
                  <span className="relative inline-block whitespace-nowrap">
                    <span className="inline-block tracking-[.5px] opacity-0" style={an("hstk", 12, "steps(26,end)")}>{TOKEN_DOTS}</span>
                    <span className="absolute inset-y-[1px] left-0 w-full border-r border-white opacity-0" style={an("hskc", 12, "steps(26,end)")} />
                  </span>
                </div>
                <span className="inline-grid shrink-0 place-items-center rounded-md bg-indigo-600 px-2 text-[7px] font-medium text-white" style={an("hsdis", 12)}>
                  <span className="col-start-1 row-start-1" style={an("hsdA", 12)}><Swap a="Deploy to Vercel" b="Deploy to Netlify" /></span>
                  <span className="col-start-1 row-start-1 opacity-0" style={an("hsdB", 12)}>Deploying...</span>
                </span>
              </div>
            </div>

            {/* looping mouse (wrapper = the panel's padding box; stops are anchored to the top/bottom/right edges) */}
            <div className="hscur pointer-events-none absolute inset-0 z-20" style={an("hsmove2", 12, "cubic-bezier(.65,0,.35,1)")}>
              <span className="absolute left-0 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" style={an("hsclick2", 12)} />
              <svg width="16" height="16" viewBox="0 0 16 16" className="absolute left-0 top-0 drop-shadow-md"><path d="M1 1l5 13 2-5 5-2z" fill="#fff" stroke="#0b0f17" /></svg>
            </div>
          </div>
        </div>
      </div>
    </Win>
  );
}

const d = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

/* Reverse fan. The dashboard sits front and centre, a touch larger than the other two. The smaller cards are hinged
   behind it at their inner bottom corners and swing outward in a wedge, so their outer edges (and the content that
   matters) stay clear; the AI and deploy cards are inset on their inner sides so the dashboard never covers their text.
   Below lg there is no room to fan, so everything stacks and the dashboard drops BEHIND the cards instead of blocking them. */
const SIDE =
  "relative -mt-10 w-[92%] transition-transform duration-[900ms] ease-[cubic-bezier(.16,1,.3,1)] lg:absolute lg:bottom-20 lg:z-10 lg:mt-0 lg:w-[40%]";
const LEFT = `${SIDE} z-10 mr-auto -rotate-2 lg:-left-[5%] lg:origin-bottom-right lg:-rotate-[7deg] lg:group-hover:-translate-x-3 lg:group-hover:-rotate-[9deg]`;
const RIGHT = `${SIDE} z-20 ml-auto rotate-2 lg:-right-[5%] lg:origin-bottom-left lg:rotate-[7deg] lg:group-hover:translate-x-3 lg:group-hover:rotate-[9deg]`;

function Side({ cls, enter, delay, float, shade, children }: { cls: string; enter: string; delay: number; float: string; shade: string; children: ReactNode }) {
  return (
    <div className={cls}>
      <div className={`hsin ${enter}`} style={d(delay)}>
        <div className="relative" style={{ animation: float }}>
          {children}
          {/* the dashboard casts a soft shadow over the inner edge; it lifts on hover */}
          <div aria-hidden className={`pointer-events-none absolute inset-0 hidden rounded-2xl transition-opacity duration-[900ms] lg:block lg:group-hover:opacity-0 ${shade}`} />
        </div>
      </div>
    </div>
  );
}

export default function HeroStack() {
  return (
    <div className="hs group relative mx-auto max-w-xl px-4 sm:px-6 lg:max-w-6xl lg:pb-14">
      <style>{CSS}</style>
      <div className="pointer-events-none absolute inset-x-12 -top-10 h-72 rounded-full bg-accent-cyan/10 blur-3xl lg:inset-x-[22%]" />
      <div className="hsin relative z-0 lg:z-20 lg:mx-auto lg:w-[46%]" style={d(0.5)}>
        <div style={{ animation: "hsfloat 7s ease-in-out infinite alternate" }}><Dashboard /></div>
      </div>
      <Side cls={LEFT} enter="hsfl" delay={0.95} float="hsfloat 8s ease-in-out -2s infinite alternate" shade="bg-gradient-to-l from-black/45 via-black/10 to-transparent">
        <DeployPreview />
      </Side>
      <Side cls={RIGHT} enter="hsfr" delay={1.1} float="hsfloat 6s ease-in-out -1s infinite alternate" shade="bg-gradient-to-r from-black/45 via-black/10 to-transparent">
        <AiPreview />
      </Side>
    </div>
  );
}
