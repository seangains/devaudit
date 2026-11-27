"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import Reveal from "./Reveal";

type Q = { q: string; a: string };
const CATEGORIES: { label: string; items: Q[] }[] = [
  {
    label: "General",
    items: [
      { q: "What does DevAudit actually do?", a: "DevAudit stores the errors you report from your repositories (through the CLI or the API), explains the likely cause, and suggests a fix. You can apply a suggested fix as a commit on a new branch. The dashboard also has a code editor, an AI assistant and deployment tools." },
      { q: "How is this different from an error tracker?", a: "Error trackers mostly show you a stack trace. DevAudit keeps each error with its file, line and commit, explains the likely cause, and offers a suggested patch you can apply as a commit on a new branch." },
      { q: "Do I need to change how my team ships?", a: "No. There's no release step to adopt: sign in with GitHub, connect a repository and report errors with the CLI or API. DevAudit only changes your repository when you ask it to." },
      { q: "Is DevAudit free?", a: "Yes, it's free to use at the moment, though some features have rate limits. If we ever introduce paid plans, we'll explain the price before you're charged." },
    ],
  },
  {
    label: "Security",
    items: [
      { q: "Is our source code stored?", a: "DevAudit stores repository and project names, file paths, commit SHAs, error details and any code excerpts or patches attached to errors. Your repositories stay on GitHub and are read when needed. Code you send to AI features goes to third-party AI providers (see below)." },
      { q: "Are you SOC 2 or ISO 27001 certified?", a: "No. DevAudit is a small independent project and doesn't hold SOC 2, ISO 27001 or any other formal certification. What it does do: GitHub tokens and environment variables are encrypted at rest, API tokens are stored only as hashes, and your GitHub token stays on the server. See the Security page and Privacy Policy for details." },
      { q: "What access does DevAudit need on GitHub?", a: "Sign-in requests GitHub's repo permission, which is broad because GitHub doesn't offer a narrower option for private repositories. DevAudit reads your repositories and, only when you ask, creates branches and commits, creates repositories or changes a repository's visibility. You can revoke access at any time in your GitHub settings." },
      { q: "Is my code used to train AI models?", a: "DevAudit doesn't use your code to train its own models. AI features do send what you submit to third-party providers (currently OpenRouter and Groq), and some of those models are free-tier ones whose providers may log inputs or use them to improve their models. Please don't put secrets in prompts. See Section 6 of the Privacy Policy." },
    ],
  },
  {
    label: "Integrations",
    items: [
      { q: "Which languages are supported?", a: "DevAudit isn't tied to a language: errors are reported with a file, line and message, and AI suggestions work on whatever code you send. How good the suggestions are varies by language and by which AI model answers." },
      { q: "Can I use it from scripts or CI?", a: "Yes. The REST API accepts errors with an API token, so any script or CI step that can make an HTTPS request can report one. There's no built-in integration with specific CI providers yet." },
      { q: "Can I deploy from DevAudit?", a: "Yes. The dashboard can deploy a project to Vercel, Netlify, Cloudflare, Render, GitHub Pages or a custom webhook. Environment variables you save are encrypted, and only decrypted at deploy time." },
    ],
  },
];

export default function FAQ() {
  const [cat, setCat] = useState(0);
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [dir, setDir] = useState(1);

  function selectCat(next: number) {
    setDir(next > cat ? 1 : -1);
    setCat(next);
    setOpenIdx(0);
  }

  const items = CATEGORIES[cat].items;

  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-20">
      <Reveal direction="up" className="mb-8 text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Frequently asked questions
        </h2>
      </Reveal>

      <Reveal direction="up" delay={0.05} className="mb-8 flex flex-wrap justify-center gap-2">
        {CATEGORIES.map((c, i) => (
          <button
            key={c.label}
            onClick={() => selectCat(i)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              cat === i
                ? "border-ink bg-ink text-bg"
                : "border-border text-ink-soft hover:bg-border-soft hover:text-ink"
            }`}
          >
            {c.label}
          </button>
        ))}
      </Reveal>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={cat}
            custom={dir}
            initial={{ opacity: 0, x: 32 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 * dir }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="divide-y divide-border-soft rounded-2xl border border-border bg-bg-elevated"
          >
            {items.map((item, i) => {
              const open = openIdx === i;
              return (
                <div key={item.q}>
                  <button
                    onClick={() => setOpenIdx(open ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-[15px] font-medium text-ink">{item.q}</span>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-ink-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-4 text-sm leading-relaxed text-ink-soft">{item.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
