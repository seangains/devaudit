"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { ChevronRight } from "lucide-react";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/#features", note: "Autopsies, diffs and live watch" },
      { label: "Workflow", href: "/#workflow", note: "How a push becomes a fix" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "CLI reference", href: "/docs/cli" },
      { label: "GitHub app", href: "/integrations/github" },
      { label: "API", href: "/docs/api" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Security", href: "/security" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

const panel: Variants = {
  hidden: { opacity: 0, y: -16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.045, delayChildren: 0.05 } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.25, ease: [0.4, 0, 1, 1] } },
};
const row: Variants = {
  hidden: { opacity: 0, y: -8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

export default function MegaMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            aria-hidden
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm"
          />
          <motion.div
            variants={panel}
            initial="hidden"
            animate="show"
            exit="exit"
            className="fixed inset-x-0 top-14 z-50 max-h-[calc(100vh-3.5rem)] origin-top overflow-y-auto rounded-b-2xl border-b border-border bg-bg-elevated shadow-2xl"
          >
            <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 sm:px-8 md:grid-cols-4 md:gap-8 md:py-14">
              {COLUMNS.map((col) => (
                <div key={col.heading}>
                  <motion.p variants={row} className="text-sm font-medium text-ink-faint">
                    {col.heading}
                  </motion.p>
                  <ul className="mt-4 divide-y divide-border-soft md:divide-y-0">
                    {col.links.map((l) => (
                      <motion.li key={l.label} variants={row}>
                        <Link
                          href={l.href}
                          onClick={onClose}
                          className="group flex items-center justify-between gap-3 py-3.5 text-ink transition-colors duration-200 hover:text-accent md:py-2.5"
                        >
                          <span>
                            <span className="text-base font-medium md:text-[15px]">{l.label}</span>
                            {l.note && <span className="mt-0.5 block text-sm text-ink-faint">{l.note}</span>}
                          </span>
                          <ChevronRight
                            size={16}
                            className="shrink-0 text-ink-faint opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
                          />
                        </Link>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <motion.div variants={row} className="border-t border-border-soft px-6 py-5 sm:px-8">
              <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
                <span className="text-sm text-ink-faint">Watch your first repo in under five minutes.</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href="/login"
                    onClick={onClose}
                    className="rounded-full border border-border px-4 py-2 text-sm font-medium text-ink transition-colors duration-200 hover:bg-border-soft"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/login"
                    onClick={onClose}
                    className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg transition-transform duration-200 hover:opacity-90 active:scale-[0.97]"
                  >
                    Get started
                  </Link>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
