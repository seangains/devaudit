"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/utils/supabase";

/** Drop <GithubTokenSync /> once into EVERY page a GitHub sign-in can land on (/dashboard and
 *  /cli-auth). It renders nothing.
 *
 *  Why every landing page: Supabase exposes session.provider_token only in the browser, only
 *  right after sign-in, and keeps it in localStorage until its next session refresh. If someone's
 *  first sign-in lands on a page without this component, the server never receives the token
 *  (so CLI/API features that need GitHub can't work) and the raw token just sits in localStorage.
 *
 *  `onSynced` runs after a successful hand-off. It is a prop (not an import) so pages that don't
 *  need it, like /cli-auth, don't have to pull the whole Code Studio bundle in just for this.
 *
 *  Supabase only exposes session.provider_token in the browser, once, right after sign-in. This
 *  hands it to the server (encrypted into github_connections), then scrubs it from the session
 *  Supabase keeps in localStorage, so from here on the browser neither holds nor sends it — all
 *  GitHub calls go through /api/github/proxy. */

/** Supabase persists the whole session, provider tokens included, until its next refresh. */
export function scrubProviderTokens() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const s = JSON.parse(raw);
      if (s && typeof s === "object" && ("provider_token" in s || "provider_refresh_token" in s)) {
        delete s.provider_token;
        delete s.provider_refresh_token;
        localStorage.setItem(k, JSON.stringify(s));
      }
    }
  } catch {
    // Best-effort.
  }
}

export default function GithubTokenSync({ onSynced }: { onSynced?: () => void | Promise<unknown> } = {}) {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.provider_token) return; // not a fresh GitHub sign-in this load — nothing to do

      try {
        const res = await fetch("/api/github/connection", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            providerToken: session.provider_token, // /api/github/connection reads `providerToken`
            githubLogin: (session.user.user_metadata as Record<string, unknown> | null)?.user_name ?? null,
            scope: "repo",
          }),
        });
        if (!res.ok) return; // keep the token in place so the next load can retry
        scrubProviderTokens();
        await onSynced?.();
      } catch {
        // Best-effort — the next sign-in retries. Nothing for the user to act on.
      }
    })();
  }, []);

  return null;
}
