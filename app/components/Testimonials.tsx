import ScrollFly from "./ScrollFly";

type Quote = {
  text: string;
  big?: boolean;
  pos: string; // explicit grid cell on desktop (full class names so Tailwind can see them)
  side: "left" | "right";
};

// Placeholder quotes — no real customers are quoted here.
// Desktop layout is a 2 × 5 grid: the two large cards each span two rows.
const QUOTES: Quote[] = [
  { text: "We had a checkout bug that came back every few weeks, and every time somebody burned half a day on it. DevAudit lumped all the instances together and pointed at one cause. Fixed it that afternoon. The write-up was already there Monday morning so I didn't have to chase anyone for a post-mortem, which is honestly half the reason we're sticking with it.", big: true, side: "left", pos: "lg:col-start-1 lg:row-start-1 lg:row-span-2" },
  { text: "First thing I open after a bad deploy now. Saves me scrolling through the diff trying to remember what went out.", side: "right", pos: "lg:col-start-2 lg:row-start-1" },
  { text: "On-call is less miserable. We used to get 40 pages for one dead dependency, now it's a single alert with a count next to it.", side: "right", pos: "lg:col-start-2 lg:row-start-2" },
  { text: "Honest answer: I didn't want another dashboard. I mostly just read the summaries it writes about the diff. Hotfix reviews go quicker. Can't give you a number.", side: "left", pos: "lg:col-start-1 lg:row-start-3" },
  { text: "We hired six people this spring and I pointed each of them at our old autopsies in week one. They work out why things are the way they are without pulling a senior person aside every time. I'd guess incident onboarding went from about a month to two weeks, though I haven't measured it properly. Setup took an afternoon, and most of that was us untangling our own repo.", big: true, side: "right", pos: "lg:col-start-2 lg:row-start-3 lg:row-span-2" },
  { text: "It flagged a guest checkout bug in a path we have zero tests for. The patch it suggested is basically what we merged. I renamed a variable.", side: "left", pos: "lg:col-start-1 lg:row-start-4" },
  { text: "We've got Go, Python and some Ruby nobody wants to touch. Same autopsy format for all of it, which makes triage a lot less annoying.", side: "left", pos: "lg:col-start-1 lg:row-start-5" },
  { text: "Closed out two of our three log tools last month. The live feed does what I was actually using them for.", side: "right", pos: "lg:col-start-2 lg:row-start-5" },
];

function Card({ q }: { q: Quote }) {
  return (
    <figure className="relative flex h-full flex-col justify-center overflow-hidden rounded-3xl border border-surface-dark-border bg-surface-dark p-6 sm:p-8">
      {q.big && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_70%)]"
        />
      )}

      <blockquote
        className={`relative text-surface-dark-ink ${
          q.big ? "text-xl font-medium leading-snug sm:text-2xl" : "text-sm leading-relaxed sm:text-[15px]"
        }`}
      >
        <p>“{q.text}”</p>
      </blockquote>
    </figure>
  );
}

export default function Testimonials() {
  return (
    <section className="mx-auto max-w-[1400px] px-4 pb-20 pt-4 sm:px-8 md:pb-32">
      <div className="grid gap-5 sm:gap-6 lg:auto-rows-[minmax(11rem,auto)] lg:grid-cols-2">
        {QUOTES.map((q, i) => (
          <ScrollFly key={i} from={q.side} className={`${q.pos} ${q.big ? "min-h-[16rem] lg:min-h-0" : ""}`}>
            <Card q={q} />
          </ScrollFly>
        ))}
      </div>
    </section>
  );
}
