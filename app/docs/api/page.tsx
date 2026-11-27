import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

type Endpoint = { method: "GET" | "POST"; path: string; desc: string };

const METHOD_STYLE: Record<Endpoint["method"], string> = {
  GET: "bg-accent-cyan/10 text-accent-cyan",
  POST: "bg-accent/10 text-accent",
};

const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/v1/repos", desc: "List repositories watched on your account." },
  { method: "GET", path: "/v1/errors", desc: "List recent grouped errors across all watched repos." },
  { method: "GET", path: "/v1/errors/:id", desc: "Fetch a single error's full autopsy, including cause and suggested fix." },
  { method: "POST", path: "/v1/errors/:id/fix", desc: "Apply the AI quick-fix for an error as a commit on a new branch." },
];

export default function ApiDocsPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">API reference</h1>
          <p className="mt-4 text-ink-soft">
            The DevAudit API is REST over HTTPS. Authenticate every request with a bearer token from your account settings.
          </p>
          <a
            href="/dashboard?settings=1"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Generate an API token →
          </a>
        </Reveal>

        <Reveal direction="up" delay={0.05} className="mt-8">
          <div className="overflow-hidden rounded-2xl border border-surface-dark-border bg-surface-dark">
            <div className="flex items-center gap-2 border-b border-surface-dark-border px-4 py-3">
              <i className="h-3 w-3 rounded-full bg-rose-500/80" />
              <i className="h-3 w-3 rounded-full bg-amber-400/80" />
              <i className="h-3 w-3 rounded-full bg-emerald-500/80" />
              <span className="mx-auto truncate font-mono text-xs text-surface-dark-ink-soft">example request</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-7 text-surface-dark-ink">
              curl https://api.devaudit.org/v1/errors \{"\n"}
              {"  "}-H "Authorization: Bearer $DEVAUDIT_TOKEN"
            </pre>
          </div>
        </Reveal>

        <h2 className="mt-14 font-display text-xl font-semibold text-ink">Endpoints</h2>
        <div className="mt-5 divide-y divide-border-soft rounded-2xl border border-border">
          {ENDPOINTS.map((e) => (
            <div key={e.method + e.path} className="flex flex-col gap-1.5 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
              <span className={`w-fit shrink-0 rounded-full px-2.5 py-0.5 font-mono text-xs font-medium ${METHOD_STYLE[e.method]}`}>
                {e.method}
              </span>
              <code className="shrink-0 font-mono text-sm text-ink">{e.path}</code>
              <span className="text-sm text-ink-soft">{e.desc}</span>
            </div>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
