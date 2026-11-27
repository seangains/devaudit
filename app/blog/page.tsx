import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

// Placeholder posts — no CMS wired up yet. Swap for the real feed once one exists.
const POSTS = [
  {
    date: "Sep 15, 2026",
    title: "How we group errors by cause instead of by timestamp",
    excerpt: "The trick isn't smarter matching — it's tracing every error back to the commit that introduced it, then diffing from there.",
  },
  {
    date: "Aug 28, 2026",
    title: "What a good post-mortem actually needs to say",
    excerpt: "Most post-mortems answer 'what happened.' The useful ones answer 'what would have caught this sooner,' every time.",
  },
  {
    date: "Aug 6, 2026",
    title: "Watching every language the same way",
    excerpt: "Why DevAudit doesn't have a JS mode and a Python mode — and what that constraint forced us to get right early.",
  },
];

export default function BlogPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Blog</h1>
          <p className="mt-4 text-ink-soft">Notes on debugging, incident response, and building DevAudit.</p>
        </Reveal>

        <div className="mt-12 divide-y divide-border-soft">
          {POSTS.map((p, i) => (
            <Reveal key={p.title} direction="up" delay={i * 0.05}>
              <article className="py-6">
                <p className="font-mono text-xs text-ink-faint">{p.date}</p>
                <h2 className="mt-1.5 font-display text-lg font-semibold text-ink">{p.title}</h2>
                <p className="mt-2 max-w-xl text-sm text-ink-soft">{p.excerpt}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
