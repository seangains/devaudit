"use client";
import { motion } from "framer-motion";
import { ShieldCheck, Boxes, Activity } from "lucide-react";
import Highlight from "./Highlight";
import ScrollFly from "./ScrollFly";
import SecurityRadar from "./SecurityRadar";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const FEED = [
  { t: "09:14:02", label: "push", text: "main ← a3f9c1e “refactor checkout”", c: "text-indigo-300" },
  { t: "09:14:44", label: "ok", text: "build passed in 42s", c: "text-emerald-400" },
  { t: "09:16:10", label: "err", text: "TypeError: Cannot read 'id' of undefined", c: "text-rose-400" },
  { t: "09:16:11", label: "note", text: "grouped with 131 similar events", c: "text-surface-dark-ink-soft" },
  { t: "09:21:03", label: "push", text: "feat/auth ← 91bd07a “add refresh flow”", c: "text-indigo-300" },
];

const FIX_LINES = [
  { t: "-", code: "return charge(item.id, cart.total);" },
  { t: "+", code: "if (!item) throw new CartExpiredError(cart.id);" },
  { t: "+", code: "return charge(item.id, cart.total);" },
];
const diffBg: Record<string, string> = { "-": "bg-diff-del-bg text-diff-del", "+": "bg-diff-add-bg text-diff-add" };

const STACK = ["JS", "TS", "PY", "GO", "RS", "RB", "JAVA", "C#", "+12 more"];

const HEALTH = [
  { name: "checkout-api", ms: "18ms" },
  { name: "auth-service", ms: "9ms" },
  { name: "billing-worker", ms: "31ms" },
];
const BARS = [62, 58, 70, 48, 52, 40, 44, 30, 34, 22, 26, 16];

// The section heading now lives in the WaveDivider placed above this section in page.tsx.
export default function DashboardShowcase() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6 md:pb-20">
      <div className="grid gap-x-10 gap-y-16 md:grid-cols-2">
        {/* Preview 1 — faded feed screenshot with caption below, in front */}
        <ScrollFly from="left">
          <div className="rounded-2xl border border-border bg-bg-elevated p-2 shadow-sm">
            <div className="fade-bottom relative overflow-hidden rounded-xl bg-surface-dark px-4 pb-16 pt-4">
              <span className="absolute right-4 top-4 flex items-center gap-1.5 text-[11px] text-surface-dark-ink-soft">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
              <p className="font-mono text-xs text-surface-dark-ink-soft/70">$ devaudit watch --repo acme/storefront</p>
              <div className="mt-3 space-y-2 font-mono text-xs leading-6">
                {FEED.map((f, i) => (
                  <motion.div key={f.t} className="flex gap-2" initial={{ opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.8, delay: 0.2 + i * 0.14, ease: EASE }}>
                    <span className="shrink-0 text-surface-dark-ink-soft/60">{f.t}</span>
                    <span className={`shrink-0 ${f.c}`}>{f.label}</span>
                    <span className="truncate text-surface-dark-ink">{f.text}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative z-10 -mt-8 px-3">
            <h3 className="text-lg font-semibold text-ink">Every push, watched automatically</h3>
            <p className="mt-1.5 text-sm text-ink-soft">
              DevAudit connects to your repo once, then tails every push and deploy — no dashboards to babysit.
            </p>
          </div>
        </ScrollFly>

        {/* Preview 2 — faded diff screenshot with caption below, in front */}
        <ScrollFly from="right">
          <div className="rounded-2xl border border-border bg-bg-elevated p-2 shadow-sm">
            <div className="fade-bottom relative overflow-hidden rounded-xl bg-surface-dark px-4 pb-16 pt-4">
              <p className="text-[11px] font-medium text-accent-cyan">AI Quick-Fix · api/checkout.ts:47</p>
              <div className="mt-3 overflow-hidden rounded-lg border border-surface-dark-border font-mono text-xs leading-6">
                {FIX_LINES.map((l, i) => (
                  <motion.div key={i} className={`flex gap-3 px-3 py-1 ${diffBg[l.t]}`} initial={{ clipPath: "inset(0 100% 0 0)" }} whileInView={{ clipPath: "inset(0 0% 0 0)" }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.9, delay: 0.3 + i * 0.45, ease: EASE }}>
                    <span className="select-none opacity-60">{l.t}</span>
                    <span><Highlight line={l.code} /></span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative z-10 -mt-8 px-3">
            <h3 className="text-lg font-semibold text-ink">Fixes, explained and ready to apply</h3>
            <p className="mt-1.5 text-sm text-ink-soft">
              Every autopsy ends in a reviewable patch, with the reasoning written next to the line it applies to.
            </p>
          </div>
        </ScrollFly>
      </div>

      {/* Self-contained cards — not faded, content lives inside */}
      <div className="mt-16 grid gap-6 md:grid-cols-3">
        <ScrollFly from="left" className="h-full">
          <div className="h-full rounded-2xl border border-surface-dark-border bg-surface-dark p-6">
            <ShieldCheck size={18} className="text-accent-cyan" />
            <h3 className="mt-3 text-base font-semibold text-surface-dark-ink">Secure by default</h3>
            <p className="mt-1.5 text-sm text-surface-dark-ink-soft">Secrets encrypted at rest, API tokens stored as hashes, GitHub token kept server-side.</p>
            <SecurityRadar />
          </div>
        </ScrollFly>

        <ScrollFly from="up" className="h-full">
          <div className="h-full rounded-2xl border border-surface-dark-border bg-surface-dark p-6">
            <Boxes size={18} className="text-accent-cyan" />
            <h3 className="mt-3 text-base font-semibold text-surface-dark-ink">Works with your stack</h3>
            <p className="mt-1.5 text-sm text-surface-dark-ink-soft">Point DevAudit at any repo — watched the same way, whatever it's written in.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {STACK.map((s, i) => (
                <motion.span key={s} animate={{ opacity: [0.55, 1, 0.55] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.25 }} className="rounded-full border border-surface-dark-border bg-surface-dark-2 px-3 py-1.5 font-mono text-xs text-surface-dark-ink-soft">
                  {s}
                </motion.span>
              ))}
            </div>
          </div>
        </ScrollFly>

        <ScrollFly from="right" className="h-full">
          <div className="h-full rounded-2xl border border-surface-dark-border bg-surface-dark p-6">
            <Activity size={18} className="text-accent-cyan" />
            <h3 className="mt-3 text-base font-semibold text-surface-dark-ink">Live error monitoring</h3>
            <p className="mt-1.5 text-sm text-surface-dark-ink-soft">Error rate across every service, trending down since last deploy.</p>
            <div className="mt-6 flex h-16 items-end gap-1">
              {BARS.map((h, i) => (
                <motion.div key={i} className="flex-1 rounded-sm bg-accent-cyan/30" style={{ height: `${h}%`, originY: 1 }} animate={{ scaleY: [0.7, 1] }} transition={{ duration: 2.8, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay: i * 0.14 }} />
              ))}
            </div>
            <div className="mt-4 space-y-1.5 border-t border-surface-dark-border pt-3">
              {HEALTH.map((h) => (
                <div key={h.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-surface-dark-ink-soft">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {h.name}
                  </span>
                  <span className="font-mono text-surface-dark-ink-soft">{h.ms}</span>
                </div>
              ))}
            </div>
          </div>
        </ScrollFly>
      </div>
    </section>
  );
}
