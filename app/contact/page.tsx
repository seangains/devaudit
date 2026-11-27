"use client";
import { useState } from "react";
import { MessageCircle, Copy, Check, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

// Direct contact only, for now — no support inbox or socials set up yet.
const DISCORD_USER_ID = "1448344807893369007";

export default function ContactPage() {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(DISCORD_USER_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard API unavailable — the ID is still selectable as plain text
    }
  }

  return (
    <main>
      <Navbar />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal direction="up">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">Contact</h1>
          <p className="mt-4 text-ink-soft">
            The fastest way to reach me right now is Discord
          </p>
        </Reveal>

        <Reveal direction="up" delay={0.05} className="mt-10">
          <div className="rounded-2xl border border-border bg-bg-elevated p-6 sm:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">
              <MessageCircle size={22} />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold text-ink">Message me on Discord</h2>
            <p className="mt-1.5 max-w-md text-sm text-ink-soft">
              Open my profile in Discord, or copy my user ID and add me directly.
            </p>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <a
                href={`https://discord.com/users/${DISCORD_USER_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-bg transition-transform duration-200 hover:opacity-90 active:scale-[0.97]"
              >
                Open in Discord <ExternalLink size={14} />
              </a>
              <button
                type="button"
                onClick={copyId}
                className="flex items-center justify-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-200 hover:bg-border-soft"
              >
                {copied ? (
                  <>
                    <Check size={14} className="text-emerald-500" /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy user ID
                  </>
                )}
              </button>
            </div>

            <p className="mt-4 select-all font-mono text-xs text-ink-faint">{DISCORD_USER_ID}</p>
          </div>
        </Reveal>
      </section>
      <Footer />
    </main>
  );
}
