"use client";
import { motion } from "framer-motion";

// Sweeping radar. Each protection blip flares as the sweep passes it (first-pass delay = angle/360 * period).
const PERIOD = 4;
const BLIPS = [
  { a: 40, r: 0.62, l: "AES-256" },
  { a: 150, r: 0.72, l: "SHA-256" },
  { a: 262, r: 0.5, l: "TLS" },
];

export default function SecurityRadar() {
  return (
    <div className="relative mx-auto mt-6 aspect-square w-44">
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 text-accent-cyan/25" fill="none" stroke="currentColor" strokeWidth=".4">
        {[16, 32, 48].map((r) => <circle key={r} r={r} />)}
        <path d="M-50 0H50M0-50V50" />
      </svg>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: "conic-gradient(from 0deg, transparent 0 240deg, rgb(34 211 238 / .32) 360deg)" }}
        animate={{ rotate: 360 }}
        transition={{ duration: PERIOD, ease: "linear", repeat: Infinity }}
      />
      {BLIPS.map((b) => {
        const rad = (b.a * Math.PI) / 180;
        return (
          <span key={b.l} className="absolute" style={{ left: `${50 + Math.sin(rad) * b.r * 50}%`, top: `${50 - Math.cos(rad) * b.r * 50}%` }}>
            <motion.i
              className="block h-2 w-2 rounded-full bg-accent-cyan"
              style={{ x: "-50%", y: "-50%" }}
              animate={{ opacity: [1, 0.25, 0.25], scale: [1.7, 1, 1] }}
              transition={{ duration: PERIOD, times: [0, 0.35, 1], ease: "linear", repeat: Infinity, delay: (b.a / 360) * PERIOD }}
            />
            <span className="absolute left-2 top-[-6px] whitespace-nowrap font-mono text-[9px] text-surface-dark-ink-soft">{b.l}</span>
          </span>
        );
      })}
    </div>
  );
}
