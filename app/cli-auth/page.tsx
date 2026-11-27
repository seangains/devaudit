"use client";

import { useEffect, useState, useRef, type FormEvent } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Globe, Loader2, ScanSearch, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "@/utils/supabase";
import GithubTokenSync from "@/components/GithubTokenSync";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

// The Supabase session lives in the browser client, and a plain fetch doesn't send it. The API
// route identifies the caller from an Authorization: Bearer header, so attach the access token.
async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// Mirrors the device-code flow in cli/src/commands/login.js, wired to app/api/cli-auth/route.ts:
//   1. CLI calls POST /v1/cli-auth/start, gets back { device_code, user_code, verification_uri }
//      and prints user_code + verification_uri, then opens this page. verification_uri is the
//      bare page (no ?code=), so the person always types the code from their terminal here.
//      SECURITY: this page must NEVER read the code from the URL. If it did, an attacker could
//      start their own login, send the victim a link with the attacker's code in it, and get an
//      API token for the victim's account after one click on "Approve". Typing the code from
//      your own terminal is what proves the terminal is yours, so any ?code= in the URL is ignored
//      (and removed from the address bar).
//   2. GET /api/cli-auth?code=USER_CODE (session-authenticated) resolves what that code is for,
//      so this page can show "Approve login from <client_name>?" before anything changes. A
//      code that's missing, expired, or already used comes back as a 404 either way.
//   3. POST /api/cli-auth {code, decision: "approve" | "deny"} records the decision. Approving
//      just stamps the request with this user's id — the CLI's own poll of /v1/cli-auth/token
//      is what actually mints the token, so nothing here ever sees or handles a token itself.
// A 401 from either call means the session lapsed between the initial check and the request;
// that's treated the same as never having been signed in.

type Status =
  | "checking-auth"
  | "need-signin"
  | "entry"
  | "looking-up"
  | "confirm"
  | "approving"
  | "denying"
  | "approved"
  | "denied"
  | "error";

interface DeviceRequest {
  client_name: string;
  created_at?: string;
  requested_from?: {
    ip: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
  };
  your_ip?: string | null;
  same_network?: boolean | null;
}

function describeLocation(from?: DeviceRequest["requested_from"]): string | null {
  if (!from) return null;
  const parts = [from.city, from.region, from.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function describeAge(iso?: string): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
}

function CliAuthContent() {
  const [status, setStatus] = useState<Status>("checking-auth");
  const [code, setCode] = useState("");
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // If someone arrived with ?code=… in the URL, drop it from the address bar. It is never used (see
  // the security note above); removing it just avoids leaving a stranger's code sitting in view.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("code")) {
      url.searchParams.delete("code");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);

  // Resolve the session once on mount. No session -> send them through GitHub sign-in and come
  // straight back here instead of dropping them on the dashboard.
  useEffect(() => {
    let active = true;

    // Listen for auth state updates (handles the incoming OAuth redirect hash automatically)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !isMountedRef.current) return;
      if (!session) {
        setStatus("need-signin");
        return;
      }
      // Token refreshes and tab-focus events also fire this listener; only advance from the
      // initial states so it never resets a screen the person is already on.
      setStatus((prev) => (prev === "checking-auth" || prev === "need-signin" ? "entry" : prev));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status !== "looking-up") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/cli-auth?code=${encodeURIComponent(code)}`, {
          headers: await authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!active || !isMountedRef.current) return;
        if (res.status === 401) {
          setStatus("need-signin");
          return;
        }
        if (!res.ok) {
          setError(data.error || "That code isn't valid, or it's expired. Check it and try again.");
          setStatus("error");
          return;
        }
        setRequest(data);
        setStatus("confirm");
      } catch {
        if (!active || !isMountedRef.current) return;
        setError("Couldn't reach DevAudit. Check your connection and try again.");
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [status, code]);

  async function signIn() {
    const redirectTo = `${window.location.origin}/cli-auth`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo, scopes: "repo" },
    });
    if (error && isMountedRef.current) {
      setError(error.message);
      setStatus("error");
    }
    // On success the browser navigates away to GitHub, so no further state change here.
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setCode(trimmed);
    setError(null);
    setStatus("looking-up");
  }

  async function respond(decision: "approve" | "deny") {
    setStatus(decision === "approve" ? "approving" : "denying");
    try {
      const res = await fetch("/api/cli-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ code, decision }),
      });
      if (!isMountedRef.current) return;

      if (res.status === 401) {
        setStatus("need-signin");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong. Try again.");
        setStatus("error");
        return;
      }
      setStatus(decision === "approve" ? "approved" : "denied");
    } catch {
      if (!isMountedRef.current) return;
      setError("Couldn't reach DevAudit. Check your connection and try again.");
      setStatus("error");
    }
  }

  function retry() {
    setError(null);
    setRequest(null);
    // Back to the entry form (keeping what was typed so a typo can be fixed) rather than silently
    // repeating the same lookup.
    setStatus("entry");
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-12 transition-colors duration-300">
      {/* A GitHub sign-in started here lands back on this page: hand the fresh GitHub token to the
          server and scrub it from localStorage, exactly as the dashboard does. */}
      <GithubTokenSync />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[130px]"
      />

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-bg-elevated/90 p-8 shadow-xl shadow-ink/5 backdrop-blur-xl"
      >
        <div aria-hidden className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/50 to-transparent" />

        <Link href="/" aria-label="DevAudit home" className="flex w-fit items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500">
            <ScanSearch size={16} className="text-slate-950" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-ink">DevAudit</span>
        </Link>

        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-8"
          >
            {(status === "checking-auth" || status === "looking-up") && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 size={22} className="animate-spin text-ink-soft" />
                <p className="text-sm text-ink-soft">
                  {status === "checking-auth" ? "Checking your session…" : "Looking up this login request…"}
                </p>
              </div>
            )}

            {status === "need-signin" && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Approve a CLI login</h1>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Sign in to confirm it&apos;s you before we connect the CLI running in your terminal.
                </p>
                <button
                  type="button"
                  onClick={signIn}
                  className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-full bg-ink px-4 py-3 text-sm font-medium text-bg shadow-sm transition-transform duration-200 hover:opacity-90 active:scale-[0.97]"
                >
                  <GithubMark className="h-[18px] w-[18px]" />
                  Continue with GitHub
                </button>
              </>
            )}

            {status === "entry" && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Enter your login code</h1>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Type the code shown in your terminal after running <span className="font-mono text-ink">devaudit login</span>.
                </p>
                <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink-faint">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  Only use a code from a terminal you started yourself. If someone sent you a code or a link to approve, don&apos;t.
                </p>
                <form onSubmit={submitCode} className="mt-6 flex flex-col gap-3">
                  <input
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX"
                    className="w-full rounded-md border border-border bg-surface-dark px-3 py-2.5 text-center font-mono text-sm tracking-widest text-ink outline-none focus:border-accent-cyan"
                  />
                  <button
                    type="submit"
                    disabled={!code.trim()}
                    className="flex w-full items-center justify-center rounded-full bg-ink px-4 py-3 text-sm font-medium text-bg shadow-sm transition-transform duration-200 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Continue
                  </button>
                </form>
              </>
            )}

            {status === "confirm" && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Approve this login?</h1>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  {request?.client_name ? (
                    <>
                      The CLI login <span className="font-medium text-ink">{request.client_name}</span> wants to sign in to
                      your DevAudit account.
                    </>
                  ) : (
                    "A CLI wants to sign in to your DevAudit account."
                  )}
                </p>
                <p className="mt-4 rounded-md bg-surface-dark px-3 py-2 text-center font-mono text-sm tracking-widest text-accent-cyan">
                  {code}
                </p>
                <dl className="mt-4 space-y-1.5 rounded-lg border border-border px-3 py-3 text-xs leading-5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-faint">Requested</dt>
                    <dd className="text-right text-ink">
                      {request?.created_at ? new Date(request.created_at).toLocaleString() : "Unknown"}
                      {describeAge(request?.created_at) ? (
                        <span className="text-ink-faint"> ({describeAge(request?.created_at)})</span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-faint">From IP address</dt>
                    <dd className="break-all text-right font-mono text-ink">{request?.requested_from?.ip ?? "Unknown"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-faint">Approx. location</dt>
                    <dd className="text-right text-ink">{describeLocation(request?.requested_from) ?? "Unknown"}</dd>
                  </div>
                  {request?.your_ip ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-faint">Your IP right now</dt>
                      <dd className="break-all text-right font-mono text-ink">{request.your_ip}</dd>
                    </div>
                  ) : null}
                </dl>

                {request?.same_network === false && (
                  <p
                    role="alert"
                    className="mt-3 flex items-start gap-2 rounded-lg border border-diff-del/30 bg-diff-del-bg p-3 text-xs leading-5 text-diff-del"
                  >
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                    This login was requested from a different network than the one you&apos;re on now. That&apos;s normal if
                    the terminal is on another machine you control (SSH, a server, a VPN) — but if you didn&apos;t start it
                    yourself, press Deny.
                  </p>
                )}

                <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-ink-faint">
                  <Globe size={14} className="mt-0.5 shrink-0" />
                  Only approve this if you just ran <span className="font-mono">devaudit login</span> yourself and the code
                  above matches your terminal.
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => respond("deny")}
                    className="flex-1 rounded-full border border-border px-4 py-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-dark"
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    onClick={() => respond("approve")}
                    className="flex-1 rounded-full bg-ink px-4 py-3 text-sm font-medium text-bg shadow-sm transition-transform duration-200 hover:opacity-90 active:scale-[0.97]"
                  >
                    Approve
                  </button>
                </div>
              </>
            )}

            {status === "approving" && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 size={22} className="animate-spin text-ink-soft" />
                <p className="text-sm text-ink-soft">Connecting your CLI…</p>
              </div>
            )}
            {status === "denying" && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 size={22} className="animate-spin text-ink-soft" />
                <p className="text-sm text-ink-soft">Denying this login…</p>
              </div>
            )}

            {status === "approved" && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 size={28} className="text-emerald-400" />
                <h1 className="font-display text-xl font-bold tracking-tight text-ink">You&apos;re all set</h1>
                <p className="text-sm leading-6 text-ink-soft">
                  Head back to your terminal — the CLI will pick this up automatically.
                </p>
                <p className="text-xs text-ink-faint">
                  You can revoke this any time from your account settings.
                </p>
              </div>
            )}

            {status === "denied" && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <XCircle size={28} className="text-ink-soft" />
                <h1 className="font-display text-xl font-bold tracking-tight text-ink">Login denied</h1>
                <p className="text-sm leading-6 text-ink-soft">You can close this tab. Nothing was connected.</p>
              </div>
            )}

            {status === "error" && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Something went wrong</h1>
                <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-diff-del/30 bg-diff-del-bg p-3 text-xs leading-5 text-diff-del">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-6 flex w-full items-center justify-center rounded-full bg-ink px-4 py-3 text-sm font-medium text-bg shadow-sm transition-transform duration-200 hover:opacity-90 active:scale-[0.97]"
                >
                  Try again
                </button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.section>
    </main>
  );
}

export default function CliAuthPage() {
  return <CliAuthContent />;
}