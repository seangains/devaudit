// ---------------------------------------------------------------------------
// Importing dropped files and folders into the Code Studio's virtual file system.
//
// This module has no React in it. It does three things:
//   1. captureDrop / captureFileList — grab what was dropped (or picked) *synchronously*. The browser
//      invalidates a drop's DataTransfer the moment the event handler returns, so everything that
//      needs it has to be read before the first `await`.
//   2. scanDrop — walk dropped folders recursively, keeping each file's path relative to what was
//      dropped, read the text files, and record everything that was left out and why.
//   3. planImport / applyImport — compare the result with the workspace: which files are new, which
//      would replace a different file of the same name, which are identical (nothing to do).
//
// The workspace is a flat { path: text } map, so only text files can be imported, and empty folders
// can't be represented. Both are reported to the person rather than dropped silently.
//
// Images and fonts are the one exception to "text only": they can't go in the workspace, but Preview
// needs them to draw a site properly. scanDrop returns them separately (`assets`), and they are kept in
// the preview-only store (./previewAssets), never in the workspace and never pushed to GitHub.
// ---------------------------------------------------------------------------

import { isSafeRepoFilePath } from "../api/_shared/pathSafety";
import { MAX_PREVIEW_ASSET_BYTES, MAX_PREVIEW_ASSETS, MAX_PREVIEW_ASSETS_TOTAL_BYTES, previewAssetMime, type PreviewAssetInput } from "./previewAssets";

type Files = Record<string, string>;

/** Same cap the GitHub import uses: a bigger file is almost never source code, and the workspace
 *  lives in localStorage (a few MB in total). */
export const MAX_IMPORT_FILE_BYTES = 200_000;
/** Safety nets for a huge drop. Past these the rest is reported as "over the import limit". */
export const MAX_IMPORT_FILES = 5_000;
export const MAX_IMPORT_TOTAL_BYTES = 10_000_000;
/** Above this many stored characters a browser may refuse to keep the workspace across a reload
 *  (localStorage is ~5 MB per site, and Firefox/Safari count more strictly than Chrome). */
export const STORAGE_WARN_CHARS = 2_500_000;

/* ---------- what never gets imported ---------- */

// Folders that are tooling output / version-control internals. They are not entered at all, so
// dropping a project that still has its node_modules doesn't read tens of thousands of files.
const IGNORED_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", ".next", ".turbo", ".parcel-cache", "__pycache__", ".venv"]);
const IGNORED_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

// .env files hold real secrets, and a workspace sync writes every file to GitHub — so they stay out.
// Templates like .env.example are meant to be committed and are kept.
const ENV_FILE = /^\.env(\..+)?$/i;
const ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i;
const isSecretEnvFile = (name: string) => ENV_FILE.test(name) && !ENV_TEMPLATE.test(name);

/** Files that are binary by extension — the workspace only stores text. (Binary files with an
 *  unusual extension are caught later by looking at the bytes.) */
export const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "wav", "ogg", "mp4", "webm", "mov", "avi",
  "pdf", "zip", "gz", "tar", "rar", "7z",
  "wasm", "exe", "dll", "so", "bin",
]);
const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

/* ---------- types ---------- */

export type ImportedFile = { path: string; content: string; bytes: number };
/** An image or font kept for Preview only (see ./previewAssets). */
export type ImportedAsset = { path: string; blob: Blob; bytes: number };

export type SkipReason = "ignored" | "env" | "binary" | "too-large" | "unreadable" | "unsafe-path" | "duplicate" | "limit";
export type SkippedItem = { path: string; reason: SkipReason; isDir?: boolean; bytes?: number };

export type ScanResult = {
  /** Text files that were read, sorted by path. Paths are relative to what was dropped. */
  files: ImportedFile[];
  /** Images and fonts that were read, sorted by path. They are used by Preview only; they never become workspace files. */
  assets: ImportedAsset[];
  skipped: SkippedItem[];
  emptyFolders: number;
  /** What was dropped at the top level (a folder, or a file). */
  topLevel: { name: string; isDir: boolean }[];
};

export type ScanProgress = { stage: "finding" | "reading"; done: number; total: number };

export class ImportCancelledError extends Error {
  constructor() { super("Import cancelled"); this.name = "ImportCancelledError"; }
}

type DroppedFile = { file: File; path: string };
export type CapturedDrop = { entries: FileSystemEntry[]; files: DroppedFile[] };

/* ---------- 1. capture (synchronous) ---------- */

/** Reads what a drop contains. MUST be called synchronously inside the drop handler. */
export function captureDrop(dt: DataTransfer): CapturedDrop {
  const entries: FileSystemEntry[] = [];
  const files: DroppedFile[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      // webkitGetAsEntry is what exposes folders (and is supported by every current browser).
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (entry) { entries.push(entry); continue; }
      const f = item.getAsFile();
      if (f) files.push({ file: f, path: f.name });
    }
  } else {
    for (const f of Array.from(dt.files ?? [])) files.push({ file: f, path: f.name });
  }
  return { entries, files };
}

/** For the Upload button's <input type="file">. Copies the list at once: clearing the input's
 *  value afterwards empties the live FileList. */
export function captureFileList(list: FileList | null): CapturedDrop {
  const files = Array.from(list ?? []).map((file) => ({
    file,
    path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/^\/+/, ""),
  }));
  return { entries: [], files };
}

/* ---------- 2. scan ---------- */

/** readEntries returns a directory in batches (Chrome: 100 at a time) — keep calling until it
 *  comes back empty, or big folders are silently truncated. */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) resolve(all);
      else { all.push(...batch); next(); }
    }, reject);
    next();
  });
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => { while (i < items.length) await fn(items[i++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
/** The file's text, or null when it isn't text (contains a NUL byte, or isn't valid UTF-8 — reading
 *  such a file as text would silently corrupt it, and a sync would then push the corruption). */
function decodeText(buf: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return null;
  try { return utf8.decode(bytes); } catch { return null; }
}

const hasUnsafeSegment = (path: string) => path.split("/").includes("__proto__") || !isSafeRepoFilePath(path);

export async function scanDrop(
  captured: CapturedDrop,
  opts: { signal?: AbortSignal; onProgress?: (p: ScanProgress) => void } = {},
): Promise<ScanResult> {
  const { signal, onProgress } = opts;
  const throwIfCancelled = () => { if (signal?.aborted) throw new ImportCancelledError(); };

  const skipped: SkippedItem[] = [];
  const candidates: { path: string; getFile: () => Promise<File> }[] = [];
  const assetCandidates: { path: string; getFile: () => Promise<File> }[] = [];
  const seen = new Set<string>();
  const topLevel = new Map<string, boolean>();
  const ignoredPrefixes = new Set<string>();
  let emptyFolders = 0;

  let lastTick = 0;
  const tick = (p: ScanProgress, force = false) => {
    const now = Date.now();
    if (!force && now - lastTick < 80) return;
    lastTick = now;
    onProgress?.(p);
  };

  /** Decides whether a file is worth reading. Returns true if it was queued. */
  function consider(path: string, name: string, getFile: () => Promise<File>) {
    if (IGNORED_FILES.has(name.toLowerCase())) { skipped.push({ path, reason: "ignored" }); return; }
    if (isSecretEnvFile(name)) { skipped.push({ path, reason: "env" }); return; }
    // Images and fonts: not workspace files, but kept for Preview. Everything else binary is left out as before.
    if (previewAssetMime(name)) {
      if (hasUnsafeSegment(path)) { skipped.push({ path, reason: "unsafe-path" }); return; }
      if (seen.has(path)) { skipped.push({ path, reason: "duplicate" }); return; }
      if (assetCandidates.length >= MAX_PREVIEW_ASSETS) { skipped.push({ path, reason: "limit" }); return; }
      seen.add(path);
      assetCandidates.push({ path, getFile });
      return;
    }
    if (BINARY_EXTS.has(extOf(name))) { skipped.push({ path, reason: "binary" }); return; }
    if (hasUnsafeSegment(path)) { skipped.push({ path, reason: "unsafe-path" }); return; }
    if (seen.has(path)) { skipped.push({ path, reason: "duplicate" }); return; }
    if (candidates.length >= MAX_IMPORT_FILES) { skipped.push({ path, reason: "limit" }); return; }
    seen.add(path);
    candidates.push({ path, getFile });
    tick({ stage: "finding", done: candidates.length, total: 0 });
  }

  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    throwIfCancelled();
    const path = prefix + entry.name;
    if (entry.isDirectory) {
      if (IGNORED_DIRS.has(entry.name)) { skipped.push({ path, reason: "ignored", isDir: true }); return; }
      let children: FileSystemEntry[];
      try { children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader()); }
      catch { skipped.push({ path, reason: "unreadable", isDir: true }); return; }
      if (children.length === 0) { emptyFolders++; return; }
      // Browsers list a folder in no particular order. Walking it alphabetically makes the result
      // (and, past the file limit, exactly which files are cut off) predictable.
      children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const child of children) await walk(child, path + "/");
      return;
    }
    consider(path, entry.name, () => fileOf(entry as FileSystemFileEntry));
  }

  for (const entry of captured.entries) {
    topLevel.set(entry.name, entry.isDirectory);
    await walk(entry, "");
  }

  // Files that arrive as a flat list (the Upload button, or a browser without folder support).
  // A path with a slash in it came from a folder picker, which has already listed every file inside —
  // so ignored folders can only be skipped here by recognising them in the path.
  for (const { file, path } of captured.files) {
    throwIfCancelled();
    const segments = path.split("/");
    topLevel.set(segments[0], segments.length > 1);
    const ignoredAt = segments.slice(0, -1).findIndex((s) => IGNORED_DIRS.has(s));
    if (ignoredAt !== -1) {
      const prefix = segments.slice(0, ignoredAt + 1).join("/");
      if (!ignoredPrefixes.has(prefix)) { ignoredPrefixes.add(prefix); skipped.push({ path: prefix, reason: "ignored", isDir: true }); }
      continue;
    }
    consider(path, segments[segments.length - 1], async () => file);
  }

  // Read the queued files a few at a time.
  const files: ImportedFile[] = [];
  let readCount = 0;
  let totalBytes = 0;
  const total = candidates.length + assetCandidates.length;
  tick({ stage: "reading", done: 0, total }, true);
  await pool(candidates, 8, async (c) => {
    throwIfCancelled();
    let file: File;
    try { file = await c.getFile(); } catch { skipped.push({ path: c.path, reason: "unreadable" }); return; }
    if (file.size > MAX_IMPORT_FILE_BYTES) { skipped.push({ path: c.path, reason: "too-large", bytes: file.size }); return; }
    if (totalBytes + file.size > MAX_IMPORT_TOTAL_BYTES) { skipped.push({ path: c.path, reason: "limit" }); return; }
    totalBytes += file.size;
    let text: string | null;
    try { text = decodeText(await file.arrayBuffer()); } catch { skipped.push({ path: c.path, reason: "unreadable" }); return; }
    readCount++;
    tick({ stage: "reading", done: readCount, total });
    if (text === null) { totalBytes -= file.size; skipped.push({ path: c.path, reason: "binary" }); return; }
    files.push({ path: c.path, content: text, bytes: file.size });
  });

  // Images and fonts. Read into memory now (not when the import is confirmed): the dialog can stay open
  // for a while, and a dropped file's handle isn't guaranteed to still be readable later.
  const assets: ImportedAsset[] = [];
  let assetBytes = 0;
  await pool(assetCandidates, 4, async (c) => {
    throwIfCancelled();
    let file: File;
    try { file = await c.getFile(); } catch { skipped.push({ path: c.path, reason: "unreadable" }); return; }
    if (file.size > MAX_PREVIEW_ASSET_BYTES) { skipped.push({ path: c.path, reason: "too-large", bytes: file.size }); return; }
    if (assetBytes + file.size > MAX_PREVIEW_ASSETS_TOTAL_BYTES) { skipped.push({ path: c.path, reason: "limit" }); return; }
    let blob: Blob;
    try { blob = new Blob([await file.arrayBuffer()], { type: file.type || previewAssetMime(c.path) || "" }); } catch { skipped.push({ path: c.path, reason: "unreadable" }); return; }
    assetBytes += file.size;
    readCount++;
    tick({ stage: "reading", done: readCount, total });
    assets.push({ path: c.path, blob, bytes: file.size });
  });
  throwIfCancelled();
  tick({ stage: "reading", done: total, total }, true);

  assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, assets, skipped, emptyFolders, topLevel: [...topLevel].map(([name, isDir]) => ({ name, isDir })) };
}

/* ---------- 3. plan / apply ---------- */

export type ImportStatus = "new" | "replace" | "same";
export type PlanRow = ImportedFile & { status: ImportStatus };
/** A path that can't be added because the workspace already has a file where this path needs a
 *  folder, or a folder where it needs a file. */
export type BlockedRow = { path: string; why: "folder-exists" | "file-exists" };

export type ImportPlan = {
  rows: PlanRow[];
  blocked: BlockedRow[];
  counts: { new: number; replace: number; same: number };
  bytes: number;
  folders: number;
};

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Works out what importing `imported` would do to `existing`. `stripRoot` removes a leading
 *  folder name from every path (used to put a dropped project folder's *contents* at the root). */
export function planImport(existing: Files, imported: ImportedFile[], opts: { stripRoot?: string | null } = {}): ImportPlan {
  const root = opts.stripRoot ? `${opts.stripRoot}/` : null;

  const existingDirs = new Set<string>();
  for (const p of Object.keys(existing)) {
    for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1)) existingDirs.add(p.slice(0, i));
  }

  const rows: PlanRow[] = [];
  const blocked: BlockedRow[] = [];
  const dirs = new Set<string>();
  const counts = { new: 0, replace: 0, same: 0 };
  let bytes = 0;

  for (const f of imported) {
    const path = root && f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
    if (existingDirs.has(path)) { blocked.push({ path, why: "folder-exists" }); continue; }
    const parents: string[] = [];
    for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) parents.push(path.slice(0, i));
    if (parents.some((d) => hasOwn(existing, d))) { blocked.push({ path, why: "file-exists" }); continue; }
    for (const d of parents) dirs.add(d);
    const status: ImportStatus = !hasOwn(existing, path) ? "new" : existing[path] === f.content ? "same" : "replace";
    counts[status]++;
    bytes += f.bytes;
    rows.push({ ...f, path, status });
  }
  return { rows, blocked, counts, bytes, folders: dirs.size };
}

export type ImportResult = {
  next: Files;
  added: string[];
  replaced: string[];
  keptExisting: number;
  unchanged: number;
  blocked: number;
  /** Paths that were written (added + replaced). */
  touched: string[];
};

/** Applies an import. Files that exist with different content are replaced only when
 *  `replaceExisting` is set; identical files are never touched. Never mutates `existing`. */
export function applyImport(existing: Files, imported: ImportedFile[], opts: { stripRoot?: string | null; replaceExisting: boolean }): ImportResult {
  const plan = planImport(existing, imported, { stripRoot: opts.stripRoot });
  const next: Files = { ...existing };
  const added: string[] = [];
  const replaced: string[] = [];
  let keptExisting = 0;
  for (const r of plan.rows) {
    if (r.status === "new") { next[r.path] = r.content; added.push(r.path); }
    else if (r.status === "replace") {
      if (opts.replaceExisting) { next[r.path] = r.content; replaced.push(r.path); } else keptExisting++;
    }
  }
  return { next, added, replaced, keptExisting, unchanged: plan.counts.same, blocked: plan.blocked.length, touched: [...added, ...replaced] };
}

/** The scan's images and fonts with the same leading folder removed that `planImport` removes from text files,
 *  ready for `savePreviewAssets`. A path the workspace needs as a text file or a folder is left out. */
export function assetsToKeep(existing: Files, assets: ImportedAsset[], opts: { stripRoot?: string | null } = {}): PreviewAssetInput[] {
  const root = opts.stripRoot ? `${opts.stripRoot}/` : null;
  const out: PreviewAssetInput[] = [];
  for (const a of assets) {
    const path = root && a.path.startsWith(root) ? a.path.slice(root.length) : a.path;
    if (hasOwn(existing, path)) continue;
    out.push({ path, blob: a.blob });
  }
  return out;
}

/* ---------- helpers for the UI ---------- */

/** The file to open after an import: a README if there is one, otherwise whatever sits closest to the top. */
export function pickPrimaryFile(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const depth = (p: string) => p.split("/").length;
  const readme = (p: string) => /^readme(\.[a-z]+)?$/i.test(p.split("/").pop() ?? "");
  return [...paths].sort((a, b) => depth(a) - depth(b) || Number(readme(b)) - Number(readme(a)) || (a < b ? -1 : 1))[0];
}

/** Folders to expand in the explorer so the imported structure is visible straight away: every
 *  top-level folder that received files, plus the whole path down to the file that gets opened. */
export function foldersToReveal(touched: string[], primary: string | null): string[] {
  const out = new Set<string>();
  for (const p of touched) { const i = p.indexOf("/"); if (i !== -1) out.add(p.slice(0, i)); }
  if (primary) for (let i = primary.indexOf("/"); i !== -1; i = primary.indexOf("/", i + 1)) out.add(primary.slice(0, i));
  return [...out];
}

/** Rough number of characters the workspace takes up once saved (paths + contents). */
export function estimateStoredChars(files: Files): number {
  let n = 0;
  for (const [p, c] of Object.entries(files)) n += p.length + c.length + 6;
  return n;
}
