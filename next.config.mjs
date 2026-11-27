const isDev = process.env.NODE_ENV !== "production";

// Origins are only ever taken from environment variables if they look like a plain origin, so a typo or a
// stray ";" can't add directives to a policy.
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const cleanOrigins = (value) =>
  (value ?? "").split(/[\s,]+/).map((v) => v.replace(/\/+$/, "")).filter((v) => ORIGIN.test(v));

// OPTIONAL — serve the preview frame from a different origin (e.g. https://preview.example.com, the same
// app behind a second hostname). That is the strongest isolation: the previewed project then can't even
// reach this app's origin. Leave both unset to serve it from this origin at /preview-frame.html, which is
// still sandboxed (see previewCsp below).
//   NEXT_PUBLIC_PREVIEW_ORIGIN    where the frame is served from (also read by CodeStudio.tsx)
//   PREVIEW_FRAME_ANCESTORS       the origin(s) of the app that frames it, e.g. https://app.example.com
const [previewOrigin] = cleanOrigins(process.env.NEXT_PUBLIC_PREVIEW_ORIGIN);
const previewAncestors = cleanOrigins(process.env.PREVIEW_FRAME_ANCESTORS);

// Content-Security-Policy, built from what DevAudit actually loads:
// - NO third-party script hosts. Everything that runs in the app's origin is served from 'self':
//   Next.js's own bundles, esbuild-wasm (public/esbuild.wasm) and Monaco (public/monaco/vs), the
//   last two copied out of node_modules by scripts/copy-static-assets.mjs. A compromised CDN can
//   therefore no longer run code here (where it could read the Supabase session from localStorage).
// - script-src still needs 'unsafe-inline' for the inline scripts Next.js injects for hydration and
//   for the theme script in layout.tsx. The remaining step to a fully strict policy is a
//   nonce-based one (middleware + a per-request nonce), which makes every page dynamically
//   rendered — a trade-off to decide on deliberately, so it isn't switched on here.
// - script-src also has 'wasm-unsafe-eval': the Preview bundler (esbuild-wasm) is a WebAssembly module
//   and browsers refuse to compile one without it. It allows WebAssembly only — NOT eval() or
//   new Function(), which is what plain 'unsafe-eval' (dev builds only, below) would add.
// - 'unsafe-eval' in development is required by Next.js's own dev tooling (React Refresh, eval-based
//   source maps) and cannot be removed there. Nothing in this app needs it in production, and previewed
//   projects no longer depend on it either way: they run in the preview frame, which has its own policy
//   (previewCsp) that is the same in dev and production. To check the production policy locally, run
//   `next build && next start` — NODE_ENV is "production" there.
// - connect-src allows https://esm.sh for DATA only: CodeStudio's bundler fetches the source text of
//   npm packages a user's project imports. That text runs inside the sandboxed preview iframe
//   (opaque origin), never in this origin, and script-src does not allow esm.sh.
// - Supabase auth/database calls go to *.supabase.co (https + realtime websocket).
// - next/font/google self-hosts fonts at build time, so no Google Fonts domains are needed.
// - frame-src is this origin (the preview frame), plus the separate preview origin if one is configured.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com https://esm.sh",
  `frame-src 'self'${previewOrigin ? ` ${previewOrigin}` : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

// The preview frame (public/preview-frame.html) runs the PREVIEWED PROJECT, which is somebody's website:
// it needs images, fonts, stylesheets, scripts and APIs from all over https, so this policy is much looser
// than the app's. That's safe because of what the frame is, not because of the policy:
// - `sandbox` (a CSP directive, so it also applies if the URL is opened directly in a tab) gives it an
//   opaque origin: no access to this app's cookies, localStorage or Supabase session, and no way to
//   navigate the app. It mirrors the iframe's own sandbox attribute; where the two differ, the stricter wins.
// - Without allow-same-origin, requests it makes carry no cookies for this origin.
// - frame-ancestors lets only this app embed it.
// The value is a constant: it does not depend on isDev, so a project previews the same way under
// `next dev` and in production. (That includes 'unsafe-eval': inside this sandbox it grants nothing the
// project's own code doesn't already have, and plenty of real sites and libraries need it.)
// Only https is allowed for loading anything, so an http:// resource is blocked in both modes.
const previewCsp = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: blob:",
  "style-src 'unsafe-inline' https:",
  "img-src https: data: blob:",
  "font-src https: data:",
  "media-src https: data: blob:",
  "connect-src https: wss: data: blob:",
  "frame-src https: data: blob:",
  "worker-src blob: data:",
  "object-src 'none'",
  "form-action https:",
  `frame-ancestors ${["'self'", ...previewAncestors].join(" ")}`,
  "sandbox allow-scripts allow-forms allow-modals allow-popups",
].join("; ");

const previewFrameHeaders = [
  { key: "Content-Security-Policy", value: previewCsp },
  // Without this, the global X-Frame-Options: DENY would stop the app from framing its own preview.
  // (Browsers that support CSP frame-ancestors, which is all current ones, use that instead when both are present.)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // The frame's URL carries a one-time token (?n=...); never send it to the sites the project talks to.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-cache" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // When two rules match a path and set the same header, the later one wins. This replaces the app's
      // Content-Security-Policy, X-Frame-Options and Referrer-Policy for this one file and keeps the rest
      // (HSTS, nosniff, Permissions-Policy).
      { source: "/preview-frame.html", headers: previewFrameHeaders },
    ];
  },
};

export default nextConfig;
