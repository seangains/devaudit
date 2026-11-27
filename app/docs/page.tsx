import Link from "next/link";
import { Terminal, Braces, Github, ArrowRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

const SECTIONS = [
  {
    icon: Terminal,
    title: "CLI reference",
    body: "Every devaudit command, from first login to watching a repo in CI.",
    href: "/docs/cli",
  },
  {
    icon: Braces,
    title: "API reference",
    body: "Pull errors, autopsies and repo status into your own tools over REST.",
    href: "/docs/api",
  },
  {
    icon: Github,
    title: "GitHub integration",
    body: "What DevAudit does with your GitHub access and the permissions it asks for.",
    href: "/integrations/github",
  },
];

export default function DocsPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up" className="max-w-2xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Documentation</h1>
          <p className="mt-4 text-ink-soft">
            Get a repo watched in under five minutes, then go deeper with the CLI and API.
          </p>
        </Reveal>

        <Reveal direction="up" delay={0.05} className="mt-10">
          <div className="overflow-hidden rounded-2xl border border-surface-dark-border bg-surface-dark">
            <div className="flex items-center gap-2 border-b border-surface-dark-border px-4 py-3">
              <i className="h-3 w-3 rounded-full bg-rose-500/80" />
              <i className="h-3 w-3 rounded-full bg-amber-400/80" />
              <i className="h-3 w-3 rounded-full bg-emerald-500/80" />
              <span className="mx-auto truncate font-mono text-xs text-surface-dark-ink-soft">quick start</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-7 text-surface-dark-ink">
              <span className="text-surface-dark-ink-soft/70">$ </span>npm install -g devaudit-cli{"\n"}
              <span className="text-surface-dark-ink-soft/70">$ </span>devaudit login{"\n"}
              <span className="text-surface-dark-ink-soft/70">$ </span>devaudit watch --repo acme/storefront
            </pre>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {SECTIONS.map((s, i) => (
            <Reveal key={s.title} direction="up" delay={0.1 + i * 0.05}>
              <Link
                href={s.href}
                className="group flex h-full flex-col rounded-2xl border border-border bg-bg-elevated p-6 transition-colors duration-200 hover:border-accent/40"
              >
                <s.icon size={20} className="text-accent-cyan" />
                <h2 className="mt-4 font-display text-lg font-semibold text-ink">{s.title}</h2>
                <p className="mt-2 flex-1 text-sm text-ink-soft">{s.body}</p>
                <span className="mt-4 flex items-center gap-1 text-sm font-medium text-ink transition-transform duration-200 group-hover:translate-x-0.5">
                  Read more <ArrowRight size={14} />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
