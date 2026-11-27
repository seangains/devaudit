"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Reveal from "./Reveal";
import ScrollFly from "./ScrollFly";

const PHASES = [
  { title: "A push lands", lines: [["$ git push origin main", "text-surface-dark-ink"], ["→ a3f9c1e received, 4 files changed", "text-indigo-300"]] },
  {
    title: "The error is caught",
    lines: [
      ["✕ TypeError at api/checkout.ts:48", "text-rose-400"],
      ["  cart.items[0] is undefined", "text-surface-dark-ink-soft"],
      ["  session sess_8fk2 · guest · eu-west", "text-surface-dark-ink-soft/70"],
    ],
  },
  {
    title: "Context is logged",
    lines: [
      ["✓ linked to commit a3f9c1e by @maya", "text-emerald-400"],
      ["✓ 132 similar events grouped", "text-emerald-400"],
      ["✓ first seen 6 min after deploy", "text-emerald-400"],
    ],
  },
  {
    title: "The cause is diagnosed",
    lines: [
      ["◆ Guest carts expire after 15 min.", "text-accent-cyan"],
      ["◆ checkout() never re-checks the cart.", "text-accent-cyan"],
      ["◆ Patch ready: guard + CartExpiredError", "text-accent-cyan"],
      ["$ devaudit fix --apply", "text-surface-dark-ink"],
    ],
  },
];

export default function WorkflowSplit() {
  const [phase, setPhase] = useState(0);
  return (
    <section id="workflow" className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-2 md:gap-16 md:py-32">
      <div className="md:sticky md:top-28 md:h-fit">
        <Reveal direction="up">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl md:text-5xl">
            Debugging by hand is a loop you never leave.
          </h2>
          <p className="mt-6 max-w-md text-ink-soft">
            You get a vague alert, grep through logs, guess at a cause, patch it, and forget what you learned. The
            same bug returns three months later under a new name.
          </p>
          <p className="mt-4 max-w-md text-ink-soft">
            DevAudit writes the post-mortem while the error is still fresh. Every failure is tied to its commit,
            grouped with its twins, and explained, so it only has to teach you once.
          </p>
          <ol className="mt-8 space-y-3 border-l border-border pl-5 md:mt-10">
            {PHASES.map((p, i) => (
              <li key={p.title} className={`text-sm transition-colors duration-300 ${i === phase ? "text-accent" : "text-ink-faint"}`}>
                <span className="mr-2 font-mono">{i + 1}.</span>
                {p.title}
              </li>
            ))}
          </ol>
        </Reveal>
      </div>

      <div className="relative">
        <div className="absolute bottom-0 left-3 top-0 w-px bg-gradient-to-b from-transparent via-accent/30 to-transparent" />
        {PHASES.map((p, i) => (
          <motion.div
            key={p.title}
            onViewportEnter={() => setPhase(i)}
            viewport={{ amount: 0.7 }}
            className="flex min-h-[38vh] items-center pl-8 md:min-h-[60vh] md:pl-10"
          >
            <ScrollFly from="right" className="w-full">
            <div className="w-full overflow-x-auto rounded-lg border border-surface-dark-border bg-surface-dark p-4 font-mono text-xs leading-7 shadow-sm sm:text-sm md:p-5">
              <p className="mb-2 text-xs text-surface-dark-ink-soft">{p.title}</p>
              {p.lines.map(([t, c], j) => (
                <motion.p
                  key={j}
                  className={c}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.8 }}
                  transition={{ delay: j * 0.35 }}
                >
                  {t}
                </motion.p>
              ))}
            </div>
            </ScrollFly>
            <span
              className={`absolute left-[7px] h-3 w-3 rounded-full border-2 transition-colors duration-300 ${
                i <= phase ? "border-accent-cyan bg-accent-cyan" : "border-border bg-bg-elevated"
              }`}
            />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
