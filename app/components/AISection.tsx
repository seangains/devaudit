"use client";
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp, BookOpen, Check, Copy, FileCode2, FileText, History, Image as ImageIcon, Layers, Link2,
  MessageSquare, Paperclip, Plus, RotateCcw, SearchCheck, Sparkles, Trash2, Wrench, X, type LucideIcon,
} from "lucide-react";
import ScrollFly from "./ScrollFly";

// ---------------------------------------------------------------------------------------------
// Left-hand feature list
// ---------------------------------------------------------------------------------------------
type Feature = { id: string; icon: LucideIcon; title: string; body: string };
const FEATURES: Feature[] = [
  {
    id: "diagnose",
    icon: SearchCheck,
    title: "Finds the cause, not just the line",
    body: "Ask why something broke, or paste the error. It reads the file you have open and explains the cause in plain language.",
  },
  {
    id: "patch",
    icon: Wrench,
    title: "Writes the patch",
    body: "Proposes the fix as updated files you can preview, then apply to your project in one click. Nothing goes to GitHub until you sync.",
  },
  {
    id: "context",
    icon: Paperclip,
    title: "Sees what you see",
    body: "Attach a screenshot, a file or a link, or pin project files so the assistant always has them in view.",
  },
  {
    id: "ask",
    icon: MessageSquare,
    title: "Answers follow-ups",
    body: "Every chat is saved, so you can come back to it, ask what a change affects, or have it write the tests.",
  },
];

// One saved conversation per feature, shown in the mock's "Recent" list and header.
const CONVOS: Record<string, { title: string; meta: string }> = {
  diagnose: { title: "Why does checkout crash for guests?", meta: "2 messages · 2m ago" },
  patch: { title: "Fix it so checkout fails cleanly", meta: "2 messages · just now" },
  context: { title: "This is crashing for guests", meta: "2 messages · 1h ago" },
  ask: { title: "Will the guard affect signed-in users?", meta: "4 messages · 12m ago" },
};

const NAV: { label: string; icon: LucideIcon; count?: number }[] = [
  { label: "Chat", icon: MessageSquare },
  { label: "Recent chats", icon: History, count: 4 },
  { label: "Prompt library", icon: BookOpen },
  { label: "Attachments", icon: Paperclip },
  { label: "Project context", icon: Layers },
];

// ---------------------------------------------------------------------------------------------
// Pieces copied from the real modal (AiAssistantModal.tsx), scaled down
// ---------------------------------------------------------------------------------------------
const silver =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-b from-zinc-50 to-zinc-300 font-medium text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,.7),0_6px_16px_-8px_rgba(0,0,0,.8)]";

const IC = ({ children }: { children: ReactNode }) => (
  <code className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-100">{children}</code>
);

const You = ({ children, atts }: { children: ReactNode; atts?: ReactNode }) => (
  <div className="flex flex-col items-end gap-2">
    {atts}
    <p className="max-w-[88%] rounded-2xl rounded-br-md border border-zinc-700/70 bg-zinc-800/70 px-3.5 py-2 text-[13px] leading-6 text-zinc-100">
      {children}
    </p>
  </div>
);

const Reply = ({ ago, last = false, children }: { ago: string; last?: boolean; children: ReactNode }) => (
  <div className="flex items-start gap-3">
    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-zinc-700/70 bg-zinc-800/50 text-zinc-100">
      <Sparkles size={13} />
    </span>
    <div className="min-w-0 flex-1">
      <div className="space-y-2.5 text-[13px] leading-[1.7] text-zinc-200">{children}</div>
      <div className="-ml-2 mt-1.5 flex items-center text-[11px] font-medium text-zinc-400">
        <span className="inline-flex items-center gap-1.5 px-2 py-1"><Copy size={11} />Copy</span>
        {last && <span className="inline-flex items-center gap-1.5 px-2 py-1"><RotateCcw size={11} />Regenerate</span>}
        <span className="ml-auto font-normal text-zinc-600">{ago}</span>
      </div>
    </div>
  </div>
);

const Bullets = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-5 marker:text-zinc-500">
    {items.map((it, i) => <li key={i}>{it}</li>)}
  </ul>
);

const CodeBlock = ({ lang, lines }: { lang: string; lines: string[] }) => (
  <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0d0d0f]">
    <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-1">
      <span className="text-[11px] font-medium text-zinc-500">{lang}</span>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-400"><Copy size={11} />Copy</span>
    </div>
    <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-5 text-zinc-300"><code>{lines.join("\n")}</code></pre>
  </div>
);

// The green "Suggested changes" card that sits under a reply with proposed files.
const Changes = ({ files }: { files: { path: string; lines: number }[] }) => (
  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5">
    <p className="flex items-center gap-2 text-[12px] font-medium text-emerald-300">
      <FileCode2 size={14} />Suggested changes to {files.length} file{files.length === 1 ? "" : "s"}
    </p>
    <div className="mt-2.5 space-y-2">
      {files.map((f) => (
        <div key={f.path} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[12px] text-zinc-200">
          <span className="truncate font-medium">{f.path}</span>
          <span className="shrink-0 text-zinc-500">{f.lines} lines · preview</span>
        </div>
      ))}
    </div>
    <span className={`${silver} mt-3 px-4 py-2 text-[12px]`}>
      <Check size={13} />Apply {files.length} file change{files.length === 1 ? "" : "s"}
    </span>
  </div>
);

// Attachment chips, as shown above a sent message.
const Chip = ({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) => (
  <div className="flex max-w-[12rem] items-center gap-2.5 rounded-xl border border-zinc-700/80 bg-zinc-900/60 px-3 py-2">
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-300"><Icon size={13} /></span>
    <span className="min-w-0">
      <span className="block truncate text-[12px] font-medium text-zinc-100">{title}</span>
      <span className="block truncate text-[10px] text-zinc-500">{sub}</span>
    </span>
  </div>
);

const Attachments = () => (
  <div className="flex flex-wrap justify-end gap-2">
    <div className="overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900">
      <div className="h-14 w-24 space-y-1.5 bg-zinc-950 p-2">
        <div className="h-1.5 w-16 rounded bg-red-400/60" />
        <div className="h-1.5 w-20 rounded bg-zinc-700" />
        <div className="h-1.5 w-12 rounded bg-zinc-700" />
      </div>
      <p className="max-w-[6rem] truncate px-2 py-1 text-[10px] text-zinc-400">checkout-error.png</p>
    </div>
    <Chip icon={FileText} title="cart.ts" sub="1.8 KB" />
    <Chip icon={Link2} title="docs.example.com" sub="https://docs.example.com/checkout" />
  </div>
);

// ---------------------------------------------------------------------------------------------
// Chat content for each feature
// ---------------------------------------------------------------------------------------------
const PANELS: Record<string, ReactNode> = {
  diagnose: (
    <>
      <You>Why does checkout crash for guests?</You>
      <Reply ago="2m ago" last>
        <p>
          Guest carts expire after 15 minutes, but <IC>checkout()</IC> never re-checks the cart. When the session
          lapses mid-checkout, <IC>cart.items[0]</IC> is <IC>undefined</IC> and the next line throws.
        </p>
        <Bullets
          items={[
            <>Only guests hit this, because signed-in carts don&apos;t expire.</>,
            <>The line that fails is <IC>item.id</IC> in <IC>api/checkout.ts</IC>.</>,
          ]}
        />
        <p>Want me to write the fix?</p>
      </Reply>
    </>
  ),
  patch: (
    <>
      <You>Fix it so checkout fails cleanly.</You>
      <Reply ago="just now" last>
        <p>Add a guard before charging, so an expired cart throws an error your UI can already handle:</p>
        <CodeBlock
          lang="ts"
          lines={["if (!item) throw new CartExpiredError(cart.id);", "return charge(item.id, cart.total);"]}
        />
        <Changes files={[{ path: "api/checkout.ts", lines: 52 }]} />
      </Reply>
    </>
  ),
  context: (
    <>
      <You atts={<Attachments />}>This is crashing for guests. What&apos;s going on?</You>
      <Reply ago="1h ago" last>
        <p>
          The screenshot shows a <IC>TypeError</IC> on <IC>item.id</IC>, and <IC>cart.ts</IC> explains why:{" "}
          <IC>getCart()</IC> returns an empty <IC>items</IC> array once a guest session expires.
        </p>
        <p>The guide you linked doesn&apos;t cover that case, so the check has to live in your own code.</p>
      </Reply>
    </>
  ),
  ask: (
    <>
      <You>Will the guard affect signed-in users?</You>
      <Reply ago="12m ago">
        <p>
          No. Signed-in carts never expire, so <IC>item</IC> is always defined and the new line is skipped. Only
          expired guest carts reach the <IC>throw</IC>.
        </p>
      </Reply>
      <You>Write a test for it.</You>
      <Reply ago="12m ago" last>
        <p>Here&apos;s one for the expired-cart case:</p>
        <CodeBlock
          lang="ts"
          lines={[
            'it("throws when the guest cart expired", () => {',
            "  expect(() => checkout(expiredCart)).toThrow(CartExpiredError);",
            "});",
          ]}
        />
      </Reply>
    </>
  ),
};

// ---------------------------------------------------------------------------------------------
// The mock window
// ---------------------------------------------------------------------------------------------
function Rail({ activeId }: { activeId: string }) {
  return (
    <aside className="hidden w-44 shrink-0 flex-col border-r border-zinc-800/80 bg-[#0d0d0f] sm:flex">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-zinc-50 to-zinc-300 text-zinc-900">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-zinc-50">DevAudit AI</p>
          <p className="truncate text-[10.5px] text-zinc-500">storefront</p>
        </div>
      </div>
      <div className="px-3">
        <span className={`${silver} w-full py-2 text-[12px]`}><Plus size={14} />New chat</span>
      </div>
      <nav className="mt-3 space-y-1 px-2.5">
        {NAV.map((n, i) => (
          <span
            key={n.label}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium ${
              i === 0 ? "bg-zinc-800/70 text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]" : "text-zinc-400"
            }`}
          >
            <n.icon size={14} />
            <span className="flex-1">{n.label}</span>
            {n.count ? <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{n.count}</span> : null}
          </span>
        ))}
      </nav>
      <div className="mt-4 flex min-h-0 flex-1 flex-col px-2.5">
        <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[.16em] text-zinc-600">Recent</p>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
          {Object.entries(CONVOS).map(([id, c]) => (
            <li
              key={id}
              className={`truncate rounded-md px-3 py-1.5 text-[11.5px] transition-colors duration-200 ${
                id === activeId ? "bg-zinc-800/50 text-zinc-100" : "text-zinc-500"
              }`}
            >
              {c.title}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-zinc-800/80 px-4 py-3">
        <p className="truncate text-[10.5px] text-zinc-500">3 files in project</p>
        <p className="truncate text-[10.5px] text-zinc-600">Open: api/checkout.ts</p>
      </div>
    </aside>
  );
}

function Composer() {
  return (
    <div className="shrink-0 px-3 pb-3 pt-1 sm:px-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-2.5">
        <p className="px-2 py-1.5 text-[13px] text-zinc-600">Ask anything about api/checkout.ts…</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-zinc-800 text-zinc-400"><Plus size={15} /></span>
            <span className="grid h-8 w-8 place-items-center text-zinc-500"><ImageIcon size={14} /></span>
            <span className="grid h-8 w-8 place-items-center text-zinc-500"><Link2 size={14} /></span>
            <span className="grid h-8 w-8 place-items-center text-zinc-500"><Paperclip size={14} /></span>
          </div>
          <span className={`${silver} px-4 py-2 text-[12px] opacity-40`}><ArrowUp size={14} strokeWidth={2.5} />Send</span>
        </div>
      </div>
      <p className="mt-2 text-center text-[10.5px] leading-4 text-zinc-600">
        The assistant can make mistakes. Suggested file changes are only applied when you press Apply.
      </p>
    </div>
  );
}

export default function AISection() {
  const [active, setActive] = useState(0);
  const f = FEATURES[active];
  const convo = CONVOS[f.id];

  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-4 sm:px-6 md:pb-32">
      <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <ScrollFly from="left">
          <ul className="space-y-2">
            {FEATURES.map((x, i) => (
              <li key={x.id}>
                <button
                  onClick={() => setActive(i)}
                  aria-pressed={i === active}
                  className={`w-full rounded-xl border p-4 text-left transition-colors duration-200 ${
                    i === active ? "border-accent-cyan/40 bg-bg-elevated" : "border-transparent hover:bg-bg-elevated/60"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <x.icon size={18} className={i === active ? "text-accent-cyan" : "text-ink-faint"} />
                    <span className="font-semibold text-ink">{x.title}</span>
                  </span>
                  <span className={`grid transition-[grid-template-rows] duration-300 ${i === active ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <span className="overflow-hidden">
                      <span className="block pl-[30px] pt-2 text-sm text-ink-soft">{x.body}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollFly>

        <ScrollFly from="right">
          <div className="rounded-2xl border border-border bg-bg-elevated p-2 shadow-sm">
            <div className="flex h-[36rem] overflow-hidden rounded-xl border border-zinc-800 bg-[#131315] sm:h-[38rem]">
              <Rail activeId={f.id} />
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-zinc-50">{convo.title}</p>
                    <p className="truncate text-[11px] text-zinc-500">{convo.meta}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-zinc-800 text-zinc-400"><Trash2 size={13} /></span>
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-zinc-800 text-zinc-400"><X size={14} /></span>
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={f.id}
                      className="space-y-5"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                    >
                      {PANELS[f.id]}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <Composer />
              </div>
            </div>
          </div>
        </ScrollFly>
      </div>
    </section>
  );
}
