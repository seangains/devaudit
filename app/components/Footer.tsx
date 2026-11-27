import Link from "next/link";
import { Github, Twitter, Linkedin } from "lucide-react";
import Logo from "./Logo";

const cols = [
  {
    h: "Product",
    l: [
      { label: "Features", href: "/#features" },
      { label: "Architecture", href: "/#architecture" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    h: "Developers",
    l: [
      { label: "Docs", href: "/docs" },
      { label: "CLI reference", href: "/docs/cli" },
      { label: "GitHub app", href: "/integrations/github" },
      { label: "API", href: "/docs/api" },
    ],
  },
  {
    h: "Company",
    l: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Security", href: "/security" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    h: "Legal",
    l: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-border px-4 py-12 sm:px-6 md:py-16">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] md:gap-12">
        <div>
          <Logo size={26} className="text-xl" />
          <p className="mt-3 max-w-xs text-sm text-ink-faint">Learn from every error you ship.</p>
          <p className="mt-6 flex items-center gap-2 text-sm text-ink-soft">
            <span className="relative flex h-2 w-2">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            All Systems Operational
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:contents">
          {cols.map((c) => (
            <div key={c.h}>
              <p className="text-sm font-medium text-ink">{c.h}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.l.map((x) => (
                  <li key={x.label}>
                    <Link href={x.href} className="text-ink-faint transition-colors duration-200 hover:text-ink">
                      {x.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-6xl flex-col gap-4 border-t border-border-soft pt-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between md:mt-14">
        <span>© 2026 DevAudit, Inc.</span>
        <div className="flex gap-4 text-ink-faint">
          <a
            href="https://github.com/devaudit"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="transition-colors duration-200 hover:text-ink"
          >
            <Github size={16} />
          </a>
          <a
            href="https://twitter.com/devaudit"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Twitter"
            className="transition-colors duration-200 hover:text-ink"
          >
            <Twitter size={16} />
          </a>
          <a
            href="https://linkedin.com/company/devaudit"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
            className="transition-colors duration-200 hover:text-ink"
          >
            <Linkedin size={16} />
          </a>
        </div>
      </div>
    </footer>
  );
}
