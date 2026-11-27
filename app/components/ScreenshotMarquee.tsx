import Reveal from "./Reveal";

type Shot = { src: string; alt: string; caption: string };

const SHOTS: Shot[] = [
  { src: "/screenshots/shot-intro.png", alt: "DevAudit landing hero", caption: "See what broke, and exactly what changed." },
  { src: "/screenshots/shot-timeline.png", alt: "Push and error timeline", caption: "Every push and every error, on one timeline." },
  { src: "/screenshots/shot-autopsy.png", alt: "Autopsy of a checkout error", caption: "An autopsy for every failure, written the moment it happens." },
  { src: "/screenshots/shot-terminal.png", alt: "Live terminal with AI quick-fix", caption: "A quick-fix ready to apply, next to the log that found it." },
];
// Rendered twice back-to-back so a 50% translateX loop is seamless.
const LOOP = [...SHOTS, ...SHOTS];

function Card({ shot }: { shot: Shot }) {
  return (
    <div className="w-[220px] shrink-0 sm:w-[248px]">
      <div className="rounded-[26px] border border-border bg-bg-elevated p-2 shadow-sm">
        <div className="fade-bottom relative aspect-[9/17] overflow-hidden rounded-[20px] bg-surface-dark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.src} alt={shot.alt} className="h-full w-full object-cover object-top" draggable={false} />
        </div>
      </div>
      <p className="mt-3 px-1 text-[13px] leading-snug text-ink-soft">{shot.caption}</p>
    </div>
  );
}

export default function ScreenshotMarquee() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
      <Reveal direction="up" className="mb-10 max-w-xl">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          The product, in motion.
        </h2>
        <p className="mt-4 text-ink-soft">
          Every screen DevAudit shows your team, looping — from the first push to the finished autopsy.
        </p>
      </Reveal>

      <div className="marquee-pause -mx-4 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] sm:-mx-6">
        <div className="marquee-track flex w-max gap-5 pl-4 sm:gap-6 sm:pl-6" style={{ animationDuration: "34s" }}>
          {LOOP.map((shot, i) => (
            <Card key={i} shot={shot} />
          ))}
        </div>
      </div>
    </section>
  );
}
