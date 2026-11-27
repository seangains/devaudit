import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

type Cmd = { cmd: string; desc: string };

const COMMANDS: Cmd[] = [
  { cmd: "devaudit login", desc: "Authenticate the CLI with your DevAudit account." },
  { cmd: "devaudit init", desc: "Detect your stack and generate a devaudit.config.json in the current repo." },
  { cmd: "devaudit watch --repo <owner/repo>", desc: "Start streaming pushes, builds and errors for a repository." },
  { cmd: "devaudit list", desc: "List every repository currently being watched on your account." },
  { cmd: "devaudit fix <error-id>", desc: "Print the AI quick-fix for a given error and optionally apply it as a patch." },
  { cmd: "devaudit status", desc: "Show current watch status, event throughput and last-seen deploy." },
];

export default function CliDocsPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">CLI reference</h1>
          <p className="mt-4 text-ink-soft">
            Install with <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[13px]">npm install -g devaudit-cli</code>,
            then run <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[13px]">devaudit login</code> to get started.
          </p>
        </Reveal>

        <div className="mt-10 space-y-4">
          {COMMANDS.map((c, i) => (
            <Reveal key={c.cmd} direction="up" delay={i * 0.04}>
              <div className="overflow-hidden rounded-xl border border-surface-dark-border bg-surface-dark">
                <pre className="overflow-x-auto px-4 py-3 font-mono text-sm text-accent-cyan">
                  <span className="text-surface-dark-ink-soft/60">$ </span>
                  {c.cmd}
                </pre>
                <p className="border-t border-surface-dark-border px-4 py-3 text-sm text-surface-dark-ink-soft">{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
