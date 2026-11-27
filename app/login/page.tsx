"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Poppins } from "next/font/google";
import { Loader2, AlertCircle, ArrowLeft, ShieldCheck, Sparkles, Rocket, Bug, CheckCircle2, FlaskConical } from "lucide-react";
import { supabase } from "@/utils/supabase";
import { LogoMark } from "@/components/Logo";

// Poppins for every word on the page, same as the dashboard.
const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], display: "swap", variable: "--font-poppins" });

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const FEATURES = [
  { icon: Bug, title: "Errors caught for you", text: "Crashes are logged automatically, with the file and line." },
  { icon: Sparkles, title: "An AI that explains and fixes", text: "Ask about your code, or let it suggest the fix." },
  { icon: Rocket, title: "Deploy where you like", text: "Vercel, Netlify, Cloudflare, Render or GitHub Pages." },
];

// Scoped styles: the liquid background, the entrance animations and the button sheen.
const CSS = `
.lg-root{position:relative;min-height:100vh;min-height:100dvh;overflow:hidden;background:#05060b;color:#fff}
.lg-art{position:absolute;inset:0;overflow:hidden;z-index:0;background:
  radial-gradient(120% 90% at 85% 10%,rgba(99,102,241,.22),transparent 60%),
  radial-gradient(100% 80% at 0% 100%,rgba(34,211,238,.16),transparent 60%),
  linear-gradient(160deg,#07080f 0%,#0a0c18 55%,#05060b 100%)}
.lg-blob{position:absolute;border-radius:9999px;filter:blur(70px);mix-blend-mode:screen;will-change:transform;opacity:.9}
.lg-b1{width:54vmax;height:54vmax;left:-14vmax;top:-18vmax;background:radial-gradient(circle at 35% 35%,#22d3ee 0%,rgba(34,211,238,.0) 68%);animation:lg-f1 26s ease-in-out infinite alternate}
.lg-b2{width:48vmax;height:48vmax;right:-12vmax;top:-8vmax;background:radial-gradient(circle at 60% 40%,#6366f1 0%,rgba(99,102,241,0) 66%);animation:lg-f2 30s ease-in-out infinite alternate}
.lg-b3{width:44vmax;height:44vmax;left:18vmax;bottom:-22vmax;background:radial-gradient(circle at 50% 50%,#d946ef 0%,rgba(217,70,239,0) 64%);opacity:.55;animation:lg-f3 34s ease-in-out infinite alternate}
.lg-b4{width:38vmax;height:38vmax;right:6vmax;bottom:-16vmax;background:radial-gradient(circle at 50% 50%,#38bdf8 0%,rgba(56,189,248,0) 66%);opacity:.6;animation:lg-f4 28s ease-in-out infinite alternate}
.lg-b5{width:26vmax;height:26vmax;left:34%;top:22%;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.55) 0%,rgba(255,255,255,0) 66%);opacity:.18;animation:lg-f5 24s ease-in-out infinite alternate}
.lg-marble{position:absolute;inset:-12%;width:124%;height:124%;mix-blend-mode:screen;opacity:.30;will-change:transform;animation:lg-drift 60s ease-in-out infinite alternate}
.lg-marble.lg-m2{opacity:.20;animation-duration:80s;animation-direction:alternate-reverse}
.lg-grid{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.22) 1px,transparent 1.4px);background-size:30px 30px;
  -webkit-mask-image:radial-gradient(75% 75% at 35% 45%,#000 0%,transparent 100%);mask-image:radial-gradient(75% 75% at 35% 45%,#000 0%,transparent 100%);opacity:.55}
.lg-lines{position:absolute;inset:0;opacity:.35;background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0 1px,transparent 1px 90px);
  -webkit-mask-image:linear-gradient(90deg,#000,transparent 70%);mask-image:linear-gradient(90deg,#000,transparent 70%)}
.lg-grain{position:absolute;inset:0;opacity:.07;mix-blend-mode:overlay;pointer-events:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.lg-vignette{position:absolute;inset:0;background:radial-gradient(130% 100% at 50% 40%,transparent 55%,rgba(0,0,0,.55) 100%)}
@keyframes lg-f1{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(14vmax,10vmax,0) scale(1.18)}}
@keyframes lg-f2{0%{transform:translate3d(0,0,0) scale(1.05)}100%{transform:translate3d(-12vmax,14vmax,0) scale(.88)}}
@keyframes lg-f3{0%{transform:translate3d(0,0,0) scale(.95)}100%{transform:translate3d(18vmax,-12vmax,0) scale(1.2)}}
@keyframes lg-f4{0%{transform:translate3d(0,0,0) scale(1.1)}100%{transform:translate3d(-16vmax,-8vmax,0) scale(.9)}}
@keyframes lg-f5{0%{transform:translate3d(-6vmax,-4vmax,0)}100%{transform:translate3d(10vmax,8vmax,0)}}
@keyframes lg-drift{0%{transform:translate3d(-3%,-2%,0) rotate(0deg) scale(1)}100%{transform:translate3d(3%,3%,0) rotate(8deg) scale(1.08)}}
@keyframes lg-rise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes lg-card{from{opacity:0;transform:translateY(28px) scale(.97)}to{opacity:1;transform:none}}
@keyframes lg-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
@keyframes lg-caret{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes lg-shine{0%{transform:translateX(-130%)}60%,100%{transform:translateX(130%)}}
.lg-rise{animation:lg-rise .8s cubic-bezier(.16,1,.3,1) backwards}
.lg-card{animation:lg-card .9s cubic-bezier(.16,1,.3,1) .12s backwards}
.lg-bob{animation:lg-bob 7s ease-in-out infinite}
.lg-caret{animation:lg-caret 1.1s steps(1) infinite}
.lg-silver{background-image:linear-gradient(180deg,#ffffff 15%,#aeb6c6 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.lg-glass{background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 60px -30px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.lg-btn{position:relative;overflow:hidden;isolation:isolate}
.lg-btn::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);transform:translateX(-130%)}
.lg-btn:hover:not(:disabled)::after{animation:lg-shine 1s cubic-bezier(.16,1,.3,1)}
@media (prefers-reduced-motion:reduce){.lg-root *,.lg-root *::before,.lg-root *::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
@media (max-height:980px){.lg-health{display:none}}
@media (max-width:640px){.lg-b3,.lg-b5,.lg-marble.lg-m2{display:none}.lg-blob{filter:blur(50px)}}
`;

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  // Already signed in? Skip this screen. Every "Get started" / "Login" link on the site points
  // here, so without this check a signed-in visitor lands on the sign-in card and has to go
  // through GitHub a second time. getSession() waits for Supabase to finish reading any OAuth
  // tokens out of the URL, so a sign-in that has just completed is seen as well.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || !session || redirected.current) return;
      redirected.current = true;
      setRedirecting(true);
      router.replace("/dashboard");
    });
    return () => { active = false; };
  }, [router]);

  // Restore the button if the user returns via the browser's back button.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function signInWithGithub() {
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: `${window.location.origin}/dashboard`, scopes: "repo" },
      });
      if (error) throw error;
      // On success the browser navigates to GitHub, so we keep the loading state.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className={`lg-root ${poppins.className} ${poppins.variable}`}>
      <style>{CSS}</style>

      {/* ---------- Liquid, patterned background ---------- */}
      <div className="lg-art" aria-hidden>
        <svg width="0" height="0" className="absolute">
          <defs>
            <filter id="lg-marble-a" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.0042 0.0058" numOctaves="3" seed="11" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.13  0 0 0 0 0.83  0 0 0 0 0.93  2.6 0 0 0 -1.05" />
            </filter>
            <filter id="lg-marble-b" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.0050 0.0068" numOctaves="3" seed="37" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.45  0 0 0 0 0.98  2.6 0 0 0 -1.12" />
            </filter>
          </defs>
        </svg>
        <div className="lg-blob lg-b1" />
        <div className="lg-blob lg-b2" />
        <div className="lg-blob lg-b3" />
        <div className="lg-blob lg-b4" />
        <div className="lg-blob lg-b5" />
        <svg className="lg-marble" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><rect width="1600" height="1000" filter="url(#lg-marble-a)" /></svg>
        <svg className="lg-marble lg-m2" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><rect width="1600" height="1000" filter="url(#lg-marble-b)" /></svg>
        <div className="lg-lines" />
        <div className="lg-grid" />
        <div className="lg-vignette" />
        <div className="lg-grain" />
      </div>

      {/* ---------- Content ---------- */}
      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-[96rem] items-center gap-10 px-5 py-8 sm:px-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:px-16 xl:px-24" style={{ minHeight: "100dvh" }}>
        {/* Left: brand + pitch */}
        <section className="hidden flex-col justify-between self-stretch py-6 lg:flex">
          <Link href="/" className="lg-rise inline-flex w-fit items-center gap-2.5 rounded-full border border-white/10 bg-white/5 py-2 pl-3 pr-4 text-[0.8125rem] font-medium text-zinc-300 backdrop-blur transition-colors hover:border-white/25 hover:text-white">
            <ArrowLeft size={15} />Back to home
          </Link>

          <div className="max-w-[40rem] py-12">
            <p className="lg-rise inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-[0.8125rem] font-medium text-zinc-300 backdrop-blur" style={{ animationDelay: ".06s" }}>
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,.7)]" />Command center for developers
            </p>
            <h2 className="lg-rise lg-silver mt-7 text-[3.5rem] font-semibold leading-[1.05] tracking-[-0.03em] xl:text-[4.25rem]" style={{ animationDelay: ".12s" }}>
              Ship code you can trust.
            </h2>
            <p className="lg-rise mt-6 max-w-[34rem] text-[1.0625rem] leading-8 text-zinc-300/90" style={{ animationDelay: ".2s" }}>
              Track your projects, catch errors before your users do, and deploy with confidence, all from one calm place.
            </p>
            <ul className="mt-10 space-y-5">
              {FEATURES.map((f, i) => (
                <li key={f.title} className="lg-rise flex items-start gap-4" style={{ animationDelay: `${0.28 + i * 0.08}s` }}>
                  <span className="lg-glass grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"><f.icon size={20} /></span>
                  <span>
                    <span className="block text-[1rem] font-medium text-white">{f.title}</span>
                    <span className="mt-0.5 block text-[0.875rem] leading-6 text-zinc-400">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Floating preview of what's inside */}
          <div className="lg-health lg-rise lg-bob lg-glass w-full max-w-[26rem] rounded-3xl p-6" style={{ animationDelay: ".5s" }} aria-hidden>
            <div className="flex items-center justify-between">
              <span className="text-[0.75rem] font-medium uppercase tracking-[.16em] text-zinc-400">Project health</span>
              <span className="flex gap-1.5"><i className="h-2 w-2 rounded-full bg-white/25" /><i className="h-2 w-2 rounded-full bg-white/25" /><i className="h-2 w-2 rounded-full bg-white/25" /></span>
            </div>
            <ul className="mt-5 space-y-3.5">
              {[
                { icon: Bug, label: "Bugs", value: "All clear" },
                { icon: FlaskConical, label: "Tests", value: "12/12 passed" },
                { icon: Rocket, label: "Deploy", value: "Live on Vercel" },
              ].map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <span className="flex items-center gap-3 text-[0.875rem] text-zinc-200"><r.icon size={16} className="text-zinc-400" />{r.label}</span>
                  <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-emerald-300"><CheckCircle2 size={15} />{r.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right: sign-in card */}
        <section className="lg-card relative mx-auto w-full max-w-[32rem] lg:ml-auto lg:mr-0">
          <Link href="/" className="mb-5 inline-flex items-center gap-2 text-[0.8125rem] font-medium text-zinc-300 transition-colors hover:text-white lg:hidden"><ArrowLeft size={15} />Back to home</Link>
          <div aria-hidden className="absolute -inset-px rounded-[2rem] bg-gradient-to-br from-white/30 via-white/5 to-cyan-300/30 opacity-70 blur-[1px]" />
          <div className="relative overflow-hidden rounded-[2rem] border border-border bg-bg-elevated/90 p-8 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-12">
            <div aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/60 to-transparent" />
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-[80px]" />

            <Link href="/" aria-label="DevAudit home" className="relative flex w-fit items-center gap-3.5">
              <span className="text-ink"><LogoMark size={44} /></span>
              <span className="font-display text-[1.5rem] font-bold tracking-tight text-ink">DevAudit</span>
            </Link>

            <p className="relative mt-10 flex items-center gap-2.5 rounded-xl bg-surface-dark px-4 py-3 font-mono text-[0.8125rem] text-surface-dark-ink-soft">
              <span className="text-accent-cyan">$</span> devaudit auth --provider github
              <span className="lg-caret ml-0.5 inline-block h-4 w-2 translate-y-px bg-accent-cyan/80" />
            </p>

            <h1 className="relative mt-7 text-[2rem] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[2.375rem]">Sign in to your command center</h1>
            <p className="relative mt-4 text-[1rem] leading-7 text-ink-soft">
              Connect GitHub to track your projects, pushes and errors. New here? Signing in creates your account.
            </p>

            <button
              type="button"
              onClick={signInWithGithub}
              disabled={loading || redirecting}
              aria-busy={loading || redirecting}
              className="lg-btn relative mt-10 flex h-14 w-full items-center justify-center gap-3 rounded-full bg-ink px-6 text-[1rem] font-medium text-bg shadow-lg shadow-black/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading || redirecting ? <Loader2 size={20} className="animate-spin" /> : <GithubMark className="h-5 w-5" />}
              {redirecting ? "Taking you to your dashboard…" : loading ? "Redirecting to GitHub…" : "Continue with GitHub"}
            </button>

            {error && (
              <div role="alert" className="relative mt-5 flex items-start gap-3 rounded-2xl border border-diff-del/30 bg-diff-del-bg p-4 text-[0.875rem] leading-6 text-diff-del">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="relative mt-9 border-t border-border pt-6">
              <p className="text-center text-[0.8125rem] leading-6 text-ink-faint">
                We read your GitHub profile, email address, and repositories.
              </p>
              <p className="mt-2 flex items-center justify-center gap-2 text-center text-[0.8125rem] leading-6 text-ink-faint">
                <ShieldCheck size={15} className="shrink-0" />Secured with GitHub OAuth. We never see your password.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
