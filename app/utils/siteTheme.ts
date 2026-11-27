// ---------------------------------------------------------------------------------------------
// Shared theme model for the whole site (homepage + dashboard).
//
// No "use client" on purpose: layout.tsx (a server component) imports THEME_INIT from here, and
// the dashboard imports the same palettes, so both always agree. Nothing below touches `window`
// at import time.
// ---------------------------------------------------------------------------------------------

export type Mode = "dark" | "light" | "auto";
export type SizeKey = "normal" | "large" | "xl";

export type DaSettings = {
  mode: Mode;
  base: string;      // key of BASES, or "custom"
  accent: string;    // key of ACCENTS, or "custom"
  customBg: string;  // hex, used when base === "custom"
  customA1: string;  // hex, used when accent === "custom"
  customA2: string;
  size: SizeKey;
  glow: boolean;
};

export const STORE_KEY = "devaudit:theme:v1";

/** First-time visitors get white or dark to match their device. Change to "light" or "dark" to force one. */
export const DEFAULT_MODE: Mode = "auto";

export const DEFAULT_SETTINGS: DaSettings = {
  mode: DEFAULT_MODE, base: "default", accent: "classic",
  customBg: "#0f172a", customA1: "#22d3ee", customA2: "#6366f1",
  size: "normal", glow: false,
};

/** [page background, surface, raised surface, inset surface] */
type Four = [string, string, string, string];
export type BaseDef = { label: string; dark: Four; light: Four };

export const BASES: Record<string, BaseDef> = {
  // Exactly the homepage tokens in globals.css, so the dashboard and landing page match out of the box.
  default: { label: "Default", dark: ["#0b0d12", "#12151c", "#181c25", "#0e1016"], light: ["#f6f7f9", "#ffffff", "#eff1f5", "#eef0f4"] },
  // The dashboard's previous look.
  classic: { label: "Classic", dark: ["#09090b", "#121215", "#18181b", "#0d0d0f"], light: ["#fafafa", "#ffffff", "#f4f4f5", "#f4f4f5"] },
  pitch:   { label: "Pitch",   dark: ["#000000", "#0a0a0a", "#141414", "#050505"], light: ["#ffffff", "#ffffff", "#f5f5f5", "#fafafa"] },
  slate:   { label: "Slate",   dark: ["#0b1120", "#111a2e", "#18233b", "#0d1527"], light: ["#f1f5f9", "#ffffff", "#e8eef5", "#f8fafc"] },
  forest:  { label: "Forest",  dark: ["#07110d", "#0d1a14", "#132419", "#09140f"], light: ["#f0f7f2", "#ffffff", "#e4efe8", "#f6faf7"] },
  wine:    { label: "Wine",    dark: ["#12080c", "#1c0e14", "#28131c", "#150a10"], light: ["#fbf1f4", "#ffffff", "#f5e3e9", "#fdf6f8"] },
};

export type AccentDef = { label: string; a1: string; a2: string };
export const ACCENTS: Record<string, AccentDef> = {
  classic: { label: "Cyan to indigo", a1: "#22d3ee", a2: "#6366f1" },
  violet:  { label: "Violet",  a1: "#a78bfa", a2: "#7c3aed" },
  emerald: { label: "Emerald", a1: "#34d399", a2: "#0d9488" },
  sunset:  { label: "Sunset",  a1: "#fb923c", a2: "#e11d48" },
  rose:    { label: "Rose",    a1: "#f472b6", a2: "#db2777" },
  mono:    { label: "Mono",    a1: "#e4e4e7", a2: "#71717a" },
};

export const SIZES: Record<SizeKey, { label: string; pct: number }> = {
  normal: { label: "Normal", pct: 100 },
  large: { label: "Large", pct: 105 },
  xl: { label: "Extra large", pct: 112 },
};

// ---------------------------------------------------------------------------------------------
// Storage + resolution
// ---------------------------------------------------------------------------------------------
export function readStored(): DaSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return { ...DEFAULT_SETTINGS, ...parsed };
    // Before the shared store existed, the homepage toggle wrote a plain "dark" / "light".
    const legacy = localStorage.getItem("theme");
    if (legacy === "dark" || legacy === "light") return { ...DEFAULT_SETTINGS, mode: legacy };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function writeStored(s: DaSettings) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

export function clearStored() {
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem("theme"); } catch {}
}

export function systemPrefersDark(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}

export function resolveDark(mode: Mode): boolean {
  return mode === "dark" || (mode === "auto" && systemPrefersDark());
}

/** Page background + surface for a settings object (custom backgrounds are derived with color-mix). */
export function baseColors(s: DaSettings, dark: boolean): Four {
  if (s.base === "custom") {
    const bg = s.customBg, toward = dark ? "#ffffff" : "#000000";
    return [
      bg,
      `color-mix(in srgb, ${bg} ${dark ? 94 : 97}%, #ffffff)`,
      `color-mix(in srgb, ${bg} 90%, ${toward})`,
      `color-mix(in srgb, ${bg} 96%, #000000)`,
    ];
  }
  return (BASES[s.base] ?? BASES.default)[dark ? "dark" : "light"];
}

export function accentColors(s: DaSettings): { a1: string; a2: string } {
  return s.accent === "custom" ? { a1: s.customA1, a2: s.customA2 } : ACCENTS[s.accent] ?? ACCENTS.classic;
}

/**
 * Writes the chosen mode and colours onto <html> so the landing page follows the same setting as
 * the dashboard. "default" background / "classic" accent remove the overrides, so the tokens in
 * globals.css apply untouched.
 */
export function applySiteTheme(s: DaSettings, dark: boolean) {
  const el = document.documentElement;
  if (dark) el.setAttribute("data-theme", "dark"); else el.removeAttribute("data-theme");
  const set = (k: string, v: string | null) => (v === null ? el.style.removeProperty(k) : el.style.setProperty(k, v));

  if (s.base === "default") { set("--bg", null); set("--bg-elevated", null); }
  else { const [bg, s1] = baseColors(s, dark); set("--bg", bg); set("--bg-elevated", s1); }

  if (s.accent === "classic") { set("--accent", null); set("--accent-cyan", null); }
  else {
    const { a1, a2 } = accentColors(s);
    set("--accent", a2);
    set("--accent-cyan", dark ? a1 : `color-mix(in srgb, ${a1} 70%, #000000)`);
  }
}

/** Used by the homepage ThemeToggle: change just the mode, keep every other saved choice. */
export function setSiteMode(mode: "dark" | "light") {
  const next = { ...readStored(), mode };
  writeStored(next);
  applySiteTheme(next, mode === "dark");
}

// ---------------------------------------------------------------------------------------------
// Pre-paint script for <head> (see layout.tsx). Same logic as applySiteTheme, in plain ES5 so it
// can run inline before React hydrates, which is what prevents a flash of the wrong theme.
// ---------------------------------------------------------------------------------------------
const tables = {
  B: Object.fromEntries(Object.entries(BASES).map(([k, v]) => [k, { d: v.dark.slice(0, 2), l: v.light.slice(0, 2) }])),
  A: Object.fromEntries(Object.entries(ACCENTS).map(([k, v]) => [k, [v.a1, v.a2]])),
};

export const THEME_INIT = `(function(){try{
var K=${JSON.stringify(STORE_KEY)},B=${JSON.stringify(tables.B)},A=${JSON.stringify(tables.A)};
var d=document.documentElement,s={};
try{s=JSON.parse(localStorage.getItem(K)||"null")||{}}catch(e){}
var m=s.mode||localStorage.getItem("theme")||${JSON.stringify(DEFAULT_MODE)};
var dk=m==="dark"||(m==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(dk)d.setAttribute("data-theme","dark");else d.removeAttribute("data-theme");
var st=d.style,b=s.base||"default",a=s.accent||"classic";
if(b!=="default"){
  var bg,s1;
  if(b==="custom"&&s.customBg){bg=s.customBg;s1="color-mix(in srgb, "+bg+" "+(dk?94:97)+"%, #ffffff)"}
  else if(B[b]){var c=B[b][dk?"d":"l"];bg=c[0];s1=c[1]}
  if(bg){st.setProperty("--bg",bg);st.setProperty("--bg-elevated",s1)}
}
if(a!=="classic"){
  var p=a==="custom"?[s.customA1,s.customA2]:A[a];
  if(p&&p[0]&&p[1]){st.setProperty("--accent",p[1]);st.setProperty("--accent-cyan",dk?p[0]:"color-mix(in srgb, "+p[0]+" 70%, #000000)")}
}
}catch(e){}})();`;
