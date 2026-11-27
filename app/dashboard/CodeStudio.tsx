"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import { useDaTheme, mono } from "./dashboardTheme";
import AiAssistantModal from "./AiAssistantModal";
import RepositoryPage from "./RepositoryPage";
import { DropOverlay, ImportDialog } from "./ImportDialog";
import {
  MAX_IMPORT_FILE_BYTES, ImportCancelledError, applyImport, assetsToKeep, captureDrop, captureFileList, foldersToReveal, pickPrimaryFile, scanDrop,
  type CapturedDrop, type ScanProgress, type ScanResult,
} from "./fileImport";
import {
  MAX_PREVIEW_ASSET_BYTES, MAX_PREVIEW_ASSETS, MAX_PREVIEW_ASSETS_TOTAL_BYTES, loadPreviewAssets, previewAssetDataUrl, previewAssetMime, savePreviewAssets,
  type PreviewAssetMap,
} from "./previewAssets";
import {
  ChevronRight, File as FileIcon, FilePlus, Folder, Loader2, RefreshCw,
  AlertCircle, GitBranch, Pencil, Trash2, CloudOff, Check, Play, Code2, Eye,
  X, Sparkles, Wand2, Compass, Upload, AlertTriangle, Search, ExternalLink,
} from "lucide-react";
import { supabase } from "@/utils/supabase";

/* ---------- GitHub connection (the token lives on the server only) ---------- */
// GithubTokenSync hands the OAuth token to the server once at sign-in; it's stored encrypted in
// github_connections and attached to GitHub requests by /api/github/proxy. After that the browser
// only ever learns "connected or not" and never sends or holds the token.
const LEGACY_TOKEN_KEY = "devaudit:gh_token"; // old builds kept the raw token here; it is purged on load
const CONNECTION_EVENT = "devaudit:github-connection";
let connected = false;

function setConnected(v: boolean) {
  if (connected === v) return;
  connected = v;
  try { window.dispatchEvent(new CustomEvent(CONNECTION_EVENT)); } catch {}
}
export const hasGithubToken = () => connected;
export function onGithubConnectionChange(cb: () => void): () => void {
  window.addEventListener(CONNECTION_EVENT, cb);
  return () => window.removeEventListener(CONNECTION_EVENT, cb);
}

/** Bearer header for our own API routes (same pattern HostDeployer uses). */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  } catch { return {}; }
}

/** Asks the server whether this account has a GitHub connection (never receives the token itself). */
export async function refreshGithubConnection(): Promise<boolean> {
  try {
    const res = await fetch("/api/github/session", { cache: "no-store", headers: await authHeader() });
    if (res.ok) setConnected(!!(await res.json())?.connected);
  } catch {}
  return connected;
}

/** Resets this tab's view of the connection (call on sign-out). The server-side connection is
 *  deliberately kept: server-to-server features (e.g. the v1 fix API) still need it. */
export function clearGithubToken(): void { setConnected(false); }

// Resolves once the first connection check is done, so early GitHub calls don't wrongly go out unauthenticated.
const ready: Promise<boolean> = typeof window === "undefined"
  ? Promise.resolve(false)
  : (() => { try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {} return refreshGithubConnection(); })();

/** `emptyRepo` is set when GitHub answered 409 "Git Repository is empty", i.e. the repository exists
 *  but has no commits yet. That's an ordinary starting point (the first sync makes the first
 *  commit), so callers treat it as "nothing to read" rather than as a failure. */
export class GhError extends Error { constructor(public status: number, msg: string, public emptyRepo = false) { super(msg); } }

/** Fired on window whenever the GitHub connection turns out to be dead (revoked/expired/missing on
 *  GitHub's side) so it stops silently pretending to still work. Listened for in page.tsx to
 *  show a persistent "reconnect GitHub" banner instead of leaving the user to hit the same 401 in
 *  whichever panel they happen to be in. */
const GH_TOKEN_INVALID_EVENT = "devaudit:github-token-invalid";
function markTokenInvalid() {
  clearGithubToken();
  try { window.dispatchEvent(new CustomEvent(GH_TOKEN_INVALID_EVENT)); } catch {}
}
export function onGithubTokenInvalid(cb: () => void): () => void {
  window.addEventListener(GH_TOKEN_INVALID_EVENT, cb);
  return () => window.removeEventListener(GH_TOKEN_INVALID_EVENT, cb);
}

function ghErrorMessage(res: Response, hasToken: boolean, detail: string) {
  return res.status === 401 ? "GitHub rejected the saved connection. Sign out and sign in again."
    : res.status === 403 || res.status === 429 ? "GitHub denied the request or the rate limit was reached. Try again later."
    : res.status === 404 ? (hasToken
      ? "Repository or file not found. Check the repository name, or sign out and sign in again so GitHub grants access to private repositories."
      : "GitHub isn't connected for this session, so private repositories can't be read. Sign out and sign in again.")
    : res.status === 409 ? (/empty/i.test(detail)
      ? "GitHub says this repository has no commits yet. Syncing will create the first one."
      : `GitHub reported a conflict${detail}. Wait a moment and try again.`)
    : res.status === 422 ? `GitHub rejected the request${detail}.`
    : `GitHub returned status ${res.status}${detail}.`;
}

/** GitHub's own explanation from an error response (e.g. ": Git Repository is empty."), so the
 *  person sees what actually went wrong instead of only a status code. */
async function ghDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j?.message === "string" && j.message ? `: ${j.message}` : "";
  } catch { return ""; }
}

/** Signed in: same-origin proxy (server attaches the token). Signed out: unauthenticated public
 *  read straight from GitHub. No credential ever exists in the browser either way. */
async function ghRequest(path: string, opts: { method?: "GET" | "POST" | "PUT" | "PATCH"; body?: unknown; raw?: boolean } = {}): Promise<Response> {
  await ready;
  const headers: Record<string, string> = { Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const viaProxy = connected;
  if (viaProxy) Object.assign(headers, await authHeader()); // our Supabase JWT, only ever sent to our own origin
  return fetch(viaProxy ? `/api/github/proxy${path}` : `https://api.github.com${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** Read-only GET, works unauthenticated for public repos. */
async function gh(path: string, raw = false): Promise<any> {
  const res = await ghRequest(path, { raw });
  if (!res.ok) {
    if (res.status === 401 && connected) markTokenInvalid();
    const detail = await ghDetail(res);
    throw new GhError(res.status, ghErrorMessage(res, connected, detail), res.status === 409 && /empty/i.test(detail));
  }
  return raw ? res.text() : res.json();
}

/** Write call (POST/PATCH), always requires a GitHub connection. */
async function ghWrite(path: string, method: "POST" | "PUT" | "PATCH", body: unknown): Promise<any> {
  await ready;
  if (!connected) throw new GhError(401, "GitHub isn't connected for this session. Sign out and sign in again.");
  const res = await ghRequest(path, { method, body });
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); if (j?.message) detail = `: ${j.message}`; } catch {}
    if (res.status === 401) markTokenInvalid();
    throw new GhError(res.status, ghErrorMessage(res, true, detail));
  }
  return res.json();
}

/** Repositories the signed-in user can access, as "owner/name", most recently pushed first. */
export async function listRepos(): Promise<string[]> {
  // GitHub caps a page at 100 repositories, so walk the pages (most recently pushed first) until a
  // short page marks the end. Bounded so an account with a huge number of repositories can't turn
  // one dropdown into hundreds of requests; past the cap the least recently pushed ones are omitted.
  const PER_PAGE = 100;
  const MAX_PAGES = 10;
  const names: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let batch: { full_name: string }[];
    try {
      batch = await gh(`/user/repos?per_page=${PER_PAGE}&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`);
    } catch (e) {
      // A failure on the first page is a real error; later on, keep what we already have.
      if (page === 1) throw e;
      break;
    }
    if (!Array.isArray(batch)) break;
    for (const r of batch) if (r && typeof r.full_name === "string") names.push(r.full_name);
    if (batch.length < PER_PAGE) break;
  }
  return names;
}

/** Updates a repository's visibility (public/private) on GitHub. */
export async function updateRepoVisibility(full: string, priv: boolean): Promise<any> {
  return ghWrite(`/repos/${full}`, "PATCH", { private: priv });
}

/* ---------- sync safety ---------- */
// The workspace is a browser copy of the repository, and a sync writes EVERY local file over the
// repository's copy. So before writing, the sync checks that the branch is still at the commit this
// workspace was last imported from / synced to (the "base"). If it has moved (someone pushed, a bot
// committed) or no base was ever recorded (a repository attached to a workspace that already had
// files), the sync stops and asks first instead of silently replacing whatever is on GitHub.
// Autosave never gets past this check; only a person clicking "Overwrite" can.
export type SyncBase = { repo: string; branch: string; commit: string };
const syncBaseKey = (projectId: string) => `devaudit:syncbase:${projectId}`;
export function loadSyncBase(projectId: string): SyncBase | null {
  try {
    const raw = localStorage.getItem(syncBaseKey(projectId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.repo === "string" && typeof v.branch === "string" && typeof v.commit === "string" ? v : null;
  } catch { return null; }
}
export function saveSyncBase(projectId: string, base: SyncBase) {
  try { localStorage.setItem(syncBaseKey(projectId), JSON.stringify(base)); } catch {}
}

/** Thrown instead of pushing when the push could overwrite changes the workspace doesn't have.
 *  "unverified": no recorded base for this repository. "remote-changed": the branch moved. */
export class SyncConflictError extends Error {
  kind: "unverified" | "remote-changed";
  constructor(kind: "unverified" | "remote-changed", msg: string) { super(msg); this.name = "SyncConflictError"; this.kind = kind; }
}

/** A repository's default branch, read from GitHub (never guessed: it may be master, trunk, ...). */
const defaultBranchCache = new Map<string, string>();
export async function getDefaultBranch(full: string): Promise<string> {
  const hit = defaultBranchCache.get(full);
  if (hit) return hit;
  const info = await gh(`/repos/${full}`);
  const branch = info?.default_branch;
  if (typeof branch !== "string" || !branch) throw new Error(`Couldn't work out the default branch of ${full}.`);
  defaultBranchCache.set(full, branch);
  return branch;
}

/* ---------- commit history ---------- */
export type CommitInfo = { sha: string; message: string; author: string; when: string; url: string };

/** Real commit history for a published repo, newest first. */
export async function listCommits(full: string, perPage = 30): Promise<CommitInfo[]> {
  let commits: any[];
  try {
    commits = await gh(`/repos/${full}/commits?per_page=${perPage}`);
  } catch (e) {
    // A repository with no commits yet has an empty history; that is not an error.
    if (e instanceof GhError && e.emptyRepo) return [];
    throw e;
  }
  return commits.map((c) => ({
    sha: (c.sha as string).slice(0, 7),
    message: (c.commit?.message ?? "").split("\n")[0],
    author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
    when: c.commit?.author?.date ?? c.commit?.committer?.date ?? "",
    url: c.html_url,
  }));
}

/* ---------- virtual, local-first file system ---------- */
export type VFiles = Record<string, string>;

export const DEFAULT_FILES: VFiles = {
  "README.md": "# New project\n\nThis project starts out local-only. Edit files here, then publish to GitHub from the Pre-Push & Deploy tab whenever you're ready.",
  "package.json": '{\n  "name": "new-project",\n  "private": true,\n  "scripts": {\n    "start": "node index.js"\n  }\n}',
  "index.js": 'require("./src/app");',
  "src/app.js": "function main() {\n  console.log(\"Hello from your new project\");\n}\n\nmain();\n",
};

const LANG: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json", md: "markdown", css: "css", scss: "scss", html: "html", py: "python", go: "go", rs: "rust", java: "java", yml: "yaml", yaml: "yaml", sh: "shell", sql: "sql", xml: "xml", rb: "ruby", php: "php", c: "c", cpp: "cpp" };
const langOf = (p: string) => LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
const BINARY = /\.(png|jpe?g|gif|webp|avif|bmp|ico|pdf|zip|gz|tar|woff2?|ttf|otf|eot|mp4|webm|mov|avi|mp3|m4a|wav|ogg|aac|flac|wasm)$/i;

/* ---------- in-browser preview: builds a runnable static page from the virtual files ---------- */
const PREVIEW_CANDIDATES = ["index.html", "public/index.html", "src/index.html", "dist/index.html"];

const JS_ENTRY_CANDIDATES = [
  "src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js",
  "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js",
  "index.tsx", "index.jsx", "index.ts", "index.js",
];

export type PreviewEntry = {
  /** The real file shown in the UI and sent to the AI reviewer. */
  path: string;
  kind: "html" | "js";
  /** Set when `path` is a React component rather than a runnable entry: Preview then mounts it into
   *  `#root` itself ("component"), or, with no clear root to mount, every component in the project
   *  one under another ("gallery", listing them in `components`). "app" is a whole TanStack Router /
   *  TanStack Start site: Preview runs the real router (root layout, every route, in-app navigation)
   *  instead of one route on its own. */
  mount?: "component" | "gallery" | "app";
  components?: string[];
  /** "app" only: the router file that gets mounted. `path` is then the home route's file when there is one (what
   *  the UI shows and what errors and the AI review are attributed to, as for any single page), else this file. */
  routerPath?: string;
  /** "app" only: the routes without parameters, from the generated route tree (for the page picker). */
  routes?: string[];
  /** "app" only: the route to open first. */
  initialPath?: string;
};

const isHtmlPath = (p: string) => /\.html?$/i.test(p);
/** React component files. Tests, stories and type declarations are never previewed on their own. */
const isComponentPath = (p: string) => /\.(tsx|jsx)$/i.test(p) && !/\.(test|spec|stories)\.[jt]sx?$/i.test(p) && !/\.d\.[jt]sx?$/i.test(p);
const GALLERY_LIMIT = 24;

// Where a project's top-level component usually lives, most specific first (all lower-case: matched
// case-insensitively). Covers Vite/CRA (src/App), Lovable (src/pages/Index) and Next.js (app/page,
// pages/index). A real runnable entry (src/main.tsx, index.html, ...) always wins over these.
const ROOT_COMPONENT_CANDIDATES = [
  "src/app.tsx", "src/app.jsx", "src/app.js", "app.tsx", "app.jsx",
  "src/pages/index.tsx", "src/pages/index.jsx", "src/pages/home.tsx", "src/pages/home.jsx",
  "app/page.tsx", "app/page.jsx", "app/page.js", "src/app/page.tsx", "src/app/page.jsx", "src/app/page.js",
  "pages/index.tsx", "pages/index.jsx", "pages/index.js", "src/pages/index.js",
  // File-routed apps: TanStack Router/Start (src/routes/index.tsx), Remix and React Router (app/routes/_index.tsx).
  "src/routes/index.tsx", "src/routes/index.jsx", "app/routes/_index.tsx", "app/routes/_index.jsx", "app/routes/index.tsx", "app/routes/index.jsx",
];
const ROOT_COMPONENT_NAMES = new Set(["app", "home", "homepage", "index", "page", "main", "landing", "site", "website", "portfolio", "showcase"]);

const inRoot = (root: string, rel: string) => (root ? `${root}/${rel}` : rel);

/** Where projects live in the workspace: the top, plus every folder with its own package.json (an
 *  uploaded zip usually adds one wrapper folder; a monorepo has several), shallowest first. Entry
 *  detection looks for "src/main.tsx" and friends under each of these, not only at the top. */
export function projectRoots(files: VFiles): string[] {
  const roots = new Set<string>([""]);
  for (const p of Object.keys(files)) {
    if (p.endsWith("/package.json") && !/(^|\/)node_modules\//.test(p)) roots.add(p.slice(0, -"/package.json".length));
  }
  const depth = (d: string) => (d === "" ? 0 : d.split("/").length);
  return [...roots].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/** Every HTML page in the project, shallowest first. */
export function listHtmlPages(files: VFiles): string[] {
  const depth = (p: string) => p.split("/").length;
  return Object.keys(files).filter(isHtmlPath).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/** What Preview should show for a project. `preferred` is the file open in the editor: if it is an
 *  HTML page, that page is previewed, so every page of a multi-page site can be looked at. Anything
 *  else falls back to the project's own entry. A project is only left without a Preview when it has
 *  nothing a browser could draw (no HTML, no React component, e.g. a plain Node script). */
export function findPreviewEntry(files: VFiles, preferred?: string | null): PreviewEntry | null {
  if (preferred && isHtmlPath(preferred) && files[preferred] !== undefined) return { path: preferred, kind: "html" };
  for (const c of PREVIEW_CANDIDATES) if (files[c] !== undefined) return { path: c, kind: "html" };
  const pages = listHtmlPages(files);
  const anyIndex = pages.find((p) => /(^|\/)index\.html?$/i.test(p));
  if (anyIndex) return { path: anyIndex, kind: "html" };
  if (pages[0]) return { path: pages[0], kind: "html" };
  // Candidate-major, root-minor: a real "src/main.tsx" in any project beats a "src/index.ts" in another
  // (a monorepo's API next to its web app), and a project at the top is still tried before nested ones.
  const roots = projectRoots(files);
  for (const c of JS_ENTRY_CANDIDATES) {
    for (const root of roots) {
      const path = inRoot(root, c);
      if (files[path] !== undefined) return { path, kind: "js" };
    }
  }

  // A TanStack Router / Start site has no main.tsx: its router file and generated route tree ARE the app.
  // Run those, so the root layout, every page and the links between them are there, not just one route.
  const app = findRouterApp(files);
  if (app) return app;

  // No HTML and no entry file that starts the app: render the project's components instead.
  const paths = Object.keys(files);
  const byLower = new Map(paths.map((p) => [p.toLowerCase(), p] as const));
  for (const c of ROOT_COMPONENT_CANDIDATES) {
    for (const root of roots) {
      const hit = byLower.get(inRoot(root, c).toLowerCase());
      if (hit) return { path: hit, kind: "js", mount: "component" };
    }
  }
  const components = paths.filter(isComponentPath).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (components.length === 0) return null;
  const base = (p: string) => (p.split("/").pop() ?? p).replace(/\.[^.]+$/, "").toLowerCase();
  const named = components.find((p) => ROOT_COMPONENT_NAMES.has(base(p)));
  if (named) return { path: named, kind: "js", mount: "component" };
  if (components.length === 1) return { path: components[0], kind: "js", mount: "component" };
  return { path: components[0], kind: "js", mount: "gallery", components: components.slice(0, GALLERY_LIMIT) };
}

// TanStack Router / TanStack Start: `src/router.tsx` builds the router from the generated `routeTree.gen.ts`.
const ROUTER_FILE = /(?:^|\/)(?:src|app)\/router\.(?:tsx|ts|jsx|js)$/;
const ROUTE_TREE_IMPORT = /from\s*["'](\.{1,2}\/[^"']*routeTree\.gen)["']/;
const MAX_LISTED_ROUTES = 60;

/** The routes a generated route tree can open without parameters ("/", "/music", ...), "/" first. */
function routesOfTree(treeSource: string): string[] {
  const m = /fullPaths\s*:\s*([^\n]+)/.exec(treeSource);
  const found = m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [];
  const routes = [...new Set(found.filter((r) => r.startsWith("/") && !/[$*{]/.test(r)))];
  routes.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  return routes.slice(0, MAX_LISTED_ROUTES);
}

/** A whole TanStack Router app: a router file that creates the router from a route tree that's in the workspace.
 *  Without the generated route tree (it is written by the framework's build tool) there is no router to run, so
 *  the project falls through to the single-route fallback. */
function findRouterApp(files: VFiles): PreviewEntry | null {
  // Anywhere in the workspace (an uploaded folder may be wrapped in another one), the shallowest first.
  const depth = (p: string) => p.split("/").length;
  const candidates = Object.keys(files).filter((p) => ROUTER_FILE.test(p) && !/(^|\/)node_modules\//.test(p)).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  for (const path of candidates) {
    const src = files[path];
    if (!/@tanstack\/react-router/.test(src) || !/\bcreateRouter\b/.test(src)) continue;
    if (!/\bexport\b[^;\n]*\b(?:getRouter|createRouter|router)\b/.test(src)) continue;
    const imp = ROUTE_TREE_IMPORT.exec(src);
    const tree = imp ? resolveVirtual(files, dirOf(path), imp[1]) : null;
    if (!tree) continue;
    const home = ["index.tsx", "index.jsx", "index.ts", "index.js", "_index.tsx", "_index.jsx"].map((n) => inRoot(`${dirOf(path)}/routes`.replace(/^\//, ""), n)).find((f) => files[f] !== undefined);
    return { path: home ?? path, routerPath: path, kind: "js", mount: "app", routes: routesOfTree(files[tree]) };
  }
  return null;
}

/** For a project with nothing Preview can render: a specific reason when it's a kind of project Preview
 *  can't compile (Vue, Svelte, Astro, server languages), or null for the generic "no visible UI" message. */
export function previewBlockedReason(files: VFiles): string | null {
  const paths = Object.keys(files);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  if (has(/\.vue$/i)) return "This looks like a Vue project, and Preview can't compile Vue files yet. Add a plain index.html or a React component to preview it.";
  if (has(/\.svelte$/i)) return "This looks like a Svelte project, and Preview can't compile Svelte files yet. Add a plain index.html or a React component to preview it.";
  if (has(/\.astro$/i)) return "This looks like an Astro project, and Preview can't compile Astro files yet. Add a plain index.html or a React component to preview it.";
  if (has(/\.(php|rb|py|go|java|cs|rs)$/i)) return "This project's pages are produced by server-side code, which Preview can't run in the browser. Add a static index.html to preview it.";
  return null;
}

/** Resolves a link clicked inside a previewed page (`about.html`, `/contact`, `../index.html#top`)
 *  to another HTML page of the project, or null if it doesn't point at one. */
function resolveHtmlPage(files: VFiles, fromPage: string, href: string): string | null {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return null;
  for (const target of previewPathCandidates(fromPage, clean)) {
    const candidates = target === "" ? ["index.html"] : [target, `${target}.html`, `${target}/index.html`];
    const hit = candidates.find((c) => files[c] !== undefined && isHtmlPath(c));
    if (hit) return hit;
  }
  return null;
}

export const EXT_LOADER: Record<string, "ts" | "tsx" | "jsx" | "js" | "json"> = { ts: "ts", tsx: "tsx", jsx: "jsx", js: "jsx", mjs: "js", cjs: "js", json: "json" };
const RESOLVE_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", ".json", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function resolveVirtual(files: VFiles, fromDir: string, spec: string): string | null {
  const combined = spec.startsWith("/") ? spec.slice(1) : `${fromDir ? `${fromDir}/` : ""}${spec}`;
  const base = collapsePath(combined);
  for (const suffix of RESOLVE_SUFFIXES) if (files[base + suffix] !== undefined) return base + suffix;
  return null;
}

// ---------------------------------------------------------------------------
// SECURITY: nothing in this file may load executable code from a third-party host into the app's
// own origin. Anything that runs here can read the Supabase session out of localStorage and call
// /api/github/proxy as the signed-in user, so a compromised CDN would be a full account takeover.
//   * esbuild-wasm comes from the npm package (pinned in package.json) and its .wasm binary is
//     served from /esbuild.wasm on our own origin (copied there by scripts/copy-static-assets.mjs).
//   * Monaco is served from /monaco/vs on our own origin, the same way (see below).
// The only remote fetches left are the *text* of npm packages the user's own project imports
// (see virtualFsPlugin). That text is bundled and then executed inside the sandboxed preview
// iframe, which has an opaque origin and cannot touch this page's storage — never in this origin.
// ---------------------------------------------------------------------------
const ESBUILD_WASM_PATH = "/esbuild.wasm";

// Make @monaco-editor/react load Monaco from our own origin instead of cdn.jsdelivr.net. Must run
// before the first <Editor> mounts, so it lives at module scope.
if (typeof window !== "undefined") {
  loader.config({ paths: { vs: "/monaco/vs" } });
}

let esbuildPromise: Promise<typeof import("esbuild-wasm")> | null = null;

export function getEsbuild(): Promise<typeof import("esbuild-wasm")> {
  if (!esbuildPromise) {
    esbuildPromise = (async () => {
      const imported: any = await import("esbuild-wasm");
      // Depending on how the bundler interops the package's CJS/ESM builds, the API is either on
      // the namespace itself or on its default export.
      const mod: typeof import("esbuild-wasm") = typeof imported?.initialize === "function" ? imported : imported?.default;
      if (typeof mod?.initialize !== "function") {
        throw new Error(
          "The in-browser bundler (esbuild-wasm) didn't load correctly — this is a toolchain issue, not a bug in your code. Reload the page and try Run again."
        );
      }
      // Absolute URL: with `worker: true` esbuild runs from a blob: worker, where a relative URL
      // wouldn't resolve against this page.
      try {
        await mod.initialize({ wasmURL: new URL(ESBUILD_WASM_PATH, window.location.origin).href, worker: true });
      } catch (e) {
        // The bundler is WebAssembly. A Content-Security-Policy whose script-src lacks
        // 'wasm-unsafe-eval' refuses to compile it, which is a site setting, not a problem in the
        // person's project, so say that instead of surfacing the browser's raw message.
        const msg = e instanceof Error ? e.message : String(e);
        if (/content security policy|unsafe-eval|webassembly/i.test(msg)) {
          throw new Error(
            "Preview's bundler (esbuild, a WebAssembly module) was blocked by this site's Content-Security-Policy. " +
            "Add 'wasm-unsafe-eval' to the script-src directive (and 'blob:' to worker-src if the browser then complains about a worker), then reload."
          );
        }
        throw e;
      }
      return mod;
    })().catch((e) => { esbuildPromise = null; throw e; });
  }
  return esbuildPromise;
}

// Next.js's own modules need the Next runtime, which doesn't exist in the browser sandbox. Pages and
// components written for Next still preview if these few are swapped for plain-DOM stand-ins.
const NEXT_SHIMS: Record<string, string> = {
  "next/link": `import { createElement } from "react";
export default function Link({ href, children, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, ...rest }) {
  const to = typeof href === "string" ? href : (href && href.pathname) || "";
  return createElement("a", { href: to, ...rest }, children);
}`,
  "next/image": `import { createElement } from "react";
export default function Image({ src, alt = "", width, height, fill, priority, quality, placeholder, blurDataURL, loader, unoptimized, sizes, style, ...rest }) {
  const url = typeof src === "string" ? src : (src && (src.src || src.default)) || "";
  const fillStyle = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style;
  return createElement("img", { src: url, alt, width: fill ? undefined : width, height: fill ? undefined : height, style: fillStyle, ...rest });
}`,
  "next/navigation": `export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const useRouter = () => ({ push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} });
export const redirect = () => {};
export const notFound = () => { throw new Error("notFound() was called"); };
export const permanentRedirect = () => {};
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];`,
  "next/head": `export default function Head() { return null; }`,
  "next/script": `export default function Script() { return null; }`,
  "next/font/local": `export default function localFont() { return { className: "", variable: "", style: { fontFamily: "system-ui, sans-serif" } }; }`,
  "next/router": `import { createElement } from "react";
const router = { pathname: "/", route: "/", asPath: "/", query: {}, basePath: "", isReady: true, isFallback: false, push: async () => true, replace: async () => true, back() {}, reload() {}, prefetch: async () => {}, beforePopState() {}, events: { on() {}, off() {}, emit() {} } };
export const useRouter = () => router;
export const withRouter = (Component) => (props) => createElement(Component, { ...props, router });
export default router;`,
  "next/dynamic": `import { lazy, Suspense, createElement } from "react";
export default function dynamic(loader) {
  const Lazy = lazy(async () => {
    const mod = await (typeof loader === "function" ? loader() : loader);
    return mod && mod.default ? mod : { default: mod };
  });
  return function Dynamic(props) { return createElement(Suspense, { fallback: null }, createElement(Lazy, props)); };
}`,
};

// esm.sh serves many packages as dozens of small modules (@tanstack/react-router alone is one file
// per component), and esbuild asks for all of them at once. A burst like that, or a brief esm.sh
// hiccup, comes back as HTTP 5xx on a handful of files even though the package itself is fine, and
// one failed file fails the whole build. So: fetch a few at a time, retry transient failures with
// backoff, and remember what already succeeded so re-running Preview doesn't start from scratch.
const CDN_MAX_CONCURRENT = 6;
const CDN_RETRIES = 3;
const cdnTextCache = new Map<string, string>();
let cdnActive = 0;
const cdnWaiters: Array<() => void> = [];

async function acquireCdnSlot(): Promise<void> {
  if (cdnActive < CDN_MAX_CONCURRENT) { cdnActive++; return; }
  // The slot is handed straight to the next waiter in releaseCdnSlot, so the count stays accurate.
  await new Promise<void>((resolve) => cdnWaiters.push(resolve));
}

function releaseCdnSlot(): void {
  const next = cdnWaiters.shift();
  if (next) next();
  else cdnActive--;
}

async function fetchCdnText(url: string): Promise<{ text?: string; error?: string }> {
  const cached = cdnTextCache.get(url);
  if (cached !== undefined) return { text: cached };
  await acquireCdnSlot();
  try {
    let lastError = "";
    for (let attempt = 0; attempt <= CDN_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1) + Math.random() * 200));
      }
      try {
        const res = await fetch(url);
        if (res.ok) {
          const text = await res.text();
          cdnTextCache.set(url, text);
          return { text };
        }
        lastError = `HTTP ${res.status}`;
        // 404 and other 4xx won't change on a retry; 5xx, 429 and 408 are worth another go.
        if (res.status < 500 && res.status !== 429 && res.status !== 408) break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    return { error: lastError };
  } finally {
    releaseCdnSlot();
  }
}

// A bare import ("@tanstack/react-router") is fetched from esm.sh WITHOUT a version, so it always
// gets the newest release. A release published a few hours ago, which esm.sh may not have built yet,
// can then break Preview although nothing in the project changed. Exact versions in the project's
// package.json ("1.170.16", not "^1.170.16") are honoured so that can be worked around. The package.json
// used is the nearest one above the importing file, so a project kept in a subfolder works too. react and
// react-dom are never pinned, so every package keeps sharing a single copy of React.
const NEVER_PIN = new Set(["react", "react-dom"]);

/** Directories an "@/..." or "~/..." import can be rooted at, for a given importing file. The project
 *  isn't always at the top of the workspace (e.g. everything under "my-app/"), so besides "src" and
 *  the top level this also tries "src" and the folder itself at every level above the importer,
 *  shallowest first so a top-level project resolves exactly as before. */
function aliasBases(importer: string): string[] {
  const parts = importer.split("/").slice(0, -1);
  const bases: string[] = [];
  for (let i = 0; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join("/");
    bases.push(dir ? `${dir}/src` : "src", dir);
  }
  return bases;
}

function pinnedVersions(pkgText: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const pkg = JSON.parse(pkgText ?? "{}");
    for (const group of [pkg?.dependencies, pkg?.devDependencies]) {
      if (!group || typeof group !== "object") continue;
      for (const [name, range] of Object.entries(group)) {
        if (!NEVER_PIN.has(name) && typeof range === "string" && /^\d+\.\d+\.\d+([-+][\w.+-]+)?$/.test(range)) out[name] = range;
      }
    }
  } catch { /* package.json isn't valid JSON: nothing is pinned */ }
  return out;
}

function withPinnedVersion(spec: string, pins: Record<string, string>): string {
  // Splits "@scope/name/sub" or "name/sub"; a spec that already has an @version doesn't match.
  const m = /^((?:@[^/]+\/)?[^/@]+)(\/.*)?$/.exec(spec);
  if (!m) return spec;
  const version = pins[m[1]];
  return version ? `${m[1]}@${version}${m[2] ?? ""}` : spec;
}

/** Turns an esbuild failure into something readable: esbuild reports one error per file, so a single
 *  esm.sh outage on a package with many files would otherwise print the same sentence dozens of times. */
export function describeBuildError(e: unknown, fallback: string): string {
  const errors: unknown[] | undefined = (e as { errors?: unknown[] } | null)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return e instanceof Error ? e.message : fallback;
  const texts = errors.map((x) => String((x as { text?: unknown } | null)?.text ?? x));
  const fetchFails = texts.filter((t) => t.startsWith("Couldn't fetch https://esm.sh/"));
  const others = [...new Set(texts.filter((t) => !t.startsWith("Couldn't fetch https://esm.sh/")))];
  const lines: string[] = [];
  if (fetchFails.length > 0) {
    const pkgs = [...new Set(fetchFails.map((t) => /esm\.sh\/((?:@[^/@]+\/)?[^/@]+@[^/\s]+)/.exec(t)?.[1]).filter(Boolean))];
    const status = /\((HTTP \d+)\)/.exec(fetchFails[0])?.[1];
    lines.push(
      `esm.sh couldn't serve ${fetchFails.length} file${fetchFails.length === 1 ? "" : "s"} of ${pkgs.join(", ") || "a package"}${status ? ` (${status})` : ""}, even after retrying.`,
      "That's esm.sh failing to build or serve the package, not a problem in your code. If it keeps happening, pin the package to an earlier exact version in package.json (no ^ or ~), then run again."
    );
  }
  lines.push(...others.slice(0, 8));
  if (others.length > 8) lines.push(`…and ${others.length - 8} more errors.`);
  return lines.join("\n\n");
}

// next/font/google exports one function per font ("Inter", "Geist", ...), so a stand-in has to export
// exactly the names the project imports. They return a class name and a family a browser can use.
const GOOGLE_FONT_IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']next\/font\/google["']/g;
function googleFontsShim(files: VFiles): string {
  const names = new Set<string>();
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|mjs)$/i.test(path) || !source.includes("next/font/google")) continue;
    for (const m of source.matchAll(GOOGLE_FONT_IMPORT)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
  }
  const font = `() => ({ className: "", variable: "", style: { fontFamily: "system-ui, sans-serif" } })`;
  return [...names].map((n) => `export const ${n} = ${font};`).join("\n") + "\nexport default {};\n";
}

// Compiled-template formats that need their own compiler. Said plainly, instead of letting esbuild
// choke on the file as if it were JSX and print a wall of syntax errors.
const UNSUPPORTED_COMPILED: Record<string, string> = { vue: "Vue", svelte: "Svelte", astro: "Astro" };

// Stylesheets. Plain CSS is injected as a <style>. Sass/Less/Stylus can't be compiled here; the file is
// injected as it is, so plain-CSS parts still apply instead of the import failing the whole build.
const CSS_EXTS = new Set(["css", "scss", "sass", "less", "styl", "stylus", "pcss", "postcss"]);
const RESERVED_WORDS = new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "await", "async"]);

/** Class names a CSS Modules file defines. Comments, strings and url(...) are blanked first so file names and quoted text aren't mistaken for classes. */
function cssClassNames(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/url\([^)]*\)/gi, " ").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, " ");
  const names = new Set<string>();
  for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(m[1]);
  return [...names];
}

// Tailwind's browser build can't fetch other stylesheets, so prepareTailwindCss drops @imports. A remote one
// (usually web fonts: @import url("https://fonts.googleapis.com/...")) is something the page itself can
// load, so those are kept as an ordinary <style> in front of the Tailwind one.
const REMOTE_IMPORT = /@import\s+(?:url\(\s*)?["']?https?:\/\/[^"')\s]+["']?\s*\)?[^;]*;/g;
const remoteImports = (css: string): string => (css.match(REMOTE_IMPORT) ?? []).join("\n");

function cssSource(path: string, css: string, tailwindOn: boolean = tailwindReady): string {
  const tailwind = tailwindOn && isTailwindCss(css);
  const text = tailwind ? prepareTailwindCss(css) : css;
  const fonts = tailwind ? remoteImports(css) : "";
  let js = fonts ? `const __f=document.createElement("style");__f.textContent=${JSON.stringify(fonts)};document.head.appendChild(__f);` : "";
  js += `const __s=document.createElement("style");${tailwind ? '__s.setAttribute("type","text/tailwindcss");' : ""}__s.textContent=${JSON.stringify(text)};document.head.appendChild(__s);`;
  // `import styles from "./x.module.css"`: class names are kept as they are (not scoped per file), which
  // is enough for a preview and keeps `styles.card` working instead of failing with "no default export".
  if (/\.module\.[a-z]+$/i.test(path)) {
    const names = cssClassNames(css);
    js += `\nexport default ${JSON.stringify(Object.fromEntries(names.map((n) => [n, n])))};`;
    for (const n of names) if (/^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED_WORDS.has(n)) js += `\nexport const ${n} = ${JSON.stringify(n)};`;
  }
  return js;
}

// Vite's import.meta.env and Node-style process.env don't exist in the preview frame, so reading
// `import.meta.env.VITE_API_URL` at load would throw and blank the page. They become plain objects
// (values the project keeps in .env files aren't available). process.env.NODE_ENV is left to esbuild's define.
const IMPORT_META_ENV = '({"MODE":"development","DEV":true,"PROD":false,"SSR":false,"BASE_URL":"/"})';
function substituteEnv(source: string): string {
  let out = source;
  if (out.includes("import.meta.env")) out = out.replace(/\bimport\.meta\.env\b/g, IMPORT_META_ENV);
  if (out.includes("process.env")) out = out.replace(/\bprocess\.env\b(?!\.NODE_ENV\b)/g, "({})");
  return out;
}
const SCRIPT_EXTS = /^(?:[cm]?[jt]sx?)$/;

// Tailwind. Nothing in the preview compiles it, so a Tailwind site rendered unstyled. Tailwind's own
// in-browser build (@tailwindcss/browser, v4) compiles from <style type="text/tailwindcss"> plus the
// classes it finds in the page. It is bundled separately and is optional: if it can't be fetched the
// preview still renders, just unstyled, rather than failing. It covers Tailwind v4 CSS; a v3 project's
// tailwind.config.js (custom colours, plugins) can't be evaluated here, so those parts are missing.
const TAILWIND_RUNTIME_ENABLED = true;
const TAILWIND_RUNTIME_ENTRY = "__devaudit_tailwind__.js";
const TAILWIND_MARKERS = /@import\s+(?:url\()?["']tailwindcss|@tailwind\s+(?:base|components|utilities|variants)\b|@theme\b|@plugin\b|@source\b|@apply\b|@custom-variant\b|@utility\b/;

export const isTailwindCss = (css: string): boolean => TAILWIND_RUNTIME_ENABLED && TAILWIND_MARKERS.test(css);

/** The browser build can't load files, so imports of anything but Tailwind itself, @config and @plugin
 *  (which point at files/packages) are dropped; the v3 @tailwind directives become the v4 import. */
export function prepareTailwindCss(css: string): string {
  let out = css
    .replace(/@config\s+["'][^"']*["']\s*;?/g, "")
    .replace(/@plugin\s+["'][^"']*["']\s*(?:\{[^}]*\})?\s*;?/g, "")
    .replace(/@import\s+(?:url\()?["'](?!tailwindcss(?:\/|["']))[^"']*["']\)?[^;]*;/g, "")
    .replace(/@import\s+url\(\s*[^"'\s)][^)]*\)[^;]*;/g, "")
    .replace(/@tailwind\s+(?:base|components|utilities|variants)\s*;?/g, "");
  if (!/@import\s+(?:url\()?["']tailwindcss/.test(out)) out = `@import "tailwindcss";\n${out}`;
  return out;
}

const projectUsesTailwind = (files: VFiles): boolean =>
  TAILWIND_RUNTIME_ENABLED && Object.entries(files).some(([path, css]) => CSS_EXTS.has(path.split(".").pop()?.toLowerCase() ?? "") && isTailwindCss(css));

// True only while the runtime above is actually available. Tailwind CSS is marked type="text/tailwindcss"
// (which browsers ignore unless the runtime picks it up) only then, so when the runtime couldn't be
// fetched the stylesheet still applies as ordinary CSS instead of vanishing.
let tailwindReady = false;
let tailwindRuntime: Promise<string | null> | null = null;
/** The Tailwind runtime as one script, built once per page load; null if it couldn't be built. */
function tailwindRuntimeBundle(): Promise<string | null> {
  if (!tailwindRuntime) {
    tailwindRuntime = bundleEntry({ [TAILWIND_RUNTIME_ENTRY]: 'import "@tailwindcss/browser@4";' }, TAILWIND_RUNTIME_ENTRY)
      .then((code) => code, () => null)
      .then((code) => { tailwindReady = !!code; if (!code) tailwindRuntime = null; return code; });
  }
  return tailwindRuntime;
}

// tsconfig.json / jsconfig.json "paths" and "baseUrl" are how most projects spell their import aliases
// ("@/*": ["./app/*"], "~/*": ["./src/*"], "#lib/*": ["./lib/*"]). They are read first, so a project whose
// "@" points somewhere other than src/ resolves; the "@/ means src/ or the top" guess below is only the
// fallback for projects without one.
type TsPaths = { paths: Record<string, string[]>; base: string; baseUrl: string | null };
const TS_CONFIG_NAMES = ["tsconfig.json", "jsconfig.json", "tsconfig.app.json"];

/** JSON with comments and trailing commas, which is what tsconfig.json usually is. null if it can't be read. */
function parseJsonc(text: string): any {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")); } catch { return null; }
}

function readCompilerOptions(files: VFiles, path: string, depth = 0): { paths?: Record<string, string[]>; pathsDir?: string; baseUrl?: string } {
  const cfg = files[path] !== undefined ? parseJsonc(files[path]) : null;
  if (!cfg || typeof cfg !== "object") return {};
  const dir = dirOf(path);
  let out: { paths?: Record<string, string[]>; pathsDir?: string; baseUrl?: string } = {};
  // "extends" is followed for relative files only, a few levels deep; the child's own options win.
  if (depth < 3 && typeof cfg.extends === "string" && cfg.extends.startsWith(".")) {
    out = readCompilerOptions(files, collapsePath(`${dir}/${cfg.extends.endsWith(".json") ? cfg.extends : `${cfg.extends}.json`}`), depth + 1);
  }
  const co = cfg.compilerOptions;
  if (co && typeof co === "object") {
    if (typeof co.baseUrl === "string") out.baseUrl = collapsePath(`${dir}/${co.baseUrl}`);
    if (co.paths && typeof co.paths === "object") { out.paths = co.paths; out.pathsDir = dir; }
  }
  return out;
}

/** The alias settings that apply to a file: from the nearest folder above it that has a config with paths or baseUrl. */
function tsPathsFor(files: VFiles, importer: string, cache: Map<string, TsPaths | null>): TsPaths | null {
  for (const dir of [...ancestorDirs(importer)].reverse().concat([""])) {
    if (!cache.has(dir)) {
      let found: TsPaths | null = null;
      for (const name of TS_CONFIG_NAMES) {
        const path = dir ? `${dir}/${name}` : name;
        if (files[path] === undefined) continue;
        const o = readCompilerOptions(files, path);
        if (o.paths || o.baseUrl !== undefined) {
          // TypeScript resolves "paths" against baseUrl when there is one, else against the config that declares them.
          found = { paths: o.paths ?? {}, base: o.baseUrl ?? o.pathsDir ?? dir, baseUrl: o.baseUrl ?? null };
          break;
        }
      }
      cache.set(dir, found);
    }
    const hit = cache.get(dir);
    if (hit) return hit;
  }
  return null;
}

/** What a "paths" key captures from an import: "@/*" with "@/lib/x" gives "lib/x"; an exact key gives "". null if it doesn't match. */
function matchPathPattern(pattern: string, spec: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === spec ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix)
    ? spec.slice(prefix.length, spec.length - suffix.length)
    : null;
}

const patternPrefixLength = (pattern: string) => (pattern.indexOf("*") === -1 ? pattern.length : pattern.indexOf("*"));

/** The longest-prefix "paths" entry wins (as in TypeScript), then baseUrl. A lone "*" key matches everything, so it never counts as "this import is an alias". */
function resolveTsPath(files: VFiles, cfg: TsPaths, spec: string): { hit: string | null; isAlias: boolean } {
  let best: { pattern: string; capture: string } | null = null;
  for (const pattern of Object.keys(cfg.paths)) {
    const capture = matchPathPattern(pattern, spec);
    if (capture !== null && (!best || patternPrefixLength(pattern) > patternPrefixLength(best.pattern))) best = { pattern, capture };
  }
  const isAlias = best !== null && best.pattern !== "*";
  if (best) {
    const capture = best.capture;
    const targets = Array.isArray(cfg.paths[best.pattern]) ? cfg.paths[best.pattern] : [];
    for (const target of targets) {
      if (typeof target !== "string") continue;
      const hit = resolveVirtual(files, cfg.base, target.replace("*", () => capture));
      if (hit) return { hit, isAlias };
    }
  }
  if (cfg.baseUrl !== null) {
    const hit = resolveVirtual(files, cfg.baseUrl, spec);
    if (hit) return { hit, isAlias };
  }
  return { hit: null, isAlias };
}

/** What `import x from "./a.css?url"` is given: a stylesheet with nothing in it. The real one is applied as a <style> at import. */
const EMPTY_CSS_URL = "data:text/css;charset=utf-8,%2F*%20applied%20by%20DevAudit%20Preview%20*%2F";

/** Where a reference written in a file (an image, a font) could be: relative to the file, or, when it starts with "/", the
 *  project's own root, its public/ folder, or those one level up from the file (the project may sit in a subfolder). */
function assetCandidates(fromFile: string, ref: string): string[] {
  if (!ref.startsWith("/")) return [resolvePreviewPath(fromFile, ref)];
  const rel = ref.slice(1);
  return ["", ...ancestorDirs(fromFile)].flatMap((dir) => [collapsePath(`${dir}/${rel}`), collapsePath(`${dir}/public/${rel}`)]);
}

/** Turns the `url(...)` references in a stylesheet that point at a kept image or font (or a text SVG of the workspace)
 *  into `data:` URLs, so `@font-face` and `background-image` work in the preview frame, where relative paths lead nowhere. */
async function inlineCssAssets(css: string, cssPath: string, files: VFiles, assets: PreviewAssetMap): Promise<string> {
  if (!css.includes("url(")) return css;
  const re = /url\(\s*(["']?)([^"')\s][^"')]*?)\1\s*\)/gi;
  const urls = new Map<string, string>();
  for (const m of css.matchAll(re)) {
    const ref = m[2];
    if (urls.has(ref) || isRemoteOrData(ref) || ref.startsWith("#")) continue;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) continue;
    for (const c of assetCandidates(cssPath, clean)) {
      if (Object.prototype.hasOwnProperty.call(assets, c)) { urls.set(ref, await previewAssetDataUrl(assets[c], c)); break; }
      if (/\.svg$/i.test(c) && files[c] !== undefined) { urls.set(ref, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[c])}`); break; }
    }
  }
  return urls.size === 0 ? css : css.replace(re, (whole, _q, ref) => (urls.has(ref) ? `url("${urls.get(ref)}")` : whole));
}

/** `assets` are the images and fonts kept for Preview (see previewAssets.ts): they resolve like workspace files, so
 *  `import bg from "@/assets/bg.jpg"` works. `missing` collects the binary imports nothing was kept for. */
function virtualFsPlugin(files: VFiles, assets: PreviewAssetMap = {}, missing: Set<string> = new Set()) {
  // Every path an import can land on: the workspace's files, plus the kept images and fonts.
  const known: VFiles = Object.keys(assets).length ? { ...Object.fromEntries(Object.keys(assets).map((p) => [p, ""])), ...files } : files;
  const tsCache = new Map<string, TsPaths | null>();
  const nextShim = (spec: string): string | undefined =>
    spec === "next/font/google" ? googleFontsShim(files) : Object.prototype.hasOwnProperty.call(NEXT_SHIMS, spec) ? NEXT_SHIMS[spec] : undefined;
  const pinCache = new Map<string, Record<string, string>>();
  const pinsFor = (importer: string): Record<string, string> => {
    const parts = importer.split("/").slice(0, -1);
    for (let i = parts.length; i >= 0; i--) {
      const pkgPath = [...parts.slice(0, i), "package.json"].join("/");
      if (files[pkgPath] === undefined) continue;
      let pins = pinCache.get(pkgPath);
      if (!pins) { pins = pinnedVersions(files[pkgPath]); pinCache.set(pkgPath, pins); }
      return pins;
    }
    return {};
  };
  return {
    name: "devaudit-vfs",
    setup(build: any) {
      const resolveImport = (args: any): any => {
        if (args.kind === "entry-point") return { path: args.path, namespace: "virtual" };
        if (args.namespace !== "cdn" && nextShim(args.path) !== undefined) return { path: args.path, namespace: "next-shim" };
        // An import written INSIDE a downloaded package (namespace "cdn") is relative to that
        // module's own URL, not to the project's virtual file system. esm.sh serves things like
        // `export * from "/react@18.3.1/..."`, which must resolve against https://esm.sh — treating
        // it as a virtual-FS path fails with "Cannot find ...".
        if (args.namespace === "cdn" && (args.path.startsWith(".") || args.path.startsWith("/"))) {
          try {
            return { path: new URL(args.path, args.importer).href, namespace: "cdn" };
          } catch {
            return { errors: [{ text: `Couldn't resolve "${args.path}" imported from "${args.importer}"` }] };
          }
        }
        if (args.path.startsWith(".") || args.path.startsWith("/")) {
          const fromDir = args.namespace === "virtual" ? dirOf(args.importer) : "";
          let resolved = resolveVirtual(known, fromDir, args.path);
          if (!resolved && args.path.startsWith("/") && args.namespace === "virtual") {
            for (const dir of ancestorDirs(args.importer)) {
              resolved = resolveVirtual(known, dir, args.path.slice(1));
              if (resolved) break;
            }
          }
          if (!resolved) {
            // Images, fonts and other binary files aren't kept in the workspace, so an import of one
            // gets an empty stand-in instead of taking the whole page down with a "Cannot find".
            if (BINARY.test(args.path)) { missing.add(args.path); return { path: args.path, namespace: "asset-stub" }; }
            return { errors: [{ text: `Cannot find "${args.path}" imported from "${args.importer}"` }] };
          }
          return { path: resolved, namespace: "virtual" };
        }
        // "@/components/Hero" and "~/lib/utils": the usual tsconfig alias for the project's source root.
        if (args.namespace === "virtual" && !/^[./]|^https?:\/\//.test(args.path)) {
          const cfg = tsPathsFor(files, args.importer, tsCache);
          const resolved = cfg ? resolveTsPath(known, cfg, args.path) : null;
          if (resolved?.hit) return { path: resolved.hit, namespace: "virtual" };
          // Recognised as one of the project's own aliases but nothing is there: say so (or stub an image the
          // file list doesn't hold) instead of asking esm.sh for a package that doesn't exist.
          if (resolved?.isAlias) {
            if (BINARY.test(args.path)) { missing.add(args.path); return { path: args.path, namespace: "asset-stub" }; }
            return { errors: [{ text: `Cannot find "${args.path}" imported from "${args.importer}"` }] };
          }
        }
        if (args.namespace !== "cdn" && /^[@~]\//.test(args.path)) {
          const rest = args.path.slice(2);
          let aliased: string | null = null;
          for (const base of aliasBases(args.importer)) {
            aliased = resolveVirtual(known, base, rest);
            if (aliased) break;
          }
          if (aliased) return { path: aliased, namespace: "virtual" };
          if (BINARY.test(rest)) { missing.add(args.path); return { path: args.path, namespace: "asset-stub" }; }
          return { errors: [{ text: `Cannot find "${args.path}" imported from "${args.importer}"` }] };
        }
        if (/^https?:\/\//.test(args.path)) return { path: args.path, namespace: "cdn" };
        return { path: `https://esm.sh/${withPinnedVersion(args.path, pinsFor(args.importer))}`, namespace: "cdn" };
      };
      // Vite-style query suffixes ("./styles.css?url", "./notes.md?raw") name the same file with a different
      // meaning, so the file is resolved without the suffix and the suffix travels along to onLoad.
      build.onResolve({ filter: /\?[^/]*$/ }, (args: any) => {
        if (args.kind === "entry-point" || args.namespace === "cdn" || /^https?:\/\//.test(args.path)) return undefined;
        const q = args.path.indexOf("?");
        const inner = resolveImport({ ...args, path: args.path.slice(0, q) });
        if (inner && inner.namespace === "virtual" && !inner.errors) return { ...inner, suffix: args.path.slice(q) };
        return inner;
      });
      build.onResolve({ filter: /.*/ }, resolveImport);
      build.onLoad({ filter: /.*/, namespace: "virtual" }, async (args: any) => {
        const contents = files[args.path];
        if (contents === undefined) {
          // An image or font kept for Preview: `import logo from "./logo.png"` gives the image's URL, as in a real bundler.
          if (Object.prototype.hasOwnProperty.call(assets, args.path)) {
            return { contents: `export default ${JSON.stringify(await previewAssetDataUrl(assets[args.path], args.path))};`, loader: "js" };
          }
          return { errors: [{ text: `File not found: ${args.path}` }] };
        }
        const ext = args.path.split(".").pop()?.toLowerCase() ?? "";
        const query: string = args.suffix ?? "";
        if (query) {
          const has = (flag: string) => new RegExp(`[?&]${flag}(?:[&=]|$)`).test(query);
          if (has("raw")) return { contents: `export default ${JSON.stringify(contents)};`, loader: "js" };
          if (has("inline") && CSS_EXTS.has(ext)) return { contents: `export default ${JSON.stringify(contents)};`, loader: "js" };
          if (has("url")) {
            // `import appCss from "../styles.css?url"` hands back a URL that a <link> then loads. The stylesheet is
            // applied here instead (as a <style>, so Tailwind's runtime can compile it) and the URL is an empty one.
            if (CSS_EXTS.has(ext)) {
              const css = await inlineCssAssets(contents, args.path, files, assets);
              return { contents: `${cssSource(args.path.replace(/\.module\./i, "."), css)}\nexport default ${JSON.stringify(EMPTY_CSS_URL)};`, loader: "js" };
            }
            if (ext === "svg") return { contents: `export default ${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(contents)}`)};`, loader: "js" };
            return { contents: `export default ${JSON.stringify(`data:text/plain;charset=utf-8,${encodeURIComponent(contents)}`)};`, loader: "js" };
          }
        }
        if (Object.prototype.hasOwnProperty.call(UNSUPPORTED_COMPILED, ext)) {
          return { errors: [{ text: `Preview can't compile ${UNSUPPORTED_COMPILED[ext]} files yet (${args.path}), so a project that uses them can't be previewed here.` }] };
        }
        if (CSS_EXTS.has(ext)) return { contents: cssSource(args.path, await inlineCssAssets(contents, args.path, files, assets)), loader: "js" };
        if (ext === "svg") {
          // `import logo from "./logo.svg"` gives the image's URL, as it does in a real bundler.
          return { contents: `export default ${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(contents)}`)};`, loader: "js" };
        }
        return { contents: SCRIPT_EXTS.test(ext) ? substituteEnv(contents) : contents, loader: EXT_LOADER[ext] ?? "jsx" };
      });
      build.onLoad({ filter: /.*/, namespace: "asset-stub" }, () => ({ contents: 'export default "";', loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "next-shim" }, (args: any) => ({ contents: nextShim(args.path) ?? "", loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "cdn" }, async (args: any) => {
        // Package source is only ever downloaded from esm.sh (the one host the CSP's connect-src
        // allows), over https, so a typo'd or hostile URL in a project can't turn Preview into a
        // way to make this page fetch arbitrary hosts.
        let origin = "";
        try { origin = new URL(args.path).origin; } catch { /* handled below */ }
        if (origin !== "https://esm.sh") {
          return { errors: [{ text: `Preview can only import packages from esm.sh (got "${args.path}").` }] };
        }
        const got = await fetchCdnText(args.path);
        if (got.text === undefined) {
          return { errors: [{ text: `Couldn't fetch ${args.path} (${got.error}) after ${CDN_RETRIES + 1} tries.` }] };
        }
        return { contents: got.text, loader: "js" };
      });
    },
  };
}

// Bundled (esbuild) entries reference `localStorage`/`sessionStorage` as bare globals. The real
// window properties throw while the preview iframe is sandboxed (see previewBootstrap above), and
// that throw can't reliably be shimmed from inside the frame — Chromium locks those getters as
// non-overridable in that state. So instead we make the bundle never touch the real property at
// all: esbuild's `inject` rewrites free references to these identifiers to imports from this
// virtual module, giving bundled code a real, working in-memory Storage implementation.
const STORAGE_SHIM_PATH = "devaudit-storage-shim";
const STORAGE_SHIM_SOURCE = `
function createMemoryStorage() {
  var data = new Map();
  return {
    getItem: function (k) { k = String(k); return data.has(k) ? data.get(k) : null; },
    setItem: function (k, v) { data.set(String(k), String(v)); },
    removeItem: function (k) { data.delete(String(k)); },
    clear: function () { data.clear(); },
    key: function (i) { return Array.from(data.keys())[i] ?? null; },
    get length() { return data.size; },
  };
}
export const localStorage = createMemoryStorage();
export const sessionStorage = createMemoryStorage();
`;

function storageShimPlugin() {
  return {
    name: "devaudit-storage-shim",
    setup(build: any) {
      build.onResolve({ filter: new RegExp(`^${STORAGE_SHIM_PATH}$`) }, () => ({ path: STORAGE_SHIM_PATH, namespace: "devaudit-shim" }));
      build.onLoad({ filter: /.*/, namespace: "devaudit-shim" }, () => ({ contents: STORAGE_SHIM_SOURCE, loader: "js" }));
    },
  };
}

/** What a build may use besides the workspace's files. */
export type BuildExtras = {
  /** Images and fonts kept for Preview (see previewAssets.ts), by workspace path. */
  assets?: PreviewAssetMap;
  /** Called after a build with the binary files the project imports that nothing was kept for. */
  onMissingAssets?: (paths: string[]) => void;
};

export async function bundleEntry(files: VFiles, entryPath: string, extras: BuildExtras = {}): Promise<string> {
  const esbuild = await getEsbuild();
  const missing = new Set<string>();
  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [storageShimPlugin(), virtualFsPlugin(files, extras.assets, missing)],
    inject: [STORAGE_SHIM_PATH],
    logLevel: "silent",
  });
  if (missing.size > 0) extras.onMissingAssets?.([...missing]);
  const out = result.outputFiles?.[0]?.text;
  if (!out) throw new Error("Bundling produced no output.");
  return out;
}

// A project that is only components has no file that starts the app, so Preview writes one: a tiny
// entry that imports the component(s) and mounts them into #root. It exists only inside the bundle.
const MOUNT_ENTRY_PATH = "__devaudit_mount__.jsx";

// The generated entry lives next to the package.json that governs the component (so "pinned" versions
// in a subfolder project apply to it too) and imports components by absolute workspace path.
/** The folder of the project a file belongs to: the nearest one above it with a package.json, else the workspace top. */
function projectRootFor(files: VFiles, near: string): string {
  const parts = near.split("/").slice(0, -1);
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    if (files[dir ? `${dir}/package.json` : "package.json"] !== undefined) return dir;
  }
  return "";
}

function mountEntryPath(files: VFiles, near: string): string {
  const root = projectRootFor(files, near);
  return root ? `${root}/${MOUNT_ENTRY_PATH}` : MOUNT_ENTRY_PATH;
}

// A page mounted without its app (a TanStack route without __root.tsx, a Next page without layout.tsx)
// doesn't import the project's global stylesheet, because the app shell does that. The usual names are
// loaded for it, otherwise a Tailwind/CSS site renders as unstyled text.
const GLOBAL_CSS_NAMES = [
  "src/styles.css", "src/index.css", "src/app.css", "src/global.css", "src/globals.css",
  "src/styles/globals.css", "src/styles/global.css", "src/styles/index.css", "src/App.css",
  "app/globals.css", "app/global.css", "app/index.css", "styles/globals.css", "styles/global.css", "styles/index.css",
  "index.css", "globals.css", "global.css", "style.css",
];
function globalStylesheets(files: VFiles, near: string): string[] {
  const root = projectRootFor(files, near);
  return GLOBAL_CSS_NAMES.map((n) => (root ? `${root}/${n}` : n)).filter((p) => files[p] !== undefined).slice(0, 4);
}

// TanStack Router/Start file routes (src/routes/*.tsx) don't export a component: they export Route,
// made by createFileRoute("/")({ component }). The real app gets its route tree from a generated file
// built by a Vite plugin, which doesn't exist here, so for these files the mount hangs the route off a
// bare root inside an in-memory router and shows it at "/". Only added when a mounted file uses it,
// so projects without TanStack Router never download it.
const ROUTE_FILE = /\bcreate(?:File|Root)Route(?:WithContext)?\b/;
const ROUTER_IMPORT = `import { createRouter, createRootRoute, createMemoryHistory, RouterProvider, Outlet } from "@tanstack/react-router";
`;
const ROUTED_PAGE_SOURCE = `function routeOf(mod) {
  const r = mod && mod.Route;
  return r && typeof r === "object" && r.options ? r : null;
}
function RoutedPage({ route }) {
  const router = useMemo(() => {
    if (typeof route.update !== "function") return null;
    const root = createRootRoute({ component: Outlet });
    const leaf = route.update({ id: "/", path: "/", getParentRoute: () => root });
    return createRouter({ routeTree: root.addChildren([leaf]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  }, [route]);
  if (router) return <RouterProvider router={router} />;
  const Page = route.options.component;
  return Page ? <Page /> : null;
}
`;
const NO_ROUTED_PAGE_SOURCE = `function routeOf() { return null; }
const RoutedPage = () => null;
`;

function mountEntrySource(entry: PreviewEntry, files: VFiles): string {
  const comps = entry.mount === "gallery" && entry.components?.length ? entry.components : [entry.path];
  const imports = comps.map((p, i) => `import * as M${i} from ${JSON.stringify(`/${p}`)};`).join("\n");
  const items = comps.map((p, i) => `{ file: ${JSON.stringify(p)}, mod: M${i} }`).join(", ");
  const routed = comps.some((p) => ROUTE_FILE.test(files[p] ?? ""));
  // Stylesheets first, so the page's own (component-level) CSS still comes after and wins.
  const styles = [...new Set(comps.flatMap((p) => globalStylesheets(files, p)))].map((p) => `import ${JSON.stringify(`/${p}`)};`).join("\n");
  return `import { Component, useMemo } from "react";
import { createRoot } from "react-dom/client";
${routed ? ROUTER_IMPORT : ""}${styles ? `${styles}\n` : ""}${imports}

const ITEMS = [${items}];
const GALLERY = ${entry.mount === "gallery" ? "true" : "false"};

${routed ? ROUTED_PAGE_SOURCE : NO_ROUTED_PAGE_SOURCE}
const isComponentLike = (v) => typeof v === "function" || (v !== null && typeof v === "object" && "$$typeof" in v);
function pick(mod) {
  if (isComponentLike(mod.default)) return mod.default;
  for (const key of Object.keys(mod)) if (/^[A-Z]/.test(key) && isComponentLike(mod[key])) return mod[key];
  return null;
}

const errorStyle = { margin: 0, padding: "12px 16px", whiteSpace: "pre-wrap", font: "12px/1.5 ui-monospace, monospace", color: "#b91c1c", background: "#fef2f2" };

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(this.props.file + " failed to render: " + (error && error.message ? error.message : String(error))); }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return <pre style={errorStyle}>{this.props.file + " failed to render: " + (e && e.message ? e.message : String(e))}</pre>;
  }
}

function Preview() {
  const shown = ITEMS.map((item) => { const route = routeOf(item.mod); return { file: item.file, route, Comp: route ? null : pick(item.mod) }; }).filter((x) => x.route || x.Comp);
  if (shown.length === 0) return <pre style={errorStyle}>{"No React component is exported from " + ITEMS.map((i) => i.file).join(", ") + "."}</pre>;
  return shown.map(({ file, route, Comp }) => (
    <Boundary key={file} file={file}>
      {GALLERY ? <div style={{ padding: "6px 12px", font: "11px ui-monospace, monospace", color: "#71717a", background: "#f4f4f5", borderTop: "1px solid #e4e4e7" }}>{file}</div> : null}
      {route ? <RoutedPage route={route} /> : <Comp />}
    </Boundary>
  ));
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<Preview />);
`;
}

// A whole TanStack Router / Start site. The project's own router file builds the router from the generated route
// tree, so the root layout, every route and the <Link>s between them behave as they do in the real app. Two
// things differ from the real app, because this runs in a frame rather than on the site's own address:
//   * the router gets an in-memory history (a sandboxed frame has no address of its own to navigate);
//   * a TanStack Start root route renders the whole document (<html>, <head>, <body>, <Scripts />), which can't be
//     rendered into a <div>. That shell is replaced by one that renders just the head tags (<HeadContent />, which
//     is where fonts and the page title come from) and the app.
function appMountSource(entry: PreviewEntry): string {
  const routerPath = entry.routerPath ?? entry.path;
  return `import { Component } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, HeadContent, createMemoryHistory } from "@tanstack/react-router";
import * as RouterModule from ${JSON.stringify(`/${routerPath}`)};

const errorStyle = { margin: 0, padding: "12px 16px", whiteSpace: "pre-wrap", font: "12px/1.5 ui-monospace, monospace", color: "#b91c1c", background: "#fef2f2" };

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error("The app failed to render: " + (error && error.message ? error.message : String(error))); }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return <pre style={errorStyle}>{"The app failed to render: " + (e && e.message ? e.message : String(e))}</pre>;
  }
}

function makeRouter() {
  const make = RouterModule.getRouter || RouterModule.createRouter;
  if (typeof make === "function") return make();
  if (RouterModule.router) return RouterModule.router;
  throw new Error(${JSON.stringify(`${routerPath} doesn't export getRouter(), createRouter() or router.`)});
}

function Shell({ children }) {
  return <><HeadContent />{children}</>;
}

const rootEl = document.getElementById("root");
if (rootEl) {
  try {
    const router = makeRouter();
    router.update({ history: createMemoryHistory({ initialEntries: [${JSON.stringify(entry.initialPath || "/")}] }) });
    const root = router.routesById && router.routesById.__root__;
    if (root && root.options && root.options.shellComponent) root.options.shellComponent = Shell;
    createRoot(rootEl).render(<Boundary><RouterProvider router={router} /></Boundary>);
  } catch (e) {
    createRoot(rootEl).render(<pre style={errorStyle}>{"The app couldn't start: " + (e && e.message ? e.message : String(e))}</pre>);
    throw e;
  }
}
`;
}

/** Bundles whatever Preview is going to run for this entry (a real entry file, or a generated mount). */
export async function bundlePreviewEntry(files: VFiles, entry: PreviewEntry, extras: BuildExtras = {}): Promise<string> {
  if (!entry.mount) return bundleEntry(files, entry.path, extras);
  const mountPath = mountEntryPath(files, entry.path);
  return bundleEntry({ ...files, [mountPath]: entry.mount === "app" ? appMountSource(entry) : mountEntrySource(entry, files) }, mountPath, extras);
}

function collapsePath(combined: string): string {
  const out: string[] = [];
  for (const part of combined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function resolvePreviewPath(fromFile: string, rel: string): string {
  const baseDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const combined = rel.startsWith("/") ? rel.slice(1) : `${baseDir ? `${baseDir}/` : ""}${rel}`;
  return collapsePath(combined);
}

/** The folders above a file, shallowest first ("a/b/c.tsx" gives ["a", "a/b"]; the workspace top is not listed). */
const ancestorDirs = (path: string): string[] => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/** Where a reference could point. A root-absolute one ("/src/main.tsx", as Vite pages write them) means
 *  the project's own root, which is the workspace top only when the project isn't in a subfolder, so
 *  the folders above the referring file are tried after the top. */
function previewPathCandidates(fromFile: string, rel: string): string[] {
  const first = resolvePreviewPath(fromFile, rel);
  if (!rel.startsWith("/")) return [first];
  return [first, ...ancestorDirs(fromFile).map((dir) => collapsePath(`${dir}/${rel.slice(1)}`))];
}

function resolvePreviewAsset(files: VFiles, fromFile: string, rel: string): string {
  const candidates = previewPathCandidates(fromFile, rel);
  return candidates.find((c) => files[c] !== undefined) ?? candidates[0];
}

const isRemoteOrData = (src: string) => /^(https?:)?\/\//i.test(src) || /^data:/i.test(src);
const escapeScriptClose = (s: string) => s.replace(/<\/script/gi, "<\\/script");

const SCRIPT_SRC_RE = /<script\b([^>]*?)\ssrc=(["'])([^"']+)\2([^>]*)><\/script>/gi;

/** A page's local scripts that a browser can't run as written: TypeScript/JSX (a Vite-style
 *  `<script type="module" src="/src/main.tsx">`), or ES modules that import other files. These are
 *  bundled (esbuild) before being inlined; plain scripts are inlined as they are. */
function scriptNeedsBundling(attrs: string, path: string, source: string): boolean {
  if (/\.(tsx?|jsx|mts|cts)$/i.test(path)) return true;
  return /\btype=(["'])module\1/i.test(attrs) && /^\s*(import|export)\b/m.test(source);
}

async function bundleHtmlScripts(html: string, files: VFiles, page: string, extras: BuildExtras = {}): Promise<Map<string, string>> {
  const paths: string[] = [];
  html.replace(SCRIPT_SRC_RE, (whole, pre, _q, src, post) => {
    if (isRemoteOrData(src)) return whole;
    const path = resolvePreviewAsset(files, page, src);
    const source = files[path];
    if (source !== undefined && !paths.includes(path) && scriptNeedsBundling(`${pre} ${post}`, path, source)) paths.push(path);
    return whole;
  });
  const bundled = new Map<string, string>();
  for (const path of paths) bundled.set(path, await bundleEntry(files, path, extras));
  return bundled;
}

async function replaceAsync(input: string, re: RegExp, fn: (m: RegExpMatchArray) => Promise<string>): Promise<string> {
  const matches = [...input.matchAll(re)];
  const parts = await Promise.all(matches.map(fn));
  let out = "";
  let last = 0;
  matches.forEach((m, i) => { out += input.slice(last, m.index) + parts[i]; last = (m.index ?? 0) + m[0].length; });
  return out + input.slice(last);
}

/** The data: URL of the kept image/font a page's reference (`img/logo.png`, `../fonts/x.woff2`) points at, if there is one. */
async function keptAssetUrl(assets: PreviewAssetMap, fromFile: string, ref: string): Promise<string | null> {
  if (isRemoteOrData(ref) || ref.startsWith("#")) return null;
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return null;
  for (const c of assetCandidates(fromFile, clean)) if (Object.prototype.hasOwnProperty.call(assets, c)) return previewAssetDataUrl(assets[c], c);
  return null;
}

/** Runs `fn` on the parts of an HTML document that are markup, never on the text inside <script> elements (script text, and
 *  the bundles that get inlined into it, are full of strings that look like tags). */
async function mapOutsideScripts(html: string, fn: (markup: string) => Promise<string>): Promise<string> {
  const parts = html.split(/(<script\b[\s\S]*?<\/script>)/gi);
  return (await Promise.all(parts.map((part, i) => (i % 2 === 1 ? part : fn(part))))).join("");
}

async function inlinePreviewAssets(html: string, files: VFiles, entry: string, bundled: Map<string, string>, assets: PreviewAssetMap = {}): Promise<string> {
  // Done on the page's own markup before any script is inlined: url(...) in <style> blocks, and the kept images and
  // icons that a tag points at (`<img src="img/logo.png">`).
  const markup = Object.keys(assets).length === 0 ? html : await mapOutsideScripts(html, async (part) => {
    let m = await replaceAsync(part, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, async ([, open, css, close]) => `${open}${await inlineCssAssets(css, entry, files, assets)}${close}`);
    m = await replaceAsync(m, /<(?:img|source|video|audio|link)\b[^>]*>/gi, async ([whole]) => {
      const isLink = /^<link\b/i.test(whole);
      if (isLink && !/rel=(["'])[^"']*icon[^"']*\1/i.test(whole)) return whole;
      const attr = isLink ? whole.match(/\shref=(["'])([^"']+)\1/i) : whole.match(/\s(?:src|poster)=(["'])([^"']+)\1/i);
      if (!attr) return whole;
      const url = await keptAssetUrl(assets, entry, attr[2]);
      return url ? whole.replace(attr[0], attr[0].replace(attr[2], () => url)) : whole;
    });
    return m;
  });
  let out = markup.replace(SCRIPT_SRC_RE, (whole, pre, _q, src, post) => {
    if (isRemoteOrData(src)) return whole;
    const path = resolvePreviewAsset(files, entry, src);
    const content = files[path];
    if (content === undefined) return `<!-- devaudit: script not found: ${path} -->`;
    const code = bundled.get(path);
    if (code !== undefined) return `<script type="module">${escapeScriptClose(code)}</script>`;
    const attrs = `${pre} ${post}`.replace(/\ssrc=(["'])[^"']*\1/i, " ").trim();
    return `<script ${attrs}>${escapeScriptClose(content)}</script>`;
  });
  // <img src="logo.svg">: SVGs are text, so they're kept in the workspace and can be shown.
  out = out.replace(/<img\b[^>]*>/gi, (whole) => {
    const m = whole.match(/\ssrc=(["'])([^"']+\.svg)\1/i);
    if (!m || isRemoteOrData(m[2])) return whole;
    const content = files[resolvePreviewAsset(files, entry, m[2])];
    if (content === undefined) return whole;
    return whole.replace(m[0], ` src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}"`);
  });
  out = await replaceAsync(out, /<link\b[^>]*>/gi, async ([whole]) => {
    if (!/rel=(["'])stylesheet\1/i.test(whole)) return whole;
    const m = whole.match(/href=(["'])([^"']+)\1/i);
    if (!m) return whole;
    const src = m[2];
    if (isRemoteOrData(src)) return whole;
    const path = resolvePreviewAsset(files, entry, src);
    const raw = files[path];
    if (raw === undefined) return `<!-- devaudit: stylesheet not found: ${path} -->`;
    const content = await inlineCssAssets(raw, path, files, assets);
    return tailwindReady && isTailwindCss(content) ? `<style type="text/tailwindcss">${prepareTailwindCss(content)}</style>` : `<style>${content}</style>`;
  });
  return out;
}

// Runs inside an HTML preview. The frame only holds an in-memory document, so a link to another page
// of the project can't navigate it; this asks the parent panel to show that page instead. Links to
// other sites, #anchors and mailto:/tel: are left alone. It listens in the bubble phase, after any
// router in the page (React Router, ...) has handled the click and called preventDefault, so it
// never takes a click away from the page's own code. (No backslashes here: it sits in a template string.)
const PAGE_LINK_SNIPPET = `
    function isLocalLink(h){
      if (!h || h.charAt(0) === "#" || h.indexOf("//") === 0) return false;
      var colon = h.indexOf(":"), slash = h.indexOf("/");
      return !(colon !== -1 && (slash === -1 || colon < slash));
    }
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      var href = a.getAttribute("href");
      if (!isLocalLink(href)) return;
      e.preventDefault();
      send("navigate", { href: href });
    });`;

function previewBootstrap(runId: string, pageLinks = false): string {
  return `<script>(function(){
    var RUN_ID = ${JSON.stringify(runId)};
    function makeMemoryStorage(){
      var data = {};
      return {
        getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function(k, v){ data[String(k)] = String(v); },
        removeItem: function(k){ delete data[String(k)]; },
        clear: function(){ data = {}; },
        key: function(i){ return Object.keys(data)[i] ?? null; },
        get length(){ return Object.keys(data).length; },
      };
    }
    [["localStorage", makeMemoryStorage()], ["sessionStorage", makeMemoryStorage()]].forEach(function(pair){
      try { window[pair[0]]; return; } catch (e) {}
      try { Object.defineProperty(window, pair[0], { value: pair[1], configurable: true, writable: true, enumerable: true }); } catch (e) {}
    });
    // Chromium locks the real localStorage/sessionStorage getters as non-overridable while the
    // frame is sandboxed without "allow-same-origin", so the shim above can silently fail to take.
    // That's an expected limitation of this sandbox — not a bug in the project's code — so it's
    // filtered out here instead of being reported as a crash.
    function isSandboxStorageError(msg){
      return typeof msg === "string" && /sandboxed and lacks the 'allow-same-origin' flag/.test(msg);
    }
    function send(type, detail){
      try {
        var m = { __devaudit_preview: true, runId: RUN_ID, type: type, detail: detail };
        // As a full-page tab there is no parent frame; preview-frame.html provides this one-way channel to DevAudit.
        if (window.__devaudit_send) window.__devaudit_send(m); else window.parent.postMessage(m, "*");
      } catch (e) {}
    }
    window.addEventListener("error", function (e) {
      if (isSandboxStorageError(e.message)) return;
      send("error", { message: e.message || "Script error", stack: e.error && e.error.stack, filename: e.filename, lineno: e.lineno });
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e.reason;
      // A stylesheet or web font that couldn't be loaded (no network, blocked by the frame's policy) rejects with
      // the load event itself. The site is fine without it, and it isn't a bug in the project's code.
      if (r && r.target && r.target.tagName === "LINK") return;
      var msg = r && r.message ? r.message : (r && r.target && r.target.tagName ? "Failed to load <" + r.target.tagName.toLowerCase() + "> " + (r.target.currentSrc || r.target.src || r.target.href || "") : String(r));
      if (isSandboxStorageError(msg)) return;
      send("error", { message: "Unhandled promise rejection: " + msg, stack: r && r.stack });
    });
    ${pageLinks ? PAGE_LINK_SNIPPET : ""}
    var origError = console.error;
    console.error = function () {
      send("console-error", { message: Array.prototype.map.call(arguments, function (a) { try { return typeof a === "string" ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(" ") });
      origError.apply(console, arguments);
    };
    send("ready", {});
  })();</script>`;
}

// A page asks for files of the project's public/ folder by absolute address ("/logo.png", "/media/cover.jpg"), which in
// the preview frame lead nowhere. So the kept images and icons that live under public/ are handed to the frame, and
// <img>/<source>/<video>/icon tags that ask for one get its data: URL instead. Only the ones the project's source
// mentions (by full address, or by the folder they sit in, for names built at run time) are included, so a big public/
// folder doesn't bloat every build.
const PUBLIC_ASSETS_SNIPPET = `
    var SEL = "img,source,video,audio,link[rel~=icon],link[rel=apple-touch-icon]";
    function stripQuery(v){ var i = v.search(/[?#]/); return i === -1 ? v : v.slice(0, i); }
    function fixEl(el){
      if (!el || el.nodeType !== 1) return;
      var attrs = el.tagName === "LINK" ? ["href"] : el.tagName === "VIDEO" ? ["poster", "src"] : ["src"];
      for (var i = 0; i < attrs.length; i++) {
        var v = el.getAttribute(attrs[i]);
        if (v && v.charAt(0) === "/" && v.charAt(1) !== "/") {
          var key = stripQuery(v);
          if (Object.prototype.hasOwnProperty.call(MAP, key)) el.setAttribute(attrs[i], MAP[key]);
        }
      }
    }
    function scan(root){
      if (!root || root.nodeType !== 1) return;
      if (root.matches(SEL)) fixEl(root);
      var all = root.querySelectorAll(SEL);
      for (var i = 0; i < all.length; i++) fixEl(all[i]);
    }
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "attributes") { if (m.target.matches && m.target.matches(SEL)) fixEl(m.target); }
        else for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href", "poster"] });
    scan(document.documentElement);`;

/** The address a file of a public/ folder is served at ("public/media/a.jpg" is "/media/a.jpg"), or null if it isn't in one. */
const publicAssetUrl = (path: string): string | null => {
  const m = /(?:^|\/)public\/(.+)$/.exec(path);
  return m ? `/${m[1]}` : null;
};

async function publicAssetsScript(files: VFiles, assets: PreviewAssetMap): Promise<string> {
  const candidates = Object.keys(assets).map((path) => ({ path, url: publicAssetUrl(path) })).filter((c): c is { path: string; url: string } => c.url !== null);
  if (candidates.length === 0) return "";
  const haystack = Object.values(files).join("\n");
  const map: Record<string, string> = {};
  for (const { path, url } of candidates.sort((a, b) => a.path.split("/").length - b.path.split("/").length)) {
    if (Object.prototype.hasOwnProperty.call(map, url)) continue;
    const dir = url.slice(0, url.lastIndexOf("/") + 1);
    if (!haystack.includes(url) && !(dir.length > 1 && haystack.includes(dir))) continue;
    map[url] = await previewAssetDataUrl(assets[path], path);
  }
  if (Object.keys(map).length === 0) return "";
  return `<script>(function(){var MAP = ${JSON.stringify(map).replace(/</g, "\\u003c")};${PUBLIC_ASSETS_SNIPPET}\n  })();</script>`;
}

const runtimeScript = (code: string | null | undefined) => (code ? `<script type="module">${escapeScriptClose(code)}</script>` : "");

async function buildPreviewDoc(files: VFiles, page: string, runId: string, bundled: Map<string, string>, runtime?: string | null, assets: PreviewAssetMap = {}): Promise<string> {
  const raw = files[page] ?? "<!doctype html><html><head></head><body></body></html>";
  // The bootstrap goes into the page's own markup BEFORE any bundle is inlined: a bundle holds strings such as
  // "<head>" and "</body>" (React's own messages), and a page with no <head> tag of its own would otherwise get
  // the bootstrap written into the middle of one of them.
  const bootstrap = previewBootstrap(runId, true) + (await publicAssetsScript(files, assets));
  let page0 = raw;
  if (/<head[^>]*>/i.test(raw)) page0 = raw.replace(/<head([^>]*)>/i, (_m, attrs) => `<head${attrs}>${bootstrap}`);
  else if (/<html[^>]*>/i.test(raw)) page0 = raw.replace(/<html([^>]*)>/i, (_m, attrs) => `<html${attrs}>${bootstrap}`);
  else page0 = bootstrap + raw;
  let inlined = await inlinePreviewAssets(page0, files, page, bundled, assets);
  if (runtime) {
    const at = inlined.toLowerCase().lastIndexOf("</body>");
    inlined = at === -1 ? inlined + runtimeScript(runtime) : inlined.slice(0, at) + runtimeScript(runtime) + inlined.slice(at);
  }
  return inlined;
}

async function buildBundledPreviewDoc(code: string, runId: string, runtime?: string | null, publicScript = ""): Promise<string> {
  const bootstrap = previewBootstrap(runId) + publicScript;
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>DevAudit preview</title></head><body>${bootstrap}<div id="root"></div><script type="module">${escapeScriptClose(code)}</script>${runtimeScript(runtime)}</body></html>`;
}

/** The complete document Preview (and Run Code) shows for an entry. `page` picks another HTML page
 *  of the project than the entry's own. Rejects when a script in the project can't be bundled. */
export async function buildPreviewPage(files: VFiles, entry: PreviewEntry, runId: string, page?: string, extras: BuildExtras = {}): Promise<string> {
  // Optional: a failure here leaves the page unstyled instead of failing the preview.
  const runtime = projectUsesTailwind(files) ? await tailwindRuntimeBundle() : null;
  if (!runtime) tailwindReady = false;
  if (entry.kind === "html") {
    const path = page ?? entry.path;
    const bundled = await bundleHtmlScripts(files[path] ?? "", files, path, extras);
    return buildPreviewDoc(files, path, runId, bundled, runtime, extras.assets ?? {});
  }
  // For a whole routed app, `page` is the route to open first.
  const toBuild = entry.mount === "app" && page ? { ...entry, initialPath: page } : entry;
  return buildBundledPreviewDoc(await bundlePreviewEntry(files, toBuild, extras), runId, runtime, await publicAssetsScript(files, extras.assets ?? {}));
}

type PreviewLogEntry = { id: string; message: string; stack?: string; kind: "error" | "console-error" };

/* ---------- The frame a previewed project runs in ----------
 * Previews used to be <iframe srcDoc>, and a srcdoc document inherits the CSP of the page that embeds it.
 * That held every previewed website to DevAudit's own policy (no remote images, fonts, stylesheets,
 * scripts or API calls) and made 'unsafe-eval', which the app only allows in development, the difference
 * between a project working under `next dev` and failing in production. They now load
 * public/preview-frame.html instead, which next.config.mjs serves with its own policy (the same in dev and
 * production) and a `sandbox` directive; the project's document is handed to it with postMessage.
 *
 * If the frame doesn't answer in time (file missing, framing blocked, ...), the iframe falls back to
 * srcDoc, so Preview is never worse than it was. */
const PREVIEW_FRAME_URL = `${(process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? "").replace(/\/+$/, "")}/preview-frame.html`;
const FRAME_HANDSHAKE_TIMEOUT_MS = 5000;

type FrameWindowLike = { postMessage(message: unknown, targetOrigin: string): void };

/** The framing side of the handshake with preview-frame.html, free of React so it can be tested alone.
 *  A message counts only if it comes from this frame's own window AND carries this frame's one-time token
 *  (which is in the frame's URL), so neither another window nor a page the project navigated the frame to
 *  can ask for the document. The document is pushed once on the frame's first load (in case its request
 *  arrived before this listener existed) and sent again whenever the frame asks, which covers a reload. */
export function createFrameHandshake(opts: {
  nonce: string;
  getFrameWindow: () => FrameWindowLike | null;
  getDoc: () => string;
  timeoutMs: number;
  onTimeout: () => void;
}) {
  let acked = false;
  let pushed = false;
  const timer = setTimeout(() => { if (!acked) opts.onTimeout(); }, opts.timeoutMs);
  const deliver = (target: FrameWindowLike) => target.postMessage({ __devaudit_frame: "doc", nonce: opts.nonce, html: opts.getDoc() }, "*");
  return {
    onMessage(e: { source: unknown; data: any }) {
      const target = opts.getFrameWindow();
      const d = e.data;
      if (!target || e.source !== target || !d || typeof d !== "object" || d.nonce !== opts.nonce) return;
      if (d.__devaudit_frame === "ack") acked = true;
      else if (d.__devaudit_frame === "need-doc") deliver(target);
    },
    onLoad() {
      if (pushed) return;
      pushed = true;
      const target = opts.getFrameWindow();
      if (target) deliver(target);
    },
    dispose() { clearTimeout(timer); },
  };
}

/** The opening side of the handshake with a "Full page" tab (preview-frame.html opened as its own tab).
 *  A tab can't be asked for its document the way an iframe can (it may load before DevAudit is listening, and
 *  it has no parent to ask), so DevAudit pings it until it answers; the tab replies that it wants the document,
 *  DevAudit sends it, and the tab acknowledges. The tab only answers a window on DevAudit's own origin, and
 *  every message needs this session's one-time token and must come from this very window. After the
 *  acknowledgement DevAudit sends it nothing more, so the project running there never receives a reference
 *  to DevAudit's window. */
export function createPopupSession(opts: {
  nonce: string;
  popup: FrameWindowLike & { closed: boolean };
  getDoc: () => string;
  timeoutMs: number;
  intervalMs?: number;
  onGiveUp: () => void;
}) {
  let acked = false;
  let stopped = false;
  const interval = setInterval(() => {
    if (opts.popup.closed) { stop(); return; }
    opts.popup.postMessage({ __devaudit_frame: "ping", nonce: opts.nonce }, "*");
  }, opts.intervalMs ?? 250);
  const giveUp = setTimeout(() => { if (!acked && !stopped) { stop(); opts.onGiveUp(); } }, opts.timeoutMs);
  function stop() { stopped = true; clearInterval(interval); clearTimeout(giveUp); }
  return {
    onMessage(e: { source: unknown; data: any }) {
      const d = e.data;
      if (stopped || acked || e.source !== opts.popup || !d || typeof d !== "object" || d.nonce !== opts.nonce) return;
      if (d.__devaudit_frame === "need-doc") {
        opts.popup.postMessage({ __devaudit_frame: "doc", nonce: opts.nonce, html: opts.getDoc() }, "*");
      } else if (d.__devaudit_frame === "ack") {
        acked = true;
        clearInterval(interval);
        clearTimeout(giveUp);
      }
    },
    dispose: stop,
  };
}

const FULL_PAGE_WINDOW_NAME = "devaudit-preview";
// Always this origin (never NEXT_PUBLIC_PREVIEW_ORIGIN): the tab only trusts messages from its own origin.
const FULL_PAGE_FRAME_PATH = "/preview-frame.html";
type FullPageWindow = { win: Window; runId: string; page: string; session: ReturnType<typeof createPopupSession> };

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** An iframe showing `doc` (a complete HTML document) in the preview frame. Give it `key={runId}` so every run gets a fresh frame and token. */
function PreviewFrame({ frameRef, doc, title, sandbox, className, ariaHidden }: {
  frameRef: { current: HTMLIFrameElement | null };
  doc: string;
  title: string;
  sandbox: string;
  className?: string;
  ariaHidden?: boolean;
}) {
  const [nonce] = useState(randomToken);
  const [mode, setMode] = useState<"frame" | "srcdoc">("frame");
  const docRef = useRef(doc);
  const handshake = useRef<ReturnType<typeof createFrameHandshake> | null>(null);
  const loadedBeforeReady = useRef(false);
  useEffect(() => { docRef.current = doc; }, [doc]);

  useEffect(() => {
    if (mode !== "frame") return;
    const hs = createFrameHandshake({
      nonce,
      getFrameWindow: () => frameRef.current?.contentWindow ?? null,
      getDoc: () => docRef.current,
      timeoutMs: FRAME_HANDSHAKE_TIMEOUT_MS,
      onTimeout: () => {
        console.warn("DevAudit: the preview frame didn't respond, so this preview is running inline instead (with the app's stricter content policy).");
        setMode("srcdoc");
      },
    });
    handshake.current = hs;
    if (loadedBeforeReady.current) hs.onLoad();
    const listener = (e: MessageEvent) => hs.onMessage(e);
    window.addEventListener("message", listener);
    return () => { window.removeEventListener("message", listener); hs.dispose(); handshake.current = null; };
  }, [mode, nonce, frameRef]);

  if (mode === "srcdoc") {
    return <iframe ref={frameRef} key="srcdoc" title={title} srcDoc={doc} sandbox={sandbox} className={className} aria-hidden={ariaHidden} />;
  }
  return (
    <iframe
      ref={frameRef} key="frame" title={title} src={`${PREVIEW_FRAME_URL}?n=${nonce}`} sandbox={sandbox} className={className} aria-hidden={ariaHidden}
      onLoad={() => { if (handshake.current) handshake.current.onLoad(); else loadedBeforeReady.current = true; }}
    />
  );
}

function PreviewPanel({ files, entry, projectId, onCaughtError }: { files: VFiles; entry: PreviewEntry; projectId: string; onCaughtError?: (message: string, stack?: string) => void }) {
  const [runId, setRunId] = useState("");
  const [doc, setDoc] = useState<string | null>(null);
  const [log, setLog] = useState<PreviewLogEntry[]>([]);
  const [bundling, setBundling] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  // The page being shown when someone follows a link (or uses the page picker) to another page of a
  // multi-page site. It only applies to the entry it was chosen under.
  const [nav, setNav] = useState<{ from: string; page: string } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const runSeq = useRef(0);
  // The "Full page" tab, if one is open: the same preview opened as a tab of its own. It keeps being served by
  // this panel, which sends it other pages of a multi-page site when a link in it is followed and shows its errors.
  const fullPage = useRef<FullPageWindow | null>(null);
  const [fullPageNote, setFullPageNote] = useState<string | null>(null);
  // Images and fonts the project imports that Preview has nothing for (they weren't imported with it).
  const [missingAssets, setMissingAssets] = useState<string[]>([]);

  // The pages of a multi-page site, or the routes of a routed app, for the picker.
  const isApp = entry.mount === "app";
  const pages = useMemo(() => (entry.kind === "html" ? listHtmlPages(files) : isApp ? entry.routes ?? [] : []), [entry.kind, entry.routes, isApp, files]);
  const activePage = entry.kind === "html" && nav && nav.from === entry.path && files[nav.page] !== undefined ? nav.page
    : isApp ? (nav && nav.from === entry.path && pages.includes(nav.page) ? nav.page : "/")
    : entry.path;

  async function run() {
    const seq = ++runSeq.current;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLog([]); setBundleError(null); setMissingAssets([]); setRunId(id); setDoc(null); setBundling(true);
    try {
      const assets = await loadPreviewAssets(projectId);
      let missing: string[] = [];
      const built = await buildPreviewPage(files, entry, id, activePage, { assets, onMissingAssets: (m) => { missing = m; } });
      if (seq !== runSeq.current) return; // a newer run started while this one was bundling
      setMissingAssets(missing);
      setDoc(built);
    } catch (e) {
      if (seq !== runSeq.current) return;
      setBundleError(describeBuildError(e, "Couldn't build a preview of this project."));
    }
    setBundling(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [entry.path, entry.kind, entry.mount, activePage]);

  useEffect(() => () => fullPage.current?.session.dispose(), []);

  /** Points the full-page tab (opening it if needed) at `html`. Must run inside the click when it opens a new tab. */
  function openFullPageWith(html: string, id: string, page: string, existing: Window | null) {
    const nonce = randomToken();
    const url = `${FULL_PAGE_FRAME_PATH}?n=${nonce}`;
    let win: Window | null = null;
    if (existing && !existing.closed) {
      try { existing.location.href = url; win = existing; } catch { win = null; }
    }
    // A fixed window name means a second click re-uses the same tab instead of piling up new ones.
    if (!win) win = window.open(url, FULL_PAGE_WINDOW_NAME);
    if (!win) { setFullPageNote("Your browser blocked the new tab. Allow pop-ups for this site and try again."); return; }
    fullPage.current?.session.dispose();
    fullPage.current = {
      win, runId: id, page,
      session: createPopupSession({ nonce, popup: win, getDoc: () => html, timeoutMs: 15000, onGiveUp: () => setFullPageNote("The new tab didn't connect. Close it and try again.") }),
    };
    setFullPageNote(null);
  }

  function openFullPage() {
    if (doc) openFullPageWith(doc, runId, activePage, null);
  }

  useEffect(() => {
    function record(d: any) {
      const detail = d.detail ?? {};
      const message: string = detail.message || "Unknown error";
      const entryLog: PreviewLogEntry = { id: `${Date.now()}-${Math.random()}`, message, stack: detail.stack, kind: d.type };
      setLog((l) => [entryLog, ...l].slice(0, 50));
      onCaughtError?.(message, detail.stack);
    }

    // A link followed in the full-page tab: build that page and reload the tab with it.
    async function followInFullPage(page: FullPageWindow, href: string) {
      const target = resolveHtmlPage(files, page.page, href);
      if (!target || target === page.page) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        const built = await buildPreviewPage(files, entry, id, target, { assets: await loadPreviewAssets(projectId) });
        if (fullPage.current !== page || page.win.closed) return; // closed or replaced while it was building
        openFullPageWith(built, id, target, page.win);
      } catch (err) {
        setFullPageNote(describeBuildError(err, "Couldn't build that page."));
      }
    }

    function onMessage(e: MessageEvent) {
      const page = fullPage.current;
      if (page && e.source === page.win) {
        const m = e.data;
        if (!m || typeof m !== "object") return;
        if (typeof m.__devaudit_frame === "string") page.session.onMessage(e);
        else if (m.__devaudit_preview && m.runId === page.runId) {
          if (m.type === "navigate" && typeof m.detail?.href === "string") void followInFullPage(page, m.detail.href);
          else if (m.type === "error" || m.type === "console-error") record(m);
        }
        return;
      }
      // Only trust messages that came from this panel's own preview iframe, not from any other
      // window (another tab's opener, a stray popup, a nested frame in the previewed app).
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data;
      if (!d || !d.__devaudit_preview || d.runId !== runId) return;
      if (d.type === "navigate") {
        const target = typeof d.detail?.href === "string" ? resolveHtmlPage(files, activePage, d.detail.href) : null;
        if (target && target !== activePage) setNav({ from: entry.path, page: target });
        return;
      }
      if (d.type !== "error" && d.type !== "console-error") return;
      record(d);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [runId, onCaughtError, files, activePage, entry.path]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-[#18181b] px-3 py-1">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-zinc-500">
          <Eye size={11} className="shrink-0 text-cyan-300" />
          {pages.length > 1 ? (
            <select
              value={activePage} onChange={(e) => setNav({ from: entry.path, page: e.target.value })} aria-label={isApp ? "Route to open first" : "Page to preview"}
              className="min-w-0 max-w-full truncate rounded border border-zinc-800 bg-[#09090b] px-1 py-0.5 font-mono text-[11px] text-zinc-300 focus:border-cyan-500/60 focus:outline-none"
            >
              {pages.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : isApp ? "/" : activePage}
          {isApp && <span className="shrink-0 rounded border border-indigo-500/30 bg-indigo-500/10 px-1 py-0.5 text-[10px] text-indigo-300" title="The whole site is running: its root layout, every route, and the links between them">full site</span>}
          {entry.mount === "gallery" && <span className="shrink-0 rounded border border-indigo-500/30 bg-indigo-500/10 px-1 py-0.5 text-[10px] text-indigo-300" title="This project has no page or entry file, so every component is shown, one under another">all components</span>}
          {entry.kind === "js" && !entry.mount && <span className="shrink-0 rounded border border-indigo-500/30 bg-indigo-500/10 px-1 py-0.5 text-[10px] text-indigo-300">bundled</span>}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {log.length > 0 && <span className="flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-400"><AlertCircle size={11} />{log.length}</span>}
          <button onClick={openFullPage} disabled={bundling || !doc} title="Open this preview in a new tab as a full page" className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-60"><ExternalLink size={12} />Full page</button>
          <button onClick={run} disabled={bundling} className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-60"><RefreshCw size={12} className={bundling ? "animate-spin" : ""} />{bundling ? "Building…" : "Run again"}</button>
        </div>
      </div>
      {missingAssets.length > 0 && !bundling && (
        <p className="flex items-start gap-1.5 border-b border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {missingAssets.length === 1 ? "1 image or font this project imports isn't" : `${missingAssets.length} images or fonts this project imports aren't`} available to Preview
            ({missingAssets.slice(0, 4).map((m) => m.split("/").pop()).join(", ")}{missingAssets.length > 4 ? ", …" : ""}).
            Preview can only draw images and fonts that were imported along with the project — drop the folder in again, or import the repository again, to include them.
          </span>
        </p>
      )}
      {fullPageNote && (
        <p className="flex items-start gap-1.5 border-b border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1">{fullPageNote}</span>
          <button onClick={() => setFullPageNote(null)} aria-label="Dismiss" className="shrink-0 text-amber-300/70 hover:text-amber-200"><X size={12} /></button>
        </p>
      )}
      <div className="min-h-0 flex-1 bg-white">
        {bundling ? (
          <div className="grid h-full place-items-center bg-[#09090b] text-xs text-zinc-500"><Loader2 size={16} className="mr-2 inline animate-spin" />Building preview…</div>
        ) : bundleError ? (
          <div className="h-full overflow-auto bg-[#09090b] p-6">
            {/* min-h-full + justify-center centres a short message but lets a long one grow and scroll;
                the old grid + place-items-center clipped the top and bottom of anything taller than the panel. */}
            <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center">
              <AlertCircle size={18} className="shrink-0 text-red-400" />
              <p className="mt-2 w-full whitespace-pre-wrap break-words text-left font-mono text-xs text-red-300">{bundleError}</p>
            </div>
          </div>
        ) : doc ? (
          <PreviewFrame key={runId} frameRef={frameRef} doc={doc} title="Project preview" sandbox="allow-scripts allow-forms allow-modals allow-popups" className="h-full w-full border-0" />
        ) : null}
      </div>
      {log.length > 0 && (
        <div className="max-h-28 shrink-0 overflow-y-auto border-t border-red-500/20 bg-[#09090b] p-2">
          {log.map((l) => (
            <p key={l.id} className="truncate font-mono text-[11px] leading-5 text-red-400"><AlertCircle size={10} className="mr-1 inline shrink-0" />{l.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export type TestSummary = { total: number; passed: number; failed: number; when: number };
const testRunKey = (projectId: string) => `devaudit:testrun:${projectId}`;
export function loadLastTestRun(projectId: string): TestSummary | null {
  try { const raw = localStorage.getItem(testRunKey(projectId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveLastTestRun(projectId: string, summary: TestSummary) {
  try { localStorage.setItem(testRunKey(projectId), JSON.stringify(summary)); } catch {}
}

export type LastDeploy = { host: string; url?: string; success: boolean; message: string; when: number };
const lastDeployKey = (projectId: string) => `devaudit:lastdeploy:${projectId}`;
export function loadLastDeploy(projectId: string): LastDeploy | null {
  try { const raw = localStorage.getItem(lastDeployKey(projectId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveLastDeploy(projectId: string, deploy: LastDeploy) {
  try { localStorage.setItem(lastDeployKey(projectId), JSON.stringify(deploy)); } catch {}
}

// Reads the same "Errors & Bugs" log page.tsx writes to (key format must match `bugsKey` there).
// Kept local/read-only here — CodeStudio never writes to this log directly — so "Run Code" can
// tell the user about unresolved Critical bugs that already exist for this project instead of
// only ever reporting on the single file it just scanned.
const bugsLogKey = (projectId: string) => `devaudit:bugs:${projectId}`;
function countOpenCriticalBugs(projectId: string): number {
  try {
    const raw = localStorage.getItem(bugsLogKey(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((b: any) => b && b.sev === "Critical" && !b.resolved).length;
  } catch {
    return 0;
  }
}

// Autosave timing (see the autosave effect for why it is this slow).
const AUTOSAVE_IDLE_MS = 30_000;
const AUTOSAVE_MIN_GAP_MS = 120_000;

const fsKey = (projectId: string) => `devaudit:fs:${projectId}`;

export function loadLocalFiles(projectId: string): VFiles | null {
  try {
    const raw = localStorage.getItem(fsKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}
/** Returns false when the browser refused to store it (storage full). Existing callers can ignore
 *  that; an import checks it so a workspace that won't survive a reload isn't reported as saved. */
export function saveLocalFiles(projectId: string, files: VFiles): boolean {
  try { localStorage.setItem(fsKey(projectId), JSON.stringify(files)); return true; } catch { return false; }
}

async function importFromGithub(full: string, projectId: string): Promise<VFiles> {
  const info = await gh(`/repos/${full}`);
  // Read the branch's commit BEFORE its files: if someone pushes mid-import, the recorded base is
  // older than what was read, which can only make the next sync warn, never overwrite silently.
  let head: any;
  let tree: any;
  try {
    head = await gh(`/repos/${full}/git/ref/heads/${encodeURIComponent(info.default_branch)}`);
    tree = await gh(`/repos/${full}/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`);
  } catch (e) {
    // A repository with no commits has nothing to import. That is a normal starting point, not a
    // problem worth a warning: the caller seeds the workspace from a template, and the first sync
    // makes the repository's first commit (see pushFiles / initialiseEmptyRepo).
    if (e instanceof GhError && e.emptyRepo) return {};
    throw e;
  }
  const items: { path: string; type: string; size?: number }[] = tree.tree ?? [];
  const wanted = items.filter((it) => it.type === "blob" && !BINARY.test(it.path) && (it.size ?? 0) <= MAX_IMPORT_FILE_BYTES);
  // Images and fonts can't live in the workspace, but Preview needs them (a site's background, its logo, its
  // web fonts). They go to Preview's own store: read a few at a time, and best-effort, so a file that can't
  // be fetched never stops the import.
  const assetItems: { path: string; size: number }[] = [];
  let assetTotal = 0;
  for (const it of items) {
    const size = it.size ?? 0;
    if (it.type !== "blob" || !previewAssetMime(it.path) || size > MAX_PREVIEW_ASSET_BYTES || assetItems.length >= MAX_PREVIEW_ASSETS || assetTotal + size > MAX_PREVIEW_ASSETS_TOTAL_BYTES) continue;
    if (/(^|\/)node_modules\//.test(it.path)) continue;
    assetItems.push({ path: it.path, size });
    assetTotal += size;
  }
  const assetFetch: Promise<void> = (async () => {
    const got: { path: string; blob: Blob }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < assetItems.length) {
        const it = assetItems[next++];
        try {
          const res = await ghRequest(`/repos/${full}/contents/${it.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(info.default_branch)}`, { raw: true });
          if (!res.ok) continue;
          got.push({ path: it.path, blob: new Blob([await res.arrayBuffer()], { type: previewAssetMime(it.path) ?? "" }) });
        } catch { /* skipped: Preview shows the site without this image */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, assetItems.length) }, worker));
    // `replace`: a fresh import of the repository is the whole picture, so anything stored earlier is stale.
    await savePreviewAssets(projectId, got, { replace: true });
  })().catch(() => {});
  const entries = await Promise.all(wanted.map(async (it) => {
    try {
      const text: string = await gh(`/repos/${full}/contents/${it.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(info.default_branch)}`, true);
      return [it.path, text] as const;
    } catch { return null; }
  }));
  const files: VFiles = {};
  for (const e of entries) if (e) files[e[0]] = e[1];
  await assetFetch;
  const headSha: unknown = head?.object?.sha;
  if (typeof headSha === "string") saveSyncBase(projectId, { repo: full, branch: info.default_branch, commit: headSha });
  return files;
}

async function getRefWithRetry(full: string, branch: string, attempts = 8, delayMs = 600): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await gh(`/repos/${full}/git/ref/heads/${encodeURIComponent(branch)}`);
    } catch (e) {
      // 404: a just-created repository whose branch isn't visible yet. 409: GitHub's "Git Repository
      // is empty", which a just-created repository also answers until its first commit lands, and
      // which a repository with no commits answers for good.
      const status = e instanceof GhError ? e.status : 0;
      const notReady = status === 404 || status === 409;
      if (!notReady || i === attempts - 1) {
        throw notReady
          ? new GhError(status, status === 409
              ? `GitHub says ${full} has no commits on ${branch}.`
              : "GitHub is still setting up the new repository. Wait a few seconds and try syncing again.")
          : e;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Gives a repository that has no commits its first one (a one-line README), so files can be pushed. */
async function initialiseEmptyRepo(full: string): Promise<void> {
  const name = full.split("/")[1] ?? full; // GitHub repository names are plain ASCII, so btoa is safe
  await ghWrite(`/repos/${full}/contents/README.md`, "PUT", { message: "Initial commit", content: btoa(`# ${name}\n`) });
}

async function pushFiles(
  full: string, branch: string, files: VFiles, guard?: { projectId: string; force: boolean },
): Promise<{ commit: string; changed: boolean }> {
  let ref: any;
  // True when this very call made the repository's first commit: there is nothing of anyone's to
  // overwrite then, so the "has GitHub moved on?" check below has nothing to protect.
  let initialised = false;
  try {
    ref = await getRefWithRetry(full, branch);
  } catch (e) {
    // GitHub's Git Data API (blobs, trees, commits) refuses a repository with no commits at all (409),
    // and the workspace's own README doesn't count: it only exists here until it is pushed. The
    // Contents API can make the first commit, after which everything below works as usual.
    if (!(e instanceof GhError && e.status === 409)) throw e;
    await initialiseEmptyRepo(full);
    initialised = true;
    ref = await getRefWithRetry(full, branch);
  }
  const baseCommitSha: string = ref.object.sha;

  if (guard && !guard.force && !initialised) {
    const base = loadSyncBase(guard.projectId);
    if (!base || base.repo !== full || base.branch !== branch) {
      throw new SyncConflictError("unverified",
        `DevAudit hasn't compared this workspace with ${full} yet. Syncing will replace every file on GitHub that has the same name as one of yours.`);
    }
    if (base.commit !== baseCommitSha) {
      throw new SyncConflictError("remote-changed",
        `${full} has new commits on ${branch} that aren't in this workspace (someone pushed, or a bot committed). Syncing now would replace those changes with your files.`);
    }
  }

  const baseCommit = await gh(`/repos/${full}/git/commits/${baseCommitSha}`);
  const baseTreeSha: string = baseCommit.tree.sha;

  const paths = Object.keys(files).filter((p) => !BINARY.test(p));
  if (paths.length === 0) throw new Error("There are no text files to push.");

  const blobs = await Promise.all(paths.map(async (p) => {
    const blob = await ghWrite(`/repos/${full}/git/blobs`, "POST", { content: files[p], encoding: "utf-8" });
    return { path: p, sha: blob.sha as string };
  }));

  const tree = await ghWrite(`/repos/${full}/git/trees`, "POST", {
    base_tree: baseTreeSha,
    tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
  });

  // Nothing differs from what's already on the branch: don't create an empty commit. An empty
  // commit still counts as a push, so it would run CI and could trigger a deploy for no reason.
  if (tree.sha === baseTreeSha) return { commit: baseCommitSha, changed: false };

  const commit = await ghWrite(`/repos/${full}/git/commits`, "POST", {
    message: "Publish from DevAudit",
    tree: tree.sha,
    parents: [baseCommitSha],
  });

  // No `force`: GitHub only fast-forwards the branch, so if it moved since we read it a few
  // moments ago, this fails (422) instead of discarding the newer commits.
  await ghWrite(`/repos/${full}/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", { sha: commit.sha });
  return { commit: commit.sha as string, changed: true };
}

export async function publishToGithub(name: string, priv: boolean, files: VFiles): Promise<{ full: string; branch: string; commit: string }> {
  const repo = await ghWrite("/user/repos", "POST", { name, private: priv, auto_init: true });
  const full: string = repo.full_name;
  const branch: string = repo.default_branch;
  const { commit } = await pushFiles(full, branch, files);
  // `commit` is what the workspace now matches; callers store it with saveSyncBase once they know
  // the project id.
  return { full, branch, commit };
}

/** Copies the workspace's files to the repository's DEFAULT branch (looked up, never assumed).
 *  Refuses with a SyncConflictError when that could overwrite changes the workspace doesn't have,
 *  unless `force` is set — which only an explicit click on "Overwrite" may do. */
export async function syncToGithub(
  full: string, files: VFiles, opts: { projectId: string; force?: boolean },
): Promise<{ branch: string; changed: boolean }> {
  const branch = await getDefaultBranch(full);
  const { commit, changed } = await pushFiles(full, branch, files, { projectId: opts.projectId, force: opts.force === true });
  saveSyncBase(opts.projectId, { repo: full, branch, commit });
  return { branch, changed };
}

type Node = { name: string; path: string; dir: boolean; children: Node[] };

function buildTree(paths: string[]): Node {
  const root: Node = { name: "", path: "", dir: true, children: [] };
  for (const full of paths) {
    const parts = full.split("/");
    let cur = root;
    parts.forEach((name, i) => {
      const file = i === parts.length - 1;
      let n = cur.children.find((c) => c.name === name && c.dir === !file);
      if (!n) { n = { name, path: parts.slice(0, i + 1).join("/"), dir: !file, children: [] }; cur.children.push(n); }
      cur = n;
    });
  }
  const sort = (n: Node) => { n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root;
}

const defineTheme = (m: Monaco, mode: "dark" | "light" = "dark", bg = "#09090b") => m.editor.defineTheme("devaudit-live", {
  base: mode === "dark" ? "vs-dark" : "vs", inherit: true, rules: [],
  colors: {
    "editor.background": bg, "editorGutter.background": bg,
    "editorLineNumber.foreground": mode === "dark" ? "#52525b" : "#a1a1aa",
    "editor.lineHighlightBackground": mode === "dark" ? "#ffffff0d" : "#0000000a",
    "editor.lineHighlightBorder": "#00000000",
    "editorLineNumber.activeForeground": mode === "dark" ? "#a1a1aa" : "#52525b",
    "editorOverviewRuler.border": "#00000000",
    "scrollbarSlider.background": mode === "dark" ? "#ffffff14" : "#00000014",
    "scrollbarSlider.hoverBackground": mode === "dark" ? "#ffffff24" : "#00000024",
    "scrollbarSlider.activeBackground": mode === "dark" ? "#ffffff30" : "#00000030",
  },
});

type RowShared = {
  open: Set<string>; toggle: (p: string) => void; sel: string | null; pick: (p: string) => void;
  renamePath: string | null; renameVal: string; onRenameStart: (p: string) => void;
  onRenameChange: (v: string) => void; onRenameSubmit: (old: string) => void; onRenameCancel: () => void;
  onDelete: (p: string, isDir: boolean) => void;
};
function Row({ n, depth, ...r }: RowShared & { n: Node; depth: number }) {
  const pad = { paddingLeft: 8 + depth * 12 };
  if (r.renamePath === n.path) {
    return (
      <div style={pad} className="flex items-center gap-1.5 py-1 pr-2">
        {n.dir ? <Folder size={12} className="shrink-0 text-cyan-300" /> : <FileIcon size={12} className="shrink-0" />}
        <input
          autoFocus value={r.renameVal} onChange={(e) => r.onRenameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") r.onRenameSubmit(n.path); if (e.key === "Escape") r.onRenameCancel(); }}
          onBlur={() => r.onRenameSubmit(n.path)}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-[#09090b] px-1 py-0.5 font-mono text-xs text-zinc-100 focus:border-cyan-500/60 focus:outline-none"
        />
      </div>
    );
  }
  if (n.dir) {
    const o = r.open.has(n.path);
    return (
      <div>
        <div className="group/f flex items-center rounded hover:bg-zinc-800/30">
          <button onClick={() => r.toggle(n.path)} style={pad} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left font-mono text-xs text-zinc-300">
            <ChevronRight size={12} className={`shrink-0 transition ${o ? "rotate-90" : ""}`} /><Folder size={12} className="shrink-0 text-cyan-300" /><span className="truncate">{n.name}</span>
          </button>
          <button onClick={() => r.onRenameStart(n.path)} aria-label={`Rename ${n.name}`} className="mr-0.5 shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-700/60 hover:text-zinc-200 group-hover/f:opacity-100"><Pencil size={11} /></button>
          <button onClick={() => r.onDelete(n.path, true)} aria-label={`Delete ${n.name}`} className="mr-1 shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover/f:opacity-100"><Trash2 size={11} /></button>
        </div>
        {o && n.children.map((c) => <Row key={c.path} n={c} depth={depth + 1} {...r} />)}
      </div>
    );
  }
  return (
    <div className="group/f flex items-center rounded hover:bg-zinc-800/30">
      <button onClick={() => r.pick(n.path)} style={{ paddingLeft: 8 + depth * 12 + 16 }} className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left font-mono text-xs ${r.sel === n.path ? "bg-zinc-800/60 text-zinc-100" : "text-zinc-400"}`}>
        <FileIcon size={12} className="shrink-0" /><span className="truncate">{n.name}</span>
      </button>
      <button onClick={() => r.onRenameStart(n.path)} aria-label={`Rename ${n.name}`} className="mr-0.5 shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-700/60 hover:text-zinc-200 group-hover/f:opacity-100"><Pencil size={11} /></button>
      <button onClick={() => r.onDelete(n.path, false)} aria-label={`Delete ${n.name}`} className="mr-1 shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover/f:opacity-100"><Trash2 size={11} /></button>
    </div>
  );
}

export type ErrorTarget = { bugId: string; message: string; file: string; line: number; stack?: string };

function resolveErrorFilePath(files: VFiles, raw: string): string | null {
  const cleaned = raw.trim().replace(/^\.?\//, "");
  if (!cleaned) return null;
  if (files[cleaned] !== undefined) return cleaned;
  const base = cleaned.split("/").pop();
  return Object.keys(files).find((p) => p.split("/").pop() === base) ?? null;
}

export type AiTourResult = {
  summary: string;
  steps: string[];
  canAutoFix: boolean;
  fixExplanation: string | null;
  patchedFile: string | null;
  suggestedFix?: { before: string; after: string; note: string } | null;
};

async function requestAiFix(input: { filePath: string; line: number; message: string; stack?: string; fileContent: string }): Promise<AiTourResult> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.summary !== "string" || !Array.isArray(data.steps)) {
    throw new Error((data && typeof data.error === "string" && data.error) || `AI analysis failed (HTTP ${res.status}).`);
  }
  return data as AiTourResult;
}

export type AiRunReviewResult = {
  hasErrors: boolean;
  summary?: string;
  errors?: { file: string; line: number; severity: "error" | "warning"; message: string; suggestion: string }[];
  roadmap?: { summary: string; steps: { step: number; title: string; file?: string; description: string }[] };
};

async function requestAiRunReview(input: { filePath: string; fileContent: string }): Promise<AiRunReviewResult> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({
      action: "run_code",
      files: {
        [input.filePath]: input.fileContent,
      },
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || typeof data.hasErrors !== "boolean") {
    throw new Error((data && typeof data.error === "string" && data.error) || `AI code read failed (HTTP ${res.status}).`);
  }

  return data as AiRunReviewResult;
}

export type AiScaffoldResult = {
  summary: string;
  suggestedName?: string;
  files: VFiles;
  poweredBy: "ai" | "heuristic";
};

/** Generates a small starter project from a one-line description, for the New Project form's
 *  "Describe it" mode — an alternative to picking one of the static templates. */
export async function requestAiScaffold(prompt: string): Promise<AiScaffoldResult> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action: "scaffold", prompt }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.scaffoldSummary !== "string" || typeof data.scaffoldFiles !== "object" || data.scaffoldFiles === null) {
    throw new Error((data && typeof data.error === "string" && data.error) || `AI project generation failed (HTTP ${res.status}).`);
  }
  return {
    summary: data.scaffoldSummary,
    suggestedName: typeof data.suggestedProjectName === "string" ? data.suggestedProjectName : undefined,
    files: data.scaffoldFiles as VFiles,
    poweredBy: data.poweredBy === "ai" ? "ai" : "heuristic",
  };
}

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AiChatResult = { reply: string; proposedFiles?: VFiles };
/** What the AI Assistant sends. `attachments` is new: base64 JPEG screenshots (`images`) and web addresses (`links`) the
 *  person attached in the chat window. The text of every message also names them, so a server that ignores
 *  `attachments` still knows they exist. */
export type AiChatInput = {
  messages: ChatMessage[];
  currentFile?: string;
  currentFileContent?: string;
  referencedFiles?: VFiles;
  fileManifest?: string[];
  attachments?: { images: { name: string; mediaType: string; data: string }[]; links: string[] };
};

/** Free-form conversation with the AI Assistant panel — explain code, answer questions, or
 *  propose complete file contents for the person to review and apply. */
export async function requestAiChat(input: AiChatInput): Promise<AiChatResult> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action: "chat", ...input }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.chatReply !== "string") {
    throw new Error((data && typeof data.error === "string" && data.error) || `AI assistant failed (HTTP ${res.status}).`);
  }
  return {
    reply: data.chatReply,
    proposedFiles: data.chatProposedFiles && typeof data.chatProposedFiles === "object" ? (data.chatProposedFiles as VFiles) : undefined,
  };
}

export type AiTestGenResult = { summary: string; testContent: string; poweredBy: "ai" | "heuristic" };

/** Writes a full test file for one source file, targeting TestRunner.tsx's own minimal
 *  describe/it/expect harness. The caller (TestRunner) derives the actual save path with
 *  deriveTestPath below rather than trusting the model to name it. */
export async function requestAiTestGen(input: { filePath: string; fileContent: string }): Promise<AiTestGenResult> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action: "generate_tests", filePath: input.filePath, fileContent: input.fileContent }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.testSummary !== "string" || typeof data.testFileContent !== "string") {
    throw new Error((data && typeof data.error === "string" && data.error) || `AI test generation failed (HTTP ${res.status}).`);
  }
  return {
    summary: data.testSummary,
    testContent: data.testFileContent,
    poweredBy: data.poweredBy === "ai" ? "ai" : "heuristic",
  };
}

/** "src/utils/math.ts" -> "src/utils/math.test.ts" — always the same folder as the source file,
 *  which is what lets the generated test's relative import ("./math") be trusted without the
 *  model having to reason about paths. */
export function deriveTestPath(sourcePath: string): string {
  const m = sourcePath.match(/^(.*?)(\.([tj]sx?))$/);
  if (!m) return `${sourcePath}.test.js`;
  const [, base, , ext] = m;
  return `${base}.test.${ext}`;
}

// The AI Assistant UI now lives in AiAssistantModal.tsx (a centred, full chat window). The request helper above is shared.

function AITourGuide({ target, filePath, missing, analysis, mode, error, applying, onAutoFix, onGuideMe, onRetry, onClose }: {
  target: ErrorTarget; filePath: string | null; missing: boolean; analysis: AiTourResult | null;
  mode: "loading" | "summary" | "guide" | "applied" | "error"; error: string | null; applying: boolean;
  onAutoFix: () => void; onGuideMe: () => void; onRetry: () => void; onClose: () => void;
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-xs flex-col border-l border-fuchsia-500/20 bg-[#0c0c10] shadow-[0_0_60px_-20px_rgba(217,70,239,.35)] sm:w-80">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-gradient-to-r from-fuchsia-500/10 to-cyan-500/10 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100"><Sparkles size={13} className="text-fuchsia-300" />AI Tour Guide</span>
        <button onClick={onClose} aria-label="Close AI Tour Guide" className="text-zinc-500 hover:text-zinc-200"><X size={14} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {missing ? (
          <p role="alert" className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 leading-4 text-amber-300">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            Couldn&apos;t find &quot;{target.file}&quot; in this project&apos;s files. Open the right file manually to continue.
          </p>
        ) : (
          <>
            <p className="mb-1 font-mono text-[11px] text-zinc-500">{filePath}:{target.line}</p>

            {mode === "loading" && (
              <div className="flex flex-col items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-6 text-center">
                <Loader2 size={16} className="animate-spin text-fuchsia-300" />
                <p className="text-zinc-400">Reading the file and asking Claude what went wrong…</p>
              </div>
            )}

            {mode === "error" && (
              <div className="space-y-2">
                <p role="alert" className="flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-2 leading-4 text-red-300">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />{error ?? "Something went wrong analyzing this crash."}
                </p>
                <button onClick={onRetry} className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60">
                  <RefreshCw size={12} />Try again
                </button>
              </div>
            )}

            {mode !== "loading" && mode !== "error" && analysis && (
              <>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">What went wrong</p>
                <p className="mb-3 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 leading-5 text-zinc-300">{analysis.summary}</p>

                {mode === "summary" && (
                  <div className="space-y-2">
                    <button
                      onClick={onAutoFix} disabled={!analysis.canAutoFix || applying}
                      className="flex w-full items-center justify-center gap-1.5 rounded bg-gradient-to-r from-fuchsia-400 to-cyan-400 px-2.5 py-1.5 text-xs font-medium text-slate-950 shadow-[0_0_20px_-4px_rgba(217,70,239,.6)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
                    >
                      {applying ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}Auto-Fix with AI
                    </button>
                    {!analysis.canAutoFix && (
                      <p className="text-[11px] leading-4 text-zinc-600">
                        {analysis.fixExplanation || "Claude can't safely automate this one — try Guide Me instead."}
                      </p>
                    )}
                    <button onClick={onGuideMe} className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60">
                      <Compass size={12} />Guide Me (Manual Fix)
                    </button>
                  </div>
                )}

                {mode === "guide" && (
                  <>
                    {analysis.suggestedFix && (
                      <div className="mb-3 space-y-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Suggested fix</p>
                        <div className="rounded border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                          <p className="mb-1 text-[10px] uppercase tracking-wide text-red-400/80">Replace</p>
                          <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-red-200">{analysis.suggestedFix.before}</code>
                        </div>
                        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                          <p className="mb-1 text-[10px] uppercase tracking-wide text-emerald-400/80">With</p>
                          <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-emerald-200">{analysis.suggestedFix.after}</code>
                        </div>
                        {analysis.suggestedFix.note && <p className="text-[11px] leading-4 text-zinc-600">{analysis.suggestedFix.note}</p>}
                      </div>
                    )}
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Step-by-step</p>
                    <ol className="list-decimal space-y-2 pl-4">
                      {analysis.steps.map((s, i) => <li key={i} className="leading-5 text-zinc-300">{s}</li>)}
                    </ol>
                    <p className="mt-3 text-[11px] leading-4 text-zinc-600">The code hasn&apos;t been touched — edit the file yourself, then mark the error resolved from the Errors &amp; Bugs tab.</p>
                  </>
                )}

                {mode === "applied" && (
                  <p className="flex items-start gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 leading-4 text-emerald-300">
                    <Check size={12} className="mt-0.5 shrink-0" />{analysis.fixExplanation || "Fix applied and the error was marked resolved."} Review the change in the editor.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RunReviewPanel({ phase, review, entryPath, openCritical, onOpenErrors, onClose }: {
  phase: "reading" | "success"; review: AiRunReviewResult | null; entryPath: string;
  openCritical: number; onOpenErrors?: () => void; onClose: () => void;
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-xs flex-col border-l border-cyan-500/20 bg-[#0c0c10] shadow-[0_0_60px_-20px_rgba(34,211,238,.35)] sm:w-80">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100"><Sparkles size={13} className="text-cyan-300" />AI Run Check</span>
        <button onClick={onClose} aria-label="Close AI Run Check" className="text-zinc-500 hover:text-zinc-200"><X size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        <p className="mb-2 font-mono text-[11px] text-zinc-500">{entryPath}</p>

        {phase === "reading" && (
          <div className="flex flex-col items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-6 text-center">
            <Loader2 size={16} className="animate-spin text-cyan-300" />
            <p className="text-zinc-400">Reading the code before running it…</p>
          </div>
        )}

        {phase === "success" && review && (
          <>
            {openCritical > 0 ? (
              <p className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 leading-4 text-amber-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {entryPath} reads clean, but {openCritical} unresolved critical issue{openCritical === 1 ? "" : "s"} {openCritical === 1 ? "is" : "are"} still open for this project.{" "}
                {onOpenErrors ? (
                  <button onClick={onOpenErrors} className="font-medium text-amber-200 underline underline-offset-2 hover:text-amber-100">
                    View Errors &amp; Bugs
                  </button>
                ) : (
                  "Check the Errors & Bugs tab."
                )}
              </p>
            ) : (
              <p className="flex items-start gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 leading-4 text-emerald-300">
                <Check size={12} className="mt-0.5 shrink-0" />No errors or bugs found.
              </p>
            )}
            {review.summary && <p className="mb-3 mt-2 leading-5 text-zinc-300">{review.summary}</p>}
            {review.roadmap && review.roadmap.steps.length > 0 && (
              <>
                <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">How it runs</p>
                <ol className="list-decimal space-y-2 pl-4">
                  {review.roadmap.steps.map((s) => (
                    <li key={s.step} className="leading-5 text-zinc-300">
                      {s.title}{s.description ? ` — ${s.description}` : ""}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const cta = "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 shadow-[0_0_20px_-4px_rgba(34,211,238,.6)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none";

// `source` distinguishes a confirmed crash (something actually threw while running — "preview",
// or the bundler refused to build — "build") from "ai_scan": the AI Run Check's own static read of
// the file, which is a heuristic opinion formed *before* anything executes, not a proven failure.
// page.tsx uses this to log ai_scan hits as "Warning" instead of "Critical" so a scanner false
// positive can't quietly inflate the Errors & Bugs critical count the way it used to.
export type CaughtError = {
  message: string; stack?: string; file: string; line: number; bugId: string;
  source?: "preview" | "build" | "ai_scan";
};

const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function extractLineFromStack(stack?: string): number | null {
  if (!stack) return null;
  const m = stack.match(/:(\d+):\d+\)?/);
  return m ? parseInt(m[1], 10) : null;
}

// Small themed confirm dialog used in place of the browser's native confirm()/alert() popups,
// which render unstyled and get attributed to "localhost:3000" rather than the app.
/* ---------- global find & replace across every text file in the workspace ---------- */
type FindMatch = { path: string; count: number; nameMatch: boolean };

function buildFindRegex(query: string, useRegex: boolean, caseSensitive: boolean): RegExp {
  const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(pattern, caseSensitive ? "g" : "gi");
}

function findMatchesAcrossFiles(files: VFiles, query: string, useRegex: boolean, caseSensitive: boolean): FindMatch[] | { error: string } {
  if (!query) return [];
  let re: RegExp;
  try { re = buildFindRegex(query, useRegex, caseSensitive); } catch (e) { return { error: e instanceof Error ? e.message : "That isn't a valid pattern." }; }
  const out: FindMatch[] = [];
  for (const [path, content] of Object.entries(files)) {
    // File names are searchable (even binary files), contents only for text files.
    re.lastIndex = 0;
    const nameMatch = re.test(path);
    re.lastIndex = 0;
    const m = BINARY.test(path) ? null : content.match(re);
    const count = m ? m.length : 0;
    if (nameMatch || count > 0) out.push({ path, count, nameMatch });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function replaceAcrossFiles(files: VFiles, query: string, replacement: string, useRegex: boolean, caseSensitive: boolean, onlyPath?: string): VFiles {
  const re = buildFindRegex(query, useRegex, caseSensitive);
  const next: VFiles = { ...files };
  for (const [path, content] of Object.entries(files)) {
    if (BINARY.test(path)) continue;
    if (onlyPath && path !== onlyPath) continue;
    re.lastIndex = 0;
    if (re.test(content)) { re.lastIndex = 0; next[path] = content.replace(re, replacement); }
  }
  return next;
}

function FindReplacePanel({ files, onReplace, onClose }: { files: VFiles; onReplace: (next: VFiles, changedFiles: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const result = useMemo(() => findMatchesAcrossFiles(files, query, useRegex, caseSensitive), [files, query, useRegex, caseSensitive]);
  const error = !Array.isArray(result) ? result.error : null;
  const matches = Array.isArray(result) ? result : [];
  const totalCount = matches.reduce((n, m) => n + m.count, 0);
  const contentMatches = matches.filter((m) => m.count > 0);

  function runReplace(onlyPath?: string) {
    if (error || !query || contentMatches.length === 0) return;
    const next = replaceAcrossFiles(files, query, replacement, useRegex, caseSensitive, onlyPath);
    const changed = onlyPath ? 1 : contentMatches.length;
    const count = onlyPath ? (matches.find((m) => m.path === onlyPath)?.count ?? 0) : totalCount;
    onReplace(next, changed);
    setDone(`Replaced ${count} occurrence${count === 1 ? "" : "s"} across ${changed} file${changed === 1 ? "" : "s"}.`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-zinc-800 bg-[#121215] shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white"><Search size={14} className="text-cyan-300" />Find &amp; replace across files</h3>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
        </div>
        <div className="space-y-2.5 px-4 py-3">
          <input
            autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setDone(null); }} placeholder="Find…"
            className="w-full rounded border border-zinc-700 bg-[#09090b] px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none"
          />
          <input
            value={replacement} onChange={(e) => { setReplacement(e.target.value); setDone(null); }} placeholder="Replace with…"
            className="w-full rounded border border-zinc-700 bg-[#09090b] px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none"
          />
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={caseSensitive} onChange={(e) => { setCaseSensitive(e.target.checked); setDone(null); }} />Case sensitive</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={useRegex} onChange={(e) => { setUseRegex(e.target.checked); setDone(null); }} />Regex</label>
          </div>
          {error && <p className="flex items-start gap-1.5 text-[11px] text-red-400"><AlertCircle size={12} className="mt-0.5 shrink-0" />{error}</p>}
          {done && <p className="flex items-start gap-1.5 text-[11px] text-emerald-400"><Check size={12} className="mt-0.5 shrink-0" />{done}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-800/80 px-2 py-1.5">
          {!query ? (
            <p className="px-2 py-3 text-xs text-zinc-600">Type something to search across every file in this project.</p>
          ) : !error && matches.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-600">No matches.</p>
          ) : (
            matches.map((m) => (
              <div key={m.path} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/40">
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{m.path}</span>
                {m.nameMatch && <span className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">name</span>}
                {m.count > 0 && <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{m.count}</span>}
                {m.count > 0 && <button onClick={() => runReplace(m.path)} className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800/60">Replace</button>}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800/80 px-4 py-3">
          <span className="text-[11px] text-zinc-500">{matches.length > 0 && !error ? `${totalCount} match${totalCount === 1 ? "" : "es"} in ${contentMatches.length} file${contentMatches.length === 1 ? "" : "s"}${matches.length > contentMatches.length ? `, ${matches.length - contentMatches.length} name-only` : ""}` : ""}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700">Close</button>
            <button
              onClick={() => runReplace()} disabled={!!error || contentMatches.length === 0}
              className="rounded-md bg-gradient-to-r from-cyan-400 to-indigo-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:brightness-110 disabled:opacity-50"
            >
              Replace all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel = "Delete", danger = true, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-zinc-800 bg-[#121215] p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${danger ? "bg-red-500/90 text-white hover:bg-red-500" : "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 hover:brightness-110"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CodeStudio({
  projectId,
  owner,
  repoFull,
  onGoToDeploy,
  onGoToErrors,
  onCaughtError,
  errorTarget,
  onErrorHandled,
  onResolveError,
  onDetachRepo,
  onChangeRepo,
  pane = "workspace",
  projectName,
  onGoToRepository,
  onGoToWorkspace,
}: {
  projectId: string;
  owner?: string;
  repoFull?: string;
  onGoToDeploy?: () => void;
  onGoToErrors?: () => void;
  onCaughtError?: (err: CaughtError) => void;
  errorTarget?: ErrorTarget | null;
  onErrorHandled?: () => void;
  onResolveError?: (bugId: string) => void;
  onDetachRepo?: () => void;
  onChangeRepo?: () => void;
  /** "repository" shows the full Repository page instead of the file explorer + editor. The component stays mounted
   *  across both, so edits, autosave and the loaded files carry over when switching. */
  pane?: "workspace" | "repository";
  projectName?: string;
  onGoToRepository?: () => void;
  onGoToWorkspace?: () => void;
}) {
  const [files, setFiles] = useState<VFiles | null>(null);
  const [seededFrom, setSeededFrom] = useState<"local" | "github" | "template" | null>(null);
  const [loading, setLoading] = useState(true);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [pos, setPos] = useState({ ln: 1, col: 1 });
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [creatingFile, setCreatingFile] = useState(false);
  const [createVal, setCreateVal] = useState("");
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ path: string; isDir: boolean } | null>(null);
  const [view, setView] = useState<"code" | "preview">("code");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);

  // Dropping files / folders (or using the Upload button): hover overlay -> reading -> confirmation.
  // Nothing touches the workspace until the person confirms.
  type ImportUi = { phase: "idle" } | { phase: "reading"; progress: ScanProgress | null } | { phase: "confirm"; scan: ScanResult };
  const [importUi, setImportUi] = useState<ImportUi>({ phase: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const [importNotice, setImportNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const filesRef = useRef<VFiles | null>(null); // latest files, for the confirm step that runs after an await
  filesRef.current = files;

  // Per-project "autosave to GitHub" preference — off by default, since a sync writes to the
  // person's real repo. When on, edits are pushed in the background (after 30 quiet seconds, at
  // most every two minutes) instead of only on a manual "Sync Changes" click, so someone who closes
  // the tab risks losing less work (localStorage already protects against losing it entirely).
  const [autosaveGithub, setAutosaveGithub] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveSkipRef = useRef(true);
  // Set when a sync stopped because it could overwrite changes on GitHub; shown with an explicit
  // "Overwrite" choice. Autosave never overrides it: once blocked it stays paused until a person
  // syncs by hand (or toggles autosave off and on).
  const [syncConflict, setSyncConflict] = useState<string | null>(null);
  const autosaveBlockedRef = useRef(false);
  const lastAutosaveAtRef = useRef(0);
  // The repository's real default branch, for display. Looked up from GitHub, not assumed.
  const [repoBranch, setRepoBranch] = useState<string | null>(null);

  // Repository visibility state for the Manage Repositories box toggle
  const [isPrivateRepo, setIsPrivateRepo] = useState<boolean>(true);
  const [visibilityLoading, setVisibilityLoading] = useState<boolean>(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runDoc, setRunDoc] = useState<string | null>(null);
  const [runId, setRunId] = useState("");
  const [runBundleError, setRunBundleError] = useState<string | null>(null);

  const [runPhase, setRunPhase] = useState<"idle" | "reading" | "success">("idle");
  const [runReview, setRunReview] = useState<AiRunReviewResult | null>(null);
  const [runOpenCritical, setRunOpenCritical] = useState(0);
  const runTokenRef = useRef("");
  const runHadErrorRef = useRef(false);
  const runFrameRef = useRef<HTMLIFrameElement>(null);

  const editorRef = useRef<{
    revealLineInCenter: (l: number) => void; setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void;
    onDidChangeCursorPosition: (cb: (e: any) => void) => void; deltaDecorations: (old: string[], next: any[]) => string[];
  } | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const { resolved: daMode, editorBg } = useDaTheme();
  useEffect(() => {
    const m = monacoRef.current;
    if (!m) return;
    defineTheme(m, daMode, editorBg);
    m.editor.setTheme("devaudit-live");
  }, [daMode, editorBg]);
  const decorationsRef = useRef<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [activeTarget, setActiveTarget] = useState<ErrorTarget | null>(null);
  const [tourFilePath, setTourFilePath] = useState<string | null>(null);
  const [tourMissing, setTourMissing] = useState(false);
  const [tourMode, setTourMode] = useState<"loading" | "summary" | "guide" | "applied" | "error">("loading");
  const [tourAnalysis, setTourAnalysis] = useState<AiTourResult | null>(null);
  const [tourError, setTourError] = useState<string | null>(null);
  const [tourApplying, setTourApplying] = useState(false);
  const lastTourBugId = useRef<string | null>(null);

  useEffect(() => { setView("code"); }, [projectId]);

  // A drag that ends anywhere other than on the studio (dropped elsewhere, cancelled with Esc, left
  // the window) must not leave the overlay stuck on screen. Also stop reading if the studio goes away.
  useEffect(() => {
    const clear = () => setDragActive(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
      importAbortRef.current?.abort();
    };
  }, []);

  // Escape cancels a read that's in progress.
  useEffect(() => {
    if (importUi.phase !== "reading") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      importAbortRef.current?.abort();
      importAbortRef.current = null;
      setImportUi({ phase: "idle" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [importUi.phase]);

  // Fetch actual repository public/private visibility status when repoFull changes
  useEffect(() => {
    if (!repoFull) return;
    let active = true;
    gh(`/repos/${repoFull}`).then((data) => {
      if (active && data && typeof data.private === "boolean") {
        setIsPrivateRepo(data.private);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [repoFull]);

  // The repository's default branch, so the UI says where syncs really go (it may not be "main").
  useEffect(() => {
    setRepoBranch(null);
    if (!repoFull) return;
    let active = true;
    getDefaultBranch(repoFull).then((b) => { if (active) setRepoBranch(b); }).catch(() => {});
    return () => { active = false; };
  }, [repoFull]);

  // Load the saved autosave preference whenever the project changes, and don't let the very
  // first file-load after switching projects (local restore, GitHub import, or template seed)
  // count as an "edit" that should immediately trigger a sync.
  useEffect(() => {
    try { setAutosaveGithub(localStorage.getItem(`devaudit:autosave:${projectId}`) === "1"); } catch { setAutosaveGithub(false); }
    autosaveSkipRef.current = true;
    autosaveBlockedRef.current = false;
    lastAutosaveAtRef.current = 0;
    setAutosaveStatus("idle");
    setAutosaveError(null);
    setSyncState("idle");
    setSyncError(null);
    setSyncConflict(null);
    setSyncedAt(null);
  }, [projectId]);

  // The chat window belongs to the workspace, so close it when the Repository page takes over.
  useEffect(() => { if (pane !== "workspace") setChatOpen(false); }, [pane]);

  function toggleAutosave(next: boolean) {
    autosaveBlockedRef.current = false; // switching it off and on again is a deliberate retry
    if (next) setAutosaveError(null);
    setAutosaveGithub(next);
    try { localStorage.setItem(`devaudit:autosave:${projectId}`, next ? "1" : "0"); } catch {}
  }

  // Debounced push to GitHub whenever files change and autosave is on for a published project.
  // Every autosave is a real commit on the default branch, and plenty of repositories deploy
  // automatically when that branch changes — so this is deliberately slow: it waits for 30 seconds
  // without edits, and never pushes more than once every two minutes. (It used to push 2.5 seconds
  // after every pause in typing, which on such a repository meant a production deploy every few
  // seconds.) An unchanged workspace makes no commit at all (see pushFiles).
  useEffect(() => {
    if (!autosaveGithub || !repoFull || !files) return;
    if (autosaveSkipRef.current) { autosaveSkipRef.current = false; return; }
    if (autosaveBlockedRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const wait = Math.max(AUTOSAVE_IDLE_MS, lastAutosaveAtRef.current + AUTOSAVE_MIN_GAP_MS - Date.now());
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveStatus("syncing");
      setAutosaveError(null);
      try {
        await syncToGithub(repoFull, files, { projectId }); // never forced
        lastAutosaveAtRef.current = Date.now();
        setAutosaveStatus("synced");
        setSavedAt(Date.now());
        setSyncedAt(Date.now());
      } catch (e) {
        setAutosaveStatus("error");
        if (e instanceof SyncConflictError) {
          autosaveBlockedRef.current = true;
          setAutosaveError(`Autosave is paused. ${e.message} Use "Sync changes" on this page to review and continue.`);
        } else {
          setAutosaveError(e instanceof Error ? e.message : "Autosave to GitHub failed.");
        }
      }
    }, wait);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, autosaveGithub, repoFull]);

  async function runSync(force: boolean) {
    if (!repoFull || !files || syncState === "syncing") return;
    setSyncState("syncing");
    setSyncError(null);
    setSyncConflict(null);
    try {
      await syncToGithub(repoFull, files, { projectId, force });
      autosaveBlockedRef.current = false;
      setAutosaveError(null);
      setAutosaveStatus("idle");
      setSavedAt(Date.now());
      setSyncedAt(Date.now());
      setSyncState("synced");
    } catch (e) {
      if (e instanceof SyncConflictError) {
        // Not a failure: the sync stopped on purpose and is waiting for the person to decide.
        setSyncState("idle");
        setSyncConflict(e.message);
      } else {
        setSyncState("error");
        setSyncError(e instanceof Error ? e.message : "Sync failed. Check your connection and try again.");
      }
    }
  }
  // Separate wrappers on purpose: these are passed straight to onClick, which would hand a click
  // event to a `force` parameter (a truthy object) and silently turn every normal sync into an overwrite.
  function handleSync() { void runSync(false); }
  function handleForceSync() { void runSync(true); }

  async function handleVisibilityToggle(newPrivate: boolean) {
    if (!repoFull || visibilityLoading) return;
    setVisibilityLoading(true);
    setVisibilityError(null);
    try {
      await updateRepoVisibility(repoFull, newPrivate);
      setIsPrivateRepo(newPrivate);
    } catch (e) {
      setVisibilityError(e instanceof Error ? e.message : "Failed to update repository visibility.");
    } finally {
      setVisibilityLoading(false);
    }
  }

  function runTourAnalysis(path: string, target: ErrorTarget, content: string) {
    setTourMode("loading");
    setTourError(null);
    requestAiFix({ filePath: path, line: target.line, message: target.message, stack: target.stack, fileContent: content })
      .then((r) => { setTourAnalysis(r); setTourMode("summary"); })
      .catch((e) => { setTourError(e instanceof Error ? e.message : "Couldn't analyze this crash."); setTourMode("error"); });
  }

  function highlightErrorLine(line: number) {
    const ed = editorRef.current, monaco = monacoRef.current;
    if (!ed || !monaco) return;
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, [{
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: true, className: "devaudit-error-line", glyphMarginClassName: "devaudit-error-glyph" },
    }]);
  }
  function clearErrorHighlight() {
    if (editorRef.current) decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
  }

  function openErrorTour(target: ErrorTarget) {
    if (!files) return;
    setChatOpen(false);
    lastTourBugId.current = target.bugId;
    setActiveTarget(target);
    const resolved = resolveErrorFilePath(files, target.file);
    setTourMissing(!resolved);
    setTourFilePath(resolved);
    setTourAnalysis(null);
    setTourError(null);
    setTourOpen(true);

    if (!resolved) return;
    setView("code"); setSel(resolved);
    highlightErrorLine(Math.max(1, target.line || 1));
    runTourAnalysis(resolved, target, files[resolved] ?? "");
  }

  useEffect(() => {
    if (!errorTarget || !files) return;
    if (lastTourBugId.current === errorTarget.bugId && tourOpen) return;
    openErrorTour(errorTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorTarget, files]);

  useEffect(() => {
    if (!activeTarget || !tourFilePath || sel !== tourFilePath || !editorRef.current) return;
    const ed = editorRef.current;
    const line = Math.max(1, activeTarget.line || 1);
    const raf = requestAnimationFrame(() => {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [sel, tourFilePath, activeTarget]);

  function closeTour() { setTourOpen(false); clearErrorHighlight(); onErrorHandled?.(); }

  function retryTourAnalysis() {
    if (!activeTarget || !tourFilePath || !files) return;
    runTourAnalysis(tourFilePath, activeTarget, files[tourFilePath] ?? "");
  }

  function handleTourAutoFix() {
    if (!activeTarget || !tourFilePath || !tourAnalysis?.canAutoFix || !tourAnalysis.patchedFile) return;
    setTourApplying(true);
    updateFile(tourFilePath, tourAnalysis.patchedFile);
    onResolveError?.(activeTarget.bugId);
    setTourMode("applied");
    setTourApplying(false);
  }

  function reportRuntimeError(
    message: string, stack: string | undefined, lineno: number | undefined, entryPath: string,
    source: CaughtError["source"] = "preview",
  ) {
    runHadErrorRef.current = true;
    setRunPhase("idle");
    const file = sel && files && files[sel] !== undefined ? sel : entryPath;
    const line = Math.max(1, extractLineFromStack(stack) ?? lineno ?? 1);
    const bugId = genId();
    onCaughtError?.({ message, stack, file, line, bugId, source });
    openErrorTour({ bugId, message, file, line, stack });
  }

  function settleRunReview(id: string, review: AiRunReviewResult, entryPath: string) {
    if (runTokenRef.current !== id) return;
    setRunReview(review);
    if (review.hasErrors) {
      if (runHadErrorRef.current) return;
      const top = review.errors?.[0];
      reportRuntimeError(
        top?.message || review.summary || "The AI's read of the code found a problem.",
        undefined, top?.line, entryPath, "ai_scan",
      );
      return;
    }
    if (runHadErrorRef.current) return;
    setRunOpenCritical(countOpenCriticalBugs(projectId));
    setRunPhase("success");
  }

  async function runCode() {
    if (!files || running) return;
    const entry = findPreviewEntry(files);
    setRunBundleError(null);
    if (!entry) { setRunBundleError("Nothing to run in a browser yet — add an index.html, or a React component such as src/App.tsx."); return; }
    if (tourOpen) closeTour();
    if (chatOpen) setChatOpen(false);
    setRunning(true);
    setRunPhase("reading");
    setRunReview(null);
    setRunOpenCritical(0);
    runHadErrorRef.current = false;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runTokenRef.current = id;
    setRunDoc(null);
    setRunId(id);

    requestAiRunReview({ filePath: entry.path, fileContent: files[entry.path] ?? "" })
      .then((review) => settleRunReview(id, review, entry.path))
      .catch(() => { if (runTokenRef.current === id && !runHadErrorRef.current) setRunPhase("idle"); });

    try {
      setRunDoc(await buildPreviewPage(files, entry, id, undefined, { assets: await loadPreviewAssets(projectId) }));
    } catch (e) {
      setRunning(false);
      // This is a failure to bundle/load the toolchain itself (e.g. esbuild-wasm failing to
      // initialize) — it has no meaningful line in the user's file and isn't a crash in their
      // code, so it must NOT go through reportRuntimeError/the AI Tour Guide (which fabricates
      // a "line 1" location and presents an unrelated toolchain error as an in-code bug).
      setRunBundleError(describeBuildError(e, "Couldn't bundle this project to run it."));
    }
  }

  useEffect(() => {
    if (!runId || !files) return;
    const entryPath = findPreviewEntry(files)?.path ?? "";
    function onMessage(e: MessageEvent) {
      // Same rule as the preview panel: only the run-sandbox iframe itself may report in.
      if (!runFrameRef.current || e.source !== runFrameRef.current.contentWindow) return;
      const d = e.data;
      if (!d || !d.__devaudit_preview || d.runId !== runId) return;
      if (d.type === "ready") { setRunning(false); return; }
      if (d.type !== "error") return;
      const detail = d.detail ?? {};
      setRunning(false);
      reportRuntimeError(detail.message || "Unknown error", detail.stack, detail.lineno, entryPath);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, files]);

  useEffect(() => {
    let active = true;
    setLoading(true); setImportNote(null); setSel(null);
    (async () => {
      const local = loadLocalFiles(projectId);
      if (local) { if (active) { setFiles(local); setSeededFrom("local"); setLoading(false); } return; }
      if (repoFull) {
        try {
          const imported = await importFromGithub(repoFull, projectId);
          const seeded = Object.keys(imported).length ? imported : { ...DEFAULT_FILES };
          if (!active) return;
          setFiles(seeded); setSeededFrom(Object.keys(imported).length ? "github" : "template");
          saveLocalFiles(projectId, seeded);
          setLoading(false);
          return;
        } catch (e) {
          if (!active) return;
          setImportNote(e instanceof Error ? e.message : "Couldn't import the repository, starting from a template instead.");
        }
      }
      if (!active) return;
      const seeded = { ...DEFAULT_FILES };
      setFiles(seeded); setSeededFrom("template");
      saveLocalFiles(projectId, seeded);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [projectId, repoFull]);

  useEffect(() => {
    if (!files || sel) return;
    const first = ["README.md", "index.js", "package.json"].find((p) => files[p] !== undefined) ?? Object.keys(files)[0];
    if (first) setSel(first);
  }, [files, sel]);

  const root = useMemo(() => (files ? buildTree(Object.keys(files)) : null), [files]);
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  function updateFile(path: string, content: string) {
    setFiles((f: VFiles | null) => {
      const next: VFiles = { ...(f ?? {}), [path]: content };
      saveLocalFiles(projectId, next);
      setSavedAt(Date.now());
      return next;
    });
  }

  /** Merges several files at once (one state update, one save) — used by the AI Assistant panel
   *  when the person applies a proposed multi-file change. */
  function applyBulkFiles(patch: VFiles) {
    setFiles((f: VFiles | null) => {
      const next: VFiles = { ...(f ?? {}), ...patch };
      saveLocalFiles(projectId, next);
      setSavedAt(Date.now());
      return next;
    });
  }

  function toggleChat() {
    setChatOpen((open) => {
      const next = !open;
      if (next) { if (tourOpen) closeTour(); setRunPhase("idle"); }
      return next;
    });
  }

  function createFile() {
    const path = createVal.trim().replace(/^\/+/, "");
    setCreatingFile(false); setCreateVal("");
    if (!path || (files && files[path] !== undefined)) return;
    updateFile(path, "");
    setSel(path);
  }

  /** Reads what was dropped / picked (folders included), then asks before adding anything. */
  async function startImport(captured: CapturedDrop) {
    importAbortRef.current?.abort();
    const ctrl = new AbortController();
    importAbortRef.current = ctrl;
    const current = () => importAbortRef.current === ctrl; // false once cancelled or replaced by a newer import
    setUploadError(null);
    setImportNotice(null);
    setImportUi({ phase: "reading", progress: null });
    try {
      const scan = await scanDrop(captured, {
        signal: ctrl.signal,
        onProgress: (progress) => { if (current()) setImportUi({ phase: "reading", progress }); },
      });
      if (!current()) return;
      importAbortRef.current = null;
      if (scan.files.length === 0 && scan.assets.length === 0 && scan.skipped.length === 0 && scan.emptyFolders === 0) {
        setImportUi({ phase: "idle" });
        setUploadError("Nothing to import — no files were found in what you dropped.");
        return;
      }
      setImportUi({ phase: "confirm", scan });
    } catch (e) {
      if (e instanceof ImportCancelledError || !current()) return;
      importAbortRef.current = null;
      setImportUi({ phase: "idle" });
      setUploadError(`Couldn't read what you dropped${e instanceof Error && e.message ? ` (${e.message})` : ""}.`);
    }
  }

  function cancelImport() {
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setImportUi({ phase: "idle" });
  }

  /** Applies the confirmed import. Works from the *latest* files (the dialog may have been open for a
   *  while), so duplicates are judged against what is in the workspace right now. */
  function confirmImport(opts: { stripRoot: string | null; replaceExisting: boolean }) {
    if (importUi.phase !== "confirm") return;
    const { scan } = importUi;
    setImportUi({ phase: "idle" });
    const result = applyImport(filesRef.current ?? {}, scan.files, opts);
    // Images and fonts go to Preview's own store (see previewAssets.ts), not into the workspace.
    const keep = assetsToKeep(filesRef.current ?? {}, scan.assets, opts);
    if (keep.length > 0) void savePreviewAssets(projectId, keep);
    const assetNote = keep.length > 0 ? `${keep.length.toLocaleString()} ${keep.length === 1 ? "image or font" : "images and fonts"} kept for Preview` : "";
    if (result.touched.length === 0) {
      if (assetNote) setImportNotice({ tone: "ok", text: `${assetNote}.` });
      return;
    }

    filesRef.current = result.next;
    setFiles(result.next);
    const stored = saveLocalFiles(projectId, result.next);
    setSavedAt(Date.now());

    // Show the imported structure straight away: open its folders and the first file.
    const primary = pickPrimaryFile(result.touched);
    if (primary) setSel(primary);
    const reveal = foldersToReveal(result.touched, primary);
    if (reveal.length) setOpen((s) => new Set([...s, ...reveal]));

    const n = (count: number, one: string) => `${count.toLocaleString()} ${one}${count === 1 ? "" : "s"}`;
    const leftOut = scan.skipped.length + result.blocked;
    const parts = [`Imported ${n(result.added.length + result.replaced.length, "file")}`];
    if (assetNote) parts.push(assetNote);
    if (result.replaced.length) parts.push(`${result.replaced.length.toLocaleString()} replaced`);
    if (result.keptExisting) parts.push(`${result.keptExisting.toLocaleString()} existing kept`);
    if (leftOut) parts.push(`${leftOut.toLocaleString()} left out`);
    setImportNotice(stored
      ? { tone: "ok", text: `${parts.join(" · ")}.` }
      : { tone: "warn", text: `${parts.join(" · ")} — but this browser has no room to keep a workspace this big, so it will be lost on reload. Sync it to GitHub or import less.` });
  }

  // Drag and drop covers the whole studio, not just the file list. Only drags that carry files react,
  // so selecting/dragging text inside the editor is unaffected.
  const dropBlocked = importUi.phase !== "idle" || findReplaceOpen || !!pendingDelete;
  const isFileDrag = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  function onStudioDragEnter(e: ReactDragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (!dropBlocked) setDragActive(true);
  }
  function onStudioDragOver(e: ReactDragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // required, or the browser won't allow a drop here (and may open the file instead)
    e.dataTransfer.dropEffect = dropBlocked ? "none" : "copy";
    if (!dropBlocked && !dragActive) setDragActive(true);
  }
  function onStudioDrop(e: ReactDragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragActive(false);
    if (dropBlocked) return;
    void startImport(captureDrop(e.dataTransfer)); // must read the drop synchronously, before any await
  }
  // Leaving the studio is judged by where the pointer is, not by relatedTarget: Safari reports a null
  // relatedTarget on every dragleave, and right after the overlay appears the browser can still be
  // targeting the element underneath it, so a quick exit would otherwise leave the overlay stuck.
  function onStudioDragLeave(e: ReactDragEvent<HTMLDivElement>) {
    if (!isFileDrag(e)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const outside = e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom;
    if (outside) setDragActive(false);
  }

  function renameEntry(oldPath: string) {
    const newPath = renameVal.trim().replace(/^\/+/, "");
    setRenamePath(null);
    if (!newPath || newPath === oldPath || !files) return;
    setFiles((f: VFiles | null) => {
      if (!f) return f;
      const next: VFiles = {};
      for (const [p, c] of Object.entries(f) as [string, string][]) {
        if (p === oldPath) next[newPath] = c;
        else if (p.startsWith(`${oldPath}/`)) next[newPath + p.slice(oldPath.length)] = c;
        else next[p] = c;
      }
      saveLocalFiles(projectId, next);
      setSavedAt(Date.now());
      return next;
    });
    if (sel === oldPath) setSel(newPath);
    else if (sel?.startsWith(`${oldPath}/`)) setSel(newPath + sel.slice(oldPath.length));
  }

  function deleteEntry(path: string, isDir: boolean) {
    setPendingDelete({ path, isDir });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const { path, isDir } = pendingDelete;
    setFiles((f: VFiles | null) => {
      if (!f) return f;
      const next: VFiles = {};
      for (const [p, c] of Object.entries(f) as [string, string][]) {
        if (p === path || (isDir && p.startsWith(`${path}/`))) continue;
        next[p] = c;
      }
      saveLocalFiles(projectId, next);
      setSavedAt(Date.now());
      return next;
    });
    if (sel === path || (isDir && sel?.startsWith(`${path}/`))) setSel(null);
    setPendingDelete(null);
  }

  const box = "rounded-lg border border-zinc-800/80 bg-zinc-900/40";

  if (loading) return <div className={`${box} space-y-2 p-4`}>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-zinc-800/40" style={{ width: `${70 - i * 8}%` }} />)}</div>;
  if (!root || !files) return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-red-500/30 px-6 py-10 text-center">
      <AlertCircle size={20} className="text-red-400" />
      <p className="mt-3 text-sm font-medium text-zinc-200">Couldn&apos;t set up the workspace</p>
    </div>
  );

  if (pane === "repository") {
    return (
      <RepositoryPage
        repoFull={repoFull} isPrivate={isPrivateRepo} visibilityLoading={visibilityLoading} visibilityError={visibilityError}
        onVisibility={handleVisibilityToggle}
        autosave={autosaveGithub} autosaveStatus={autosaveStatus} autosaveError={autosaveError} onAutosave={toggleAutosave}
        branch={repoBranch} syncConflict={syncConflict} onForceSync={handleForceSync}
        syncState={syncState} syncError={syncError} syncedAt={syncedAt} onSync={handleSync}
        fileCount={Object.keys(files).length} fromGithub={seededFrom === "github"}
        onOpenWorkspace={() => onGoToWorkspace?.()} onGoToDeploy={onGoToDeploy} onDetach={onDetachRepo} onChange={onChangeRepo}
      />
    );
  }

  const value = sel ? files[sel] : undefined;
  const lastSaved = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  // Preview follows the page open in the editor (so every HTML page can be looked at); Run Code and
  // error attribution always use the project's own entry.
  const previewEntry = findPreviewEntry(files, sel);
  const blockedReason = previewEntry ? null : previewBlockedReason(files);
  const runEntry = findPreviewEntry(files);

  return (
    <div
      className={`${box} relative grid h-[75vh] min-h-[460px] grid-rows-[12rem_1fr] overflow-hidden md:grid-cols-[16rem_1fr] md:grid-rows-1`}
      onDragEnter={onStudioDragEnter} onDragOver={onStudioDragOver} onDragLeave={onStudioDragLeave} onDrop={onStudioDrop}
    >
      <div className="flex min-h-0 flex-col border-b border-zinc-800/80 md:border-b-0 md:border-r">
        <div className="flex h-12 items-center justify-between gap-2 border-b border-zinc-800/80 bg-[#18181b] px-3">
          <span className="truncate font-mono text-xs text-zinc-300">{repoFull ?? "Local workspace"}</span>
          <div className="flex items-center gap-0.5">
            <input
              ref={uploadInputRef} type="file" multiple hidden
              onChange={(e) => { void startImport(captureFileList(e.target.files)); e.target.value = ""; }}
            />
            <button onClick={() => uploadInputRef.current?.click()} aria-label="Upload files" title="Upload files" className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"><Upload size={14} /></button>
            <button onClick={() => setFindReplaceOpen(true)} aria-label="Find and replace across files" title="Find and replace across all files" className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"><Search size={14} /></button>
            <button onClick={() => setCreatingFile(true)} aria-label="New file" title="New file" className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"><FilePlus size={14} /></button>
          </div>
        </div>

        {/* Repository details moved to their own page (the Repository tab); the explorer only keeps a small summary. */}
        {repoFull && (
          <div className="border-b border-zinc-800/80 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5 text-[0.8125rem] font-medium text-zinc-200"><GitBranch size={15} className="shrink-0 text-zinc-400" /><span className="truncate">{repoFull.split("/")[1] ?? repoFull}</span></span>
              <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium ${isPrivateRepo ? "border-amber-500/25 bg-amber-500/10 text-amber-400" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"}`}>{isPrivateRepo ? "Private" : "Public"}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[0.75rem] text-zinc-500">
              <span className="flex items-center gap-1.5">
                {syncState === "syncing" || autosaveStatus === "syncing" ? <><Loader2 size={12} className="animate-spin" />Syncing…</>
                  : syncState === "error" || autosaveStatus === "error" ? <><AlertCircle size={12} className="text-red-400" />Sync failed</>
                  : autosaveGithub ? <><Check size={12} className="text-emerald-400" />Autosave on</> : "Autosave off"}
              </span>
              {onGoToRepository && <button type="button" onClick={onGoToRepository} data-tip="Open the full Repository page: sync, visibility and autosave" className="font-medium text-zinc-300 underline decoration-zinc-700 underline-offset-4 hover:text-zinc-50 hover:decoration-zinc-400">Manage</button>}
            </div>
          </div>
        )}

        {uploadError && <p className="flex items-start gap-1.5 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-4 text-amber-400"><AlertCircle size={12} className="mt-0.5 shrink-0" />{uploadError}</p>}
        {importNotice && (
          <p role="status" className={`flex items-start gap-1.5 border-b px-3 py-2 text-[11px] leading-4 ${importNotice.tone === "ok" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" : "border-amber-500/20 bg-amber-500/5 text-amber-400"}`}>
            {importNotice.tone === "ok" ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 flex-1">{importNotice.text}</span>
            <button onClick={() => setImportNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><X size={12} /></button>
          </p>
        )}
        {importNote && <p className="flex items-start gap-1.5 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-4 text-amber-400"><AlertCircle size={12} className="mt-0.5 shrink-0" />{importNote}</p>}
        {seededFrom === "github" && <p className="flex items-start gap-1.5 border-b border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px] leading-4 text-cyan-300"><GitBranch size={12} className="mt-0.5 shrink-0" />Imported from {repoFull}. Edits stay local until you sync.</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {creatingFile && (
            <div className="flex items-center gap-1.5 px-2 py-1">
              <FileIcon size={12} className="shrink-0 text-zinc-500" />
              <input
                autoFocus value={createVal} onChange={(e) => setCreateVal(e.target.value)} placeholder="path/to/file.js"
                onKeyDown={(e) => { if (e.key === "Enter") createFile(); if (e.key === "Escape") { setCreatingFile(false); setCreateVal(""); } }}
                onBlur={createFile}
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-[#09090b] px-1.5 py-0.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>
          )}
          {root.children.length === 0 && !creatingFile ? <p className="px-2 py-3 text-xs leading-5 text-zinc-600">No files yet. Drop files or a whole folder here, or click the file icon above to create one.</p>
            : root.children.map((c) => (
              <Row key={c.path} n={c} depth={0} open={open} toggle={toggle} sel={sel} pick={setSel}
                renamePath={renamePath} renameVal={renameVal}
                onRenameStart={(p) => { setRenamePath(p); setRenameVal(p); }}
                onRenameChange={setRenameVal} onRenameSubmit={renameEntry} onRenameCancel={() => setRenamePath(null)}
                onDelete={deleteEntry}
              />
            ))}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-12 items-center justify-between gap-3 border-b border-zinc-800/80 bg-[#18181b] px-3">
          <span className="truncate font-mono text-xs text-zinc-400">{view === "preview" ? "Live Preview" : sel ?? "No file selected"}</span>
          <div className="dv flex shrink-0 items-center gap-2">
            <button
              onClick={runCode} disabled={running || !previewEntry} title={previewEntry ? "Run this project in a sandbox and catch any errors" : "Add an index.html or a React component (like src/App.tsx) to run this project"}
              className={`flex h-8 items-center gap-1.5 rounded-full px-4 text-[0.8125rem] font-medium ${cta}`}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}{running ? "Running…" : "Run Code"}
            </button>
            <button
              onClick={toggleChat} aria-pressed={chatOpen} title="Ask an AI assistant about this project — explain code, ask what to change, or ask it to write something"
              className={`flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-medium ${chatOpen ? "border border-zinc-400 bg-zinc-800 text-zinc-50" : "border border-zinc-800 text-zinc-300 hover:bg-zinc-800/60"}`}
            >
              <Sparkles size={13} />AI Assistant
            </button>
            <div className="flex items-center gap-0.5 rounded-full border border-zinc-800 p-0.5 text-[0.8125rem]">
              <button onClick={() => setView("code")} className={`flex h-7 items-center gap-1.5 rounded-full px-3 font-medium ${view === "code" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}><Code2 size={13} />Code</button>
              <button
                onClick={() => previewEntry && setView("preview")}
                disabled={!previewEntry}
                title={previewEntry ? undefined : blockedReason ?? "This project has no visible UI — add an index.html, or a React component (like src/App.tsx), to unlock a live Preview."}
                className={`flex h-7 items-center gap-1.5 rounded-full px-3 font-medium ${view === "preview" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"} ${!previewEntry ? "cursor-not-allowed opacity-40 hover:text-zinc-500" : ""}`}
              ><Play size={13} />Preview</button>
            </div>
          </div>
        </div>
        {runBundleError && (
          <p className="flex max-h-40 items-start gap-1.5 overflow-y-auto whitespace-pre-wrap break-words border-b border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300"><AlertCircle size={13} className="mt-0.5 shrink-0" /><span className="min-w-0">{runBundleError}</span></p>
        )}
        <div className="relative min-h-0 flex-1 bg-[#09090b]">
          {view === "preview" && previewEntry ? (
            <PreviewPanel
              files={files} entry={previewEntry} projectId={projectId}
              onCaughtError={(message, stack) => onCaughtError?.({ message, stack, file: previewEntry.path, line: extractLineFromStack(stack) ?? 1, bugId: genId(), source: "preview" })}
            />
          ) : view === "preview" && !previewEntry ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <Eye size={18} className="mx-auto text-zinc-600" />
                <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-500">
                  {blockedReason ?? (
                    <>
                      This project has no visible UI — there&apos;s nothing to render here. Add an{" "}
                      <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">index.html</code>, or a React component such as{" "}
                      <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">src/App.tsx</code>, to unlock a live Preview.
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : value !== undefined && sel ? (
            <Editor
              height="100%" theme="devaudit-live" path={`${projectId}/${sel}`} language={langOf(sel)} value={value}
              beforeMount={(m) => defineTheme(m, daMode, editorBg)}
              onMount={(ed, monaco) => {
                editorRef.current = ed; monacoRef.current = monaco;
                ed.onDidChangeCursorPosition((e) => setPos({ ln: e.position.lineNumber, col: e.position.column }));
                // Monaco measures glyph widths once at startup. If the code font is still loading it measures the fallback and the
                // cursor and selections drift, so measure again as soon as the font is ready.
                document.fonts?.load(`400 13px ${mono.style.fontFamily}`).then(() => monaco.editor.remeasureFonts()).catch(() => {});
              }}
              onChange={(v) => updateFile(sel, v ?? "")}
              loading={<Loader2 size={18} className="animate-spin text-zinc-600" />}
              options={{
                minimap: { enabled: false },
                fontSize: 13, lineHeight: 21, fontFamily: mono.style.fontFamily, fontLigatures: true,
                scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16, bottom: 16 }, tabSize: 2, glyphMargin: true,
                smoothScrolling: true, cursorBlinking: "smooth", roundedSelection: true, lineNumbersMinChars: 3,
                overviewRulerBorder: false, overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
              }}
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-xs text-zinc-500">
              {previewEntry ? "Select a file from the explorer, create one, or switch to Preview above." : "Select a file from the explorer, or create one to get started. Add an index.html, or a React component (like src/App.tsx), to unlock a live Preview."}
            </div>
          )}
          {tourOpen && activeTarget && (
            <AITourGuide
              target={activeTarget}
              filePath={tourFilePath}
              missing={tourMissing}
              analysis={tourAnalysis}
              mode={tourMode}
              error={tourError}
              applying={tourApplying}
              onAutoFix={handleTourAutoFix}
              onGuideMe={() => setTourMode("guide")}
              onRetry={retryTourAnalysis}
              onClose={closeTour}
            />
          )}
          {!tourOpen && runPhase !== "idle" && runEntry && (
            <RunReviewPanel
              phase={runPhase} review={runReview} entryPath={runEntry.path}
              openCritical={runOpenCritical} onOpenErrors={onGoToErrors} onClose={() => setRunPhase("idle")}
            />
          )}
          {chatOpen && files && (
            <AiAssistantModal
              projectId={projectId} projectName={projectName} files={files} currentFile={sel}
              onApplyFiles={applyBulkFiles} onClose={() => setChatOpen(false)} requestChat={requestAiChat}
            />
          )}
          {runDoc && <PreviewFrame key={runId} frameRef={runFrameRef} doc={runDoc} title="Run sandbox" sandbox="allow-scripts" className="hidden" ariaHidden />}
        </div>
        <style>{`.devaudit-error-line { background: rgba(239,68,68,.15); } .devaudit-error-glyph::after { content: ""; display: block; width: 8px; height: 8px; margin-top: 6px; border-radius: 9999px; background: #f87171; }`}</style>
        {view === "code" && (
          <div className="dv flex h-8 items-center gap-4 border-t border-zinc-800/80 bg-[#18181b] px-3 font-mono text-[11px] text-zinc-500">
            {sel && <span>{langOf(sel)}</span>}{sel && <span>Ln {pos.ln}, Col {pos.col}</span>}
            <span className="ml-auto flex items-center gap-1.5">
              {lastSaved ? <><Check size={11} className="text-emerald-400" />Saved locally {lastSaved}</> : <><CloudOff size={11} />Not yet edited</>}
            </span>
            {onGoToDeploy && !repoFull && (
              <button onClick={onGoToDeploy} className="rounded-md border border-zinc-800 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800/60">Publish to GitHub →</button>
            )}
          </div>
        )}
      </div>
      {findReplaceOpen && files && (
        <FindReplacePanel
          files={files}
          onReplace={(next) => {
            setFiles(next);
            saveLocalFiles(projectId, next);
            setSavedAt(Date.now());
          }}
          onClose={() => setFindReplaceOpen(false)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.isDir ? "Delete folder" : "Delete file"}
          body={
            pendingDelete.isDir
              ? `Delete the "${pendingDelete.path}" folder and everything inside it? This can't be undone.`
              : `Delete "${pendingDelete.path}"? This can't be undone.`
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {(dragActive || importUi.phase === "reading") && (
        <DropOverlay
          mode={importUi.phase === "reading" ? "reading" : "hover"}
          progress={importUi.phase === "reading" ? importUi.progress : null}
          onCancel={cancelImport} onDismiss={() => setDragActive(false)}
        />
      )}
      {importUi.phase === "confirm" && (
        <ImportDialog scan={importUi.scan} files={files} onCancel={cancelImport} onConfirm={confirmImport} />
      )}
    </div>
  );
}
