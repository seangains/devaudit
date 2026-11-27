"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import SiteCustomizer from "./SiteCustomizer";
import MegaMenu from "./MegaMenu";
import Logo from "./Logo";

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <motion.header initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md transition-colors duration-300">
      <nav className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="DevAudit home">
          <Logo size={30} />
        </Link>

        <div className="flex items-center gap-3 sm:gap-4">
          <ThemeToggle />
          <SiteCustomizer />
          <Link
            href="/login"
            className="group relative hidden h-12 items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-accent-cyan/40 bg-surface-dark px-6 text-base font-medium text-surface-dark-ink shadow-[0_8px_24px_-10px_rgba(34,211,238,.45)] transition-[transform,box-shadow,border-color] duration-300 hover:border-accent-cyan/70 hover:shadow-[0_12px_32px_-8px_rgba(34,211,238,.6)] active:scale-[0.97] sm:flex"
          >
            <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
            <span className="relative">Get started</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-bg-elevated/60 text-ink transition-colors duration-300 hover:border-accent-cyan/40"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      <MegaMenu open={open} onClose={() => setOpen(false)} />
    </motion.header>
  );
}
