import Link from "next/link";
import { Github, GitCommit, GitBranch, ShieldCheck } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

const PERMISSIONS = [
  { icon: GitCommit, title: "Read your repositories", body: "Lists the repositories you can access, including private ones, and reads files, commits and branches so DevAudit can analyze errors and show your code in the editor." },
  { icon: GitBranch, title: "Create branches and commits, only when you ask", body: "Applying a suggested fix, or committing from the code editor, writes a branch or commit to your repository. It only happens in response to an action you take." },
  { icon: ShieldCheck, title: "Create repositories and change visibility, only when you ask", body: "The code editor can create a new repository, or switch a repository between public and private, when you use those controls." },
];

export default function GithubIntegrationPage() {
  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up" className="flex flex-col items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-bg-elevated">
            <Github size={22} className="text-ink" />
          </span>
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">GitHub integration</h1>
          <p className="max-w-xl text-ink-soft">
            Sign in with GitHub and connect your repositories. DevAudit reads your code to explain errors and suggest
            fixes, and only changes anything on GitHub when you ask it to.
          </p>
          <Link
            href="/login"
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-bg transition-transform duration-200 hover:opacity-90 active:scale-[0.97]"
          >
            Connect GitHub
          </Link>
          <p className="text-xs text-ink-faint">You'll authorize DevAudit through GitHub's standard sign-in. There's nothing else to install.</p>
        </Reveal>

        <h2 className="mt-16 font-display text-xl font-semibold text-ink">What it does with your access</h2>
        <div className="mt-5 space-y-4">
          {PERMISSIONS.map((p, i) => (
            <Reveal key={p.title} direction="up" delay={i * 0.05}>
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

        <Reveal direction="up" delay={0.15} className="mt-10">
          <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-ink-soft">
            Sign-in requests GitHub's <code>repo</code> permission, which is broad: it covers read and write access to
            the repositories you can access, and GitHub doesn't offer a narrower option for private repositories. To
            limit what that means in practice, DevAudit's servers only make a fixed list of GitHub API calls on your
            behalf and never send your GitHub token to your browser. You can revoke access at any time at{" "}
            <a href="https://github.com/settings/applications" className="font-medium text-ink underline underline-offset-2">github.com/settings/applications</a>.
          </div>
        </Reveal>
      </section>
      <Footer />
    </main>
  );
}
