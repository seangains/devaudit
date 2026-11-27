// The DevAudit mark: a person with a magnifying glass (someone being audited, closely).
// Light grey on dark, dark grey on light. It reads --da-logo inside the dashboard and --logo
// (globals.css) everywhere else, so one component serves both. Save as components/Logo.tsx: Navbar
// and Footer already import it from there.

const COLOR = "var(--da-logo, var(--logo, currentColor))";

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="DevAudit" className={className}>
      {/* head and shoulders; the shoulders are cut away in an arc around the lens */}
      <g fill={COLOR}>
        <circle cx="20.7" cy="11.1" r="11.05" />
        <path d="M22.2 25.4C13.5 25.4 6 27.2 2.4 30.2 .9 31.4 .2 32.4 .2 34V42.3A2.3 2.3 0 0 0 2.5 44.6H30A12.4 12.4 0 0 1 22.2 25.4Z" />
      </g>
      {/* magnifying glass */}
      <g stroke={COLOR} strokeWidth={3.05} strokeLinecap="round">
        <circle cx="32.4" cy="32.4" r="8.54" />
        <path d="M38.45 38.45 46.2 46.3" />
      </g>
    </svg>
  );
}

type LogoProps = { size?: number; className?: string; wordmark?: boolean } & Record<string, unknown>;

export default function Logo({ size = 28, className = "", wordmark = true }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      {wordmark && <span className="font-display text-[1.25rem] font-semibold tracking-tight text-ink">DevAudit</span>}
    </span>
  );
}
