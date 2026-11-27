"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, Sun, Moon, Monitor, Check, RotateCcw } from "lucide-react";
import {
  ACCENTS, BASES, DEFAULT_SETTINGS, applySiteTheme, clearStored, readStored, resolveDark, writeStored,
  type DaSettings, type Mode,
} from "@/utils/siteTheme";

/**
 * The homepage's colour settings: the same choices as the dashboard's Settings > Appearance, saved to
 * the same place, so changing them here changes the dashboard too (and the other way round).
 * Sits next to ThemeToggle in the Navbar.
 */
export default function SiteCustomizer() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<DaSettings>(DEFAULT_SETTINGS);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setS(readStored()); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function update(patch: Partial<DaSettings>) {
    const next = { ...readStored(), ...patch };
    writeStored(next);
    setS(next);
    applySiteTheme(next, resolveDark(next.mode));
  }
  function reset() {
    clearStored();
    setS(DEFAULT_SETTINGS);
    applySiteTheme(DEFAULT_SETTINGS, resolveDark(DEFAULT_SETTINGS.mode));
  }

  const dark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
  const tone = dark ? "dark" : "light";
  const modes: { k: Mode; label: string; icon: typeof Sun }[] = [{ k: "light", label: "Light", icon: Sun }, { k: "dark", label: "Dark", icon: Moon }, { k: "auto", label: "System", icon: Monitor }];
  const heading = "mb-2.5 mt-6 text-sm font-medium text-ink";
  const tile = (on: boolean) => `relative flex flex-col items-center gap-2 rounded-xl border p-2.5 text-xs transition-colors ${on ? "border-accent bg-border-soft text-ink" : "border-border text-ink-soft hover:bg-border-soft"}`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Customise colours"
        className="grid h-11 w-11 place-items-center rounded-full border border-border text-ink transition-colors duration-200 hover:bg-border-soft">
        <Palette size={18} />
      </button>

      {open && (
        <div role="dialog" aria-label="Customise colours"
          className="absolute right-0 top-[calc(100%+0.75rem)] z-50 max-h-[calc(100dvh-6rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-border bg-bg-elevated p-5 shadow-xl shadow-ink/10">
          <p className="text-base font-semibold text-ink">Colours</p>
          <p className="mt-1 text-sm text-ink-faint">Applies across the site and your dashboard.</p>

          <p className={heading}>Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {modes.map(({ k, label, icon: Icon }) => (
              <button key={k} type="button" aria-pressed={s.mode === k} onClick={() => update({ mode: k })} className={tile(s.mode === k)}>
                <Icon size={18} />{label}
                {s.mode === k && <Check size={12} className="absolute right-1.5 top-1.5 text-accent" />}
              </button>
            ))}
          </div>

          <p className={heading}>Background</p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(BASES).map(([k, b]) => (
              <button key={k} type="button" aria-pressed={s.base === k} onClick={() => update({ base: k })} className={tile(s.base === k)}>
                <span className="h-8 w-full rounded-lg border border-border" style={{ background: b[tone][0], boxShadow: `inset 0 -12px 0 ${b[tone][1]}` }} />
                {b.label}
              </button>
            ))}
            <button type="button" aria-pressed={s.base === "custom"} onClick={() => update({ base: "custom" })} className={tile(s.base === "custom")}>
              <span className="h-8 w-full rounded-lg border border-border" style={{ background: s.customBg }} />
              Custom
            </button>
          </div>
          {s.base === "custom" && (
            <label className="mt-3 flex items-center gap-3 text-sm text-ink-soft">
              Colour
              <input type="color" value={s.customBg} onChange={(e) => update({ customBg: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-transparent p-1" />
            </label>
          )}

          <p className={heading}>Accent</p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ACCENTS).map(([k, a]) => (
              <button key={k} type="button" aria-pressed={s.accent === k} onClick={() => update({ accent: k })} className={tile(s.accent === k)}>
                <span className="h-8 w-full rounded-lg" style={{ background: `linear-gradient(to right,${a.a1},${a.a2})` }} />
                <span className="max-w-full truncate">{a.label}</span>
              </button>
            ))}
          </div>

          <button type="button" onClick={reset}
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border text-sm text-ink transition-colors hover:bg-border-soft">
            <RotateCcw size={14} />Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
