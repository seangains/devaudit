import { ShieldCheck, Lock, Database, KeyRound, Github, Server, Sparkles } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

// Plain facts about how data is handled — not certifications.
const FACTS = [
  { label: "AES-256", sub: "at rest" },
  { label: "SHA-256", sub: "hashed" },
  { label: "TLS", sub: "in transit" },
];

const PRACTICES = [
  { icon: Lock, title: "Secrets are encrypted at rest", body: "GitHub access tokens and saved environment variables are encrypted with AES-256-GCM before they are stored. Environment variables are decrypted on our servers only at the moment you deploy. Traffic to and from the Service uses HTTPS (TLS)." },
  { icon: KeyRound, title: "API tokens are stored as hashes", body: "We keep only a SHA-256 hash of each API token, plus its name and a short prefix. The full token is shown once, when you create it, so it can't be read back out of our database." },
  { icon: Github, title: "Your GitHub token stays on the server", body: "The token is stored encrypted and is never sent to your browser. The dashboard talks to GitHub through a server-side proxy that only allows a fixed list of GitHub API calls." },
  { icon: ShieldCheck, title: "GitHub access, explained", body: "Sign-in requests GitHub's repo permission, which is broad: GitHub's sign-in scopes don't offer a narrower option for private repositories. DevAudit reads your repositories and, only when you ask, creates branches and commits, creates repositories or changes a repository's visibility. You can revoke access at any time in your GitHub settings." },
  { icon: Sparkles, title: "AI features send code to third parties", body: "AI explanations, fixes and the assistant send the code excerpts and prompts you submit to AI providers (currently OpenRouter and Groq), some of them on free tiers that may log inputs. Environment variable values are never included in deployment recommendations. Please don't put secrets in prompts. See the Privacy Policy for details." },
  { icon: Server, title: "Abuse protection", body: "API and AI endpoints are rate limited, and deploy webhooks can only point at public HTTPS addresses, so the Service can't be aimed at internal networks." },
  { icon: Database, title: "You control your data", body: "Delete projects, environment variables and API tokens from the dashboard, or disconnect DevAudit in your GitHub settings. Data is kept until you delete it or ask us to, as described in the Privacy Policy." },
];

export default function SecurityPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up" className="flex flex-col items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-bg-elevated">
            <ShieldCheck size={22} className="text-accent-cyan" />
          </span>
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Security, in plain terms</h1>
          <p className="max-w-xl text-ink-soft">
            DevAudit is a small independent project and doesn't hold formal security certifications. Here is what it
            actually does to protect your tokens, secrets and code.
          </p>
        </Reveal>

        <Reveal direction="up" delay={0.05} className="mt-8 flex flex-wrap gap-4">
          {FACTS.map((b) => (
            <div key={b.label} className="grid h-20 w-20 place-items-center rounded-full border border-border bg-bg-elevated text-center">
              <span>
                <span className="block text-sm font-semibold text-ink">{b.label}</span>
                <span className="block text-[10px] uppercase tracking-wide text-ink-faint">{b.sub}</span>
              </span>
            </div>
          ))}
        </Reveal>

        <div className="mt-14 space-y-4">
          {PRACTICES.map((p, i) => (
            <Reveal key={p.title} direction="up" delay={0.1 + i * 0.05}>
              <div className="flex gap-4 rounded-2xl border border-border bg-bg-elevated p-5">
                <p.icon size={18} className="mt-0.5 shrink-0 text-accent-cyan" />
                <div>
                  <p className="font-medium text-ink">{p.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{p.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal direction="up" delay={0.25} className="mt-10 rounded-2xl border border-dashed border-border p-5 text-sm text-ink-soft">
          Found a vulnerability or have a security question? Email{" "}
          <a href="mailto:sean@devaudit.lol" className="font-medium text-ink underline underline-offset-2">sean@devaudit.lol</a>.
          Please give us a reasonable chance to fix an issue before sharing it publicly.
        </Reveal>
      </section>
      <Footer />
    </main>
  );
}
