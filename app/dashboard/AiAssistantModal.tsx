"use client";

// ---------------------------------------------------------------------------------------------
// AI Assistant — a mini "AI website" that opens in the middle of the dashboard.
//
//   • Left rail with its own navigation: Chat, Recent chats, Prompt library, Attachments, Project context
//   • Many saved conversations per project (kept in this browser, like the rest of the app's local state)
//   • Attach images, files, links, or any file from the project; drag & drop and paste images too
//   • Replies render code blocks (with a copy button), lists and inline code; proposed file changes can be applied
//
// It talks to the same /api/ai "chat" action as the old side panel, through the `requestChat` prop
// (CodeStudio passes requestAiChat). This file only imports *types* from CodeStudio, so there's no import cycle.
// ---------------------------------------------------------------------------------------------

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Sparkles, MessageSquare, History, BookOpen, Paperclip, Layers, Plus, X, Trash2, Copy, Check, Loader2, AlertCircle,
  Image as ImageIcon, Link2, FileText, ArrowUp, Search, Pin, PinOff, RotateCcw, Bug, FlaskConical, Wand2, Lightbulb,
  FolderGit2, Zap, ShieldCheck, FileCode2, CloudUpload,
} from "lucide-react";
import type { VFiles, AiChatInput, AiChatResult } from "./CodeStudio";
import { Toggle, EmptyState } from "./dashboardUi";

// ---------------------------------------------------------------------------------------------
// Types + storage
// ---------------------------------------------------------------------------------------------
type ImageAtt = { id: string; kind: "image"; name: string; size: number; w: number; h: number; thumb: string; mediaType: string; data?: string };
type FileAtt = { id: string; kind: "file"; name: string; size: number; content: string; truncated: boolean; fromProject?: boolean };
type LinkAtt = { id: string; kind: "link"; url: string; host: string };
type Att = ImageAtt | FileAtt | LinkAtt;
type Msg = { id: string; role: "user" | "assistant"; content: string; at: number; atts?: Att[]; proposedFiles?: VFiles; applied?: boolean };
type Convo = { id: string; title: string; createdAt: number; updatedAt: number; pinned?: boolean; messages: Msg[] };
type View = "chat" | "history" | "prompts" | "library" | "context";

const MAX_CONVOS = 40;
const MAX_MSGS_PER_CONVO = 80;
const MAX_HISTORY_SENT = 16;
const MAX_REFERENCED_FILES = 5;
const MAX_FILE_CHARS_SENT = 6000;
const MAX_FILE_CHARS_STORED = 40_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_READ_BYTES = 400 * 1024;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|otf|eot|mp4|mov|mp3|wasm|exe|dll|bin)$/i;

const convosKey = (pid: string) => `devaudit:chats:v2:${pid}`;
const legacyKey = (pid: string) => `devaudit:chat:${pid}`;
const pinnedKey = (pid: string) => `devaudit:chat-context:${pid}`;

const genId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

function loadConvos(pid: string): Convo[] {
  try {
    const raw = localStorage.getItem(convosKey(pid));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Convo[];
    }
    // Bring over the single chat the old side panel kept, so nobody loses their history.
    const old = localStorage.getItem(legacyKey(pid));
    const oldMsgs = old ? JSON.parse(old) : [];
    if (Array.isArray(oldMsgs) && oldMsgs.length > 0) {
      const now = Date.now();
      const messages: Msg[] = oldMsgs
        .filter((m: { role?: string; content?: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: { id?: string; role: "user" | "assistant"; content: string; proposedFiles?: VFiles; applied?: boolean }, i: number) => ({
          id: m.id || genId(), role: m.role, content: m.content, at: now - (oldMsgs.length - i) * 1000, proposedFiles: m.proposedFiles, applied: m.applied,
        }));
      if (messages.length) return [{ id: genId(), title: "Earlier conversation", createdAt: now, updatedAt: now, messages }];
    }
  } catch { /* ignore corrupt storage */ }
  return [];
}

function saveConvos(pid: string, convos: Convo[]) {
  // Full-size image data is only kept for the current session; the small thumbnail is what gets stored.
  const slim = (list: Convo[]) => list.map((c) => ({
    ...c,
    messages: c.messages.map((m) => (m.atts ? { ...m, atts: m.atts.map((a) => (a.kind === "image" ? { ...a, data: undefined } : a)) } : m)),
  }));
  let list = slim(convos);
  for (let attempt = 0; attempt < 12; attempt++) {
    try { localStorage.setItem(convosKey(pid), JSON.stringify(list)); return; }
    catch {
      // Storage is full: drop the oldest conversation that isn't pinned and try again.
      const idx = [...list].reverse().findIndex((c) => !c.pinned);
      if (idx === -1 || list.length <= 1) return;
      list = list.filter((_, i) => i !== list.length - 1 - idx);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function fmtAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "Just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} d ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A short, readable chat title: the message without links, cut at a word boundary. */
function makeTitle(text: string, atts: Att[]): string {
  const base = text.replace(URL_IN_TEXT, "").replace(/\s+/g, " ").trim();
  if (base) return base.length <= 48 ? base : `${base.slice(0, 48).replace(/\s+\S*$/, "")}…`;
  const first = atts[0];
  if (!first) return "New conversation";
  if (first.kind === "link") return `About ${first.host}`;
  return first.kind === "image" ? `Screenshot: ${first.name}` : `About ${first.name}`;
}

function normalizeUrl(input: string): { url: string; host: string } | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return { url: u.toString(), host: u.hostname.replace(/^www\./, "") };
  } catch { return null; }
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"')]+[^\s<>"')\].,;:!?]/g;

async function processImage(file: File): Promise<ImageAtt> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Couldn't read ${file.name} as an image.`));
      el.src = url;
    });
    const sw = img.naturalWidth || 512, sh = img.naturalHeight || 512;
    const draw = (max: number, quality: number) => {
      const scale = Math.min(1, max / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't process images.");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); // transparent PNGs would turn black as JPEG otherwise
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", quality);
    };
    return { id: genId(), kind: "image", name: file.name || "pasted-image.png", size: file.size, w: sw, h: sh, mediaType: "image/jpeg", data: draw(1280, 0.82), thumb: draw(360, 0.62) };
  } finally { URL.revokeObjectURL(url); }
}

async function processTextFile(file: File): Promise<FileAtt> {
  if (BINARY.test(file.name)) throw new Error(`${file.name} looks like a binary file, so it can't be read as text.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
  const text = await file.slice(0, MAX_TEXT_READ_BYTES).text();
  if (text.includes("\u0000")) throw new Error(`${file.name} looks like a binary file, so it can't be read as text.`);
  return { id: genId(), kind: "file", name: file.name, size: file.size, content: text.slice(0, MAX_FILE_CHARS_STORED), truncated: file.size > MAX_TEXT_READ_BYTES || text.length > MAX_FILE_CHARS_STORED };
}

function mentionedFiles(message: string, files: VFiles, exclude: Set<string>): VFiles {
  const out: VFiles = {};
  for (const path of Object.keys(files)) {
    if (exclude.has(path)) continue;
    const base = path.split("/").pop() || path;
    if (message.includes(path) || (base.length > 2 && message.includes(base))) out[path] = files[path];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rich text for replies (no HTML injection: everything is built as React nodes)
// ---------------------------------------------------------------------------------------------
function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" data-tip={`${label} to clipboard`}
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }).catch(() => {}); }}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.75rem] font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100 ${className}`}
    >
      {done ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}{done ? "Copied" : label}
    </button>
  );
}

function Inline({ s }: { s: string }) {
  const nodes: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>"')]+)/g;
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    let tok = m[0];
    if (m[1]) nodes.push(<code key={i++} className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[0.85em] text-zinc-100">{tok.slice(1, -1)}</code>);
    else if (m[2]) nodes.push(<strong key={i++} className="font-semibold text-zinc-50">{tok.slice(2, -2)}</strong>);
    else {
      tok = tok.replace(/[.,;:!?]+$/, "");
      re.lastIndex = m.index + tok.length;
      nodes.push(<a key={i++} href={tok} target="_blank" rel="noreferrer" className="break-all underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300">{tok}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return <>{nodes}</>;
}

function Markdownish({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;
  const flushPara = () => { if (para.length) { out.push(<p key={k++} className="whitespace-pre-wrap">{<Inline s={para.join("\n")} />}</p>); para = []; } };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(<Tag key={k++} className={`${list.ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-6 marker:text-zinc-500`}>{list.items.map((it, j) => <li key={j}><Inline s={it} /></li>)}</Tag>);
    list = null;
  };
  for (const line of lines) {
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); out.push(<p key={k++} className="pt-2 text-[1rem] font-semibold text-zinc-50"><Inline s={h[1]} /></p>); }
    else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return <div className="space-y-3.5">{out}</div>;
}

function RichText({ text }: { text: string }) {
  const blocks: ({ kind: "md"; body: string } | { kind: "code"; lang: string; body: string })[] = [];
  const re = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) blocks.push({ kind: "md", body: text.slice(last, m.index) });
    blocks.push({ kind: "code", lang: m[1] || "", body: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) blocks.push({ kind: "md", body: text.slice(last) });
  return (
    <div className="space-y-4 text-[0.9375rem] leading-[1.75] text-zinc-200">
      {blocks.map((b, i) => b.kind === "md" ? (
        b.body.trim() ? <Markdownish key={i} body={b.body} /> : null
      ) : (
        <div key={i} className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0d0f]">
          <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-1.5">
            <span className="text-[0.75rem] font-medium text-zinc-500">{b.lang || "code"}</span>
            <CopyButton text={b.body} />
          </div>
          <pre className="da-code overflow-x-auto p-4 text-[0.8125rem] leading-6 text-zinc-300"><code>{b.body}</code></pre>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Prompt library
// ---------------------------------------------------------------------------------------------
const PROMPT_GROUPS: { group: string; items: { icon: typeof Bug; title: string; text: string }[] }[] = [
  { group: "Understand", items: [
    { icon: FileText, title: "Explain this file", text: "Explain what the file I have open does, step by step, as if I'm new to programming." },
    { icon: FolderGit2, title: "Tour the project", text: "Give me a tour of this project: what each file is for and how they fit together." },
    { icon: Lightbulb, title: "Why does it work this way?", text: "Why is this code written this way? Point out the key ideas I should understand." },
  ] },
  { group: "Fix", items: [
    { icon: Bug, title: "Find bugs", text: "Read the file I have open and list any bugs or mistakes, most serious first, with a fix for each." },
    { icon: ShieldCheck, title: "Add error handling", text: "Where could this code crash? Add sensible error handling and show me the updated code." },
    { icon: AlertCircle, title: "Why is it failing?", text: "My project is throwing an error. Help me work out the cause. Ask me for the error message if you need it." },
  ] },
  { group: "Improve", items: [
    { icon: Wand2, title: "Make it cleaner", text: "Refactor the file I have open to be easier to read, without changing what it does. Show the new version." },
    { icon: Zap, title: "Speed it up", text: "Look for anything slow or wasteful in this code and suggest concrete improvements." },
    { icon: FileCode2, title: "Add comments", text: "Add short, helpful comments to the file I have open. Only comment what isn't obvious." },
  ] },
  { group: "Build", items: [
    { icon: FlaskConical, title: "Write tests", text: "Write tests for the file I have open using describe / it / expect. Cover the normal cases and a couple of edge cases." },
    { icon: Plus, title: "Add a feature", text: "I want to add a new feature to this project. Ask me what it should do, then propose the code changes." },
    { icon: BookOpen, title: "Write a README", text: "Write a clear README for this project: what it does, how to run it, and how to use it." },
  ] },
];

// ---------------------------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------------------------
export type AiAssistantModalProps = {
  projectId: string;
  projectName?: string;
  files: VFiles;
  currentFile: string | null;
  onApplyFiles: (patch: VFiles) => void;
  onClose: () => void;
  requestChat: (input: AiChatInput) => Promise<AiChatResult>;
};

const NAV: { view: View; label: string; icon: typeof MessageSquare; blurb: string }[] = [
  { view: "chat", label: "Chat", icon: MessageSquare, blurb: "Talk to the assistant about your project" },
  { view: "history", label: "Recent chats", icon: History, blurb: "Pick up an earlier conversation" },
  { view: "prompts", label: "Prompt library", icon: BookOpen, blurb: "Ready-made questions to start from" },
  { view: "library", label: "Attachments", icon: Paperclip, blurb: "Images, files and links you've shared" },
  { view: "context", label: "Project context", icon: Layers, blurb: "Choose which files the assistant can see" },
];

export default function AiAssistantModal({ projectId, projectName, files, currentFile, onApplyFiles, onClose, requestChat }: AiAssistantModalProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<View>("chat");
  const [convos, setConvos] = useState<Convo[]>(() => loadConvos(projectId));
  const [activeId, setActiveId] = useState<string | null>(() => loadConvos(projectId)[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Att[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<null | "attach" | "project">(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkVal, setLinkVal] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [libTab, setLibTab] = useState<"images" | "files" | "links">("images");
  const [pinned, setPinned] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(pinnedKey(projectId)) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } });
  const [contextQuery, setContextQuery] = useState("");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const lastSent = useRef<{ text: string; atts: Att[] } | null>(null);

  // Render inside .da-root so the theme (colours, Poppins, animations) applies, and position: fixed is relative to the window.
  useEffect(() => { setTarget(document.querySelector<HTMLElement>(".da-root") ?? document.body); }, []);

  const active = useMemo(() => convos.find((c) => c.id === activeId) ?? null, [convos, activeId]);
  const messages = active?.messages ?? [];

  // Persist (debounced) whenever conversations change.
  useEffect(() => {
    const t = setTimeout(() => saveConvos(projectId, convos), 250);
    return () => clearTimeout(t);
  }, [convos, projectId]);
  useEffect(() => { try { localStorage.setItem(pinnedKey(projectId), JSON.stringify(pinned)); } catch { /* ignore */ } }, [pinned, projectId]);

  // Keep the newest message in view.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length, sending, activeId, view]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft, view]);

  useEffect(() => { if (view === "chat") textareaRef.current?.focus(); }, [view, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (menuOpen) setMenuOpen(null);
      else if (linkOpen) setLinkOpen(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, linkOpen, onClose]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t); }, [notice]);

  // ---- conversation helpers ------------------------------------------------------------------
  const patchConvo = useCallback((id: string, fn: (c: Convo) => Convo) => {
    setConvos((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  function newChat() {
    setActiveId(null); setView("chat"); setDraft(""); setPending([]); setError(null); setLinkOpen(false); setMenuOpen(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }
  function openConvo(id: string) { setActiveId(id); setView("chat"); setError(null); }
  function deleteConvo(id: string) {
    setConvos((list) => list.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }
  function clearAll() {
    setConvos((list) => list.filter((c) => c.pinned));
    if (!convos.find((c) => c.id === activeId)?.pinned) setActiveId(null);
  }

  // ---- attachments ---------------------------------------------------------------------------
  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const arr = Array.from(list);
    const problems: string[] = [];
    const added: Att[] = [];
    for (const f of arr) {
      try { added.push(f.type.startsWith("image/") ? await processImage(f) : await processTextFile(f)); }
      catch (e) { problems.push(e instanceof Error ? e.message : `Couldn't add ${f.name}.`); }
    }
    if (added.length) setPending((p) => [...p, ...added].slice(0, 12));
    if (problems.length) setNotice(problems.join(" "));
    setView("chat");
  }
  function addLink() {
    const n = normalizeUrl(linkVal);
    if (!n) { setNotice("That doesn't look like a web address. Try something like https://example.com/page"); return; }
    setPending((p) => (p.some((a) => a.kind === "link" && a.url === n.url) ? p : [...p, { id: genId(), kind: "link", url: n.url, host: n.host }]));
    setLinkVal(""); setLinkOpen(false);
  }
  function addProjectFile(path: string) {
    const content = files[path] ?? "";
    setPending((p) => (p.some((a) => a.kind === "file" && a.name === path) ? p : [...p, { id: genId(), kind: "file", name: path, size: content.length, content: content.slice(0, MAX_FILE_CHARS_STORED), truncated: content.length > MAX_FILE_CHARS_STORED, fromProject: true }]));
    setMenuOpen(null); setProjectQuery("");
  }
  const removePending = (id: string) => setPending((p) => p.filter((a) => a.id !== id));

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imgs = Array.from(e.clipboardData.files as FileList).filter((f: File) => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); void addFiles(imgs); }
  }
  function onDragEnter(e: DragEvent) { if (e.dataTransfer.types.includes("Files")) { dragDepth.current++; setDragging(true); } }
  function onDragLeave() { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }
  function onDrop(e: DragEvent) {
    e.preventDefault(); dragDepth.current = 0; setDragging(false);
    void addFiles(e.dataTransfer.files);
  }

  // ---- sending -------------------------------------------------------------------------------
  async function send(override?: { text: string; atts: Att[] }) {
    const text = (override ? override.text : draft).trim();
    const atts = override ? override.atts : pending;
    if ((!text && atts.length === 0) || sending) return;

    // Links typed straight into the message count as attachments too.
    const typedLinks = Array.from(new Set(text.match(URL_IN_TEXT) ?? []));
    const allAtts: Att[] = [...atts];
    for (const u of typedLinks) {
      const n = normalizeUrl(u);
      if (n && !allAtts.some((a) => a.kind === "link" && a.url === n.url)) allAtts.push({ id: genId(), kind: "link", url: n.url, host: n.host });
    }

    const now = Date.now();
    const userMsg: Msg = { id: genId(), role: "user", content: text || "Please take a look at what I've attached.", at: now, atts: allAtts.length ? allAtts : undefined };
    let convoId = activeId;
    let priorMessages = messages;
    if (!convoId || !active) {
      convoId = genId();
      priorMessages = [];
      const convo: Convo = { id: convoId, title: makeTitle(text, allAtts), createdAt: now, updatedAt: now, messages: [userMsg] };
      setConvos((list) => [convo, ...list].slice(0, MAX_CONVOS));
      setActiveId(convoId);
    } else {
      patchConvo(convoId, (c) => ({ ...c, updatedAt: now, messages: [...c.messages, userMsg].slice(-MAX_MSGS_PER_CONVO) }));
    }

    lastSent.current = { text, atts };
    setDraft(""); setPending([]); setError(null); setLinkOpen(false); setMenuOpen(null); setSending(true);

    try {
      const fileAtts = allAtts.filter((a): a is FileAtt => a.kind === "file");
      const linkAtts = allAtts.filter((a): a is LinkAtt => a.kind === "link");
      const imageAtts = allAtts.filter((a): a is ImageAtt => a.kind === "image");

      // Files to put in front of the model: attached first, then pinned, then anything named in the message.
      const referenced: VFiles = {};
      const add = (path: string, content: string) => { if (Object.keys(referenced).length < MAX_REFERENCED_FILES && !(path in referenced)) referenced[path] = content.slice(0, MAX_FILE_CHARS_SENT); };
      for (const f of fileAtts) add(f.fromProject ? f.name : `attached/${f.name}`, f.content);
      for (const p of pinned) if (p !== currentFile && files[p] !== undefined) add(p, files[p]);
      const mentioned = mentionedFiles(text, files, new Set([...(currentFile ? [currentFile] : []), ...Object.keys(referenced)]));
      for (const [p, c] of Object.entries(mentioned)) add(p, c);

      let outgoing = text || "Please take a look at what I've attached.";
      if (linkAtts.length) outgoing += `\n\nLinks I'm referring to (you can't open them, so work from the address and what I say about them):\n${linkAtts.map((l) => `- ${l.url}`).join("\n")}`;
      if (imageAtts.length) outgoing += `\n\n[I attached ${imageAtts.length} image${imageAtts.length === 1 ? "" : "s"}: ${imageAtts.map((i) => i.name).join(", ")}]`;
      if (fileAtts.length) outgoing += `\n\n[I attached ${fileAtts.length} file${fileAtts.length === 1 ? "" : "s"}: ${fileAtts.map((f) => f.name).join(", ")}]`;

      const history = [...priorMessages.slice(-(MAX_HISTORY_SENT - 1)).map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: outgoing }];
      const currentContent = currentFile ? files[currentFile] : undefined;

      const result = await requestChat({
        messages: history,
        currentFile: currentFile ?? undefined,
        currentFileContent: currentContent !== undefined ? currentContent.slice(0, MAX_FILE_CHARS_SENT) : undefined,
        referencedFiles: Object.keys(referenced).length ? referenced : undefined,
        fileManifest: Object.keys(files).slice(0, 60),
        attachments: imageAtts.length || linkAtts.length ? {
          images: imageAtts.filter((i) => i.data).map((i) => ({ name: i.name, mediaType: i.mediaType, data: (i.data as string).replace(/^data:[^,]+,/, "") })),
          links: linkAtts.map((l) => l.url),
        } : undefined,
      });
      patchConvo(convoId, (c) => ({ ...c, updatedAt: Date.now(), messages: [...c.messages, { id: genId(), role: "assistant" as const, content: result.reply, at: Date.now(), proposedFiles: result.proposedFiles }].slice(-MAX_MSGS_PER_CONVO) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI assistant didn't respond.");
    }
    setSending(false);
  }

  function retry() {
    if (!lastSent.current || !active) return;
    // Remove the unanswered user message, then send it again.
    const { text, atts } = lastSent.current;
    patchConvo(active.id, (c) => ({ ...c, messages: c.messages.slice(0, -1) }));
    void send({ text, atts });
  }

  function regenerate() {
    if (!active || sending) return;
    const msgs = active.messages;
    const lastUserIdx = [...msgs].map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const u = msgs[lastUserIdx];
    patchConvo(active.id, (c) => ({ ...c, messages: c.messages.slice(0, lastUserIdx) }));
    void send({ text: u.content, atts: u.atts ?? [] });
  }

  function applyProposal(msgId: string, proposed: VFiles) {
    onApplyFiles(proposed);
    if (active) patchConvo(active.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, applied: true } : m)) }));
  }

  function onComposerKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  }

  function usePrompt(text: string) { setView("chat"); setDraft(text); setTimeout(() => { textareaRef.current?.focus(); }, 0); }

  // ---- derived data for the side views ---------------------------------------------------------
  const allAtts = useMemo(() => {
    const out: { att: Att; at: number; convo: string }[] = [];
    for (const c of convos) for (const m of c.messages) for (const a of m.atts ?? []) out.push({ att: a, at: m.at, convo: c.title });
    return out.sort((a, b) => b.at - a.at);
  }, [convos]);
  const libImages = allAtts.filter((x): x is { att: ImageAtt; at: number; convo: string } => x.att.kind === "image");
  const libFiles = allAtts.filter((x): x is { att: FileAtt; at: number; convo: string } => x.att.kind === "file");
  const libLinks = allAtts.filter((x): x is { att: LinkAtt; at: number; convo: string } => x.att.kind === "link");

  const sortedConvos = useMemo(() => [...convos].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt), [convos]);
  const filteredConvos = sortedConvos.filter((c) => {
    const q = historyQuery.trim().toLowerCase();
    return !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q));
  });

  const filePaths = useMemo(() => Object.keys(files).filter((p) => !BINARY.test(p)).sort(), [files]);
  const projectMatches = filePaths.filter((p) => p.toLowerCase().includes(projectQuery.trim().toLowerCase())).slice(0, 40);
  const contextMatches = filePaths.filter((p) => p.toLowerCase().includes(contextQuery.trim().toLowerCase()));

  const canSend = !sending && (draft.trim().length > 0 || pending.length > 0);
  const current = NAV.find((n) => n.view === view)!;
  const fileLabel = currentFile ?? "your project";

  if (!target) return null;

  // ---- view: chat -----------------------------------------------------------------------------
  const suggestions = [
    { icon: FileText, title: currentFile ? `Explain ${currentFile.split("/").pop()}` : "Explain my project", text: currentFile ? `Explain what ${currentFile} does, step by step.` : "Give me a tour of this project and what each file does." },
    { icon: Bug, title: "Find bugs", text: `Read ${fileLabel} and list any bugs or mistakes, most serious first, with a fix for each.` },
    { icon: FlaskConical, title: "Write tests", text: `Write tests for ${fileLabel} using describe / it / expect.` },
    { icon: Wand2, title: "Make it cleaner", text: `Refactor ${fileLabel} to be easier to read without changing what it does.` },
  ];

  const chatView = (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
        <div className="mx-auto w-full max-w-3xl">
          {messages.length === 0 && !sending ? (
            <div className="flex flex-col items-center pt-1 text-center sm:pt-4">
              <span className="da-float grid h-14 w-14 place-items-center rounded-2xl border border-zinc-700/70 bg-zinc-800/40 text-zinc-100 shadow-[0_24px_60px_-24px_rgba(0,0,0,.8)]"><Sparkles size={26} /></span>
              <h3 className="da-silver-text da-up mt-5 text-[1.5rem] font-semibold sm:text-[1.875rem]">What can I help you build?</h3>
              <p className="da-up mt-2.5 max-w-md text-[0.875rem] leading-7 text-zinc-500" style={{ animationDelay: ".08s" }}>
                Ask about <span className="text-zinc-300">{fileLabel}</span>, paste an error, attach a screenshot or share a link.
              </p>
              <div className="da-stagger mt-7 grid w-full gap-4 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button key={s.title} type="button" onClick={() => void send({ text: s.text, atts: [] })} data-tip="Send this question now"
                    className="da-card da-card-hover flex items-center gap-4 !p-4 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><s.icon size={18} /></span>
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] font-medium text-zinc-100">{s.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] leading-5 text-zinc-500">{s.text}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-9">
              {messages.map((m, idx) => (
                <div key={m.id} className="da-up">
                  {m.role === "user" ? (
                    <div className="flex flex-col items-end gap-2.5">
                      {m.atts && m.atts.length > 0 && <AttachmentGrid atts={m.atts} align="end" />}
                      <div className="max-w-[88%] whitespace-pre-wrap rounded-3xl rounded-br-lg border border-zinc-700/70 bg-zinc-800/70 px-5 py-3.5 text-[0.9375rem] leading-7 text-zinc-100">{m.content}</div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-4">
                      <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-zinc-700/70 bg-zinc-800/50 text-zinc-100"><Sparkles size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <RichText text={m.content} />
                        {m.proposedFiles && Object.keys(m.proposedFiles).length > 0 && (
                          <div className="mt-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
                            <p className="flex items-center gap-2 text-[0.875rem] font-medium text-emerald-300"><FileCode2 size={16} />Suggested changes to {Object.keys(m.proposedFiles).length} file{Object.keys(m.proposedFiles).length === 1 ? "" : "s"}</p>
                            <div className="mt-3 space-y-2.5">
                              {Object.entries(m.proposedFiles).map(([path, content]) => (
                                <details key={path} className="rounded-xl border border-zinc-800 bg-zinc-900/40">
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[0.8125rem] text-zinc-200 [&::-webkit-details-marker]:hidden">
                                    <span className="truncate font-medium">{path}</span><span className="shrink-0 text-zinc-500">{content.split("\n").length} lines · preview</span>
                                  </summary>
                                  <pre className="da-code max-h-64 overflow-auto border-t border-zinc-800 p-4 text-[0.75rem] leading-5 text-zinc-400">{content}</pre>
                                </details>
                              ))}
                            </div>
                            <button type="button" onClick={() => applyProposal(m.id, m.proposedFiles!)} disabled={m.applied} data-tip="Writes these files into your project. Nothing is sent to GitHub until you sync."
                              className={`mt-4 ${m.applied ? "da-btn-ghost" : "da-btn-silver"}`}>
                              <Check size={15} />{m.applied ? "Applied to your project" : `Apply ${Object.keys(m.proposedFiles).length} file change${Object.keys(m.proposedFiles).length === 1 ? "" : "s"}`}
                            </button>
                          </div>
                        )}
                        <div className="mt-2.5 flex items-center gap-1">
                          <CopyButton text={m.content} />
                          {idx === messages.length - 1 && !sending && (
                            <button type="button" onClick={regenerate} data-tip="Ask again and get a fresh answer"
                              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.75rem] font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100">
                              <RotateCcw size={13} />Regenerate
                            </button>
                          )}
                          <span className="ml-auto text-[0.75rem] text-zinc-600">{fmtAgo(m.at)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="da-fade flex items-center gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-zinc-700/70 bg-zinc-800/50 text-zinc-100"><Sparkles size={16} className="animate-pulse" /></span>
                  <span className="flex items-center gap-1.5 text-zinc-400" aria-label="Thinking"><span className="da-dot" /><span className="da-dot" /><span className="da-dot" /></span>
                </div>
              )}
              {error && (
                <div role="alert" className="flex flex-wrap items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[0.875rem] text-red-300">
                  <AlertCircle size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 leading-6">{error}</span>
                  <button type="button" onClick={retry} className="da-btn-ghost !min-h-9"><RotateCcw size={14} />Try again</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-5 pt-2 sm:px-10">
        <div className="mx-auto w-full max-w-3xl">
          {notice && (
            <p role="alert" className="da-up mb-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[0.8125rem] leading-6 text-amber-300">
              <AlertCircle size={15} className="mt-1 shrink-0" />{notice}
            </p>
          )}
          {pending.length > 0 && <div className="mb-3"><AttachmentGrid atts={pending} onRemove={removePending} /></div>}
          {linkOpen && (
            <div className="da-pop mb-3 flex items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/60 p-2.5 pl-4">
              <Link2 size={16} className="shrink-0 text-zinc-500" />
              <input autoFocus value={linkVal} onChange={(e) => setLinkVal(e.target.value)} placeholder="Paste a web address, e.g. https://docs.example.com/guide" aria-label="Link address"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
                className="!min-h-0 min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[0.875rem] text-zinc-100 placeholder:text-zinc-600 focus:!shadow-none focus:outline-none" />
              <button type="button" onClick={addLink} disabled={!linkVal.trim()} className="da-btn-silver !min-h-9 !px-4 disabled:opacity-40">Add link</button>
              <button type="button" onClick={() => { setLinkOpen(false); setLinkVal(""); }} aria-label="Cancel" className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200"><X size={16} /></button>
            </div>
          )}
          <div className="da-card relative p-3 transition-shadow focus-within:shadow-[0_0_0_3px_rgba(161,161,170,.18)]">
            <textarea
              ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKey} onPaste={onPaste} rows={1}
              placeholder={`Ask anything about ${fileLabel}…`} aria-label="Message the AI assistant"
              className="block max-h-[200px] min-h-[3rem] w-full resize-none !border-0 !bg-transparent !px-3 !py-2 text-[0.9375rem] leading-7 text-zinc-100 placeholder:text-zinc-600 focus:!shadow-none focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className="relative flex items-center gap-1">
                <button type="button" onClick={() => setMenuOpen((m) => (m === "attach" ? null : "attach"))} aria-expanded={menuOpen === "attach"} data-tip="Attach an image, file, link or project file"
                  className={`grid h-10 w-10 place-items-center rounded-full border transition-colors ${menuOpen ? "border-zinc-500 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"}`}>
                  <Plus size={18} className={`transition-transform duration-300 ${menuOpen ? "rotate-45" : ""}`} />
                </button>
                <button type="button" onClick={() => imageInputRef.current?.click()} aria-label="Upload images" data-tip="Upload images or screenshots (you can also paste them)" className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100"><ImageIcon size={17} /></button>
                <button type="button" onClick={() => { setLinkOpen(true); setMenuOpen(null); }} aria-label="Add a link" data-tip="Add a link to a page or document" className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100"><Link2 size={17} /></button>
                <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Upload files" data-tip="Upload code or text files from your computer" className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100"><Paperclip size={17} /></button>

                {menuOpen && (
                  <div className="absolute bottom-[calc(100%+0.75rem)] left-0 z-20 w-[min(21rem,80vw)]">
                    <div className="da-card da-pop overflow-hidden p-2">
                      {menuOpen === "attach" ? (
                        <>
                          {[
                            { icon: ImageIcon, label: "Upload image", hint: "PNG, JPG, GIF, WebP", run: () => { setMenuOpen(null); imageInputRef.current?.click(); } },
                            { icon: Paperclip, label: "Upload file", hint: "Code, text, JSON, Markdown…", run: () => { setMenuOpen(null); fileInputRef.current?.click(); } },
                            { icon: Link2, label: "Add link", hint: "A web page or document", run: () => { setMenuOpen(null); setLinkOpen(true); } },
                            { icon: FolderGit2, label: "Project file", hint: "Pick from this project", run: () => setMenuOpen("project") },
                          ].map((it) => (
                            <button key={it.label} type="button" onClick={it.run} className="flex w-full items-center gap-4 rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-zinc-800/60">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><it.icon size={17} /></span>
                              <span><span className="block text-[0.875rem] font-medium text-zinc-100">{it.label}</span><span className="block text-[0.75rem] text-zinc-500">{it.hint}</span></span>
                            </button>
                          ))}
                        </>
                      ) : (
                        <div className="p-1">
                          <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800 px-3">
                            <Search size={15} className="shrink-0 text-zinc-500" />
                            <input autoFocus value={projectQuery} onChange={(e) => setProjectQuery(e.target.value)} placeholder="Search project files" aria-label="Search project files"
                              className="!min-h-10 min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[0.8125rem] text-zinc-100 placeholder:text-zinc-600 focus:!shadow-none focus:outline-none" />
                          </div>
                          <ul className="mt-2 max-h-60 overflow-y-auto">
                            {projectMatches.length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-zinc-500">No files match.</li>}
                            {projectMatches.map((p) => (
                              <li key={p}><button type="button" onClick={() => addProjectFile(p)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[0.8125rem] text-zinc-300 transition-colors hover:bg-zinc-800/60"><FileText size={15} className="shrink-0 text-zinc-500" /><span className="truncate">{p}</span></button></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <span className="hidden text-[0.75rem] text-zinc-600 sm:block">Enter to send · Shift+Enter for a new line</span>
                <button type="button" onClick={() => void send()} disabled={!canSend} aria-label="Send message" data-tip="Send message (Enter)"
                  className="da-btn-silver !min-h-11 !px-6 disabled:cursor-not-allowed disabled:opacity-40">
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.5} />}Send
                </button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[0.75rem] leading-5 text-zinc-600">The assistant can make mistakes. Suggested file changes are only applied when you press Apply.</p>
        </div>
      </div>
    </>
  );

  // ---- view: recent chats -----------------------------------------------------------------------
  const historyView = (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-zinc-800 px-4 focus-within:border-zinc-500">
            <Search size={16} className="shrink-0 text-zinc-500" />
            <input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="Search your conversations" aria-label="Search conversations"
              className="!min-h-11 min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[0.875rem] text-zinc-100 placeholder:text-zinc-600 focus:!shadow-none focus:outline-none" />
          </div>
          <button type="button" onClick={newChat} className="da-btn-silver"><Plus size={16} />New chat</button>
        </div>
        {filteredConvos.length === 0 ? (
          <div className="mt-8"><EmptyState icon={History} title={convos.length ? "No conversations match" : "No conversations yet"} body={convos.length ? "Try a different word." : "Your chats with the assistant will be kept here so you can pick them up later."}
            action={<button type="button" onClick={newChat} className="da-btn-silver"><MessageSquare size={16} />Start a chat</button>} /></div>
        ) : (
          <ul className="da-stagger mt-6 space-y-4">
            {filteredConvos.map((c) => {
              const last = c.messages[c.messages.length - 1];
              return (
                <li key={c.id} className={`da-card da-card-hover group flex items-stretch ${c.id === activeId ? "!border-zinc-500" : ""}`}>
                  <button type="button" onClick={() => openConvo(c.id)} className="flex min-w-0 flex-1 items-start gap-4 p-5 text-left">
                    <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-300">{c.pinned ? <Pin size={17} /> : <MessageSquare size={17} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-medium text-zinc-100">{c.title}</span>
                      <span className="mt-1 line-clamp-2 block text-[0.8125rem] leading-6 text-zinc-500">{last ? last.content : "Empty conversation"}</span>
                      <span className="mt-2 block text-[0.75rem] text-zinc-600">{c.messages.length} message{c.messages.length === 1 ? "" : "s"} · {fmtAgo(c.updatedAt)}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col justify-center gap-1 pr-3">
                    <button type="button" onClick={() => patchConvo(c.id, (x) => ({ ...x, pinned: !x.pinned }))} aria-label={c.pinned ? "Unpin" : "Pin"} data-tip={c.pinned ? "Unpin this chat" : "Pin this chat to the top"}
                      className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100">{c.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>
                    <button type="button" onClick={() => deleteConvo(c.id)} aria-label="Delete conversation" data-tip="Delete this chat"
                      className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"><Trash2 size={15} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {convos.some((c) => !c.pinned) && (
          <div className="mt-8 flex justify-center">
            <button type="button" onClick={clearAll} data-tip="Deletes every conversation that isn't pinned" className="da-btn-ghost"><Trash2 size={15} />Clear all unpinned chats</button>
          </div>
        )}
      </div>
    </div>
  );

  // ---- view: prompts ------------------------------------------------------------------------------
  const promptsView = (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        {PROMPT_GROUPS.map((g) => (
          <section key={g.group}>
            <h4 className="mb-4 text-[0.75rem] font-medium uppercase tracking-[.16em] text-zinc-500">{g.group}</h4>
            <div className="da-stagger grid gap-4 sm:grid-cols-2">
              {g.items.map((it) => (
                <button key={it.title} type="button" onClick={() => usePrompt(it.text)} data-tip="Put this in the message box so you can edit it"
                  className="da-card da-card-hover flex items-start gap-4 p-5 text-left">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-200"><it.icon size={18} /></span>
                  <span className="min-w-0"><span className="block text-[0.9375rem] font-medium text-zinc-100">{it.title}</span><span className="mt-1 block text-[0.8125rem] leading-6 text-zinc-500">{it.text}</span></span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  // ---- view: attachments library ---------------------------------------------------------------------
  const libTabs: { k: typeof libTab; label: string; n: number; icon: typeof ImageIcon }[] = [
    { k: "images", label: "Images", n: libImages.length, icon: ImageIcon },
    { k: "files", label: "Files", n: libFiles.length, icon: FileText },
    { k: "links", label: "Links", n: libLinks.length, icon: Link2 },
  ];
  const reuse = (a: Att) => { setPending((p) => [...p, a.kind === "image" ? { ...a, id: genId(), data: a.data ?? a.thumb } : { ...a, id: genId() }].slice(0, 12)); setView("chat"); };
  const libraryView = (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
      <div className="mx-auto w-full max-w-3xl">
        <div role="tablist" className="flex gap-2">
          {libTabs.map((t) => (
            <button key={t.k} type="button" role="tab" aria-selected={libTab === t.k} onClick={() => setLibTab(t.k)} className="da-tab">
              <t.icon size={16} />{t.label}<span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[0.6875rem] text-zinc-400">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="mt-6">
          {libTab === "images" && (libImages.length === 0 ? <EmptyState icon={ImageIcon} title="No images yet" body="Screenshots and pictures you attach in a chat are collected here." /> : (
            <div className="da-stagger grid grid-cols-2 gap-4 sm:grid-cols-3">
              {libImages.map(({ att, at, convo }) => (
                <div key={att.id + at} className="da-card overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={att.thumb} alt={att.name} className="aspect-[4/3] w-full object-cover" />
                  <div className="p-4">
                    <p className="truncate text-[0.8125rem] font-medium text-zinc-100">{att.name}</p>
                    <p className="mt-0.5 truncate text-[0.75rem] text-zinc-500">{convo} · {fmtAgo(at)}</p>
                    <button type="button" onClick={() => reuse(att)} className="da-btn-ghost mt-3 !min-h-9 w-full">Use again</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {libTab === "files" && (libFiles.length === 0 ? <EmptyState icon={FileText} title="No files yet" body="Files you upload or pick from the project are collected here." /> : (
            <ul className="da-stagger space-y-4">
              {libFiles.map(({ att, at, convo }) => (
                <li key={att.id + at} className="da-card flex items-center gap-4 p-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-300"><FileText size={17} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[0.875rem] font-medium text-zinc-100">{att.name}</span><span className="block truncate text-[0.75rem] text-zinc-500">{fmtBytes(att.size)} · {convo} · {fmtAgo(at)}</span></span>
                  <button type="button" onClick={() => reuse(att)} className="da-btn-ghost !min-h-9">Use again</button>
                </li>
              ))}
            </ul>
          ))}
          {libTab === "links" && (libLinks.length === 0 ? <EmptyState icon={Link2} title="No links yet" body="Links you share in a chat are collected here." /> : (
            <ul className="da-stagger space-y-4">
              {libLinks.map(({ att, at, convo }) => (
                <li key={att.id + at} className="da-card flex items-center gap-4 p-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/40 text-zinc-300"><Link2 size={17} /></span>
                  <span className="min-w-0 flex-1"><a href={att.url} target="_blank" rel="noreferrer" className="block truncate text-[0.875rem] font-medium text-zinc-100 hover:underline">{att.host}</a><span className="block truncate text-[0.75rem] text-zinc-500">{att.url}</span><span className="block truncate text-[0.75rem] text-zinc-600">{convo} · {fmtAgo(at)}</span></span>
                  <button type="button" onClick={() => reuse(att)} className="da-btn-ghost !min-h-9">Use again</button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );

  // ---- view: project context -----------------------------------------------------------------------------
  const contextView = (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <div className="da-card p-6">
          <p className="text-[0.75rem] font-medium uppercase tracking-[.16em] text-zinc-500">Always included</p>
          <p className="mt-3 flex items-center gap-3 text-[0.9375rem] text-zinc-100"><FileCode2 size={18} className="text-zinc-400" />{currentFile ?? "No file is open right now"}</p>
          <p className="mt-2 text-[0.8125rem] leading-6 text-zinc-500">The file open in the editor is always shared with the assistant, along with the list of files in your project. Files you name in a message are added automatically.</p>
        </div>
        <div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h4 className="text-[1rem] font-semibold text-zinc-100">Pinned files</h4>
              <p className="mt-1 text-[0.8125rem] text-zinc-500">Pinned files are shared in every message. Up to {MAX_REFERENCED_FILES} at a time. <span className="text-zinc-300">{pinned.length}/{MAX_REFERENCED_FILES} pinned</span></p>
            </div>
            {pinned.length > 0 && <button type="button" onClick={() => setPinned([])} className="da-btn-ghost !min-h-9">Unpin all</button>}
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 px-4 focus-within:border-zinc-500">
            <Search size={16} className="shrink-0 text-zinc-500" />
            <input value={contextQuery} onChange={(e) => setContextQuery(e.target.value)} placeholder="Search project files" aria-label="Search project files"
              className="!min-h-11 min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[0.875rem] text-zinc-100 placeholder:text-zinc-600 focus:!shadow-none focus:outline-none" />
          </div>
          <ul className="da-card mt-4 divide-y divide-zinc-800/80 overflow-hidden">
            {contextMatches.length === 0 && <li className="px-6 py-8 text-center text-[0.875rem] text-zinc-500">No files match.</li>}
            {contextMatches.slice(0, 120).map((p) => {
              const on = pinned.includes(p);
              return (
                <li key={p} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <span className="flex min-w-0 items-center gap-3"><FileText size={16} className="shrink-0 text-zinc-500" /><span className="truncate text-[0.875rem] text-zinc-200">{p}</span></span>
                  <Toggle checked={on} label={`${on ? "Unpin" : "Pin"} ${p}`} disabled={!on && pinned.length >= MAX_REFERENCED_FILES}
                    onChange={(next) => setPinned((list) => (next ? [...list, p].slice(0, MAX_REFERENCED_FILES) : list.filter((x) => x !== p)))} />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );

  const body = view === "chat" ? chatView : view === "history" ? historyView : view === "prompts" ? promptsView : view === "library" ? libraryView : contextView;

  return createPortal(
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-[90] grid place-items-center bg-black/60 backdrop-blur-sm sm:p-6">
      <div
        role="dialog" aria-modal="true" aria-label="AI Assistant"
        onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}
        className="da-card relative flex h-dvh w-full max-w-[78rem] overflow-hidden !rounded-none sm:h-[min(50rem,90dvh)] sm:!rounded-[1.75rem]"
      >
        {/* Left rail */}
        <aside className="hidden w-[17.5rem] shrink-0 flex-col border-r border-zinc-800/80 bg-[#0d0d0f] md:flex" aria-label="Assistant navigation">
          <div className="flex items-center gap-3.5 px-6 pb-4 pt-6">
            <span className="da-toggle-on grid h-11 w-11 place-items-center rounded-2xl" style={{ color: "var(--da-btn-fg)" }}><Sparkles size={20} /></span>
            <div className="min-w-0">
              <p className="text-[1rem] font-semibold text-zinc-50">DevAudit AI</p>
              <p className="truncate text-[0.75rem] text-zinc-500">{projectName ?? "Project assistant"}</p>
            </div>
          </div>
          <div className="px-5"><button type="button" onClick={newChat} className="da-btn-silver w-full"><Plus size={17} />New chat</button></div>
          <nav className="da-stagger-r mt-5 space-y-1.5 px-4">
            {NAV.map((n) => {
              const on = view === n.view;
              const count = n.view === "history" ? convos.length : n.view === "library" ? allAtts.length : n.view === "context" ? pinned.length : 0;
              return (
                <button key={n.view} type="button" onClick={() => setView(n.view)} aria-current={on ? "page" : undefined} data-tip={n.blurb}
                  className={`flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-left text-[0.875rem] font-medium transition-all duration-200 ${on ? "bg-zinc-800/70 text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]" : "text-zinc-400 hover:translate-x-0.5 hover:bg-zinc-800/40 hover:text-zinc-100"}`}>
                  <n.icon size={17} className={on ? "text-zinc-100" : ""} />
                  <span className="flex-1">{n.label}</span>
                  {count > 0 && <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[0.6875rem] text-zinc-400">{count}</span>}
                </button>
              );
            })}
          </nav>
          <div className="mt-6 flex min-h-0 flex-1 flex-col px-4">
            <p className="px-4 pb-2 text-[0.6875rem] font-medium uppercase tracking-[.16em] text-zinc-600">Recent</p>
            <ul className="da-stagger-r min-h-0 flex-1 space-y-1 overflow-y-auto pb-2">
              {sortedConvos.slice(0, 8).map((c) => (
                <li key={c.id} className="group relative">
                  <button type="button" onClick={() => openConvo(c.id)} className={`w-full truncate rounded-lg py-2.5 pl-4 pr-10 text-left text-[0.8125rem] transition-colors ${c.id === activeId && view === "chat" ? "bg-zinc-800/50 text-zinc-100" : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-200"}`}>{c.title}</button>
                  <button type="button" onClick={() => deleteConvo(c.id)} aria-label={`Delete ${c.title}`} className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-zinc-600 opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"><Trash2 size={14} /></button>
                </li>
              ))}
              {convos.length === 0 && <li className="px-4 py-2 text-[0.8125rem] leading-6 text-zinc-600">Your conversations will show up here.</li>}
            </ul>
          </div>
          <div className="border-t border-zinc-800/80 px-6 py-4">
            <p className="truncate text-[0.75rem] text-zinc-500">{Object.keys(files).length} file{Object.keys(files).length === 1 ? "" : "s"} in project</p>
            <p className="truncate text-[0.75rem] text-zinc-600">{currentFile ? `Open: ${currentFile}` : "No file open"}</p>
          </div>
        </aside>

        {/* Main column */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800/80 px-5 py-4 sm:px-8">
            <div className="min-w-0">
              <h2 className="truncate text-[1.0625rem] font-semibold text-zinc-50">{view === "chat" ? (active?.title ?? "New chat") : current.label}</h2>
              <p className="hidden truncate text-[0.8125rem] text-zinc-500 sm:block">{view === "chat" ? (active ? `${messages.length} message${messages.length === 1 ? "" : "s"} · ${fmtAgo(active.updatedAt)}` : current.blurb) : current.blurb}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={newChat} aria-label="New chat" data-tip="Start a new chat" className="grid h-10 w-10 place-items-center rounded-full border border-zinc-800 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 md:hidden"><Plus size={17} /></button>
              {view === "chat" && active && (
                <button type="button" onClick={() => deleteConvo(active.id)} aria-label="Delete this chat" data-tip="Delete this chat" className="grid h-10 w-10 place-items-center rounded-full border border-zinc-800 text-zinc-400 transition-colors hover:border-red-500/40 hover:text-red-400"><Trash2 size={16} /></button>
              )}
              <button type="button" onClick={onClose} aria-label="Close AI Assistant" data-tip="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-full border border-zinc-800 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"><X size={17} /></button>
            </div>
          </header>

          {/* Mobile navigation (the left rail is hidden on small screens) */}
          <div role="tablist" aria-label="Assistant sections" className="flex shrink-0 gap-2 overflow-x-auto border-b border-zinc-800/80 px-4 py-3 md:hidden">
            {NAV.map((n) => (
              <button key={n.view} type="button" role="tab" aria-selected={view === n.view} onClick={() => setView(n.view)} className="da-tab !px-4 !py-2.5"><n.icon size={15} />{n.label}</button>
            ))}
          </div>

          <div key={view} className="da-fade flex min-h-0 flex-1 flex-col">{body}</div>

          {/* Drag & drop overlay */}
          {dragging && (
            <div className="da-fade pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-[1.4rem] border-2 border-dashed border-zinc-400 bg-black/60 backdrop-blur-sm">
              <div className="text-center"><CloudUpload size={40} className="da-float mx-auto text-zinc-100" /><p className="mt-4 text-[1.0625rem] font-semibold text-zinc-50">Drop to attach</p><p className="mt-1 text-[0.875rem] text-zinc-400">Images and text or code files</p></div>
            </div>
          )}
        </div>

        <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { void addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { void addFiles(e.target.files); e.target.value = ""; }} />
      </div>
    </div>,
    target,
  );
}

// ---------------------------------------------------------------------------------------------
// Attachment chips / thumbnails
// ---------------------------------------------------------------------------------------------
function AttachmentGrid({ atts, onRemove, align = "start" }: { atts: Att[]; onRemove?: (id: string) => void; align?: "start" | "end" }) {
  return (
    <div className={`flex flex-wrap gap-3 ${align === "end" ? "justify-end" : ""}`}>
      {atts.map((a) => (
        <div key={a.id} className="da-pop group relative">
          {a.kind === "image" ? (
            <div className="overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.thumb} alt={a.name} className="h-24 w-32 object-cover" />
              <p className="max-w-[8rem] truncate px-3 py-1.5 text-[0.6875rem] text-zinc-400">{a.name}</p>
            </div>
          ) : (
            <div className="flex max-w-[16rem] items-center gap-3 rounded-2xl border border-zinc-700/80 bg-zinc-900/60 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-800 text-zinc-300">{a.kind === "link" ? <Link2 size={16} /> : <FileText size={16} />}</span>
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] font-medium text-zinc-100">{a.kind === "link" ? a.host : a.name}</span>
                <span className="block truncate text-[0.6875rem] text-zinc-500">{a.kind === "link" ? a.url : `${fmtBytes(a.size)}${a.truncated ? " · shortened" : ""}`}</span>
              </span>
            </div>
          )}
          {onRemove && (
            <button type="button" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.kind === "link" ? a.host : a.name}`}
              className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-zinc-600 bg-zinc-900 text-zinc-300 shadow-lg transition-transform hover:scale-110 hover:text-white"><X size={13} /></button>
          )}
        </div>
      ))}
    </div>
  );
}
