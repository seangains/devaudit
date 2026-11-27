import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

const VALUES = [
  { title: "Write it once", body: "Every failure gets a post-mortem while it's still fresh, so no one has to reconstruct it from memory three months later." },
  { title: "Every stack, the same way", body: "DevAudit watches JS, TS, Python, Go, Rust, Ruby and more with the same consistency, so context never depends on the language." },
  { title: "Careful with your secrets", body: "Tokens and environment variables are encrypted at rest, API tokens are stored only as hashes, and your GitHub token stays on the server." },
];

export default function AboutPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            We got tired of debugging the same bug twice.
          </h1>
          <p className="mt-5 text-ink-soft">
            DevAudit started as an internal tool for a team that kept shipping the same class of regression under a new
            name every few months. The problem wasn't a lack of logs — it was that the reasoning behind every fix lived
            in someone's head instead of next to the code. We built DevAudit to write that reasoning down automatically,
            the moment a failure happens, so a team only has to learn a bug once.
          </p>
          <p className="mt-4 text-ink-soft">
            Today DevAudit watches pushes and errors for engineering teams who'd rather read a five-line autopsy than
            grep three log files at 2am.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {VALUES.map((v, i) => (
            <Reveal key={v.title} direction="up" delay={i * 0.06}>
              <div className="h-full rounded-2xl border border-border bg-bg-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-ink">{v.title}</h2>
                <p className="mt-2 text-sm text-ink-soft">{v.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
