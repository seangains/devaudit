"use client";
import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import Reveal from "./Reveal";

type StatKey = "developers" | "visits" | "repos";
type Stat = { key: StatKey; label: string; suffix?: string; decimals?: number; value: number | null };

// Static placeholder numbers — no live data source wired up.
// Swap back to the Supabase-backed version once real stats are ready.
const INITIAL: Stat[] = [
  { key: "developers", label: "Developers shipping with DevAudit", suffix: "+", value: 1100 },
  { key: "visits", label: "Monthly dashboard visits", suffix: "+", value: 312000 },
  { key: "repos", label: "Repositories audited", suffix: "+", value: 11500 },
];

function CountUp({ value, decimals = 0, suffix = "" }: { value: number | null; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [display, setDisplay] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!inView || value === null) return;
    const start = performance.now();
    const base = from.current;
    const delta = value - base;
    const duration = 1200;
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(base + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);

  if (value === null) {
    return <span className="inline-block h-[1em] w-24 animate-pulse rounded bg-border-soft align-middle" />;
  }
  const formatted = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString("en-US");
  return (
    <span ref={ref}>
      {formatted}
      {suffix}
    </span>
  );
}

export default function StatsSection() {
  const [stats] = useState<Stat[]>(INITIAL);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
      <div className="grid gap-10 border-y border-border py-10 sm:grid-cols-3 md:py-12">
        {stats.map((s, i) => (
          <Reveal key={s.key} direction="up" delay={i * 0.1}>
            <p className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              <CountUp value={s.value} decimals={s.decimals} suffix={s.suffix} />
            </p>
            <p className="mt-2 text-sm text-ink-soft">{s.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
