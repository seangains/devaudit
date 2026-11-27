"use client";
import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

const VARIANTS: Record<string, Variants> = {
  up: { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0 } },
  right: { hidden: { opacity: 0, x: 56 }, show: { opacity: 1, x: 0 } },
  left: { hidden: { opacity: 0, x: -56 }, show: { opacity: 1, x: 0 } },
  scale: { hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1 } },
};

export default function Reveal({
  children,
  direction = "up",
  delay = 0,
  className,
}: {
  children: ReactNode;
  direction?: keyof typeof VARIANTS;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={VARIANTS[direction]}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
