"use client";
import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";

type Props = { children: ReactNode; from?: "left" | "right" | "up"; className?: string };

/**
 * Scroll-linked entrance and exit (same behaviour as before). The scroll progress now runs through a
 * spring, so every transform eases toward the scroll position instead of snapping to it -- that's
 * what makes it feel buttery, even on notchy mouse wheels.
 */
export default function ScrollFly({ children, from = "up", className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const s = from === "left" ? -1 : from === "right" ? 1 : 0;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const p = useSpring(scrollYProgress, { stiffness: 85, damping: 24, mass: 0.55, restDelta: 0.0005 });

  const x = useTransform(p, [0, 0.3, 0.8, 1], [s * 130, 0, 0, s * 80]);
  const y = useTransform(p, [0, 0.3, 0.8, 1], [110, 0, 0, -80]);
  const rotate = useTransform(p, [0, 0.3, 0.8, 1], [s * 2, 0, 0, s * 1.5]);
  const scale = useTransform(p, [0, 0.3, 0.8, 1], [0.95, 1, 1, 0.95]);
  const opacity = useTransform(p, [0, 0.24, 0.82, 1], [0, 1, 1, 0]);

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div ref={ref} style={{ x, y, rotate, scale, opacity, willChange: "transform, opacity" }} className={className}>
      {children}
    </motion.div>
  );
}
