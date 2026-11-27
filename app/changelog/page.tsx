import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

type Entry = { date: string; tag: "Added" | "Improved" | "Fixed"; title: string; body: string };

const TAG_STYLE: Record<Entry["tag"], string> = {
  Added: "bg-accent-cyan/10 text-accent-cyan",
  Improved: "bg-accent/10 text-accent",
  Fixed: "bg-emerald-500/10 text-emerald-500",
};

// Release history. Dates are approximate (taken from when the work was last touched): adjust if needed.
const ENTRIES: Entry[] = [
  {
    date: "Oct 8, 2026",
    tag: "Added",
    title: "Privacy Policy, Terms of Service and a clearer Security page",
    body: "Published our Privacy Policy and Terms of Service, and rewrote the Security page to describe exactly how tokens, secrets and GitHub access are handled.",
  },
  {
    date: "Sep 29, 2026",
    tag: "Added",
    title: "Deploy from the dashboard",
    body: "Deploy a project to Vercel, Netlify, Cloudflare, Render, GitHub Pages or a custom webhook. Saved environment variables are encrypted at rest and only decrypted at deploy time.",
  },
  {
    date: "Sep 28, 2026",
    tag: "Improved",
    title: "Your GitHub token now stays on the server",
    body: "The token is stored encrypted and is never sent to your browser. The dashboard reaches GitHub through a server-side proxy that only allows a fixed list of calls.",
  },
  {
    date: "Sep 28, 2026",
    tag: "Added",
    title: "CLI sign-in and API tokens",
    body: "Sign in the CLI from your browser, or create API tokens in the dashboard. Tokens are shown once and stored only as hashes.",
  },
  {
    date: "Sep 27, 2026",
    tag: "Added",
    title: "Public REST API",
    body: "Report errors and read them back over HTTPS with a bearer token, and apply a suggested fix as a commit on a new branch. See the API reference.",
  },
];

export default function ChangelogPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up" className="mb-14">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Changelog</h1>
          <p className="mt-4 text-ink-soft">What's new in DevAudit, released as it ships.</p>
        </Reveal>

        <div className="space-y-10 border-l border-border pl-6 sm:pl-8">
          {ENTRIES.map((e, i) => (
            <Reveal key={e.title} direction="up" delay={i * 0.05}>
              <div className="relative">
                <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent sm:-left-[41px]" />
                <p className="font-mono text-xs text-ink-faint">{e.date}</p>
                <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TAG_STYLE[e.tag]}`}>
                  {e.tag}
                </span>
                <h2 className="mt-2 font-display text-lg font-semibold text-ink">{e.title}</h2>
                <p className="mt-1.5 max-w-xl text-sm text-ink-soft">{e.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
