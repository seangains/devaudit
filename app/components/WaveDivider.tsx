"use client";
import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

const W = 1600;
const H = 400;
const SEG = 80; // points per line
const LINES = 9;
const FRAMES = 12; // keyframes per loop

// One wave line at phase t. Every keyframe has identical structure, so framer-motion
// can interpolate the path data smoothly between them. t = 0 and t = 2π are identical,
// which makes the loop seamless.
function line(i: number, t: number) {
  const base = H / 2 + (i - (LINES - 1) / 2) * 26;
  const amp = 40 + ((i * 7) % 5) * 9;
  const f = 0.9 + (i % 3) * 0.35;
  const pts: string[] = [];
  for (let s = 0; s <= SEG; s++) {
    const u = s / SEG;
    const y =
      base +
      amp * Math.sin(u * Math.PI * 2 * f + t + i * 0.5) +
      amp * 0.45 * Math.sin(u * Math.PI * 2 * (f * 2 + 0.5) + 2 * t + i);
    pts.push(`${(u * W).toFixed(1)},${y.toFixed(1)}`);
  }
  return "M" + pts.join("L");
}

const PATHS = Array.from({ length: LINES }, (_, i) =>
  Array.from({ length: FRAMES + 1 }, (_, k) => line(i, (k / FRAMES) * Math.PI * 2)),
);

type Props = { label: string; title: string; sub?: string; id?: string };

export default function WaveDivider({ label, title, sub, id }: Props) {
  const gid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();

  return (
    <div
      id={id}
      className="relative isolate flex min-h-[340px] scroll-mt-20 items-center justify-center overflow-hidden px-4 py-24 sm:px-6 md:min-h-[460px]"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gid} x1="0" x2={W} y1="0" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="currentColor" className="text-accent-cyan" />
              <stop offset="0.5" stopColor="currentColor" className="text-accent" />
              <stop offset="1" stopColor="currentColor" className="text-accent-cyan" />
            </linearGradient>
          </defs>
          {PATHS.map((frames, i) => (
            <motion.path
              key={i}
              d={frames[0]}
              fill="none"
              stroke={`url(#${gid})`}
              strokeWidth={1.25}
              strokeOpacity={0.55 - Math.abs(i - (LINES - 1) / 2) * 0.07}
              vectorEffect="non-scaling-stroke"
              animate={reduce ? undefined : { d: frames }}
              transition={{ duration: 28 + i * 2.5, ease: "linear", repeat: Infinity }}
            />
          ))}
        </svg>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex max-w-3xl flex-col items-center text-center"
      >
        <span className="rounded-full border border-border bg-bg-elevated/80 px-3 py-1 text-xs font-medium text-ink-soft backdrop-blur">
          {label}
        </span>
        <h2 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl md:text-6xl">
          {title}
        </h2>
        {sub && <p className="mt-5 max-w-xl text-ink-soft md:text-lg">{sub}</p>}
      </motion.div>
    </div>
  );
}
