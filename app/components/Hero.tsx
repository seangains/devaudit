"use client";
import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import HeroStack from "./HeroStack";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const WORDS = "Your code, audited. Your mistakes, mastered.".split(" ");
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, delay, ease: EASE },
});

export default function Hero() {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  // The preview stack starts tilted back and settles flat as you scroll (spring-damped, so it never feels jerky).
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 25%"] });
  const p = useSpring(scrollYProgress, { stiffness: 70, damping: 22, mass: 0.6 });
  const rotateX = useTransform(p, [0, 1], [14, 0]);
  const scale = useTransform(p, [0, 1], [0.94, 1]);
  const y = useTransform(p, [0, 1], [40, 0]);

  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 md:pb-32 md:pt-28">
      <div className="relative mx-auto max-w-4xl text-center">
        <h1 className="font-display text-5xl font-bold tracking-tight text-ink sm:text-6xl md:text-7xl">
          {WORDS.map((w, i) => (
            <span key={i}>
              <span className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-bottom">
                <motion.span
                  className="inline-block"
                  initial={{ y: "110%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 1, delay: 0.1 + i * 0.07, ease: EASE }}
                >
                  {w}
                </motion.span>
              </span>
              {i < WORDS.length - 1 && " "}
            </span>
          ))}
        </h1>
        <motion.p {...rise(0.55)} className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-ink-soft sm:text-xl sm:leading-9">
          DevAudit is the command center for your engineering work. It watches every push, catches every error, and
          turns each failure into a written post-mortem with a fix you can apply.
        </motion.p>
        <motion.div {...rise(0.7)} className="mt-10 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-center">
          <Link
            href="/login"
            className="group relative inline-flex h-14 items-center justify-center gap-2 overflow-hidden rounded-xl border border-accent-cyan/40 bg-surface-dark px-9 text-base font-medium text-surface-dark-ink shadow-[0_12px_36px_-12px_rgba(34,211,238,.5)] transition-[transform,box-shadow,border-color] duration-300 hover:border-accent-cyan/70 hover:shadow-[0_16px_44px_-10px_rgba(34,211,238,.65)] active:scale-[0.97]"
          >
            <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
            <span className="relative">Get started free</span>
          </Link>
          <a
            href="#workflow"
            className="flex h-14 items-center justify-center rounded-xl border border-border bg-bg-elevated/60 px-9 text-base text-ink backdrop-blur transition-[border-color,background-color] duration-300 hover:border-accent-cyan/40 hover:bg-bg-elevated"
          >
            See a post-mortem
          </a>
        </motion.div>
      </div>

      <div ref={stage} className="relative mx-auto mt-16 max-w-7xl md:mt-24" style={{ perspective: 1400 }}>
        <motion.div style={reduce ? undefined : { rotateX, scale, y, transformOrigin: "50% 0%" }}>
          <HeroStack />
        </motion.div>
      </div>
    </section>
  );
}
