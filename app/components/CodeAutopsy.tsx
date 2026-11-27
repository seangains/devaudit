"use client";
import { useState } from "react";
import Highlight from "./Highlight";
import Reveal from "./Reveal";
import { LogoMark } from "./Logo";

type Row = { n: number; t: " " | "-" | "+"; code: string; note?: string };
const ROWS: Row[] = [
  { n: 44, t: " ", code: "export async function checkout(cart: Cart) {" },
  { n: 45, t: " ", code: "  const user = await getUser(cart.userId);" },
  { n: 46, t: "-", code: "  const item = cart.items[0];", note: "Assumes the cart is never empty." },
  { n: 47, t: "-", code: "  return charge(item.id, cart.total);", note: "Crashes here when a guest session expires." },
  { n: 46, t: "+", code: "  const item = cart.items[0];" },
  { n: 47, t: "+", code: "  if (!item) throw new CartExpiredError(cart.id);", note: "Fails early with an error your UI can handle." },
  { n: 48, t: "+", code: "  return charge(item.id, cart.total);" },
  { n: 49, t: " ", code: "}" },
];
const bg = { " ": "", "-": "bg-diff-del-bg text-diff-del", "+": "bg-diff-add-bg text-diff-add" };

export default function CodeAutopsy() {
  const [fixedOnly, setFixedOnly] = useState(false);
  const rows = ROWS.filter((r) => !fixedOnly || r.t !== "-");
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 md:pb-32">
      <Reveal direction="up" className="mb-10 grid gap-6 md:grid-cols-[1fr_1.2fr] md:items-end">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl md:text-5xl">
          See what broke and exactly what changed.
        </h2>
        <p className="max-w-lg text-ink-soft md:justify-self-end">
          Every autopsy ends in a reviewable diff. Read the reasoning next to the line it applies to, then apply the
          patch or copy it into your own branch.
        </p>
      </Reveal>

      <Reveal direction="right">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-bg-elevated p-2 shadow-sm">
          <div className="fade-bottom relative overflow-hidden rounded-xl border border-surface-dark-border bg-surface-dark">
            {/* Custom window chrome, carrying the mark instead of generic dots-only */}
            <div className="flex items-center gap-3 border-b border-surface-dark-border px-4 py-2.5">
              <LogoMark size={16} />
              <span className="font-mono text-xs text-surface-dark-ink-soft">
                api/checkout.ts <span className="ml-2 text-emerald-400">+3</span>{" "}
                <span className="text-rose-400">−2</span>
              </span>
              <div className="ml-auto flex rounded-md border border-surface-dark-border p-0.5 font-mono text-xs">
                {["Diff", "Fixed"].map((l, i) => (
                  <button
                    key={l}
                    onClick={() => setFixedOnly(!!i)}
                    className={`rounded px-3 py-1 transition-colors duration-200 ${
                      fixedOnly === !!i
                        ? "bg-accent-cyan/20 text-accent-cyan"
                        : "text-surface-dark-ink-soft hover:text-surface-dark-ink"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto py-2 pb-20 font-mono text-xs leading-7 md:text-[13px]">
              {rows.map((r, i) => (
                <div
                  key={i}
                  className={`grid min-w-[480px] grid-cols-[2.5rem_1.25rem_1fr] md:min-w-[720px] md:grid-cols-[3rem_1.5rem_1fr_16rem] ${bg[r.t]}`}
                >
                  <span className="select-none pr-3 text-right text-surface-dark-ink-soft/50">{r.n}</span>
                  <span className="select-none text-center opacity-70">{r.t === " " ? "" : r.t}</span>
                  <pre className="whitespace-pre">
                    <Highlight line={r.code} />
                  </pre>
                  {r.note && (
                    <span className="col-start-3 pb-1.5 pr-4 font-sans text-xs italic leading-5 text-surface-dark-ink-soft/70 md:col-start-4 md:truncate md:pb-0">
                      {r.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal direction="up" delay={0.15} className="relative z-10 -mt-8 px-4">
        <h3 className="text-lg font-semibold text-ink">A patch, not just a warning</h3>
        <p className="mt-1.5 max-w-lg text-sm text-ink-soft">
          DevAudit doesn't stop at the stack trace — it proposes the fix, in your codebase's own style, ready to
          apply or copy into a review.
        </p>
      </Reveal>
    </section>
  );
}
