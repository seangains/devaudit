"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { setSiteMode } from "@/utils/siteTheme";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    setSiteMode(next ? "dark" : "light"); // saved in the shared store, so the dashboard picks it up too
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted && dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={mounted && dark}
      className="relative flex h-11 w-[68px] shrink-0 items-center rounded-full border border-border bg-bg-elevated px-1 shadow-sm transition-colors duration-300"
    >
      <Sun size={15} className="pointer-events-none absolute left-[11px] text-ink-faint" strokeWidth={2.25} />
      <Moon size={15} className="pointer-events-none absolute right-[11px] text-ink-faint" strokeWidth={2.25} />
      <motion.span
        className="relative z-10 grid h-8 w-8 place-items-center rounded-full bg-ink text-bg"
        animate={{ x: mounted && dark ? 24 : 0 }}
        transition={{ type: "spring", stiffness: 480, damping: 32 }}
      >
        {mounted && dark ? <Moon size={15} strokeWidth={2.25} /> : <Sun size={15} strokeWidth={2.25} />}
      </motion.span>
    </button>
  );
}
