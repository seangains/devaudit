"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";

/* ---------- Desktop views of the site, drawn inside a browser frame ----------
   Want real screenshots instead? Give a shot a `src` (e.g. "/screenshots/desktop-feed.png")
   and it is used in place of the built-in preview. */

const mono = "font-mono text-[9px] leading-5 sm:text-[11px] sm:leading-6";

function CliView() {
  // Straight from `devaudit --help`
  const cmds: [string, string][] = [
    ["login [options]", "Log in via your browser (default), or with an API token."],
    ["init", "Detect your stack and generate a devaudit.config.json in the current repo."],
    ["list", "List repos connected to your account."],
    ["errors [options]", "List recent errors across your connected repos."],
    ["status [options]", "Summarize connected repos and open errors."],
    ["fix <errorId>", "Apply the AI-suggested fix for an error as a commit on a new branch."],
  ];
  return (
    <div className={`${mono} p-4`}>
      <p className="text-surface-dark-ink-soft/70">$ devaudit --help</p>
      {cmds.map(([c, d]) => (
        <div key={c} className="flex gap-2">
          <span className="w-[17ch] shrink-0 text-surface-dark-ink">{c}</span>
          <span className="truncate text-surface-dark-ink-soft">{d}</span>
        </div>
      ))}
    </div>
  );
}

function ErrorsView() {
  // Same shape `devaudit errors` prints: id  repo  file:line  message
  const rows: [string, string, string, string][] = [
    ["b82e4d10", "northwind/web", "app/checkout/page.tsx:48", "TypeError: Cannot read properties of undefined (reading 'id')"],
    ["3f9a1c07", "northwind/web", "src/lib/session.ts:112", "UnhandledPromiseRejection: 401 from /api/session"],
    ["5c07ea93", "northwind/worker", "jobs/invoice.ts:203", "Error: connect ETIMEDOUT 10.0.4.17:5432"],
    ["91d2b6f4", "northwind/web", "components/Cart.tsx:77", "ReferenceError: price is not defined"],
    ["e07a38bc", "northwind/api", "routes/webhooks.ts:31", "SyntaxError: Unexpected token < in JSON at position 0"],
    ["0d6c51aa", "northwind/worker", "jobs/export.ts:59", "RangeError: Maximum call stack size exceeded"],
  ];
  return (
    <div className={`${mono} p-4`}>
      <p className="text-surface-dark-ink-soft/70">$ devaudit errors</p>
      {rows.map(([id, repo, loc, msg]) => (
        <div key={id} className="overflow-hidden text-ellipsis whitespace-pre">
          <span className="font-semibold text-surface-dark-ink">{id}</span>
          <span className="text-surface-dark-ink-soft">{"  "}{repo}{"  "}{loc}{"  "}</span>
          <span className="text-surface-dark-ink">{msg}</span>
        </div>
      ))}
    </div>
  );
}

function FixView() {
  // Same lines `devaudit fix <errorId>` prints (see fix.js); values are placeholders
  const sha = "7c2e91d4a8f03b65e1d9c4a72b0f58e36d1a94cb";
  return (
    <div className={`${mono} p-4`}>
      <p className="truncate text-surface-dark-ink-soft/70">$ devaudit fix b82e4d10</p>
      <p className="truncate text-surface-dark-ink-soft/70">Working on a fix — this can take a moment if the AI has to write it...</p>
      <p className="truncate text-surface-dark-ink">
        <span className="text-emerald-400">✓ </span>Committed to <span className="font-semibold">devaudit/fix-b82e4d10</span>
      </p>
      <p className="truncate text-surface-dark-ink">AI fix: cart.items[0] is undefined when a guest cart expires mid-checkout. Added a guard before charge().</p>
      <p className="truncate text-surface-dark-ink">
        Commit: <span className="text-surface-dark-ink-soft/70">{sha}</span>
      </p>
      <p className="truncate text-surface-dark-ink">
        View: <span className="text-accent-cyan">https://github.com/northwind/web/commit/{sha}</span>
      </p>
      <p className="truncate text-surface-dark-ink-soft/70">{"Open a pull request from that branch when you're ready to merge it."}</p>
    </div>
  );
}

function SecureView() {
  const codeCls = "rounded bg-surface-dark-2 px-1 py-0.5 font-mono text-[10px] text-surface-dark-ink sm:text-xs";
  return (
    <div className="p-4">
      <p className="text-sm font-semibold text-surface-dark-ink">Security</p>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-5 text-surface-dark-ink-soft sm:text-sm sm:leading-6">
        <li>Secrets encrypted at rest (AES-256-GCM)</li>
        <li>API tokens stored only as hashes</li>
        <li>GitHub token kept on the server</li>
      </ul>
      <div className="mt-3 max-w-md space-y-2 text-[11px] leading-5 text-surface-dark-ink-soft sm:text-sm sm:leading-6">
        <p>
          Log in through your browser or with an API token. <code className={codeCls}>devaudit whoami</code> checks
          the stored token and <code className={codeCls}>devaudit logout</code> forgets it.
        </p>
        <p>
          <code className={codeCls}>devaudit fix</code> applies a suggested fix as a commit on a new branch.
        </p>
      </div>
    </div>
  );
}

function StartView() {
  // Built only from commands in `devaudit --help`; no output is shown
  const steps: [string, string][] = [
    ["install", "npm install devaudit-cli"],
    ["sign in through your browser", "devaudit login"],
    ["detect your stack and write devaudit.config.json", "devaudit init"],
    ["list recent errors across your repos", "devaudit errors"],
    ["apply the suggested fix on a new branch", "devaudit fix <errorId>"],
  ];
  return (
    <div className={`${mono} space-y-2 p-4`}>
      {steps.map(([note, cmd]) => (
        <div key={cmd}>
          <p className="truncate text-surface-dark-ink-soft/70"># {note}</p>
          <p className="truncate">
            <span className="text-surface-dark-ink-soft/70">$ </span>
            <span className="text-surface-dark-ink">{cmd}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

/* ---------- The stack ---------- */

type Shot = {
  url: string;
  alt: string;
  side: -1 | 1; // which bottom corner it flies in from
  x: number; // resting offset, % of card width
  y: number; // resting offset, % of card height
  r: number; // resting rotation, deg
  preview: ReactNode;
  src?: string;
};

const SHOTS: Shot[] = [
  { url: "npm install devaudit-cli", alt: "DevAudit CLI commands", side: -1, x: -38, y: -30, r: -4, preview: <CliView /> },
  { url: "npm install devaudit-cli", alt: "devaudit errors output", side: 1, x: 36, y: -22, r: 3, preview: <ErrorsView /> },
  { url: "npm install devaudit-cli", alt: "Compliance panel", side: -1, x: -26, y: 20, r: -2, preview: <SecureView /> },
  { url: "npm install devaudit-cli", alt: "Quickstart commands", side: 1, x: 28, y: 26, r: 2.5, preview: <StartView /> },
  { url: "npm install devaudit-cli", alt: "devaudit fix output", side: -1, x: 0, y: 2, r: 0, preview: <FixView /> },
];

/* ---------- How the motion works ----------
   Scroll no longer drives the cards directly. Scrolling only decides which "stage" we're at:
     stage 0      -> empty
     stage 1..n   -> card 1..n has flown in
     stage n+1    -> everything has flown out
   A spring then animates one shared `stage` value toward that target over time. So one nudge past
   a threshold plays a card's whole swoop smoothly, no matter how notchy the wheel or trackpad is.
   Tuning:
     SPRING        -> feel of the swoop (lower stiffness = slower and floatier; keep damping ~ 2*sqrt(stiffness)
                      or a bit above, so it never overshoots)
     SCROLL_START  -> how far in before the first card flies in
     SCROLL_EXIT   -> where the exit is triggered (the cards hold in a stack between the last card and here)
     section height (h-[...vh] below) -> how much scrolling each card needs */

const SPRING = { type: "spring", stiffness: 70, damping: 18, mass: 1, restDelta: 0.001 } as const;
const SCROLL_START = 0.03;
const SCROLL_EXIT = 0.88;

function Frame({ shot }: { shot: Shot }) {
  return (
    <div className="overflow-hidden rounded-xl border border-surface-dark-border bg-surface-dark shadow-2xl shadow-black/40">
      <div className="flex items-center gap-3 border-b border-surface-dark-border px-3 py-2">
        <span className="mx-auto w-2/3 truncate rounded-md bg-surface-dark-2 px-3 py-0.5 text-center font-mono text-[9px] text-surface-dark-ink-soft sm:text-[10px]">
          {shot.url}
        </span>
      </div>
      <div className="fade-bottom relative aspect-[16/9.5] overflow-hidden">
        {shot.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.src} alt={shot.alt} className="h-full w-full object-cover object-top" draggable={false} />
        ) : (
          shot.preview
        )}
      </div>
    </div>
  );
}

function Card({ shot, i, n, t, k }: { shot: Shot; i: number; n: number; t: MotionValue<number>; k: { x: number; y: number } }) {
  // `t` is the spring-driven stage (0 .. n + 1)
  const a = i; // starts flying in
  const b = i + 1; // settled
  const c = n + 0.05 + (n - 1 - i) * 0.1; // starts leaving (front card first)
  const d = c + 0.45; // gone
  const rx = shot.x * k.x;
  const ry = shot.y * k.y;
  const s = shot.side;

  const x = useTransform(t, [a, b, c, d], [`${s * 170}%`, `${rx}%`, `${rx}%`, `${rx + s * 40}%`]);
  const y = useTransform(t, [a, b, c, d], ["260%", `${ry}%`, `${ry}%`, `${ry - 150}%`]);
  const rotate = useTransform(t, [a, b, c, d], [s * 10, shot.r, shot.r, shot.r + s * 6]);
  const scale = useTransform(t, [a, b, c, d], [0.85, 1, 1, 0.88]);
  const opacity = useTransform(t, [a, a + 0.3, c, c + 0.3], [0, 1, 1, 0]);

  return (
    <motion.div
      style={{ x, y, rotate, scale, opacity, zIndex: i + 1 }}
      className="col-start-1 row-start-1 w-[86vw] will-change-transform md:w-[min(58vw,680px)]"
    >
      <Frame shot={shot} />
    </motion.div>
  );
}

export default function ScrollStack() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [mobile, setMobile] = useState(false);

  const n = SHOTS.length;
  const gap = (SCROLL_EXIT - SCROLL_START) / n; // scroll distance between stage changes

  const t = useMotionValue(0); // the spring-driven stage
  const stage = useRef(0); // the stage we are currently animating toward
  const anim = useRef<ReturnType<typeof animate> | null>(null);

  const goTo = (progress: number) => {
    const next = progress < SCROLL_START ? 0 : Math.min(n + 1, Math.floor((progress - SCROLL_START) / gap) + 1);
    if (next === stage.current) return;
    stage.current = next;
    anim.current?.stop(); // a spring retarget keeps its velocity, so reversing mid-swoop stays smooth
    anim.current = animate(t, next, SPRING);
  };

  useMotionValueEvent(p, "change", goTo);

  useEffect(() => {
    goTo(p.get()); // handles loading or refreshing partway down the section
    return () => anim.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const f = () => setMobile(q.matches);
    f();
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, []);

  // Reduced motion: no scroll choreography, just a tidy grid.
  if (reduce) {
    return (
      <section aria-label="DevAudit product screens" className="mx-auto grid max-w-6xl gap-6 px-4 pb-20 sm:px-6 md:grid-cols-2">
        {SHOTS.map((s) => (
          <Frame key={s.alt} shot={s} />
        ))}
      </section>
    );
  }

  const k = mobile ? { x: 0.3, y: 1.7 } : { x: 1, y: 1 };
  return (
    <section ref={ref} aria-label="DevAudit product screens" className="relative h-[320vh] md:h-[360vh]">
      <div className="sticky top-0 grid h-screen place-items-center overflow-hidden">
        {SHOTS.map((shot, i) => (
          <Card key={`${i}-${mobile}`} shot={shot} i={i} n={n} t={t} k={k} />
        ))}
      </div>
    </section>
  );
}
