// ---------------------------------------------------------------------------
// Images and fonts for Preview.
//
// The workspace (VFiles) is a flat { path: text } map: it lives in localStorage and every file in it is
// written to GitHub on sync, so it cannot hold a PNG or a font. Preview still needs them: a site's
// background, its logo, its web fonts. This module keeps those binary files in a separate,
// per-project store that only Preview reads:
//
//   * IndexedDB, so a few MB of images survive a reload (localStorage could not hold them);
//   * never part of VFiles, never written to localStorage, never pushed to GitHub, never sent to the
//     AI reviewer;
//   * filled when files are imported (drop / upload / GitHub import) and read when Preview builds.
//
// If IndexedDB is unavailable (private windows, blocked storage) the files are still kept in memory for
// the rest of the page's life, so Preview works in that session and simply forgets them on reload.
//
// No React in here, so it can be tested on its own.
// ---------------------------------------------------------------------------

/** Binary files Preview can use, by extension. SVG is text, so it already lives in the workspace. */
const PREVIEW_ASSET_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
};

/** One file. Bigger than this is almost never a site asset, and it would bloat the preview document. */
export const MAX_PREVIEW_ASSET_BYTES = 3_000_000;
/** All of a project's assets together (IndexedDB allows far more; this keeps imports and builds quick). */
export const MAX_PREVIEW_ASSETS_TOTAL_BYTES = 20_000_000;
export const MAX_PREVIEW_ASSETS = 200;

/** The MIME type for a file Preview can use, or null for anything else. */
export function previewAssetMime(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  if (!name.includes(".")) return null;
  const ext = name.split(".").pop()!.toLowerCase();
  return Object.prototype.hasOwnProperty.call(PREVIEW_ASSET_MIME, ext) ? PREVIEW_ASSET_MIME[ext] : null;
}

/** path (as in the workspace) -> the file. A string is a ready-made `data:` URL. */
export type PreviewAssetMap = Record<string, Blob | string>;
export type PreviewAssetInput = { path: string; blob: Blob };

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** `data:` URL for an asset. Chunked so a multi-MB file doesn't blow the call stack. */
export async function previewAssetDataUrl(value: Blob | string, path: string): Promise<string> {
  if (typeof value === "string") return value;
  const type = value.type || previewAssetMime(path) || "application/octet-stream";
  const bytes = new Uint8Array(await value.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return `data:${type};base64,${btoa(binary)}`;
}

/* ---------- storage ---------- */

const DB_NAME = "devaudit-preview-assets";
const STORE = "assets";
type Row = { projectId: string; path: string; type: string; blob: Blob };

// Everything saved or loaded in this page's life, so the store keeps working when IndexedDB doesn't.
const memory = new Map<string, Map<string, Blob>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: ["projectId", "path"] }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

const done = (tx: IDBTransaction) => new Promise<boolean>((resolve) => {
  tx.oncomplete = () => resolve(true);
  tx.onerror = () => resolve(false);
  tx.onabort = () => resolve(false);
});
const projectRange = (projectId: string) => IDBKeyRange.bound([projectId, ""], [projectId, "￿"]);

function memoryFor(projectId: string): Map<string, Blob> {
  let m = memory.get(projectId);
  if (!m) { m = new Map(); memory.set(projectId, m); }
  return m;
}

/** Adds (or, with `replace`, swaps in) a project's assets. Returns how many are now kept. Files over the
 *  per-file limit, and anything past the project's file-count or total-size limit, are ignored. */
export async function savePreviewAssets(projectId: string, inputs: PreviewAssetInput[], opts: { replace?: boolean } = {}): Promise<number> {
  const mem = memoryFor(projectId);
  if (opts.replace) mem.clear();
  let total = 0;
  for (const b of mem.values()) total += b.size;
  const accepted: PreviewAssetInput[] = [];
  for (const it of inputs) {
    if (!previewAssetMime(it.path) || it.blob.size > MAX_PREVIEW_ASSET_BYTES) continue;
    const replacing = mem.get(it.path)?.size ?? 0;
    if (total - replacing + it.blob.size > MAX_PREVIEW_ASSETS_TOTAL_BYTES) continue;
    if (!mem.has(it.path) && mem.size >= MAX_PREVIEW_ASSETS) continue;
    total += it.blob.size - replacing;
    mem.set(it.path, it.blob);
    accepted.push(it);
  }
  const db = await openDb();
  if (db) {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (opts.replace) store.delete(projectRange(projectId));
      for (const it of accepted) {
        const row: Row = { projectId, path: it.path, type: it.blob.type || previewAssetMime(it.path) || "", blob: it.blob };
        store.put(row);
      }
      await done(tx);
    } catch { /* kept in memory only */ }
  }
  return mem.size;
}

/** Everything stored for a project (empty if there is nothing, or storage isn't available). */
export async function loadPreviewAssets(projectId: string): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  const db = await openDb();
  if (db) {
    try {
      const rows = await new Promise<Row[]>((resolve) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll(projectRange(projectId));
        req.onsuccess = () => resolve(req.result as Row[]);
        req.onerror = () => resolve([]);
      });
      for (const r of rows) if (r && typeof r.path === "string" && r.blob) out[r.path] = r.blob.type ? r.blob : new Blob([r.blob], { type: r.type });
    } catch { /* fall through to memory */ }
  }
  const mem = memory.get(projectId);
  if (mem) for (const [p, b] of mem) if (!hasOwn(out, p)) out[p] = b;
  return out;
}

export async function clearPreviewAssets(projectId: string): Promise<void> {
  memory.delete(projectId);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(projectRange(projectId));
    await done(tx);
  } catch { /* nothing to clean up */ }
}
