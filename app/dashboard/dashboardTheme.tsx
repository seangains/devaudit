"use client";

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { JetBrains_Mono, Poppins } from "next/font/google";
import { Sun, Moon, Monitor, Check, Palette, RotateCcw } from "lucide-react";
import {
  ACCENTS, BASES, DEFAULT_SETTINGS, SIZES, STORE_KEY,
  accentColors, applySiteTheme, baseColors, clearStored, readStored, systemPrefersDark, writeStored,
  type DaSettings, type Mode, type SizeKey,
} from "@/utils/siteTheme";

// Re-exported so existing `import { BASES, ... } from "./dashboardTheme"` lines keep working.
export { ACCENTS, BASES, DEFAULT_SETTINGS };
export type { DaSettings, Mode, SizeKey };

// Code font for the editor and <pre>/<code> blocks. JetBrains Mono is a variable font, so no `weight` array.
export const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-code" });

/** Poppins is the UI font for every word in the dashboard (headings, body, buttons, labels). It is not a variable font,
 *  so next/font needs the weight list. Put `poppins.variable` on the same element as `mono.variable` (DashboardThemeRoot
 *  and the dashboard page both do). */
export const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], display: "swap", variable: "--font-poppins" });

// ---------------------------------------------------------------------------------------------
// Theme state
// ---------------------------------------------------------------------------------------------
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

export type DaTheme = {
  settings: DaSettings;
  update: (patch: Partial<DaSettings>) => void;
  reset: () => void;
  resolved: "dark" | "light";
  vars: CSSProperties;
  /** Background colour Monaco should use so the editor blends into the page. */
  editorBg: string;
};

export function useDaThemeState(): DaTheme {
  const [settings, setSettings] = useState<DaSettings>(DEFAULT_SETTINGS);
  const [systemDark, setSystemDark] = useState(false);
  // Nothing is applied to <html> until the saved settings are read, so a returning visitor never sees a frame of the defaults.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(readStored());
    setSystemDark(systemPrefersDark());
    setLoaded(true);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    // Another tab (or the homepage toggle) changed the theme: follow it.
    const onStorage = (e: StorageEvent) => { if (e.key === STORE_KEY || e.key === null) setSettings(readStored()); };
    mq.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => { mq.removeEventListener("change", onSystem); window.removeEventListener("storage", onStorage); };
  }, []);

  const resolved: "dark" | "light" = settings.mode === "auto" ? (systemDark ? "dark" : "light") : settings.mode;

  // Scale every rem-based size (text, padding, gaps, widths) at once: this is what makes the whole
  // dashboard bigger and roomier without touching each component's classes.
  useEffect(() => {
    if (!loaded) return;
    const el = document.documentElement, prev = el.style.fontSize;
    el.style.fontSize = `${SIZES[settings.size].pct}%`;
    return () => { el.style.fontSize = prev; };
  }, [settings.size, loaded]);

  // Keep <html> (and so the landing page tokens) in step with the dashboard.
  useEffect(() => { if (loaded) applySiteTheme(settings, resolved === "dark"); }, [settings, resolved, loaded]);

  const update = (patch: Partial<DaSettings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    writeStored(next);
    return next;
  });
  const reset = () => { setSettings(DEFAULT_SETTINGS); clearStored(); };

  const { vars, editorBg } = useMemo(() => {
    const dark = resolved === "dark";
    const [bg, s1, s2, s3] = baseColors(settings, dark);
    const ac = accentColors(settings);
    const accentLum = (luminance(ac.a1) + luminance(ac.a2)) / 2;
    const v: Record<string, string> = {
      "--da-bg": bg, "--da-s1": s1, "--da-s2": s2, "--da-s3": s3,
      "--da-a1": ac.a1, "--da-a2": ac.a2,
      "--da-at": dark ? ac.a1 : `color-mix(in srgb, ${ac.a1} 55%, #000000)`,
      "--da-at2": dark ? `color-mix(in srgb, ${ac.a2} 55%, #ffffff)` : `color-mix(in srgb, ${ac.a2} 80%, #000000)`,
      "--da-on": accentLum > 0.28 ? "#09090b" : "#ffffff",
      "--da-hi": dark ? "#ffffff" : "#09090b",
      "--da-z100": dark ? "#f4f4f5" : "#18181b", "--da-z200": dark ? "#e4e4e7" : "#27272a",
      "--da-z300": dark ? "#d4d4d8" : "#3f3f46", "--da-z400": dark ? "#a1a1aa" : "#52525b",
      "--da-z500": "#71717a", "--da-z600": dark ? "#52525b" : "#a1a1aa",
      "--da-z700": dark ? "#3f3f46" : "#d4d4d8", "--da-z800": dark ? "#27272a" : "#e4e4e7",
      "--da-logo": dark ? "#d4d4d8" : "#3f3f46", // light grey on dark, dark grey on light
      "--da-glow": settings.glow ? "1" : "0",
    };
    return { vars: v as CSSProperties, editorBg: bg };
  }, [settings, resolved]);

  return { settings, update, reset, resolved, vars, editorBg };
}

export const DaThemeContext = createContext<Pick<DaTheme, "resolved" | "editorBg">>({ resolved: "dark", editorBg: "#09090b" });
export const useDaTheme = () => useContext(DaThemeContext);

/** The full theme (settings + update/reset), for controls that change it. Provided by DashboardThemeRoot. */
const DaFullThemeContext = createContext<DaTheme | null>(null);
export function useDaFullTheme(): DaTheme {
  const t = useContext(DaFullThemeContext);
  if (!t) throw new Error("useDaFullTheme must be used inside <DashboardThemeRoot>.");
  return t;
}

// ---------------------------------------------------------------------------------------------
// Scoped stylesheet: remaps the Tailwind zinc / gray / hex / cyan / indigo classes the dashboard
// already uses onto the --da-* CSS variables set by DashboardThemeRoot, so every existing component follows the theme with no
// per-file edits. Everything is scoped under `.da-root`.
// ---------------------------------------------------------------------------------------------
const esc = (c: string) => "." + c.replace(/([:/\[\]#.,()%])/g, "\\$1");
const mixv = (v: string, p: number) => `color-mix(in srgb, var(${v}) ${p}%, transparent)`;

function buildCss(): string {
  const out: string[] = [];
  // Each rule also matches the .da-root element itself (`.da-root.cls`), not only its descendants: the dashboard root carries
  // bg-[#09090b] / text-zinc-300, and without this it stayed dark in light mode while everything inside flipped.
  const R = (classes: string[], decl: string, extra = "") => out.push(classes.map((c) => `.da-root ${esc(c)}${extra},.da-root${esc(c)}${extra}`).join(",") + `{${decl}}`);
  const H = (classes: string[], decl: string) => out.push(classes.map((c) => `.da-root ${esc("hover:" + c)}:hover`).join(",") + `{${decl}}`);

  // Text
  const txt: Record<string, string> = { "100": "--da-z100", "200": "--da-z200", "300": "--da-z300", "400": "--da-z400", "500": "--da-z500", "600": "--da-z600" };
  for (const [n, v] of Object.entries(txt)) { R([`text-zinc-${n}`, `text-gray-${n}`], `color:var(${v})`); H([`text-zinc-${n}`, `text-gray-${n}`], `color:var(${v})`); }
  R(["text-white"], "color:var(--da-hi)"); H(["text-white"], "color:var(--da-hi)");
  R(["text-slate-950"], "color:var(--da-on)");
  R(["placeholder:text-zinc-600", "placeholder-gray-600"], "color:var(--da-z600)", "::placeholder");

  // Surfaces
  R(["bg-[#09090b]", "bg-gray-950"], "background-color:var(--da-bg)");
  R(["bg-[#121215]", "bg-gray-900", "bg-zinc-900"], "background-color:var(--da-s1)");
  R(["bg-[#18181b]"], "background-color:var(--da-s2)");
  R(["bg-[#0d0d0f]", "bg-[#0c0c10]", "bg-[#12151f]", "bg-[#0e1017]", "bg-[#0b0f0d]"], "background-color:var(--da-s3)");
  for (const p of [30, 40, 50, 60, 80]) {
    R([`bg-gray-900/${p}`, `bg-zinc-900/${p}`], `background-color:${mixv("--da-s1", p)}`);
    R([`bg-zinc-800/${p}`], `background-color:${mixv("--da-z800", p)}`);
  }
  R(["bg-zinc-800", "bg-gray-800"], "background-color:var(--da-z800)");
  R(["bg-zinc-700"], "background-color:var(--da-z700)");
  R(["bg-zinc-700/60"], `background-color:${mixv("--da-z700", 60)}`);
  H(["bg-zinc-700", "bg-gray-800"], "background-color:var(--da-z700)");
  for (const p of [30, 40, 60]) H([`bg-zinc-800/${p}`], `background-color:${mixv("--da-z800", p)}`);
  H(["bg-zinc-700/60"], `background-color:${mixv("--da-z700", 60)}`);

  // Borders + dividers
  R(["border-zinc-800", "border-gray-800", "border-zinc-800/80", "border-gray-800/80", "border-zinc-800/60"], "border-color:var(--da-z800)");
  R(["border-zinc-700", "border-gray-700", "border-zinc-700/80"], "border-color:var(--da-z700)");
  R(["border-zinc-300"], "border-color:var(--da-z300)");
  R(["focus:border-zinc-600"], "border-color:var(--da-z500)", ":focus");
  H(["border-gray-700"], "border-color:var(--da-z700)"); H(["border-gray-600"], "border-color:var(--da-z600)");
  out.push(`.da-root ${esc("divide-zinc-800/80")}>:not([hidden])~:not([hidden]),.da-root ${esc("divide-gray-800/60")}>:not([hidden])~:not([hidden]){border-color:var(--da-z800)}`);

  // Accent (cyan / indigo → chosen accent)
  R(["text-cyan-200", "text-cyan-300", "text-cyan-400", "text-cyan-200/90"], "color:var(--da-at)"); H(["text-cyan-200"], "color:var(--da-at)");
  R(["text-indigo-100", "text-indigo-200", "text-indigo-300", "text-indigo-400", "text-indigo-200/90"], "color:var(--da-at2)"); H(["text-indigo-300", "text-indigo-400"], "color:var(--da-at2)");
  for (const p of [20, 30, 50, 60]) R([`border-cyan-500/${p}`], `border-color:${mixv("--da-a1", p)}`);
  R(["border-cyan-400"], "border-color:var(--da-a1)");
  for (const p of [50, 60]) R([`focus:border-cyan-500/${p}`], `border-color:${mixv("--da-a1", p)}`, ":focus");
  R(["focus:border-indigo-500"], "border-color:var(--da-a2)", ":focus");
  R(["ring-indigo-500"], "--tw-ring-color:var(--da-a2)");
  R(["ring-cyan-400"], "--tw-ring-color:var(--da-a1)");
  R(["border-indigo-500", "border-indigo-500/30", "border-indigo-800/50", "border-indigo-800/60"], `border-color:${mixv("--da-a2", 40)}`);
  H(["border-indigo-500"], "border-color:var(--da-a2)");
  R(["bg-cyan-500/5"], `background-color:${mixv("--da-a1", 6)}`); R(["bg-cyan-500/10"], `background-color:${mixv("--da-a1", 12)}`); R(["bg-cyan-500"], "background-color:var(--da-a1)");
  R(["bg-indigo-500/5"], `background-color:${mixv("--da-a2", 6)}`); R(["bg-indigo-500/10"], `background-color:${mixv("--da-a2", 12)}`);
  R(["bg-indigo-500/20", "bg-indigo-900/60", "bg-indigo-950/30", "bg-indigo-950/50"], `background-color:${mixv("--da-a2", 18)}`); H(["bg-indigo-950/20"], `background-color:${mixv("--da-a2", 14)}`);
  R(["bg-indigo-600"], "background-color:var(--da-a2)"); H(["bg-indigo-500"], "background-color:var(--da-a1)");
  out.push(`.da-root ${esc("bg-indigo-600")}${esc("text-white")}{color:var(--da-on)}`);

  // Gradients (buttons, active dots, headings)
  const gr = "linear-gradient(to right,var(--da-a1),var(--da-a2))", grb = "linear-gradient(to bottom right,var(--da-a1),var(--da-a2))";
  out.push(`.da-root ${esc("from-cyan-400")}${esc("to-indigo-500")}{background-image:${gr}}`);
  out.push(`.da-root ${esc("bg-gradient-to-br")}${esc("from-cyan-400")}${esc("to-indigo-500")}{background-image:${grb}}`);
  out.push(`.da-root ${esc("from-purple-600")}${esc("to-indigo-600")},.da-root ${esc("from-purple-600")}${esc("to-indigo-600")}:hover{background-image:${gr}}`);
  out.push(`.da-root ${esc("from-fuchsia-400")}${esc("to-cyan-400")},.da-root ${esc("from-fuchsia-500")}${esc("to-cyan-400")}{background-image:linear-gradient(to right,#e879f9,var(--da-a1))}`);
  out.push(`.da-root ${esc("from-white")}${esc("to-cyan-200")}{background-image:var(--da-silver-text)}`);
  out.push(`.da-root ${esc("from-fuchsia-500/10")}${esc("to-cyan-500/10")}{background-image:linear-gradient(to right,rgba(217,70,239,.10),${mixv("--da-a1", 10)})}`);
  out.push(`.da-root ${esc("from-cyan-500/10")}${esc("to-emerald-500/10")}{background-image:linear-gradient(to right,${mixv("--da-a1", 10)},rgba(16,185,129,.10))}`);
  // Glows follow the accent; light mode gets a plain soft shadow instead.
  // The guided tour dims the page with a 9999px spread shadow, so that one must not be flattened by this rule.
  out.push(`.da-root [class*="shadow-[0_0_"]:not([class*="9999px"]){box-shadow:0 22px 44px -28px rgba(0,0,0,.75)}`);
  out.push(`.da-root [class*="shadow-[inset_2px_0_0_"]{box-shadow:inset 3px 0 0 var(--da-a1)}`);
  out.push(`.da-root[data-mode="light"] [class*="shadow-[0_0_"]{box-shadow:0 1px 3px rgba(0,0,0,.10)}`);

  // Light-mode legibility for status colours and dark-tinted panels
  const L = (cls: string[], decl: string) => out.push(cls.map((c) => `.da-root[data-mode="light"] [class~="${c}"]`).join(",") + `{${decl}}`);
  L(["text-emerald-100", "text-emerald-200", "text-emerald-300", "text-emerald-400", "text-emerald-300/80", "text-emerald-400/80"], "color:#047857");
  L(["text-red-200", "text-red-300", "text-red-400", "text-red-400/80", "text-rose-200"], "color:#b91c1c");
  L(["text-amber-200", "text-amber-300", "text-amber-400"], "color:#b45309");
  L(["text-fuchsia-200", "text-fuchsia-300"], "color:#a21caf");
  L(["bg-emerald-950/50"], "background-color:rgba(16,185,129,.10)"); L(["bg-red-950/30", "bg-rose-950/50"], "background-color:rgba(239,68,68,.08)");
  L(["border-emerald-800/60"], "border-color:rgba(16,185,129,.35)"); L(["border-red-900/50", "border-red-900/40", "border-rose-800/60"], "border-color:rgba(239,68,68,.30)");
  out.push(`.da-root ${esc("bg-red-500/90")}${esc("text-white")}{color:#fff}`);

  // Type scale for the older components (Code Studio, Deploy, Tests...). Tiny arbitrary sizes are snapped onto the rem
  // scale so they follow the Interface size setting, and never drop below 10px.
  out.push(`.da-root ${esc("text-[9px]")}{font-size:.6875rem;line-height:1rem}.da-root ${esc("text-[10px]")}{font-size:.75rem;line-height:1.1rem}.da-root ${esc("text-[11px]")}{font-size:.8125rem;line-height:1.2rem}.da-root ${esc("text-[13px]")}{font-size:.875rem;line-height:1.35rem}`);
  // Controls use normal app sizing (about 32-36px). Anything inside a `.dv` element (sidebar, top bar, editor toolbar) sizes
  // itself, so these older rules skip it.
  out.push(`.da-root .text-xs:not(.dv *){font-size:.8125rem;line-height:1.3rem}.da-root .text-sm:not(.dv *){font-size:.9rem;line-height:1.45rem}`);
  out.push(`.da-root input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]):not(.dv *),.da-root select:not(.dv *){min-height:2.5rem;padding-inline:.9rem;border-radius:.7rem}`);
    // Buttons keep the padding and radius their own classes ask for; this only stops them being too short to click, and
  // softens the plain 4px "rounded" ones. Pills, rounded-lg and rounded-xl buttons are left alone.
  out.push(`.da-root button[class*="rounded"][class*="px-"]:not(.dv *){min-height:2.25rem}`);
  out.push(`.da-root button[class~="rounded"]:not(.dv *){border-radius:.65rem}`);
    out.push(`.da-root main{padding-inline:clamp(1rem,3vw,2.75rem);padding-block:clamp(1.25rem,2.5vw,2.25rem)}`);

  // Typography is handled in the extra layer below (Poppins everywhere, JetBrains Mono only for real code).
  out.push(`.da-root{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}`);

  // Primary gradient buttons become silver (dark mode) / graphite (light mode) pills: see the extra layer below.

  // Page header glow
  out.push(`.da-glow{background:radial-gradient(60% 100% at 25% 0%,color-mix(in srgb,var(--da-a2) 20%,transparent),transparent),radial-gradient(40% 80% at 85% 0%,color-mix(in srgb,var(--da-a1) 12%,transparent),transparent);opacity:var(--da-glow,1)}`);
  out.push(`.da-root ::selection{background:color-mix(in srgb,var(--da-a1) 35%,transparent)}`);
  out.push(`.da-root{color-scheme:dark}.da-root[data-mode="light"]{color-scheme:light}`);
  return out.join("\n");
}


/** Shades the older remap list didn't cover (zinc-50, the 400-700 border shades and a few hover / focus / group variants).
 *  Without these, light mode left white-on-white titles and dark borders on the newer pages. */
function buildGapCss(): string {
  const out: string[] = [];
  const sel = (c: string, pseudo = "") => `.da-root ${esc(c)}${pseudo},.da-root${esc(c)}${pseudo}`;
  const mix = (v: string, p: number) => `color-mix(in srgb,var(${v}) ${p}%,transparent)`;
  out.push(`${sel("text-zinc-50")},${sel("text-gray-50")},${sel("hover:text-zinc-50", ":hover")}{color:var(--da-hi)}`);
  out.push(`.da-root .group:hover ${esc("group-hover:text-zinc-100")}{color:var(--da-z100)}.da-root .group:hover ${esc("group-hover:text-zinc-200")}{color:var(--da-z200)}`);
  out.push(`${sel("bg-zinc-800/70")}{background-color:${mix("--da-z800", 70)}}${sel("hover:bg-zinc-800/70", ":hover")}{background-color:${mix("--da-z800", 70)}}`);
  for (const n of ["400", "500", "600"]) out.push(`${sel(`border-zinc-${n}`)}{border-color:var(--da-z${n})}`);
  out.push(`${sel("border-zinc-700/70")}{border-color:${mix("--da-z700", 70)}}`);
  out.push(`${sel("hover:border-zinc-600", ":hover")}{border-color:var(--da-z600)}`);
  out.push(`${sel("focus:border-zinc-500", ":focus")}{border-color:var(--da-z500)}${sel("focus-within:border-zinc-500", ":focus-within")}{border-color:var(--da-z500)}`);
  return out.join("\n");
}

/** Spreads the older, compact components out. Every rule skips elements that carry a responsive variant for the same property
 *  (e.g. `sm:p-6`), so it never fights Tailwind's breakpoints, and skips anything inside a `.dv` element. */
function buildDensityCss(): string {
  const out: string[] = [];
  const nd = ":not(.dv *)";
  const D = (sel: string, decl: string, guard: string) => out.push(`.da-root ${sel}${nd}:not([class*=":${guard}"]){${decl}}`);
  const gaps: [string, string][] = [["gap-1", ".5rem"], ["gap-1\\.5", ".65rem"], ["gap-2", ".8rem"], ["gap-2\\.5", ".95rem"], ["gap-3", "1.1rem"], ["gap-4", "1.4rem"]];
  for (const [c, v] of gaps) D(`.${c}`, `gap:${v}`, "gap");
  const spaces: [string, string][] = [["space-y-1", ".55rem"], ["space-y-1\\.5", ".7rem"], ["space-y-2", ".85rem"], ["space-y-2\\.5", "1rem"], ["space-y-3", "1.15rem"]];
  for (const [c, v] of spaces) out.push(`.da-root .${c}${nd}:not([class*=":space"])>:not([hidden])~:not([hidden]){margin-top:${v}}`);
  const pads: [string, string][] = [["p-2", ".75rem"], ["p-2\\.5", ".9rem"], ["p-3", "1.1rem"], ["p-4", "1.4rem"]];
  for (const [c, v] of pads) D(`.${c}`, `padding:${v}`, "p");
  D(".px-3:not(button)", "padding-inline:1.1rem", "p"); D(".px-4:not(button)", "padding-inline:1.4rem", "p");
  D(".py-2:not(button)", "padding-block:.75rem", "p"); D(".py-2\\.5:not(button)", "padding-block:.9rem", "p"); D(".py-3:not(button)", "padding-block:1.05rem", "p");
  D(".mb-3", "margin-bottom:1.1rem", "m"); D(".mt-3", "margin-top:1.1rem", "m");
  // Buttons: roomier padding for the tiny px-2 / py-1 pills, without touching icon-only buttons (they have no px-* class).
  D("button.px-2", "padding-inline:.9rem", "p"); D("button.px-2\\.5", "padding-inline:1rem", "p"); D("button.px-3", "padding-inline:1.1rem", "p");
  D("button.py-1", "padding-block:.45rem", "p"); D("button.py-1\\.5", "padding-block:.55rem", "p");
  out.push(`.da-root td.px-3,.da-root th.px-3{padding-inline:1.15rem}.da-root td.py-2,.da-root th.py-2{padding-block:.85rem}`);
  return out.join("\n");
}

const EXTRA_CSS = String.raw`/* =========================================================================
   DevAudit dashboard — extra styling layer (appended after the class remaps)
   ========================================================================= */

/* ---- Root: background + text colour must apply to the .da-root element itself --------------------------
   (the remap rules above are descendant selectors, so a hard-coded bg-[#09090b] on the root never flipped in light mode) */
.da-root.da-root{background-color:var(--da-bg);color:var(--da-z200)}

/* ---- Design tokens: silver / white corporate palette ------------------------------------------------- */
.da-root{
  --da-silver-text:linear-gradient(180deg,#ffffff 8%,#b4bac6 100%);
  --da-silver-line:linear-gradient(90deg,transparent,#ffffff,transparent);
  --da-card-bg:linear-gradient(160deg,rgba(255,255,255,.060),rgba(255,255,255,.016) 62%),var(--da-s1);
  --da-card-border:rgba(255,255,255,.09);
  --da-card-border-hi:rgba(255,255,255,.22);
  --da-card-edge:rgba(255,255,255,.26);
  --da-card-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 22px 44px -28px rgba(0,0,0,.75);
  --da-card-shadow-hi:0 1px 0 rgba(255,255,255,.07) inset,0 28px 54px -26px rgba(0,0,0,.85);
  --da-btn-bg:linear-gradient(180deg,#ffffff 0%,#eceef2 46%,#c3c8d1 100%);
  --da-btn-fg:#0b0c10;
  --da-btn-fg-inv:#ffffff;
  --da-btn-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 1px 2px rgba(0,0,0,.45),0 10px 26px -12px rgba(220,226,240,.40);
  --da-tip-bg:linear-gradient(180deg,#ffffff,#d5d9e1);
  --da-tip-fg:#0b0c10;
  --da-tip-border:rgba(255,255,255,.65);
  --da-sheen:rgba(255,255,255,.55);
  --da-ease:cubic-bezier(.16,1,.3,1);
}
.da-root[data-mode="light"]{
  --da-silver-text:linear-gradient(180deg,#0b0c10 0%,#4a505c 100%);
  --da-silver-line:linear-gradient(90deg,transparent,#0b0c10,transparent);
  --da-card-bg:linear-gradient(160deg,#ffffff,#f5f6f8 70%),var(--da-s1);
  --da-card-border:rgba(15,23,42,.10);
  --da-card-border-hi:rgba(15,23,42,.24);
  --da-card-edge:rgba(255,255,255,0);
  --da-card-shadow:0 1px 2px rgba(15,23,42,.05),0 20px 38px -24px rgba(15,23,42,.24);
  --da-card-shadow-hi:0 1px 2px rgba(15,23,42,.06),0 28px 48px -24px rgba(15,23,42,.32);
  --da-btn-bg:linear-gradient(180deg,#30343d 0%,#181a20 55%,#0b0c10 100%);
  --da-btn-fg:#ffffff;
  --da-btn-fg-inv:#0b0c10;
  --da-btn-shadow:inset 0 1px 0 rgba(255,255,255,.20),0 1px 2px rgba(15,23,42,.30),0 12px 26px -14px rgba(15,23,42,.55);
  --da-tip-bg:linear-gradient(180deg,#2b2f38,#14161b);
  --da-tip-fg:#ffffff;
  --da-tip-border:rgba(15,23,42,.6);
  --da-sheen:rgba(255,255,255,.28);
}

/* ---- Typography: Poppins for every word of UI text ------------------------------------------------------ */
.da-root.da-root{font-family:var(--font-poppins),"Poppins",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;line-height:1.6}
.da-root .font-display{font-family:var(--font-poppins),"Poppins",ui-sans-serif,system-ui,sans-serif;letter-spacing:-.012em}
.da-root .font-mono{font-family:var(--font-poppins),"Poppins",ui-sans-serif,system-ui,sans-serif;letter-spacing:0;font-variant-numeric:tabular-nums}
.da-root input,.da-root textarea,.da-root select,.da-root button{font-family:inherit}
/* Only real code stays monospaced: the editor, <pre> and <code> blocks. */
.da-root.da-root pre,.da-root.da-root code,.da-root.da-root samp,.da-root .da-code{font-family:var(--font-code),ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0}
.da-root h1,.da-root h2,.da-root h3{font-weight:600;letter-spacing:-.012em}
.da-root .font-medium{font-weight:500}.da-root .font-semibold{font-weight:600}

.da-silver-text{background-image:var(--da-silver-text);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}

/* ---- Cards, hero panels ---------------------------------------------------------------------------------- */
.da-card{position:relative;border:1px solid var(--da-card-border);border-radius:1.15rem;background:var(--da-card-bg);box-shadow:var(--da-card-shadow);transition:transform .35s var(--da-ease),border-color .25s,box-shadow .35s var(--da-ease)}
.da-card::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;background:linear-gradient(145deg,var(--da-card-edge),transparent 38%,transparent 70%,rgba(255,255,255,.05));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.da-card-hover{cursor:pointer}
.da-card-hover:hover{transform:translateY(-3px);border-color:var(--da-card-border-hi);box-shadow:var(--da-card-shadow-hi)}
.da-hero{position:relative;border:1px solid var(--da-card-border);border-radius:1.4rem;box-shadow:var(--da-card-shadow);
  background:radial-gradient(120% 160% at 0% 0%,rgba(255,255,255,.11),transparent 55%),radial-gradient(90% 140% at 100% 0%,color-mix(in srgb,var(--da-a2) 18%,transparent),transparent 60%),var(--da-card-bg)}
.da-root[data-mode="light"] .da-hero{background:radial-gradient(120% 160% at 0% 0%,rgba(15,23,42,.05),transparent 55%),radial-gradient(90% 140% at 100% 0%,color-mix(in srgb,var(--da-a2) 12%,transparent),transparent 60%),var(--da-card-bg)}
.da-hero-fx{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}
.da-hero-fx::after{content:"";position:absolute;inset:-40% -20%;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.07) 50%,transparent 60%);transform:translateX(-60%);animation:da-hero-sheen 9s ease-in-out infinite}
.da-root[data-mode="light"] .da-hero-fx::after{background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.65) 50%,transparent 60%)}
.da-toggle-on{background-image:var(--da-btn-bg)}

/* Legacy panels (bg-zinc-900/xx + border) pick up the same silver card surface automatically. */
.da-root .bg-zinc-900\/30,.da-root .bg-zinc-900\/40,.da-root .bg-zinc-900\/50,.da-root .bg-zinc-900\/60,.da-root .bg-zinc-900\/80,
.da-root .bg-gray-900\/30,.da-root .bg-gray-900\/40,.da-root .bg-gray-900\/50,.da-root .bg-gray-900\/60,.da-root .bg-gray-900\/80{background:var(--da-card-bg)}
.da-root[data-mode="light"] [class*="shadow-[0_0_"]:not([class*="9999px"]){box-shadow:0 1px 2px rgba(15,23,42,.06),0 14px 30px -20px rgba(15,23,42,.25)}
.da-root .rounded-lg:not(.dv *){border-radius:.9rem}
.da-root .rounded-md:not(.dv *){border-radius:.65rem}
.da-root .rounded-xl:not(.dv *){border-radius:1.1rem}

/* ---- Buttons --------------------------------------------------------------------------------------------- */
.da-root button{transition:transform .2s var(--da-ease),background-color .2s,border-color .2s,color .2s,box-shadow .3s,opacity .2s,filter .2s}
.da-root button:not(:disabled):active{transform:scale(.97)}
.da-root button:disabled{cursor:not-allowed}
.da-root button:focus-visible,.da-root a:focus-visible,.da-root [role="tab"]:focus-visible,.da-root summary:focus-visible{outline:2px solid color-mix(in srgb,var(--da-z300) 80%,transparent);outline-offset:2px}
.da-root button[class*="px-"]:not(.dv *){min-height:2.25rem}
/* Primary buttons: silver (dark mode) / graphite (light mode) pills with a sheen sweep on hover. */
.da-root.da-root button.from-cyan-400.to-indigo-500,.da-root.da-root button.from-purple-600.to-indigo-600,.da-root.da-root button.from-fuchsia-400.to-cyan-400,.da-root.da-root button.from-fuchsia-500.to-cyan-400{
  background-image:var(--da-btn-bg);background-color:transparent;color:var(--da-btn-fg);border-radius:9999px;font-weight:500;min-height:2.25rem;padding-inline:1.15rem;box-shadow:var(--da-btn-shadow);position:relative;overflow:hidden;isolation:isolate}
.da-root.da-root button.from-cyan-400.to-indigo-500::after,.da-root.da-root button.from-purple-600.to-indigo-600::after,.da-root.da-root button.from-fuchsia-400.to-cyan-400::after,.da-root.da-root button.from-fuchsia-500.to-cyan-400::after{
  content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(105deg,transparent 35%,var(--da-sheen) 50%,transparent 65%);transform:translateX(-130%);transition:transform .8s var(--da-ease)}
.da-root.da-root button.from-cyan-400.to-indigo-500:hover:not(:disabled)::after,.da-root.da-root button.from-purple-600.to-indigo-600:hover:not(:disabled)::after,.da-root.da-root button.from-fuchsia-400.to-cyan-400:hover:not(:disabled)::after,.da-root.da-root button.from-fuchsia-500.to-cyan-400:hover:not(:disabled)::after{transform:translateX(130%)}
.da-root.da-root button.from-cyan-400.to-indigo-500:hover:not(:disabled),.da-root.da-root button.from-fuchsia-400.to-cyan-400:hover:not(:disabled){opacity:1;filter:brightness(1.04);transform:translateY(-1px)}
.da-btn-ghost{display:inline-flex;align-items:center;justify-content:center;gap:.55rem;min-height:2.5rem;padding:.5rem 1.1rem;border-radius:9999px;border:1px solid var(--da-card-border);background:color-mix(in srgb,var(--da-z700) 14%,transparent);color:var(--da-z200);font-size:.8125rem;font-weight:500}
.da-btn-ghost:hover:not(:disabled){border-color:var(--da-card-border-hi);background:color-mix(in srgb,var(--da-z700) 30%,transparent);color:var(--da-hi);transform:translateY(-1px)}
.da-btn-silver{display:inline-flex;align-items:center;justify-content:center;gap:.55rem;min-height:2.5rem;padding:.5rem 1.3rem;border-radius:9999px;background-image:var(--da-btn-bg);color:var(--da-btn-fg);box-shadow:var(--da-btn-shadow);font-size:.8125rem;font-weight:500}
.da-btn-silver:hover:not(:disabled){filter:brightness(1.05);transform:translateY(-1px)}

/* ---- Forms: roomier fields, soft focus glow ---------------------------------------------------------------- */
.da-root textarea:not(.dv *){padding:.7rem .9rem;border-radius:.7rem;line-height:1.55}
.da-root input,.da-root textarea,.da-root select{transition:border-color .2s,box-shadow .25s,background-color .2s}
.da-root input:focus:not([type=checkbox]):not([type=radio]),.da-root textarea:focus,.da-root select:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--da-z300) 18%,transparent)}
.da-root select:not(.dv *){padding-right:2rem}

/* ---- Tab bar ---------------------------------------------------------------------------------------------- */
.da-tab{position:relative;display:flex;align-items:center;gap:.6rem;white-space:nowrap;border-radius:.9rem;padding:.75rem 1.15rem;font-size:.875rem;font-weight:500;color:var(--da-z400);border:1px solid transparent}
.da-tab:hover{color:var(--da-hi);background:color-mix(in srgb,var(--da-z700) 26%,transparent);transform:translateY(-1px)}
.da-tab[aria-selected="true"]{color:var(--da-hi);background:var(--da-card-bg);border-color:var(--da-card-border);box-shadow:var(--da-card-shadow)}
.da-tab[aria-selected="true"]::after{content:"";position:absolute;left:16%;right:16%;bottom:-1px;height:2px;border-radius:2px;background:var(--da-silver-line);animation:da-tab .45s var(--da-ease) backwards}
.da-tab svg{transition:transform .3s var(--da-ease)}
.da-tab:hover svg,.da-tab[aria-selected="true"] svg{transform:scale(1.12)}

/* ---- Tooltip layer ------------------------------------------------------------------------------------------- */
.da-tip{position:fixed;z-index:300;max-width:18rem;padding:.55rem .8rem;border-radius:.75rem;font-size:.75rem;line-height:1.15rem;font-weight:500;pointer-events:none;color:var(--da-tip-fg);background:var(--da-tip-bg);border:1px solid var(--da-tip-border);box-shadow:0 14px 34px -10px rgba(0,0,0,.6)}
.da-tip[data-place="top"]{transform:translate(-50%,-100%);animation:da-tip-top .18s var(--da-ease) backwards}
.da-tip[data-place="bottom"]{transform:translate(-50%,0);animation:da-tip-bottom .18s var(--da-ease) backwards}

/* ---- Scrollbars ------------------------------------------------------------------------------------------------ */
.da-root *{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--da-z500) 45%,transparent) transparent}
.da-root ::-webkit-scrollbar{width:10px;height:10px}
.da-root ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--da-z500) 42%,transparent);border-radius:9999px;border:3px solid transparent;background-clip:padding-box}
.da-root ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--da-z400) 60%,transparent);background-clip:padding-box;border:3px solid transparent}
.da-root ::-webkit-scrollbar-track{background:transparent}

/* ---- Light-mode scrims + small fixes -------------------------------------------------------------------------- */
.da-root[data-mode="light"] .bg-black\/60{background-color:rgba(15,23,42,.42)}
.da-root[data-mode="light"] .bg-black\/70{background-color:rgba(15,23,42,.50)}
.da-root[data-mode="light"] .da-card::before{opacity:.0}
.da-root[data-mode="light"] kbd{background:#fff}

/* ---- Motion ---------------------------------------------------------------------------------------------------- */
@keyframes da-fade{from{opacity:0}to{opacity:1}}
@keyframes da-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes da-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
@keyframes da-slide-r{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
@keyframes da-slide-l{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes da-tab{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes da-tip-top{from{opacity:0;transform:translate(-50%,calc(-100% + 5px)) scale(.96)}to{opacity:1;transform:translate(-50%,-100%) scale(1)}}
@keyframes da-tip-bottom{from{opacity:0;transform:translate(-50%,-5px) scale(.96)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes da-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes da-dots{0%,80%,100%{transform:scale(.55);opacity:.35}40%{transform:scale(1);opacity:1}}
@keyframes da-hero-sheen{0%,55%{transform:translateX(-60%)}100%{transform:translateX(60%)}}
@keyframes da-aurora{0%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-14px,0)}100%{transform:translate3d(0,-4px,0)}}
@keyframes da-ring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--da-z300) 45%,transparent)}100%{box-shadow:0 0 0 14px transparent}}
@keyframes da-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes da-check{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}

.da-page{animation:da-up .55s var(--da-ease) backwards}
.da-fade{animation:da-fade .4s ease backwards}
.da-up{animation:da-up .55s var(--da-ease) backwards}
.da-pop{animation:da-pop .35s var(--da-ease) backwards}
.da-slide-r{animation:da-slide-r .45s var(--da-ease) backwards}
.da-slide-l{animation:da-slide-l .45s var(--da-ease) backwards}
.da-float{animation:da-float 5s ease-in-out infinite}
.da-ring{animation:da-ring 1.8s ease-out infinite}
.da-shimmer{background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.10) 50%,transparent 70%),color-mix(in srgb,var(--da-z700) 25%,transparent);background-size:200% 100%;animation:da-shimmer 1.6s linear infinite}
.da-stagger>*{animation:da-up .6s var(--da-ease) backwards}
.da-stagger>*:nth-child(1){animation-delay:.02s}.da-stagger>*:nth-child(2){animation-delay:.08s}.da-stagger>*:nth-child(3){animation-delay:.14s}
.da-stagger>*:nth-child(4){animation-delay:.20s}.da-stagger>*:nth-child(5){animation-delay:.26s}.da-stagger>*:nth-child(6){animation-delay:.32s}
.da-stagger>*:nth-child(7){animation-delay:.38s}.da-stagger>*:nth-child(8){animation-delay:.44s}.da-stagger>*:nth-child(n+9){animation-delay:.5s}
.da-stagger-r>*{animation:da-slide-r .5s var(--da-ease) backwards}
.da-stagger-r>*:nth-child(1){animation-delay:.02s}.da-stagger-r>*:nth-child(2){animation-delay:.06s}.da-stagger-r>*:nth-child(3){animation-delay:.10s}
.da-stagger-r>*:nth-child(4){animation-delay:.14s}.da-stagger-r>*:nth-child(5){animation-delay:.18s}.da-stagger-r>*:nth-child(6){animation-delay:.22s}
.da-stagger-r>*:nth-child(7){animation-delay:.26s}.da-stagger-r>*:nth-child(n+8){animation-delay:.3s}
.da-lift{transition:transform .3s var(--da-ease),box-shadow .3s var(--da-ease),border-color .25s}
.da-lift:hover{transform:translateY(-2px)}
.da-dot{display:inline-block;width:.4rem;height:.4rem;border-radius:9999px;background:currentColor;animation:da-dots 1.2s ease-in-out infinite}
.da-dot:nth-child(2){animation-delay:.15s}.da-dot:nth-child(3){animation-delay:.3s}

/* Everything that opens or appears animates in without touching the component that renders it. */
.da-root [role="dialog"],.da-root [role="alertdialog"]{animation:da-pop .32s var(--da-ease) backwards}
.da-root [role="presentation"]{animation:da-fade .22s ease backwards}
.da-root .fixed.inset-0{animation:da-fade .22s ease backwards}
.da-root .fixed.inset-0>div{animation:da-pop .32s var(--da-ease) backwards}
.da-root [role="menu"]{animation:da-pop .22s var(--da-ease) backwards;transform-origin:top right}
.da-root [role="alert"]{animation:da-up .4s var(--da-ease) backwards}
.da-root tbody tr{animation:da-fade .45s ease backwards}
.da-root tbody tr:nth-child(2){animation-delay:.04s}.da-root tbody tr:nth-child(3){animation-delay:.08s}.da-root tbody tr:nth-child(4){animation-delay:.12s}
.da-root tbody tr:nth-child(5){animation-delay:.16s}.da-root tbody tr:nth-child(6){animation-delay:.2s}.da-root tbody tr:nth-child(n+7){animation-delay:.24s}
.da-root details[open]>*:not(summary){animation:da-fade .3s ease backwards}
.da-root summary{transition:color .2s}
.da-root li{transition:background-color .2s}
.da-glow{animation:da-aurora 22s ease-in-out infinite alternate}

@media (prefers-reduced-motion:reduce){
  .da-root *:not(.animate-spin),.da-root *:not(.animate-spin)::before,.da-root *:not(.animate-spin)::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`;

const CSS = buildCss() + "\n" + buildGapCss() + "\n" + buildDensityCss() + "\n" + EXTRA_CSS;
export function ThemeStyles() { return <style dangerouslySetInnerHTML={{ __html: CSS }} />; }

// The logo lives in components/Logo.tsx so the homepage and dashboard share one drawing.
export { LogoMark as DaLogo } from "@/components/Logo";

// WhatsApp-style empty profile picture.
export function DefaultAvatar({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`} style={{ width: size, height: size, background: "var(--da-z700)" }}>
      <svg viewBox="0 0 24 24" width={size * 0.78} height={size * 0.78} style={{ marginTop: size * 0.16, color: "var(--da-z400)" }} fill="currentColor" aria-hidden>
        <circle cx="12" cy="8.2" r="4.1" /><path d="M3.5 22c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8z" />
      </svg>
    </span>
  );
}

/** The person's GitHub picture when we have one, the empty-profile silhouette otherwise (or if the image fails to load). */
export function Avatar({ src, name, size = 44, className = "" }: { src?: string | null; name?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <DefaultAvatar size={size} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name ? `${name}'s profile picture` : "Profile picture"} width={size} height={size} referrerPolicy="no-referrer"
      onError={() => setFailed(true)} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />
  );
}

// ---------------------------------------------------------------------------------------------
// Light / dark pill. Same shape and motion as the homepage's ThemeToggle.
// ---------------------------------------------------------------------------------------------
export function ModeSwitch({ theme }: { theme?: DaTheme }) {
  const ctx = useContext(DaFullThemeContext);
  const t = theme ?? ctx;
  if (!t) return null;
  const dark = t.resolved === "dark";
  return (
    <button type="button" onClick={() => t.update({ mode: dark ? "light" : "dark" })} aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="dv relative flex h-8 w-[3.25rem] shrink-0 items-center rounded-full border border-da-line bg-da-s1 p-0.5 transition-colors">
      <Sun size={12} className="pointer-events-none absolute left-[0.5rem] text-da-faint" strokeWidth={2.25} />
      <Moon size={12} className="pointer-events-none absolute right-[0.5rem] text-da-faint" strokeWidth={2.25} />
      <span className="relative z-10 grid h-6 w-6 place-items-center rounded-full bg-da-hi text-da-bg transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)]"
        style={{ transform: dark ? "translateX(1.25rem)" : "none" }}>
        {dark ? <Moon size={12} strokeWidth={2.25} /> : <Sun size={12} strokeWidth={2.25} />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Appearance controls. `compact` is the version shown in the top-bar popover; the full version
// lives in Settings.
// ---------------------------------------------------------------------------------------------
function Swatch({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={label}
      className={`relative flex flex-col items-center gap-2 rounded-xl border p-2.5 text-[0.75rem] transition-colors ${active ? "border-da-a1 bg-da-s2 text-da-ink" : "border-da-line text-da-soft hover:bg-da-s2"}`}>
      {children}
      <span className="max-w-full truncate">{label}</span>
      {active && <Check size={12} className="absolute right-1.5 top-1.5 text-da-accent" />}
    </button>
  );
}

export function AppearancePanel({ theme, compact = false }: { theme?: DaTheme; compact?: boolean }) {
  const ctx = useContext(DaFullThemeContext);
  const t = theme ?? ctx;
  if (!t) return null;
  const { settings: s, update, reset, resolved } = t;
  const mode = resolved === "dark" ? "dark" : "light";
  const label = `${compact ? "mb-2 mt-4" : "mb-2.5 mt-7"} text-[0.8125rem] font-medium text-da-ink`;
  const modes: { k: Mode; label: string; icon: typeof Sun }[] = [{ k: "dark", label: "Dark", icon: Moon }, { k: "light", label: "Light", icon: Sun }, { k: "auto", label: "System", icon: Monitor }];
  const colorInput = "h-9 w-14 cursor-pointer rounded-lg border border-da-line-2 bg-transparent p-1";

  return (
    <section className={`dv ${compact ? "" : "mt-8 max-w-2xl"}`} aria-labelledby={compact ? undefined : "appearance-title"}>
      {!compact && (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 id="appearance-title" className="flex items-center gap-2 font-display text-[1.0625rem] font-semibold tracking-[-0.015em] text-da-ink"><Palette size={17} className="text-da-accent" />Appearance</h2>
            <button type="button" onClick={reset} className="flex h-8 items-center gap-1.5 rounded-lg border border-da-line px-3 text-[0.8125rem] text-da-soft transition-colors hover:bg-da-s2"><RotateCcw size={13} />Reset</button>
          </div>
          <p className="mt-1 text-[0.8125rem] text-da-faint">Changes apply instantly, across the site, and are saved on this device.</p>
        </>
      )}

      <p className={`${label} ${compact ? "!mt-0" : ""}`}>Mode</p>
      <div className="grid grid-cols-3 gap-2.5">
        {modes.map(({ k, label: l, icon: Icon }) => (
          <Swatch key={k} active={s.mode === k} onClick={() => update({ mode: k })} label={l}><Icon size={compact ? 16 : 18} /></Swatch>
        ))}
      </div>

      <p className={label}>Background</p>
      <div className={`grid gap-2.5 ${compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}>
        {Object.entries(BASES).map(([k, b]) => (
          <Swatch key={k} active={s.base === k} onClick={() => update({ base: k })} label={b.label}>
            <span className="h-8 w-full rounded-lg border border-da-line-2" style={{ background: b[mode][0], boxShadow: `inset 0 -12px 0 ${b[mode][1]}` }} />
          </Swatch>
        ))}
        <Swatch active={s.base === "custom"} onClick={() => update({ base: "custom" })} label="Custom">
          <span className="h-8 w-full rounded-lg border border-da-line-2" style={{ background: s.customBg }} />
        </Swatch>
      </div>
      {s.base === "custom" && (
        <label className="mt-3 flex items-center gap-3 text-[0.8125rem] text-da-soft">
          Colour
          <input type="color" value={s.customBg} onChange={(e) => update({ customBg: e.target.value })} className={colorInput} />
          <span className="font-mono text-da-faint">{s.customBg}</span>
        </label>
      )}

      <p className={label}>Accent</p>
      <div className={`grid gap-2.5 ${compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}>
        {Object.entries(ACCENTS).map(([k, a]) => (
          <Swatch key={k} active={s.accent === k} onClick={() => update({ accent: k })} label={a.label}>
            <span className="h-8 w-full rounded-lg" style={{ background: `linear-gradient(to right,${a.a1},${a.a2})` }} />
          </Swatch>
        ))}
        <Swatch active={s.accent === "custom"} onClick={() => update({ accent: "custom" })} label="Custom">
          <span className="h-8 w-full rounded-lg" style={{ background: `linear-gradient(to right,${s.customA1},${s.customA2})` }} />
        </Swatch>
      </div>
      {s.accent === "custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-5 text-[0.8125rem] text-da-soft">
          <label className="flex items-center gap-2.5">From<input type="color" value={s.customA1} onChange={(e) => update({ customA1: e.target.value })} className={colorInput} /></label>
          <label className="flex items-center gap-2.5">To<input type="color" value={s.customA2} onChange={(e) => update({ customA2: e.target.value })} className={colorInput} /></label>
        </div>
      )}

      {!compact && (
        <>
          <p className={label}>Interface size</p>
          <div className="grid grid-cols-3 gap-2.5">
            {(Object.entries(SIZES) as [SizeKey, { label: string }][]).map(([k, z]) => (
              <button key={k} type="button" onClick={() => update({ size: k })} aria-pressed={s.size === k}
                className={`h-10 rounded-xl border text-[0.8125rem] transition-colors ${s.size === k ? "border-da-a1 bg-da-s2 text-da-ink" : "border-da-line text-da-soft hover:bg-da-s2"}`}>{z.label}</button>
            ))}
          </div>

          <label className="mt-5 flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-da-line px-4 text-[0.8125rem] text-da-soft">
            Soft accent glow behind page headers
            <input type="checkbox" checked={s.glow} onChange={(e) => update({ glow: e.target.checked })} className="h-4 w-4" style={{ accentColor: "var(--da-a1)" }} />
          </label>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Root wrapper. Wrap the whole dashboard in this once: it owns the theme state, injects the scoped
// stylesheet, applies Inter + the code font, and exposes the theme to everything inside (CodeStudio's editor,
// AppearancePanel, ModeSwitch, DashboardShell).
// ---------------------------------------------------------------------------------------------
export function DashboardThemeRoot({ children, className = "" }: { children: ReactNode; className?: string }) {
  const theme = useDaThemeState();
  return (
    <DaFullThemeContext.Provider value={theme}>
      <DaThemeContext.Provider value={{ resolved: theme.resolved, editorBg: theme.editorBg }}>
        <ThemeStyles />
        <div className={`da-root ${mono.variable} ${poppins.variable} min-h-dvh ${className}`} data-mode={theme.resolved}
          style={{ ...theme.vars, background: "var(--da-bg)", color: "var(--da-z200)" }}>
          {children}
        </div>
      </DaThemeContext.Provider>
    </DaFullThemeContext.Provider>
  );
}
