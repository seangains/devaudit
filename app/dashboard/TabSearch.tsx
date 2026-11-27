"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft, type LucideIcon } from "lucide-react";

export type SearchItem = { id: string; group: "Tabs" | "Projects" | "Actions" | "Settings"; label: string; hint?: string; icon: LucideIcon; run: () => void };

/** Command-palette style search over tabs, projects and settings. Opens from the top bar, the sidebar, or Ctrl/Cmd+K. */
export default function TabSearch({ items, onClose }: { items: SearchItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(needle));
  }, [items, q]);

  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" }); }, [idx]);

  function choose(i: SearchItem | undefined) { if (!i) return; onClose(); i.run(); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((n) => Math.min(n + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((n) => Math.max(n - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[idx]); }
  }

  let last = "";
  return (
    <div role="presentation" onClick={onClose} className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70 p-4 pt-[12vh] backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#121215] shadow-[0_0_60px_-12px_rgba(34,211,238,.25)]">
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tabs, projects, settings…" aria-label="Search"
            className="!min-h-0 min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[0.9375rem] text-zinc-100 placeholder:text-zinc-600 focus:outline-none" />
          <kbd className="hidden rounded-md border border-zinc-700 px-1.5 py-px font-mono text-[11px] text-zinc-500 sm:block">Esc</kbd>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {results.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">Nothing matches “{q}”.</p>}
          {results.map((r, i) => {
            const header = r.group !== last ? (last = r.group) : null;
            const Icon = r.icon;
            return (
              <div key={r.id}>
                {header && <p className="px-3 pb-1 pt-3 text-[12px] font-medium text-zinc-500">{header}</p>}
                <button data-idx={i} onClick={() => choose(r)} onMouseMove={() => setIdx(i)}
                  className={`!flex !min-h-10 w-full items-center gap-3 !rounded-lg !px-3 text-left text-[0.875rem] ${i === idx ? "bg-zinc-800/60 text-zinc-100" : "text-zinc-300"}`}>
                  <Icon size={16} className="shrink-0 text-cyan-300" />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.hint && <span className="hidden truncate font-mono text-xs text-zinc-500 sm:block">{r.hint}</span>}
                  {i === idx && <CornerDownLeft size={13} className="shrink-0 text-zinc-500" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

