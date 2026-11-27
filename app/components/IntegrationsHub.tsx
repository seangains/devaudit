"use client";
import {
  Github,
  Slack,
  Terminal,
  Cloud,
  Webhook,
  KanbanSquare,
  BellRing,
  BarChart3,
  MessageSquare,
  Container,
} from "lucide-react";
import Reveal from "./Reveal";
import { LogoMark } from "./Logo";

const RING_1 = [
  { icon: Github, label: "GitHub" },
  { icon: KanbanSquare, label: "Linear" },
  { icon: Slack, label: "Slack" },
  { icon: Webhook, label: "Webhooks" },
];
const RING_2 = [
  { icon: Cloud, label: "AWS" },
  { icon: Container, label: "Docker" },
  { icon: BarChart3, label: "Datadog" },
  { icon: BellRing, label: "PagerDuty" },
  { icon: Terminal, label: "CLI" },
  { icon: MessageSquare, label: "Discord" },
];

function Ring({
  items,
  radius,
  duration,
  reverse,
  iconSize,
}: {
  items: { icon: typeof Github; label: string }[];
  radius: number;
  duration: number;
  reverse?: boolean;
  iconSize: number;
}) {
  const n = items.length;
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{
        width: radius * 2,
        height: radius * 2,
        marginLeft: -radius,
        marginTop: -radius,
        animation: `${reverse ? "orbit-spin-reverse" : "orbit-spin"} ${duration}s linear infinite`,
      }}
    >
      {items.map((item, i) => {
        const angle = (i / n) * 2 * Math.PI;
        const x = radius + radius * Math.cos(angle);
        const y = radius + radius * Math.sin(angle);
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="absolute grid place-items-center rounded-2xl border border-border bg-bg-elevated shadow-sm"
            style={{
              width: iconSize,
              height: iconSize,
              left: x - iconSize / 2,
              top: y - iconSize / 2,
              animation: `${reverse ? "orbit-spin" : "orbit-spin-reverse"} ${duration}s linear infinite`,
              animationDelay: "0s",
              opacity: 0.85,
            }}
            title={item.label}
          >
            <Icon size={iconSize * 0.42} className="text-ink-soft" />
          </div>
        );
      })}
    </div>
  );
}

export default function IntegrationsHub() {
  return (
    <section id="architecture" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <Reveal direction="up" className="mb-6 text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Sits in the middle of your stack.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-ink-soft">
          DevAudit doesn't replace the tools your team already relies on — it listens to them.
        </p>
      </Reveal>

      <Reveal direction="scale" delay={0.1}>
        <div className="relative mx-auto flex h-[280px] w-full max-w-lg items-center justify-center sm:h-[360px]">
          <div
            aria-hidden
            className="pointer-events-none absolute h-40 w-40 rounded-full bg-accent-cyan/15 blur-[70px] sm:h-56 sm:w-56"
          />
          <div
            aria-hidden
            className="absolute rounded-full border border-dashed border-border"
            style={{ width: 300, height: 300 }}
          />
          <div
            aria-hidden
            className="absolute rounded-full border border-dashed border-border"
            style={{ width: 180, height: 180 }}
          />

          <Ring items={RING_2} radius={150} duration={46} iconSize={46} />
          <Ring items={RING_1} radius={90} duration={30} reverse iconSize={52} />

          <div className="relative z-10 grid h-20 w-20 place-items-center rounded-3xl border border-border bg-bg-elevated shadow-lg sm:h-24 sm:w-24">
            <LogoMark size={40} />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
