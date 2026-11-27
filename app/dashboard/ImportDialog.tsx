"use client";

// The two pieces of UI behind dropping files / folders into the Code Studio:
//   <DropOverlay>   covers the studio while something is dragged over it ("Drop files here"), then
//                   while the drop is being read ("Reading files…").
//   <ImportDialog>  the confirmation: what will be added, which files already exist and would be
//                   replaced, and what was left out.
// All the decisions live in ./fileImport; this file only presents them. Styling reuses the
// utility classes the other dashboard dialogs use, so the dark/light dashboard theme applies as is.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, File as FileIcon, Folder, Loader2, Upload, X } from "lucide-react";
import { MAX_PREVIEW_ASSET_BYTES } from "./previewAssets";
import {
  MAX_IMPORT_FILE_BYTES, MAX_IMPORT_FILES, MAX_IMPORT_TOTAL_BYTES, STORAGE_WARN_CHARS,
  assetsToKeep, estimateStoredChars, planImport,
  type BlockedRow, type ImportStatus, type PlanRow, type ScanProgress, type ScanResult, type SkipReason,
} from "./fileImport";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const neutralBtn = "rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700";
const primaryBtn = "rounded-md bg-gradient-to-r from-cyan-400 to-indigo-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:brightness-110";

/* ---------- overlay ---------- */

export function DropOverlay({ mode, progress, onCancel, onDismiss }: {
  mode: "hover" | "reading";
  progress: ScanProgress | null;
  onCancel: () => void;
  /** Clicking the hover state closes it — a safety valve if the browser never sends a dragleave. */
  onDismiss: () => void;
}) {
  const detail = !progress ? "Looking through what you dropped…"
    : progress.stage === "finding" ? `Found ${plural(progress.done, "file")} so far…`
    : `${progress.done.toLocaleString()} of ${plural(progress.total, "file")}`;

  return (
    <div
      className="absolute inset-0 z-40 bg-zinc-900/80 p-2 backdrop-blur-sm"
      onClick={mode === "hover" ? onDismiss : undefined}
      role={mode === "reading" ? "status" : undefined}
      aria-live={mode === "reading" ? "polite" : undefined}
    >
      {/* In the hover state nothing inside may take pointer events: the overlay itself must be the
          drag target, otherwise moving across the text fires a dragleave and the overlay flickers. */}
      <div className={`flex h-full w-full flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-cyan-400 px-6 text-center ${mode === "hover" ? "pointer-events-none" : ""}`}>
        {mode === "hover" ? (
          <>
            <span className="grid h-14 w-14 place-items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"><Upload size={22} /></span>
            <p className="text-lg font-semibold text-zinc-100">Drop files here</p>
            <p className="max-w-xs text-xs leading-5 text-zinc-400">Folders keep their structure. You&apos;ll be asked to confirm before anything is added.</p>
          </>
        ) : (
          <>
            <Loader2 size={26} className="animate-spin text-cyan-300" />
            <p className="text-base font-semibold text-zinc-100">Reading files…</p>
            <p className="text-xs text-zinc-400">{detail}</p>
            <button onClick={onCancel} className={`mt-1 ${neutralBtn}`}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- dialog ---------- */

type TreeRow = { key: string; depth: number; name: string; dir: boolean; status?: ImportStatus; previewOnly?: boolean };

/** Flattens the files to be imported into an indented folder/file listing, ordered like the explorer
 *  (folders first, then files, each alphabetical). `previewOnly` rows are images and fonts kept for Preview. */
function toTreeRows(rows: { path: string; status: ImportStatus; previewOnly?: boolean }[]): TreeRow[] {
  type N = { name: string; dir: boolean; status?: ImportStatus; previewOnly?: boolean; kids: Map<string, N> };
  const root: N = { name: "", dir: true, kids: new Map() };
  for (const r of rows) {
    const parts = r.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const key = `${isFile ? "f" : "d"}:${part}`;
      let n = cur.kids.get(key);
      if (!n) { n = { name: part, dir: !isFile, kids: new Map() }; cur.kids.set(key, n); }
      if (isFile) { n.status = r.status; n.previewOnly = r.previewOnly; }
      cur = n;
    });
  }
  const out: TreeRow[] = [];
  const walk = (n: N, depth: number, prefix: string) => {
    const kids = [...n.kids.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    for (const k of kids) {
      const path = prefix + k.name;
      out.push({ key: `${k.dir ? "d" : "f"}:${path}`, depth, name: k.name, dir: k.dir, status: k.status, previewOnly: k.previewOnly });
      if (k.dir) walk(k, depth + 1, `${path}/`);
    }
  };
  walk(root, 0, "");
  return out;
}

const BADGE: Record<ImportStatus, { text: string; cls: string }> = {
  new: { text: "new", cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" },
  replace: { text: "replaces existing", cls: "border-amber-500/25 bg-amber-500/10 text-amber-400" },
  same: { text: "identical", cls: "border-zinc-700 bg-zinc-800/60 text-zinc-500" },
};

const REASONS: Record<SkipReason | BlockedRow["why"], { title: string; note: string }> = {
  ignored: { title: "Left out on purpose", note: "Folders such as node_modules and .git, and OS files like .DS_Store, never belong in a workspace." },
  env: { title: "Environment files", note: "Kept out so secrets can't be pushed to GitHub. Create them by hand if you need them here." },
  binary: { title: "Not text files", note: "This workspace only holds text, so archives, audio, video and other binary files can't be imported. (Images and fonts are kept for Preview.)" },
  "too-large": { title: "Too large", note: `Bigger than ${fmtBytes(MAX_IMPORT_FILE_BYTES)} (${fmtBytes(MAX_PREVIEW_ASSET_BYTES)} for images and fonts), which is more than the in-browser workspace can hold.` },
  unreadable: { title: "Couldn't be read", note: "The browser wouldn't let this be opened (permissions, or the file changed while reading)." },
  "unsafe-path": { title: "Unsupported file name", note: "The name contains characters (such as ? # or \\) or is too long to be a path in a repository." },
  duplicate: { title: "Same path dropped twice", note: "Another file with the exact same path was already included." },
  limit: { title: "Over the import limit", note: `A single import is capped at ${MAX_IMPORT_FILES.toLocaleString()} files / ${fmtBytes(MAX_IMPORT_TOTAL_BYTES)}. Import the rest in a second drop.` },
  "folder-exists": { title: "Clashes with an existing folder", note: "The workspace already has a folder with this name, and a path can't be both." },
  "file-exists": { title: "Clashes with an existing file", note: "The workspace already has a file where this path needs a folder." },
};
const REASON_ORDER: (keyof typeof REASONS)[] = ["unsafe-path", "folder-exists", "file-exists", "too-large", "binary", "env", "ignored", "duplicate", "limit", "unreadable"];

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  const cls = tone === "ok" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
    : tone === "warn" ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
    : "border-zinc-700 bg-zinc-800/60 text-zinc-400";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

const MAX_TREE_ROWS = 600;
const MAX_LISTED = 25;

export function ImportDialog({ scan, files, onCancel, onConfirm }: {
  scan: ScanResult;
  /** The workspace's current files — duplicates are worked out against these. */
  files: Record<string, string>;
  onCancel: () => void;
  onConfirm: (opts: { stripRoot: string | null; replaceExisting: boolean }) => void;
}) {
  // Exactly one folder dropped: offer to use its contents as the workspace root instead of nesting it.
  const rootName = scan.topLevel.length === 1 && scan.topLevel[0].isDir ? scan.topLevel[0].name : null;
  const [flatten, setFlatten] = useState(false);
  const stripRoot = flatten ? rootName : null;

  const plan = useMemo(() => planImport(files, scan.files, { stripRoot }), [files, scan.files, stripRoot]);
  // Images and fonts go to Preview's own store, not into the workspace, so they never clash with workspace files.
  const assetPaths = useMemo(() => assetsToKeep(files, scan.assets, { stripRoot }).map((a) => a.path), [files, scan.assets, stripRoot]);
  const nAssets = assetPaths.length;
  const tree = useMemo(
    () => toTreeRows([...plan.rows.map((r) => ({ path: r.path, status: r.status })), ...assetPaths.map((path) => ({ path, status: "new" as ImportStatus, previewOnly: true }))]),
    [plan.rows, assetPaths],
  );
  const { new: nNew, replace: nReplace, same: nSame } = plan.counts;
  const changes = nNew + nReplace + nAssets;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const groups = useMemo(() => {
    const by = new Map<keyof typeof REASONS, string[]>();
    const add = (k: keyof typeof REASONS, label: string) => { const l = by.get(k); if (l) l.push(label); else by.set(k, [label]); };
    for (const s of scan.skipped) add(s.reason, `${s.path}${s.isDir ? "/" : ""}${s.bytes ? ` (${fmtBytes(s.bytes)})` : ""}`);
    for (const b of plan.blocked) add(b.why, b.path);
    return REASON_ORDER.filter((k) => by.has(k)).map((k) => ({ key: k, ...REASONS[k], items: by.get(k)! }));
  }, [scan.skipped, plan.blocked]);
  const skippedCount = scan.skipped.length + plan.blocked.length;

  const replacePaths = useMemo(() => plan.rows.filter((r) => r.status === "replace").map((r) => r.path), [plan.rows]);
  const storedAfter = useMemo(() => estimateStoredChars(files) + plan.rows.reduce((n, r) => n + r.path.length + r.content.length, 0), [files, plan.rows]);

  const source = scan.topLevel.length === 1 ? `${scan.topLevel[0].name}${scan.topLevel[0].isDir ? "/" : ""}` : plural(scan.topLevel.length, "dropped item");
  const assetBytes = useMemo(() => scan.assets.reduce((n, a) => n + a.bytes, 0), [scan.assets]);
  const title = changes === 0 ? "Nothing to import" : plan.rows.length > 0 ? `Import ${plural(plan.rows.length, "file")}` : `Import ${plural(nAssets, "image or font", "images and fonts")}`;
  const subtitle = plan.rows.length > 0
    ? `${source} · ${plural(plan.folders, "folder")} · ${fmtBytes(plan.bytes)}`
    : source;

  // With duplicates the safe choice (keep what's there) is the one Enter lands on.
  const focusKeep = nReplace > 0 && nNew > 0;
  const focusCancel = nReplace > 0 && nNew === 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-zinc-800 bg-[#121215] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0">
            <h3 id="import-title" className="flex items-center gap-1.5 text-sm font-semibold text-white"><Upload size={14} className="shrink-0 text-cyan-300" />{title}</h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{subtitle}</p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs">
          {changes === 0 && (
            <p className="leading-5 text-zinc-300">
              {plan.rows.length > 0
                ? `Everything you dropped is already in this workspace, unchanged.`
                : `None of what you dropped can be imported — see below for why.`}
            </p>
          )}

          {(plan.rows.length > 0 || nAssets > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {nNew > 0 && <Chip tone="ok">{nNew.toLocaleString()} new</Chip>}
              {nAssets > 0 && <Chip tone="ok">{plural(nAssets, "image or font", "images and fonts")} for Preview</Chip>}
              {nReplace > 0 && <Chip tone="warn">{nReplace.toLocaleString()} already {nReplace === 1 ? "exists" : "exist"}</Chip>}
              {nSame > 0 && <Chip tone="muted">{nSame.toLocaleString()} identical</Chip>}
            </div>
          )}

          {nReplace > 0 && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 leading-5">
              <p className="flex items-start gap-1.5 font-medium text-amber-300">
                <AlertTriangle size={13} className="mt-1 shrink-0" />
                <span>
                  {nReplace === 1 ? "1 file already exists" : `${nReplace.toLocaleString()} files already exist`} in this workspace with different contents.
                  {" "}Replace {nReplace === 1 ? "it" : "them"} with the {nReplace === 1 ? "version" : "versions"} you dropped?
                </span>
              </p>
              <p className="mt-1 text-zinc-400">
                {nNew > 0 ? `Either way, the ${plural(nNew, "new file")} will be added. ` : ""}
                {nSame > 0 ? `${plural(nSame, "other file")} ${nSame === 1 ? "is" : "are"} identical and will be left alone. ` : ""}
                Replacing can&apos;t be undone.
              </p>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-zinc-300 hover:text-zinc-100">Show the {nReplace === 1 ? "file" : "files"}</summary>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-zinc-400">
                  {replacePaths.slice(0, 200).map((p) => <li key={p} className="truncate">{p}</li>)}
                  {replacePaths.length > 200 && <li>…and {(replacePaths.length - 200).toLocaleString()} more</li>}
                </ul>
              </details>
            </div>
          )}

          {nAssets > 0 && (
            <p className="rounded-lg border border-zinc-800 px-3 py-2 leading-5 text-zinc-400">
              <span className="font-medium text-zinc-200">{plural(nAssets, "image or font", "images and fonts")}</span> ({fmtBytes(assetBytes)}) will be kept so Preview can draw the site properly.
              They aren&apos;t workspace files: they can&apos;t be edited here and they aren&apos;t pushed to GitHub.
            </p>
          )}

          {storedAfter > STORAGE_WARN_CHARS && changes > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 leading-5 text-amber-300">
              <AlertTriangle size={13} className="mt-1 shrink-0" />
              <span>This workspace would be about {fmtBytes(storedAfter)}. Browsers keep only a few MB per site, so it may not survive a reload — sync it to GitHub to be safe.</span>
            </p>
          )}

          {rootName && plan.rows.length + plan.blocked.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 px-3 py-2 leading-5 text-zinc-300">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} className="mt-1" />
              <span>
                Put the contents of <code className="font-mono text-zinc-100">{rootName}/</code> at the top level of the workspace
                <span className="block text-zinc-500">
                  {flatten ? `The ${rootName}/ folder itself is left out; its files go straight into the workspace.` : `Files are placed under ${rootName}/, exactly as dropped.`}
                </span>
              </span>
            </label>
          )}

          {tree.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Preview</p>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-[#09090b] p-1.5 font-mono">
                {tree.slice(0, MAX_TREE_ROWS).map((r) => (
                  <div key={r.key} style={{ paddingLeft: 6 + r.depth * 14 }} className="flex items-center gap-1.5 py-0.5 pr-1">
                    {r.dir ? <Folder size={12} className="shrink-0 text-cyan-300" /> : <FileIcon size={12} className="shrink-0 text-zinc-500" />}
                    <span className={`min-w-0 truncate ${r.dir ? "text-zinc-300" : "text-zinc-400"}`}>{r.name}</span>
                    {r.previewOnly && (
                      <span className="ml-auto shrink-0 rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 text-[10px] leading-4 text-cyan-300">preview only</span>
                    )}
                    {r.status && r.status !== "new" && (
                      <span className={`ml-auto shrink-0 rounded border px-1.5 text-[10px] leading-4 ${BADGE[r.status].cls}`}>{BADGE[r.status].text}</span>
                    )}
                  </div>
                ))}
                {tree.length > MAX_TREE_ROWS && <p className="px-1.5 py-1 text-zinc-600">…and {(tree.length - MAX_TREE_ROWS).toLocaleString()} more</p>}
              </div>
            </div>
          )}

          {(skippedCount > 0 || scan.emptyFolders > 0) && (
            <details open={changes === 0} className="rounded-lg border border-zinc-800">
              <summary className="cursor-pointer px-3 py-2 text-zinc-300 hover:text-zinc-100">
                {skippedCount > 0 ? `${plural(skippedCount, "item")} left out` : `${plural(scan.emptyFolders, "empty folder")} not imported`}
              </summary>
              <div className="space-y-3 border-t border-zinc-800/80 px-3 py-2.5">
                {groups.map((g) => (
                  <div key={g.key}>
                    <p className="font-medium text-zinc-200">{g.title} <span className="font-normal text-zinc-500">({g.items.length.toLocaleString()})</span></p>
                    <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{g.note}</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-400">
                      {g.items.slice(0, MAX_LISTED).map((p) => <li key={p} className="truncate">{p}</li>)}
                      {g.items.length > MAX_LISTED && <li className="text-zinc-600">…and {(g.items.length - MAX_LISTED).toLocaleString()} more</li>}
                    </ul>
                  </div>
                ))}
                {scan.emptyFolders > 0 && (
                  <p className="text-[11px] leading-4 text-zinc-500">
                    {plural(scan.emptyFolders, "empty folder")} can&apos;t be kept — the workspace stores files, and a folder only exists while it has one in it.
                  </p>
                )}
              </div>
            </details>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800/80 px-4 py-3">
          <button onClick={onCancel} autoFocus={focusCancel || changes === 0} className={neutralBtn}>{changes === 0 ? "Close" : "Cancel"}</button>
          {focusKeep && (
            <button onClick={() => onConfirm({ stripRoot, replaceExisting: false })} autoFocus className={neutralBtn}>Keep existing files</button>
          )}
          {changes > 0 && (
            <button onClick={() => onConfirm({ stripRoot, replaceExisting: nReplace > 0 })} autoFocus={nReplace === 0} className={primaryBtn}>
              {nReplace > 0 ? `Replace ${plural(nReplace, "file")}` : nNew > 0 ? `Import ${plural(nNew, "file")}` : `Import ${plural(nAssets, "image or font", "images and fonts")}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
