"use client";

// ---------------------------------------------------------------------------------------------
// Shared building blocks for the dashboard's pages: the page hero every tab opens with, section
// cards, stat tiles, switches, info popovers and the global tooltip layer. Everything here uses
// the same zinc / da-* classes as the rest of the app, so it follows light, dark and the accent
// settings automatically (see dashboardTheme.tsx).
// ---------------------------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, ArrowUpRight, Check, Loader2, ChevronDown, type LucideIcon } from "lucide-react";

export type Tone = "emerald" | "red" | "amber" | "zinc";

export const TONES: Record<Tone, { chip: string; text: string; ring: string }> = {
  emerald: { chip: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400", text: "text-emerald-400", ring: "hover:border-emerald-500/40" },
  red: { chip: "border-red-500/25 bg-red-500/10 text-red-400", text: "text-red-400", ring: "hover:border-red-500/40" },
  amber: { chip: "border-amber-500/25 bg-amber-500/10 text-amber-400", text: "text-amber-400", ring: "hover:border-amber-500/40" },
  zinc: { chip: "border-zinc-700 bg-zinc-800/50 text-zinc-300", text: "text-zinc-400", ring: "hover:border-zinc-600" },
};

// ---------------------------------------------------------------------------------------------
// Tooltips for every button
// ---------------------------------------------------------------------------------------------
type Tip = { text: string; x: number; y: number; place: "top" | "bottom" };

/**
 * One listener for the whole dashboard. Hover (or keyboard-focus) any element that has `data-tip`, a `title`, or is an
 * icon-only button with an `aria-label`, and a styled tooltip explains it. Native `title` attributes are moved to
 * `data-title` on first hover so the browser's own grey tooltip doesn't appear on top. Mount it once, inside `.da-root`.
 * Wrap anything that should not get tips in an element with the `da-tip-off` class.
 */
export function TipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      current = null;
      setTip(null);
    };

    const textFor = (el: HTMLElement): string | null => {
      const explicit = el.getAttribute("data-tip");
      if (explicit) return explicit;
      const saved = el.getAttribute("data-title");
      if (saved) return saved;
      const native = el.getAttribute("title");
      if (native) {
        el.setAttribute("data-title", native);
        el.removeAttribute("title");
        return native;
      }
      const aria = el.getAttribute("aria-label");
      if (aria && !(el.textContent ?? "").trim()) return aria;
      return null;
    };

    const findTarget = (t: EventTarget | null): HTMLElement | null => {
      if (!(t instanceof Element) || t.closest(".da-tip-off, .da-tip")) return null;
      let el: Element | null = t;
      while (el && el !== document.body) {
        if (el instanceof HTMLElement) {
          const iconOnlyControl = (el.tagName === "BUTTON" || el.tagName === "A") && el.hasAttribute("aria-label") && !(el.textContent ?? "").trim();
          if (el.hasAttribute("data-tip") || el.hasAttribute("data-title") || (el.hasAttribute("title") && el.tagName !== "IFRAME") || iconOnlyControl) return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    const show = (el: HTMLElement) => {
      const text = textFor(el);
      if (!text || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      const half = 152; // half of the tooltip's max width, plus a little margin
      const x = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half);
      const place: Tip["place"] = r.top > 76 ? "top" : "bottom";
      setTip({ text, x, y: place === "top" ? r.top - 10 : r.bottom + 10, place });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      const el = findTarget(e.target);
      if (!el) { if (current) hide(); return; }
      if (el === current) return;
      hide();
      current = el;
      timer = setTimeout(() => { if (current) show(current); }, 380);
    };
    const onOut = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      const el = findTarget(target);
      if (el && target?.matches?.(":focus-visible")) { hide(); current = el; show(el); }
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div role="tooltip" className="da-tip" data-place={tip.place} style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// "What is this?" popover
// ---------------------------------------------------------------------------------------------
export function InfoTip({ title, children, align = "left" }: { title: string; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`About: ${title}`} data-tip={`What is ${title}?`}
        className={`grid h-8 w-8 place-items-center rounded-full border transition-colors ${open ? "border-zinc-500 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200"}`}
      >
        <Info size={15} />
      </button>
      {open && (
        <div role="dialog" aria-label={title} className={`absolute top-[calc(100%+0.7rem)] z-40 w-[min(20rem,82vw)] ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="da-card p-5 text-left">
            <p className="text-sm font-semibold text-zinc-100">{title}</p>
            <div className="mt-2 text-[0.8125rem] leading-6 text-zinc-400">{children}</div>
          </div>
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Page hero + wrapper: the top of every dashboard page
// ---------------------------------------------------------------------------------------------
export type HeroProps = {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: ReactNode;
  /** Short "what you can do here" cards under the description. */
  tips?: { icon: LucideIcon; title: string; text: string }[];
  actions?: ReactNode;
  info?: { title: string; body: ReactNode };
  /** A slimmer header for pages whose main job is a big working area (the code editor). */
  compact?: boolean;
};

/** The big header every dashboard page opens with. */
export function PageHero({ icon: Icon, eyebrow, title, description, tips, actions, info, compact }: HeroProps) {
  if (compact) {
    return (
      <div className="da-page">
        <div className="da-hero px-6 py-5 sm:px-7">
          <div className="da-hero-fx" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-zinc-700/70 bg-zinc-800/40 text-zinc-100"><Icon size={20} /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="da-silver-text text-[1.25rem] font-semibold leading-tight">{title}</h2>
                  {info && <InfoTip title={info.title}>{info.body}</InfoTip>}
                </div>
                <p className="mt-1 max-w-3xl text-[0.8125rem] leading-6 text-zinc-500">{description}</p>
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
          </div>
        </div>
      </div>
    );
  }
  return <FullHero icon={Icon} eyebrow={eyebrow} title={title} description={description} tips={tips} actions={actions} info={info} />;
}

/** The tips under a hero start open, and remember (per page, on this device) if you hid them. */
function FullHero({ icon: Icon, eyebrow, title, description, tips, actions, info }: HeroProps) {
  const key = `devaudit:hero-tips:${title}`;
  const [showTips, setShowTips] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(key) === "0") setShowTips(false); } catch { /* ignore */ } }, [key]);
  const toggleTips = () => setShowTips((v) => { const next = !v; try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* ignore */ } return next; });

  return (
    <div className="da-page">
      <div className="da-hero p-6 sm:p-8">
        <div className="da-hero-fx" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 max-w-3xl items-start gap-5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-zinc-700/70 bg-zinc-800/40 text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,.02)]">
              <Icon size={24} />
            </span>
            <div className="min-w-0">
              {eyebrow && <p className="mb-1 text-[0.75rem] font-medium uppercase tracking-[.16em] text-zinc-500">{eyebrow}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="da-silver-text text-[1.625rem] font-semibold leading-tight sm:text-[2rem]">{title}</h2>
                {info && <InfoTip title={info.title}>{info.body}</InfoTip>}
              </div>
              <p className="mt-3 text-[0.9375rem] leading-7 text-zinc-400">{description}</p>
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </div>
        {tips && tips.length > 0 && (
          <button type="button" onClick={toggleTips} aria-expanded={showTips} data-tip={showTips ? "Hide these tips. They'll stay hidden on this page." : "Show what you can do on this page"}
            className="relative mt-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-4 py-2 text-[0.8125rem] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100">
            <ChevronDown size={15} className={`transition-transform duration-300 ${showTips ? "rotate-180" : ""}`} />{showTips ? "Hide tips" : "Show tips"}
          </button>
        )}
        {tips && tips.length > 0 && showTips && (
          <ul className="da-stagger relative mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tips.map((t) => (
              <li key={t.title} className="flex items-start gap-3.5 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-800/60 text-zinc-200"><t.icon size={17} /></span>
                <span className="min-w-0">
                  <span className="block text-[0.875rem] font-medium text-zinc-100">{t.title}</span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-6 text-zinc-500">{t.text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A full page: the hero, then its content sections spaced well apart. */
export function TabPage({ children, ...hero }: HeroProps & { children: ReactNode }) {
  return (
    <section aria-label={hero.title}>
      <PageHero {...hero} />
      <div className="mt-8 space-y-8">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Section card: a titled "sector" inside a page
// ---------------------------------------------------------------------------------------------
export function SectionCard({
  icon: Icon, title, description, action, info, children, className = "", bodyClassName = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  info?: { title: string; body: ReactNode };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`da-card ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800/80 px-6 py-5 sm:px-7">
        <div className="flex min-w-0 items-start gap-4">
          {Icon && <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><Icon size={18} /></span>}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[1.0625rem] font-semibold text-zinc-100">{title}</h3>
              {info && <InfoTip title={info.title}>{info.body}</InfoTip>}
            </div>
            {description && <p className="mt-1 text-[0.8125rem] leading-6 text-zinc-500">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div>}
      </div>
      <div className={`p-6 sm:p-7 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Stat tile (clickable when given onClick)
// ---------------------------------------------------------------------------------------------
export function StatTile({
  icon: Icon, label, value, detail, tone = "zinc", onClick, tip,
}: {
  icon: LucideIcon; label: string; value: string; detail?: string; tone?: Tone; onClick?: () => void; tip?: string;
}) {
  const t = TONES[tone];
  const body = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl border ${t.chip}`}><Icon size={18} /></span>
        {onClick && <ArrowUpRight size={16} className="text-zinc-600 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-200" />}
      </span>
      <span className="mt-5 block text-[0.75rem] font-medium uppercase tracking-[.12em] text-zinc-500">{label}</span>
      <span className={`mt-1 block truncate text-[1.125rem] font-semibold ${tone === "zinc" ? "text-zinc-100" : t.text}`}>{value}</span>
      {detail && <span className="mt-1 block text-[0.8125rem] leading-5 text-zinc-500">{detail}</span>}
    </>
  );
  if (!onClick) return <div className="da-card p-5 sm:p-6">{body}</div>;
  return (
    <button type="button" onClick={onClick} data-tip={tip} className={`da-card da-card-hover group block w-full p-5 text-left sm:p-6 ${t.ring}`}>
      {body}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Smaller pieces
// ---------------------------------------------------------------------------------------------
export function Pill({ tone = "zinc", icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium ${TONES[tone].chip}`}>
      {Icon && <Icon size={14} />}{children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="da-up flex flex-col items-center rounded-3xl border border-dashed border-zinc-700/80 px-8 py-14 text-center">
      <span className="da-float grid h-16 w-16 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900/60 text-zinc-300"><Icon size={26} /></span>
      <p className="mt-6 text-[1.0625rem] font-semibold text-zinc-100">{title}</p>
      <p className="mt-2 max-w-md text-[0.875rem] leading-7 text-zinc-500">{body}</p>
      {action && <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}

/** An on/off switch with a real role="switch" so screen readers announce it properly. */
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors duration-300 disabled:opacity-50 ${checked ? "da-toggle-on border-transparent" : "border-zinc-700 bg-zinc-800"}`}
    >
      <span
        className={`absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full shadow-md transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] ${checked ? "translate-x-6" : ""}`}
        style={{ background: checked ? "var(--da-btn-fg)" : "var(--da-z400)" }}
      >
        {checked && <Check size={13} strokeWidth={3} style={{ color: "var(--da-btn-fg-inv)" }} />}
      </span>
    </button>
  );
}

/** A big selectable card, used for choices such as Public vs Private. */
export function OptionCard({
  selected, onSelect, icon: Icon, title, body, loading, disabled,
}: {
  selected: boolean; onSelect: () => void; icon: LucideIcon; title: string; body: string; loading?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button" role="radio" aria-checked={selected} onClick={onSelect} disabled={disabled || loading}
      className={`group relative flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition-all duration-300 disabled:cursor-not-allowed ${selected ? "border-zinc-400 bg-zinc-800/60 shadow-[0_18px_40px_-28px_rgba(0,0,0,.8)]" : "border-zinc-800 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-zinc-800/30"}`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${selected ? "border-zinc-500 bg-zinc-700/60 text-zinc-50" : "border-zinc-800 bg-zinc-800/40 text-zinc-400"}`}>
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Icon size={19} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-semibold text-zinc-100">{title}</span>
        <span className="mt-1 block text-[0.8125rem] leading-6 text-zinc-500">{body}</span>
      </span>
      <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-all duration-300 ${selected ? "da-toggle-on border-transparent" : "border-zinc-700"}`}>
        {selected && <Check size={13} strokeWidth={3} style={{ color: "var(--da-btn-fg)" }} />}
      </span>
    </button>
  );
}

/** Numbered how-it-works list, collapsed by default so it never gets in the way. */
export function HowItWorks({ title = "How this works", steps }: { title?: string; steps: { title: string; text: string }[] }) {
  return (
    <details className="da-card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-[0.9375rem] font-semibold text-zinc-100 sm:px-7 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3"><Info size={17} className="text-zinc-400" />{title}</span>
        <span className="text-[0.8125rem] font-normal text-zinc-500 group-open:hidden">Show</span>
        <span className="hidden text-[0.8125rem] font-normal text-zinc-500 group-open:inline">Hide</span>
      </summary>
      <ol className="space-y-5 border-t border-zinc-800/80 p-6 sm:p-7">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-4">
            <span className="da-toggle-on grid h-8 w-8 shrink-0 place-items-center rounded-full text-[0.8125rem] font-semibold" style={{ color: "var(--da-btn-fg)" }}>{i + 1}</span>
            <span>
              <span className="block text-[0.9375rem] font-medium text-zinc-100">{s.title}</span>
              <span className="mt-1 block text-[0.8125rem] leading-6 text-zinc-500">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Label + value row for read-only details (account info, repository facts). */
export function DetailRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-4 sm:px-7">
      <span className="text-[0.8125rem] text-zinc-500">{label}</span>
      <span className={`min-w-0 truncate text-[0.875rem] text-zinc-100 ${mono ? "font-mono" : ""}`}>{children}</span>
    </div>
  );
}
