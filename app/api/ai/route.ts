import { NextResponse } from "next/server";
import type { CodeErrorItem, AnalysisResponse, RoadmapStep, GuidanceHint } from "./types";
// Adjust these two relative paths if app/api/ai/route.ts doesn't sit exactly two levels below
// app/api/_shared in your project (they match the other routes you've sent, e.g. tokens/route.ts).
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { rateLimit, rateLimitResponse } from "../_shared/rateLimit";

interface LlmAnalysis {
  summary: string;
  explanation: string;
  steps: string[];
  suggestedFix: { before: string; after: string } | null;
  mismatched: boolean;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ModelCandidate {
  provider: "openrouter" | "groq";
  model: string;
}

// Tried in order, across TWO independent providers. Free-tier models rotate out (or get
// rate-limited) without much notice on either service, so this is a long fallback chain, not a
// single hardcoded model — if one is gone/limited, the next is tried automatically, and OpenRouter
// + Groq have entirely separate quotas, so exhausting one provider's daily cap doesn't take down
// the feature. OpenRouter's free coding-tuned/general models come first (qwen3-coder is
// purpose-tuned for coding/agentic tasks), then Groq's free-tier models as a second, unrelated
// pool of headroom.
const FREE_CODER_MODELS: ModelCandidate[] = [
  // --- OpenRouter (requires OPENROUTER_API_KEY) ---
  { provider: "openrouter", model: "qwen/qwen3-coder:free" },
  { provider: "openrouter", model: "poolside/laguna-s-2.1:free" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  { provider: "openrouter", model: "qwen/qwen3-235b-a22b:free" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
  // --- Groq (requires GROQ_API_KEY) — separate account/quota from OpenRouter above ---
  { provider: "groq", model: "qwen/qwen3.6-27b" },
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "groq", model: "openai/gpt-oss-20b" },
  { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" },
];
const LLM_TIMEOUT_MS = 20000;
// Keep the file sent to the model bounded — this is a cost/latency guard, not a correctness
// limit: most real crashes are diagnosable from a window around the reported line even in a
// large file, and uncapped file size would make every click slow and burn through the free
// tier's daily request cap faster.
const MAX_FILE_CHARS_FOR_LLM = 8000;

// Backstop only: the platform kills the function after this many seconds. Must be long enough
// for the model fallback chain to work through a couple of slow/limited providers (each attempt
// can take up to LLM_TIMEOUT_MS). The real protection is the input limits below, which keep every
// regex/loop in this file cheap.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// INPUT LIMITS — everything user-supplied is bounded BEFORE any regex or loop touches it. The
// static scan and auto-fixer run regexes over user code inside a serverless function, and
// several of them were quadratic on hostile input (tens of KB pinned the function for seconds).
// ---------------------------------------------------------------------------
const MAX_FILES = 50;
const MAX_FILE_CHARS = 100_000;
const MAX_TOTAL_CHARS = 400_000;
const MAX_PATH_CHARS = 300;
const MAX_LINE_CHARS = 2_000; // longer lines (minified code, junk) are skipped by line-based scans
const MAX_NULLISH_VARS = 25;
const MAX_ERR_MESSAGE_CHARS = 500;
const MAX_ERR_STACK_CHARS = 4_000;

// Per-IP cap, on top of the per-user cap. It exists for the case per-user limits can't cover:
// one person creating many accounts. Deliberately higher than the per-user limit so offices,
// schools and other shared-NAT networks with several legitimate users aren't locked out.
const MAX_REQUESTS_PER_USER_PER_MIN = 30;
const MAX_REQUESTS_PER_IP_PER_MIN = 60;

// Best-effort client IP. On Vercel, x-real-ip / x-forwarded-for are set by the platform and can't be
// spoofed by the client. Behind a different proxy, or when self-hosted, they can — configure that
// proxy to overwrite them. The value is strictly validated because it becomes a database key: a
// junk or oversized header must not be able to create unbounded rows in the rate-limit table.
// IPv6 is bucketed by /64 (one household/host owns a whole /64), so rotating addresses inside it
// doesn't dodge the limit. Returns null when there's no usable IP.
function getClientIp(req: Request): string | null {
  const raw = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  const ip = raw.trim();
  if (ip.length === 0 || ip.length > 45 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;

  if (!ip.includes(":")) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : null;

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i); // IPv4-mapped IPv6
  if (mapped) return mapped[1];
  if (ip.includes(".")) return null;

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, "0")).join(":")}::/64`;
}

type ValidatedFiles = { ok: true; files: Record<string, string> } | { ok: false; error: string };

function validateFiles(raw: unknown): ValidatedFiles {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "No code files provided." };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "No code files provided." };
  if (entries.length > MAX_FILES) return { ok: false, error: `Too many files (max ${MAX_FILES}).` };
  let total = 0;
  const files: Record<string, string> = {};
  for (const [path, content] of entries) {
    if (typeof content !== "string") return { ok: false, error: "Every file's content must be text." };
    if (path.length > MAX_PATH_CHARS) return { ok: false, error: "A file path is too long." };
    if (content.length > MAX_FILE_CHARS) {
      return { ok: false, error: `A file is too large to analyze (max ${MAX_FILE_CHARS.toLocaleString("en-US")} characters).` };
    }
    total += content.length;
    if (total > MAX_TOTAL_CHARS) return { ok: false, error: "The project is too large to analyze." };
    files[path] = content;
  }
  return { ok: true, files };
}

function clipString(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
}

// ---------------------------------------------------------------------------
// ACTION: "scaffold" — generates a small starter project from a one-line description, used by
// the New Project form as an alternative to picking a static template. Kept as its own
// self-contained function (its own provider loop, its own parsing/validation) rather than
// reusing callFreeCoderModel below — different system prompt, different response shape, and
// isolating it means a bug here can't regress the existing crash-analysis feature.
// ---------------------------------------------------------------------------
interface ScaffoldLlmResult {
  summary: string;
  suggestedName?: string;
  files: Record<string, string>;
}

const MAX_SCAFFOLD_TOKENS = 3000;
const MAX_SCAFFOLD_FILES = 8;
const MAX_SCAFFOLD_FILE_CHARS = 4000;
const MAX_SCAFFOLD_PROMPT_CHARS = 800;

function slugifyName(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function callScaffoldModel(prompt: string): Promise<ScaffoldLlmResult | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!openrouterKey && !groqKey) return null;

  const system =
    "You generate a small starter project for a browser-based code editor built for people who are new to " +
    "coding. The editor runs everything client-side: a project with an index.html previews it directly " +
    "(local <script src> / <link rel=stylesheet> are inlined; a <script type=\"module\" src=\"/src/main.tsx\"> or " +
    "any .ts/.tsx/.jsx script is bundled with esbuild first); a project with NO .html file previews by " +
    "bundling 'src/main.tsx' (.tsx/.jsx/.ts/.js all work) and mounting the result into an auto-provided " +
    "<div id=\"root\">, resolving bare imports like 'react' or 'react-dom/client' from a CDN at run time. If " +
    "there is no entry file either, Preview mounts the root component itself (src/App.tsx, src/pages/Index.tsx, " +
    "app/page.tsx, ...) — an index.html always takes priority over src/main.*, so only include both if the " +
    "html loads the entry with a module script. Never use " +
    "Node built-ins ('fs', 'http', 'net', child_process, etc.) or start a real server (app.listen(...)) in code " +
    "meant to run in Preview — nothing but browser JS actually executes there. A request for a backend/API is " +
    "still fine to produce as real source files (for later deployment via the host-deploy feature), but its " +
    "README must say plainly, in one sentence, that Run Code/Preview won't execute it. " +
    "Keep the project small and complete: at most 6 files, each one fully working with no TODOs or " +
    "placeholders, favoring one clear feature done well over many half-finished ones — this is a first draft " +
    "the person will read and build on, not a finished product. Always include a README.md explaining in " +
    "plain, encouraging, beginner-friendly language what was generated and how to run/preview it. " +
    "Respond with ONLY a raw JSON object — no markdown fences, no prose before or after it — matching exactly: " +
    '{"summary": string (1-2 sentences, plain language, for someone new to coding), ' +
    '"suggestedName": string (kebab-case, <= 40 chars, no spaces), ' +
    '"files": { [relativeFilePath: string]: string (full file contents) }}';

  const user = JSON.stringify({ description: prompt });

  for (const { provider, model } of FREE_CODER_MODELS) {
    const apiKey = provider === "openrouter" ? openrouterKey : groqKey;
    if (!apiKey) continue;

    const url = provider === "openrouter" ? OPENROUTER_URL : GROQ_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: MAX_SCAFFOLD_TOKENS,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      // A non-OK response (rate-limited, model temporarily gone, etc.) means try the next
      // model in the fallback chain rather than giving up on scaffolding entirely.
      if (!res.ok) continue;

      const data = await res.json();
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      if (!text) continue;

      const parsed = extractJson(text);
      if (
        !parsed ||
        typeof parsed.summary !== "string" ||
        typeof parsed.files !== "object" ||
        parsed.files === null ||
        Array.isArray(parsed.files)
      ) {
        continue; // malformed output from this model — try the next one
      }

      const entries = Object.entries(parsed.files as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[0] === "string" && e[0].trim().length > 0 && typeof e[1] === "string"
      );
      if (entries.length === 0) continue;

      const files: Record<string, string> = {};
      for (const [rawPath, content] of entries.slice(0, MAX_SCAFFOLD_FILES)) {
        const cleanPath = rawPath.replace(/^\/+/, "").trim();
        if (!cleanPath) continue;
        files[cleanPath] =
          content.length > MAX_SCAFFOLD_FILE_CHARS
            ? `${content.slice(0, MAX_SCAFFOLD_FILE_CHARS)}\n/* …truncated… */`
            : content;
      }
      if (Object.keys(files).length === 0) continue;

      const suggestedName = typeof parsed.suggestedName === "string" ? slugifyName(parsed.suggestedName) : "";

      return { summary: parsed.summary, suggestedName: suggestedName || undefined, files };
    } catch {
      continue; // timeout or network error on this model — try the next one
    } finally {
      clearTimeout(timeout);
    }
  }

  return null; // every model in the fallback chain failed
}

// No API key configured, or every model in the chain failed — rather than a hard error, fall
// back to the closest static starter based on a couple of keywords in the description, same
// "never breaks outright" philosophy as callFreeCoderModel's heuristic fallback below.
function fallbackScaffold(prompt: string): ScaffoldLlmResult {
  const lower = prompt.toLowerCase();
  const wantsReact = /\breact\b/.test(lower);
  const wantsApi = !wantsReact && /\b(api|server|backend|express)\b/.test(lower);
  const unavailableNote =
    "AI generation isn't available right now (no model responded), so here's a plain starter to build on " +
    "instead of a custom build for your description.";

  if (wantsApi) {
    return {
      summary: unavailableNote,
      suggestedName: "new-api",
      files: {
        "README.md": `# New project\n\n${unavailableNote} This is a minimal Express API skeleton. It targets a real Node runtime — push it to GitHub and deploy it from Pre-Push & Deploy; Run Code/Preview won't execute it since Preview has no Node process.`,
        "package.json": `{\n  "name": "new-api",\n  "private": true,\n  "scripts": {\n    "start": "node src/server.js"\n  },\n  "dependencies": {\n    "express": "^4.19.2"\n  }\n}`,
        "src/server.js":
          `const express = require("express");\n` +
          `const app = express();\n` +
          `const port = process.env.PORT || 3000;\n\n` +
          `app.get("/", (req, res) => {\n` +
          `  res.json({ status: "ok", message: "Hello from your new API" });\n` +
          `});\n\n` +
          `app.listen(port, () => {\n` +
          `  console.log(\`Listening on port \${port}\`);\n` +
          `});\n`,
      },
    };
  }

  if (wantsReact) {
    return {
      summary: unavailableNote,
      suggestedName: "new-react-app",
      files: {
        "README.md": `# New project\n\n${unavailableNote} This is a plain client-side React starter. Edit src/App.tsx and press Run Code.`,
        "package.json": `{\n  "name": "new-react-app",\n  "private": true,\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1"\n  }\n}`,
        "src/main.tsx":
          `import { createRoot } from "react-dom/client";\n` +
          `import App from "./App";\n\n` +
          `const root = document.getElementById("root");\n` +
          `if (root) createRoot(root).render(<App />);\n`,
        "src/App.tsx":
          `export default function App() {\n` +
          `  return (\n` +
          `    <div style={{ fontFamily: "sans-serif", textAlign: "center", marginTop: "4rem" }}>\n` +
          `      <h1>Hello, React 👋</h1>\n` +
          `      <p>Edit src/App.tsx to get started.</p>\n` +
          `    </div>\n` +
          `  );\n` +
          `}\n`,
      },
    };
  }

  return {
    summary: unavailableNote,
    suggestedName: "new-site",
    files: {
      "README.md": `# New project\n\n${unavailableNote} This is a plain HTML/CSS/JS starter. Open index.html and press Run Code.`,
      "index.html":
        `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <title>My Site</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <main>\n    <h1>Hello, world 👋</h1>\n    <p>Edit index.html, style.css or script.js to get started.</p>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
      "style.css":
        `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #e4e4e7; font-family: ui-sans-serif, system-ui, sans-serif; text-align: center; }`,
      "script.js": `console.log("Hello from script.js");`,
    },
  };
}

// ---------------------------------------------------------------------------
// ACTION: "chat" — the AI Assistant panel docked next to the editor. Open-ended conversation
// (explain code, answer questions, suggest changes), with the option to propose complete file
// contents the person reviews and applies themselves. Also its own self-contained function for
// the same reason as callScaffoldModel above: isolation from the existing, working features.
// ---------------------------------------------------------------------------
interface ChatLlmResult {
  reply: string;
  proposedFiles?: Record<string, string>;
}

const MAX_CHAT_TOKENS = 2200;
const MAX_CHAT_HISTORY_MESSAGES = 16;
const MAX_CHAT_FILE_CHARS = 6000;
const MAX_CHAT_MANIFEST_ENTRIES = 60;
const MAX_CHAT_PROPOSED_FILES = 8;
const MAX_CHAT_MESSAGE_CHARS = 4000;

async function callChatModel(input: {
  messages: { role: "user" | "assistant"; content: string }[];
  currentFile?: string;
  currentFileContent?: string;
  referencedFiles?: Record<string, string>;
  fileManifest?: string[];
}): Promise<ChatLlmResult | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!openrouterKey && !groqKey) return null;

  const system =
    "You are a friendly, encouraging coding assistant embedded in a browser code editor built for people who " +
    "are new to coding (DevAudit). Answer questions, explain code, and suggest what to do next in plain " +
    "language. The editor runs everything client-side: a project with an index.html previews it directly " +
    "(local <script src>/<link rel=stylesheet> are inlined; a module script or any .ts/.tsx/.jsx script such as " +
    "<script type=\"module\" src=\"/src/main.tsx\"> is bundled with esbuild first, and links between the " +
    "project's .html pages work); a project with no .html file previews by bundling a 'src/main.tsx'-style " +
    "entry with esbuild, mounting into an auto-provided <div id=\"root\">, and resolving bare imports like " +
    "'react' or 'react-dom/client' from a CDN at run time. With neither, Preview mounts the project's root " +
    "component itself (src/App.tsx, src/pages/Index.tsx, app/page.tsx, pages/index.tsx), or shows every " +
    "component one under another, so a components-only project still previews — never tell the person Preview " +
    "needs an index.html or src/main.tsx. The '@/' import alias, SVG imports and a few Next.js modules " +
    "(next/link, next/image, next/navigation) work; images and other binary files aren't kept in the editor. " +
    "An index.html takes priority over src/main.*. Node built-ins ('fs', 'http', " +
    "etc.) and a real server (app.listen(...)) never execute in Preview. " +
    "When asked to add or change code, and you can express the result as complete files, include them in " +
    "\"proposedFiles\" as FULL file contents (never a diff or a snippet) — the person applies these themselves " +
    "with a button in the UI, so never claim in your reply text that a change has already been made; describe " +
    "it as a suggestion. Only include files you're actually adding or changing, never the whole project. If you " +
    "don't have enough information — e.g. the person references a file you haven't been shown the content of — " +
    "say so and ask them to open it or mention it by name, instead of guessing at its contents. Keep replies " +
    "concise and skip filler like 'great question'. " +
    "Respond with ONLY a raw JSON object — no markdown fences, no prose before or after it — matching exactly: " +
    '{"reply": string, "proposedFiles": { [relativeFilePath: string]: string } | null}';

  const context = JSON.stringify({
    fileManifest: (input.fileManifest ?? []).slice(0, MAX_CHAT_MANIFEST_ENTRIES),
    currentFile: input.currentFile ?? null,
    currentFileContent: input.currentFileContent ?? null,
    otherReferencedFiles: input.referencedFiles ?? null,
  });

  const history = input.messages.slice(-MAX_CHAT_HISTORY_MESSAGES);
  const messages = [
    { role: "system" as const, content: system },
    { role: "system" as const, content: `Project context:\n${context}` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (const { provider, model } of FREE_CODER_MODELS) {
    const apiKey = provider === "openrouter" ? openrouterKey : groqKey;
    if (!apiKey) continue;

    const url = provider === "openrouter" ? OPENROUTER_URL : GROQ_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: MAX_CHAT_TOKENS, messages }),
        signal: controller.signal,
      });

      // A non-OK response (rate-limited, model temporarily gone, etc.) means try the next
      // model in the fallback chain rather than giving up on the assistant entirely.
      if (!res.ok) continue;

      const data = await res.json();
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      if (!text) continue;

      const parsed = extractJson(text);
      if (!parsed || typeof parsed.reply !== "string") continue; // malformed — try the next model

      let proposedFiles: Record<string, string> | undefined;
      if (parsed.proposedFiles && typeof parsed.proposedFiles === "object" && !Array.isArray(parsed.proposedFiles)) {
        const entries = Object.entries(parsed.proposedFiles as Record<string, unknown>).filter(
          (e): e is [string, string] => typeof e[0] === "string" && e[0].trim().length > 0 && typeof e[1] === "string",
        );
        if (entries.length) {
          const files: Record<string, string> = {};
          for (const [rawPath, content] of entries.slice(0, MAX_CHAT_PROPOSED_FILES)) {
            const cleanPath = rawPath.replace(/^\/+/, "").trim();
            if (cleanPath) files[cleanPath] = content;
          }
          if (Object.keys(files).length) proposedFiles = files;
        }
      }

      return { reply: parsed.reply, proposedFiles };
    } catch {
      continue; // timeout or network error on this model — try the next one
    } finally {
      clearTimeout(timeout);
    }
  }

  return null; // every model in the fallback chain failed
}

// ---------------------------------------------------------------------------
// ACTION: "generate_tests" — the Test Runner's "Generate tests with AI" button. Writes one test
// file for one source file, targeting the tiny describe/it/expect harness TestRunner.tsx injects
// (see its HARNESS constant): only toBe/toEqual/toBeTruthy/toBeFalsy/toContain/toThrow, no
// mocking, no async — so the model is told exactly that vocabulary rather than writing ordinary
// Jest/Vitest, which would silently fail to run in this sandbox.
// ---------------------------------------------------------------------------
interface TestGenLlmResult {
  summary: string;
  testContent: string;
}

const MAX_TEST_GEN_TOKENS = 1400;
const MAX_TEST_GEN_SOURCE_CHARS = 6000;

function importNameFor(sourcePath: string): string {
  const base = sourcePath.split("/").pop() ?? sourcePath;
  return base.replace(/\.(t|j)sx?$/, "");
}

async function callTestGenModel(sourcePath: string, sourceContent: string): Promise<TestGenLlmResult | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!openrouterKey && !groqKey) return null;

  const importName = importNameFor(sourcePath);
  const system =
    "You write ONE test file for ONE source file, for a minimal in-browser test harness (not Jest, not " +
    "Vitest — a small look-alike). Only these globals exist, already injected, so NEVER import them: " +
    "describe(name, fn), it(name, fn) (test is an alias), and expect(actual) returning an object with " +
    "EXACTLY these methods and no others: toBe(expected), toEqual(expected), toBeTruthy(), toBeFalsy(), " +
    "toContain(item), toThrow(). There is no async support (it() calls fn() synchronously and only catches a " +
    "synchronous throw), no jest.fn()/mocking, no snapshot testing, and no DOM-rendering helpers of any kind " +
    "— so never use async/await, never call jest.* or vi.*, and never try to render a React component. If the " +
    "source file's main export is a React component with no separable plain-function logic, write a minimal " +
    "import-smoke-test instead (import the module, assert it's truthy) rather than attempting to render it, " +
    "and say so plainly in your summary. " +
    `Import the file under test with: import ... from "./${importName}" — the test file will sit in the exact ` +
    "same folder as the source file, so that relative import is always correct; never guess a different path. " +
    "Prefer several small, real assertions about actual behavior over one shallow check, but stay honest: " +
    "don't assert anything you can't actually justify from the given source. " +
    "Respond with ONLY a raw JSON object — no markdown fences, no prose before or after it — matching exactly: " +
    '{"summary": string (1 sentence, plain language, for someone new to testing), "testContent": string ' +
    "(the complete file contents, ready to run as-is)}";

  const user = JSON.stringify({
    sourcePath,
    sourceContent: sourceContent.length > MAX_TEST_GEN_SOURCE_CHARS ? sourceContent.slice(0, MAX_TEST_GEN_SOURCE_CHARS) : sourceContent,
  });

  for (const { provider, model } of FREE_CODER_MODELS) {
    const apiKey = provider === "openrouter" ? openrouterKey : groqKey;
    if (!apiKey) continue;

    const url = provider === "openrouter" ? OPENROUTER_URL : GROQ_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_TEST_GEN_TOKENS,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      // A non-OK response (rate-limited, model temporarily gone, etc.) means try the next
      // model in the fallback chain rather than giving up on test generation entirely.
      if (!res.ok) continue;

      const data = await res.json();
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      if (!text) continue;

      const parsed = extractJson(text);
      if (!parsed || typeof parsed.summary !== "string" || typeof parsed.testContent !== "string" || !parsed.testContent.trim()) {
        continue; // malformed output from this model — try the next one
      }

      return { summary: parsed.summary, testContent: parsed.testContent };
    } catch {
      continue; // timeout or network error on this model — try the next one
    } finally {
      clearTimeout(timeout);
    }
  }

  return null; // every model in the fallback chain failed
}

// No API key configured, or every model failed — there's no meaningful way to heuristically
// invent real test assertions, so the fallback is an honest minimal smoke test (does the file
// import without throwing) rather than pretending to have generated real coverage.
function fallbackTestContent(sourcePath: string): TestGenLlmResult {
  const importName = importNameFor(sourcePath);
  return {
    summary:
      "AI generation isn't available right now (no model responded), so this is a minimal import smoke test " +
      "rather than real coverage of this file's behavior — add your own assertions once you're ready.",
    testContent:
      `import * as mod from "./${importName}";\n\n` +
      `describe("${importName}", () => {\n` +
      `  it("module can be imported without throwing", () => {\n` +
      `    expect(mod).toBeTruthy();\n` +
      `  });\n` +
      `});\n`,
  };
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

// Free, open-weight models are less consistent than a frontier model about respecting "JSON
// only" instructions — they sometimes wrap the object in a sentence or code fence anyway. Try a
// direct parse first, then fall back to extracting the first {...} block before giving up.
function extractJson(text: string): any | null {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

// Real, general-purpose crash analysis via a free coding-tuned model — this is what actually
// lets the assistant reason about arbitrary bugs (not just the hand-coded regex patterns below).
// Returns null on any failure (no API key, rate limit, network error, every fallback model
// exhausted, malformed response) so the caller falls back to the deterministic heuristic path
// and the feature never breaks outright.
async function callFreeCoderModel(input: {
  filePath: string;
  content: string;
  crashMessage?: string;
  crashLine?: number;
  stack?: string;
  staticFindings: CodeErrorItem[];
}): Promise<LlmAnalysis | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!openrouterKey && !groqKey) return null;

  const truncatedContent =
    input.content.length > MAX_FILE_CHARS_FOR_LLM
      ? `${input.content.slice(0, MAX_FILE_CHARS_FOR_LLM)}\n/* …truncated, file continues… */`
      : input.content;

  const system =
    "You are a careful debugging assistant embedded in a code editor built for people who are new to coding. " +
    "You will be given one source file, optionally a reported crash message/line/stack, and optionally findings " +
    "from a simple static scanner. Diagnose the real problem in plain, encouraging, beginner-friendly language. " +
    "Be concrete and specific to THIS code — never give generic advice you could paste into any bug report. " +
    "Always name the exact file and line number the problem is at in your summary/explanation, not just 'near the " +
    "error'. Write 'steps' as a short, ordered, beginner-friendly walkthrough (what to look at first, what to " +
    "change, how to confirm it's fixed) — never vague filler like 'review the logic near the error'. " +
    "If a crash message is present but doesn't correspond to anything in the file's actual content, set " +
    "\"mismatched\": true and explain that it likely came from somewhere else in the pipeline, rather than " +
    "inventing a way it could relate to this file. Whenever you can point to the specific line(s) causing the " +
    "problem, populate suggestedFix with the exact current code as \"before\" and the corrected code as \"after\" " +
    "— prefer giving a concrete fix over leaving it null; only set it to null when the fix genuinely can't be " +
    "localized to specific lines (e.g. a broader design/logic issue). " +
    "Respond with ONLY a raw JSON object — no markdown fences, no prose before or after it — matching exactly: " +
    '{"summary": string, "explanation": string, "steps": string[] (2-4 short imperative steps), ' +
    '"suggestedFix": {"before": string, "after": string} | null, "mismatched": boolean}';

  const user = JSON.stringify({
    filePath: input.filePath,
    fileContent: truncatedContent,
    reportedCrash: input.crashMessage
      ? { message: input.crashMessage, line: input.crashLine, stack: input.stack }
      : null,
    staticScannerFindings: input.staticFindings.map((f) => ({ line: f.line, severity: f.severity, message: f.message })),
  });

  for (const { provider, model } of FREE_CODER_MODELS) {
    const apiKey = provider === "openrouter" ? openrouterKey : groqKey;
    // No key configured for this provider — skip straight to the next candidate rather than
    // wasting a request (or throwing) on a provider that was never set up.
    if (!apiKey) continue;

    const url = provider === "openrouter" ? OPENROUTER_URL : GROQ_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 800,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      // A non-OK response (rate-limited, model temporarily gone, etc.) means try the next
      // model in the fallback chain rather than giving up on AI analysis entirely.
      if (!res.ok) continue;

      const data = await res.json();
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      if (!text) continue;

      const parsed = extractJson(text);
      if (!parsed || typeof parsed.summary !== "string" || typeof parsed.explanation !== "string" || !Array.isArray(parsed.steps)) {
        continue; // malformed output from this model — try the next one
      }

      const steps = parsed.steps.filter((s: unknown) => typeof s === "string").slice(0, 6);
      const suggestedFix =
        parsed.suggestedFix &&
        typeof parsed.suggestedFix.before === "string" &&
        typeof parsed.suggestedFix.after === "string"
          ? { before: parsed.suggestedFix.before, after: parsed.suggestedFix.after }
          : null;

      return {
        summary: parsed.summary,
        explanation: parsed.explanation,
        steps,
        suggestedFix,
        mismatched: parsed.mismatched === true,
      };
    } catch {
      continue; // timeout or network error on this model — try the next one
    } finally {
      clearTimeout(timeout);
    }
  }

  return null; // every model in the fallback chain failed
}

// Deliberately conservative: only patterns that are reliably a bug when matched on a *single*
// line, with no cross-line bracket/paren counting. Per-line brace/paren balance checks were
// removed — they false-positive on virtually any multi-line function, hook, or JSX block (e.g.
// `useEffect(() => {` alone "fails" a same-line paren count), which made hasErrors come back
// true on nearly every real file and made Run Code jump straight to crash-analysis every time.
const NULLISH_ASSIGN_RX = /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:null|undefined)\b/;

// `if (x = value)` typo detector. The value part is BOUNDED and single-line: the old `[^=][^)]*`
// could run across newlines to the end of the file from every `if(` start (quadratic when the
// file has no ')' — 273 KB took ~4 s), and could also match across unrelated code.
// Non-global for .test(); the _G twin is only ever used with .replace(), which resets lastIndex.
const IF_ASSIGN_RX = /\bif\s*\(\s*([a-zA-Z0-9_]+)\s*=\s*([^=\n)][^)\n]{0,200})\)/;
const IF_ASSIGN_RX_G = new RegExp(IF_ASSIGN_RX.source, "g");

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CrashExplanation {
  explanation: string;
  steps: string[];
}

// Translates common JS/TS runtime error shapes into a specific, plain-English diagnosis and
// concrete next steps — instead of the same generic "check the logic near the error" advice for
// every crash. This is pattern-matching on well-known V8 error message shapes, not a guess at
// what YOUR bug is; it explains the mechanism of the error so the person knows what to look for.
function explainCrashMessage(message: string): CrashExplanation | null {
  let m: RegExpMatchArray | null;

  if ((m = message.match(/^(.+?) is not a function$/))) {
    const callee = m[1];
    return {
      explanation: `'${callee}' was called like a function, but at runtime it wasn't one — usually because it's undefined, misspelled, or the wrong thing was imported.`,
      steps: [
        `Check where '${callee}' comes from: is it imported/declared under exactly that name, with no typo?`,
        `Log 'typeof ${callee}' right before this call to see what it actually is at runtime.`,
        `If '${callee}' comes from an async import or external module, confirm that import actually finished loading before this call runs.`,
      ],
    };
  }

  if ((m = message.match(/Cannot read propert(?:y|ies) of (null|undefined) \(reading '([^']+)'\)/))) {
    const [, nullOrUndef, prop] = m;
    return {
      explanation: `Code tried to read '.${prop}' off a value that was ${nullOrUndef} at that point.`,
      steps: [
        `Trace back to where that value is set — it's ${nullOrUndef} instead of the object you expected.`,
        `Add a guard before accessing '.${prop}', e.g. optional chaining ('value?.${prop}') or an explicit null/undefined check.`,
        `If the value should never be ${nullOrUndef} here, find why the code that was supposed to set it didn't run, or returned nothing.`,
      ],
    };
  }

  if ((m = message.match(/^(.+?) is not defined$/))) {
    const name = m[1];
    return {
      explanation: `'${name}' is referenced here, but nothing in scope declares or imports it under that name.`,
      steps: [
        `Check for a missing 'import' statement, or a typo in '${name}'.`,
        `Confirm '${name}' is actually declared before this line runs (not later in the file, and not only inside a different function/block).`,
      ],
    };
  }

  if (/Unexpected token/.test(message)) {
    return {
      explanation: "This is a syntax error — the parser hit something it couldn't make sense of at that position.",
      steps: [
        "Look for a missing or extra bracket, parenthesis, comma, or quote right around the reported position.",
        "If this came from a build/bundle step rather than your own file's syntax, it may be a toolchain issue rather than a bug in this code.",
      ],
    };
  }

  if (/unbalanced[^\n]{0,100}brace/i.test(message) || /unexpected end of (input|file)/i.test(message)) {
    return {
      explanation: "The number of opening '{' and closing '}' braces in this file don't match, so the parser can't tell where a block starts or ends.",
      steps: [
        "Scan the file from top to bottom and match every '{' to a '}' — most code editors highlight the matching bracket when you click next to one.",
        "Check the reported line first — that's usually where the count first goes wrong.",
        "Once every '{' has exactly one matching '}', save and re-run to confirm the error is gone.",
      ],
    };
  }

  return null;
}

// Finds variables literally initialized to null/undefined in this file (a narrow, deliberately
// conservative heuristic — it does not do real type/flow analysis, so it won't catch every
// null-shaped bug, only the common "declared null, dereferenced later with no guard" pattern).
function findNullishVars(content: string): string[] {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    if (line.length > MAX_LINE_CHARS) continue;
    const m = line.match(NULLISH_ASSIGN_RX);
    if (m) {
      names.add(m[1]);
      // Cap the variable count: the scans below cost (variables x file size).
      if (names.size >= MAX_NULLISH_VARS) break;
    }
  }
  return Array.from(names);
}

// Whole-file curly-brace balance check. Unlike the per-line paren/brace count that used to live
// here (removed — see the comment above NULLISH_ASSIGN_RX), this walks the ENTIRE file with a
// stack of the line numbers where each '{' was opened, so a multi-line function/hook/JSX block
// never trips it — only a genuine mismatch in the total count does. Best-effort string/comment
// stripping (not a full tokenizer) so braces inside "strings", 'strings', // line comments and
// /* block comments */ are ignored; template literals are left as plain text since their
// ${...} interpolations are still real, balanced code braces we want to count.
interface BraceImbalance { line: number; kind: "extra-closing" | "unclosed"; openLine?: number }

function findBraceImbalance(content: string): BraceImbalance | null {
  const stack: number[] = [];
  const lines = content.split("\n");
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    let inString: '"' | "'" | null = null;

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = line[c + 1];

      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; c++; }
        continue;
      }
      if (inString) {
        if (ch === "\\") { c++; continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === "/" && next === "/") break; // rest of the line is a line comment
      if (ch === "/" && next === "*") { inBlockComment = true; c++; continue; }
      if (ch === '"' || ch === "'") { inString = ch; continue; }
      if (ch === "{") stack.push(lineNumber);
      else if (ch === "}") {
        if (stack.length === 0) return { line: lineNumber, kind: "extra-closing" };
        stack.pop();
      }
    }
  }

  if (stack.length > 0) return { line: lines.length, kind: "unclosed", openLine: stack[0] };
  return null;
}

function performStaticScan(files: Record<string, string>): CodeErrorItem[] {
  const detectedErrors: CodeErrorItem[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    const lines = content.split("\n");
    const nullishVars = findNullishVars(content);
    // Built ONCE per file, not once per line per variable (that was variables x lines RegExp
    // constructions: 4,000 variables in 69 KB took 12 s).
    const nullishAccessRxs = nullishVars.map(
      (name) => [name, new RegExp(`(?<!\\?)\\b${escapeForRegex(name)}\\.\\w`)] as const,
    );

    const imbalance = findBraceImbalance(content);
    if (imbalance) {
      if (imbalance.kind === "extra-closing") {
        detectedErrors.push({
          file: filePath,
          line: imbalance.line,
          severity: "error",
          message: "Extra closing curly brace '}' on this line — there's no matching '{' still open at this point.",
          suggestion: `Remove the extra '}' on line ${imbalance.line}, or check the lines above it for a '{' that's missing.`,
        });
      } else {
        detectedErrors.push({
          file: filePath,
          line: imbalance.openLine!,
          severity: "error",
          message: "This '{' is never closed — the file ends with an unclosed curly brace that opened here.",
          suggestion: `Add a matching '}' to close the block that starts on line ${imbalance.openLine}.`,
        });
      }
    }

    lines.forEach((line, idx) => {
      const lineNumber = idx + 1;
      if (line.length > MAX_LINE_CHARS) return; // minified/junk line: not worth scanning

      // Assigning inside a single-if comparison (e.g. if (x = 5)) is almost always a typo for ==/===.
      if (/\bif\s*\(\s*[a-zA-Z0-9_]+\s*=\s*[^=]/.test(line)) {
        detectedErrors.push({
          file: filePath,
          line: lineNumber,
          severity: "error",
          message: "Assignment operator '=' used inside conditional statement.",
          suggestion: "Did you mean to use equality comparison '==' or '==='?",
        });
      }

      // A bare fetch(...) call with no await/.then on the same line is usually a missed await,
      // but this is a style nit, not a crash — kept as a low-severity warning only.
      if (line.includes("fetch(") && !line.includes("await") && !line.includes(".then")) {
        detectedErrors.push({
          file: filePath,
          line: lineNumber,
          severity: "warning",
          message: "Unhandled asynchronous fetch call.",
          suggestion: "Add 'await' before fetch or chain with '.then()' to handle the Promise.",
        });
      }

      // A variable known to be literally `null`/`undefined` somewhere in this file, accessed
      // with `.prop`/`.method(` on a *different* line with no optional-chaining guard, is the
      // single most common source of "Cannot read properties of null/undefined" crashes.
      const declaredName = line.match(NULLISH_ASSIGN_RX)?.[1];
      for (const [name, unguardedAccess] of nullishAccessRxs) {
        if (declaredName === name) continue;
        if (unguardedAccess.test(line)) {
          detectedErrors.push({
            file: filePath,
            line: lineNumber,
            severity: "error",
            message: `Possible null/undefined dereference: '${name}' was assigned null/undefined and is accessed here without a guard.`,
            suggestion: `Use optional chaining ('${name}?.') or add a null check before accessing '${name}'.`,
          });
        }
      }
    });
  }

  return detectedErrors;
}

const STOPWORDS = new Set([
  "is", "not", "a", "an", "the", "of", "to", "in", "on", "at", "cannot", "read",
  "reading", "property", "properties", "function", "undefined", "null", "error",
  "typeerror", "referenceerror", "was", "this", "that", "value", "object", "call",
  "called", "method", "invoke", "invoked", "set", "get", "type",
]);

// A cheap but useful sanity check: does a reported crash message actually reference anything
// present in the file we're being asked to analyze? If the message names an identifier that
// appears nowhere in the file's source, it almost certainly originated somewhere else in the
// execution pipeline (a sandbox bootstrap error, a stale mock, a mismatched log) rather than
// from this file, and should not be presented as this file's error.
function messageReferencesContent(message: string, content: string): boolean {
  const tokens = (message.match(/[a-zA-Z_$][\w$]*/g) || []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase())
  );
  if (tokens.length === 0) return true; // nothing specific enough to check — don't flag
  return tokens.some((t) => new RegExp(`\\b${escapeForRegex(t)}\\b`).test(content));
}

// Hard caps and sanity checks for a before/after snippet that came from the MODEL. The text is
// shown to the person for review (it is never applied by the server — see "fix_ai" below), so this
// only has to make sure the card isn't garbage: an empty `before` can't be located in the file, and
// a huge or no-op snippet is noise.
const MAX_SUGGESTED_FIX_CHARS = 4_000;
function reviewableFix(
  fix: { before: string; after: string } | null | undefined,
  note: string,
): { before: string; after: string; note: string } | null {
  if (!fix) return null;
  const { before, after } = fix;
  if (before.trim().length === 0) return null;
  if (before.length > MAX_SUGGESTED_FIX_CHARS || after.length > MAX_SUGGESTED_FIX_CHARS) return null;
  if (before === after) return null;
  return { before, after, note };
}

// Conservative, regex-based auto-repair for the one bug pattern above that's safe to fix
// automatically. Returns the patched source and a plain-language list of what changed (empty
// when nothing matched a pattern Claude is willing to apply automatically).
function attemptAutoFix(content: string): { patched: string; changes: string[] } {
  let patched = content;
  const changes: string[] = [];

  if (IF_ASSIGN_RX.test(patched)) {
    patched = patched.replace(IF_ASSIGN_RX_G, "if ($1 === $2)");
    changes.push("Corrected a single '=' to '===' inside a conditional.");
  }

  if (/const\s+([a-zA-Z0-9_]+)\s*=\s*fetch\(/.test(patched)) {
    patched = patched.replace(/const\s+([a-zA-Z0-9_]+)\s*=\s*fetch\(/g, "const $1 = await fetch(");
    changes.push("Added a missing 'await' before a fetch(...) call.");
  }

  // Guard unguarded accesses on variables known to be literally null/undefined, e.g.
  // `data.map(...)` where `data` was declared `const data = null;`. This is conservative and
  // safe: optional chaining changes a crash into `undefined`, never changes correct behavior
  // when the value isn't nullish, and never silently swallows an unrelated bug.
  const nullishVars = findNullishVars(patched);
  for (const name of nullishVars) {
    const unguardedAccess = new RegExp(`(?<!\\?)\\b${escapeForRegex(name)}\\.(?=\\w)`, "g");
    if (unguardedAccess.test(patched)) {
      // Function replacer: an identifier can legally contain `$` (e.g. `$$`, `$&`), and in a
      // replacement STRING those are special patterns that would corrupt the output.
      patched = patched.replace(unguardedAccess, () => `${name}?.`);
      changes.push(`Added optional chaining to guard '${name}' against null/undefined before property access.`);
    }
  }

  return { patched, changes };
}

export async function POST(req: Request) {
  try {
    // SECURITY: this route calls paid/rate-limited AI providers (OpenRouter, Groq) and had NO
    // auth check at all. Anyone who found this URL could burn through your AI quota for free,
    // repeatedly. Every action below requires a signed-in DevAudit session now, and is rate
    // limited per user on top of that.
    //
    // Rate limiting FAILS CLOSED on this route: rateLimit() fails open by default (ok === false
    // on a database error), which for a paid-API route would silently mean "no limits at all".
    // Better to return 503 and notice than to run unmetered.
    const limiterDown = () =>
      NextResponse.json({ error: "Service temporarily unavailable. Please try again shortly." }, { status: 503 });

    // Per-IP limit FIRST: it runs before the auth lookup, so a flood from one address (including
    // unauthenticated traffic and many-accounts-one-machine abuse) is cut off cheaply.
    const ip = getClientIp(req);
    if (ip) {
      const byIp = await rateLimit(`ai-ip:${ip}`, { limit: MAX_REQUESTS_PER_IP_PER_MIN, windowSeconds: 60 });
      if (!byIp.ok) return limiterDown();
      if (!byIp.allowed) return rateLimitResponse(60);
    }

    const supabase = supabaseForRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const byUser = await rateLimit(`ai:${user.id}`, { limit: MAX_REQUESTS_PER_USER_PER_MIN, windowSeconds: 60 });
    if (!byUser.ok) return limiterDown();
    if (!byUser.allowed) return rateLimitResponse(60);

    // Malformed JSON is the caller's mistake, not a server fault: answer 400, not 500.
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }

    // ---------------------------------------------------------
    // ACTION: "scaffold" — generate a whole new project from a one-line description. Handled
    // first and separately: unlike every other action, it has no files yet (that's the point),
    // so it must not hit the "no code files provided" check just below.
    // ---------------------------------------------------------
    if (body.action === "scaffold") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        return NextResponse.json({ error: "Describe what you want to build first." }, { status: 400 });
      }
      if (prompt.length > MAX_SCAFFOLD_PROMPT_CHARS) {
        return NextResponse.json(
          { error: `Keep the description under ${MAX_SCAFFOLD_PROMPT_CHARS} characters.` },
          { status: 400 },
        );
      }

      const llmResult = await callScaffoldModel(prompt);
      const result = llmResult ?? fallbackScaffold(prompt);

      return NextResponse.json({
        scaffoldSummary: result.summary,
        scaffoldFiles: result.files,
        suggestedProjectName: result.suggestedName,
        poweredBy: llmResult ? "ai" : "heuristic",
      } satisfies AnalysisResponse);
    }

    // ---------------------------------------------------------
    // ACTION: "chat" — the AI Assistant panel. Also handled before the fileMap check: unlike the
    // run/fix actions it doesn't require a full project snapshot, just the message history plus
    // whatever optional file context the panel chose to attach.
    // ---------------------------------------------------------
    if (body.action === "chat") {
      const messages = Array.isArray(body.messages)
        ? body.messages.filter(
            (m: unknown): m is { role: "user" | "assistant"; content: string } =>
              !!m &&
              typeof m === "object" &&
              ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
              typeof (m as { content?: unknown }).content === "string",
          )
        : [];

      if (messages.length === 0) {
        return NextResponse.json({ error: "No message to respond to." }, { status: 400 });
      }
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser && lastUser.content.length > MAX_CHAT_MESSAGE_CHARS) {
        return NextResponse.json(
          { error: `Keep each message under ${MAX_CHAT_MESSAGE_CHARS} characters.` },
          { status: 400 },
        );
      }

      // Only the last user message was length-checked; cap the rest of the history too, so a
      // huge body can't burn model quota through older turns.
      const cappedMessages = messages.map((m: { role: "user" | "assistant"; content: string }) => ({
        role: m.role,
        content: m.content.slice(0, MAX_CHAT_MESSAGE_CHARS),
      }));

      const currentFileContent =
        typeof body.currentFileContent === "string" ? body.currentFileContent.slice(0, MAX_CHAT_FILE_CHARS) : undefined;

      const referencedFiles: Record<string, string> | undefined =
        body.referencedFiles && typeof body.referencedFiles === "object" && !Array.isArray(body.referencedFiles)
          ? Object.fromEntries(
              Object.entries(body.referencedFiles as Record<string, unknown>)
                .filter((e): e is [string, string] => typeof e[0] === "string" && typeof e[1] === "string")
                .slice(0, MAX_FILES)
                .map(([p, c]) => [p.slice(0, MAX_PATH_CHARS), c.slice(0, MAX_CHAT_FILE_CHARS)]),
            )
          : undefined;

      const fileManifest: string[] | undefined = Array.isArray(body.fileManifest)
        ? body.fileManifest
            .filter((p: unknown): p is string => typeof p === "string")
            .slice(0, MAX_CHAT_MANIFEST_ENTRIES)
            .map((p: string) => p.slice(0, MAX_PATH_CHARS))
        : undefined;

      const chatResult = await callChatModel({
        messages: cappedMessages,
        currentFile: clipString(body.currentFile, MAX_PATH_CHARS),
        currentFileContent,
        referencedFiles,
        fileManifest,
      });

      if (!chatResult) {
        // Unlike scaffold, open-ended chat has no sensible non-AI fallback — better to say so
        // plainly than to fabricate a generic non-answer.
        return NextResponse.json(
          { error: "The AI assistant isn't available right now (no model responded). Try again in a moment." },
          { status: 503 },
        );
      }

      return NextResponse.json({
        chatReply: chatResult.reply,
        chatProposedFiles: chatResult.proposedFiles,
      } satisfies AnalysisResponse);
    }

    // ---------------------------------------------------------
    // ACTION: "generate_tests" — writes one test file for one source file. Handled here too,
    // before the fileMap check, since it takes a single { filePath, fileContent } pair rather
    // than the full project snapshot the run/fix actions expect.
    // ---------------------------------------------------------
    if (body.action === "generate_tests") {
      const filePath = typeof body.filePath === "string" ? body.filePath.trim().slice(0, MAX_PATH_CHARS) : "";
      const fileContent = typeof body.fileContent === "string" ? body.fileContent : "";
      if (!filePath || !fileContent.trim()) {
        return NextResponse.json({ error: "Pick a file with some code in it first." }, { status: 400 });
      }

      const llmResult = await callTestGenModel(filePath, fileContent);
      const result = llmResult ?? fallbackTestContent(filePath);

      return NextResponse.json({
        testSummary: result.summary,
        testFileContent: result.testContent,
        poweredBy: llmResult ? "ai" : "heuristic",
      } satisfies AnalysisResponse);
    }

    // The AI Tour Guide always sends the full { files } map plus an optional
    // { runtimeErrors } array describing any crash(es) reported by the preview sandbox. A
    // legacy { filePath, fileContent } single-file shape is still accepted for any other
    // caller that only wants to analyze one file directly.
    // Validate + bound everything BEFORE any scan/regex runs (see INPUT LIMITS at the top).
    const validated = validateFiles(
      body.files || (body.filePath && body.fileContent ? { [String(body.filePath)]: body.fileContent } : null),
    );
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const files = validated.files;
    const fileKeys = Object.keys(files);
    const staticErrors = performStaticScan(files);

    // Only trust the SHAPE of what the client reports: typed, and clipped to a small size.
    const rawTop: unknown = Array.isArray(body.runtimeErrors) ? body.runtimeErrors[0] : undefined;
    const top = rawTop && typeof rawTop === "object" ? (rawTop as Record<string, unknown>) : undefined;
    const topRuntimeError = top
      ? {
          message: clipString(top.message, MAX_ERR_MESSAGE_CHARS),
          file: clipString(top.file, MAX_PATH_CHARS),
          line: typeof top.line === "number" && Number.isFinite(top.line) ? top.line : undefined,
          stack: clipString(top.stack, MAX_ERR_STACK_CHARS),
        }
      : undefined;

    // Target file for crash-analysis actions ("fix_ai" / "fix_manual"): whichever file the
    // reported runtime error points at, falling back to a legacy explicit filePath, then to
    // the first file in the project. Must be an OWN key of the map (not e.g. "constructor").
    const requestedPath = topRuntimeError?.file || clipString(body.filePath, MAX_PATH_CHARS);
    const filePath: string =
      requestedPath && Object.prototype.hasOwnProperty.call(files, requestedPath) ? requestedPath : fileKeys[0];
    const content = files[filePath];
    const crashMessage: string | undefined = topRuntimeError?.message || clipString(body.message, MAX_ERR_MESSAGE_CHARS);
    const crashLine: number | undefined =
      topRuntimeError?.line ?? (typeof body.line === "number" && Number.isFinite(body.line) ? body.line : undefined);
    const stack: string | undefined = topRuntimeError?.stack || clipString(body.stack, MAX_ERR_STACK_CHARS);

    // ---------------------------------------------------------
    // ACTION: "run_code" — a quick pass/fail read before executing the preview.
    // Only real "error"-severity findings block the clean roadmap — a bare warning (e.g. an
    // un-awaited fetch) is a style nit, not a reason to jump into crash-analysis.
    // ---------------------------------------------------------
    if (body.action === "run_code") {
      const blocking = staticErrors.filter((e) => e.severity === "error");
      const hasErrors = blocking.length > 0;

      if (hasErrors) {
        return NextResponse.json({
          hasErrors,
          summary: `Found ${blocking.length} likely issue(s) before running.`,
          errors: blocking,
        } satisfies AnalysisResponse);
      }

      const roadmapSteps: RoadmapStep[] = [
        ...fileKeys.map((f, i) => ({
          step: i + 1,
          title: `${f} loads`,
          file: f,
          description: "Parsed with no blocking issues.",
        })),
        ...staticErrors.map((e, i) => ({
          step: fileKeys.length + i + 1,
          title: `Note in ${e.file}`,
          file: e.file,
          description: `${e.message} ${e.suggestion}`,
        })),
      ];

      return NextResponse.json({
        hasErrors,
        summary: `Clean read. ${fileKeys.length} file(s) look OK to run.${
          staticErrors.length ? ` (${staticErrors.length} minor note(s) below.)` : ""
        }`,
        roadmap: {
          summary: `Here's how your ${fileKeys.length} file(s) run, step by step.`,
          steps: roadmapSteps,
        },
      } satisfies AnalysisResponse);
    }

    // ---------------------------------------------------------
    // Shared crash diagnosis, reused by both "fix_ai" and "fix_manual" below — same
    // deterministic-first, AI-fallback logic either way; the two actions only differ in how
    // they present the result (apply it vs. turn it into learn-it-yourself hints).
    // ---------------------------------------------------------
    const relevant = staticErrors.filter((e) => e.file === filePath);
    const { patched, changes } = attemptAutoFix(content);
    const canAutoFix = changes.length > 0;
    const crashExplanation = crashMessage ? explainCrashMessage(crashMessage) : null;

    const llmResult = canAutoFix
      ? null
      : await callFreeCoderModel({
          filePath,
          content,
          crashMessage,
          crashLine,
          stack,
          staticFindings: relevant,
        });

    let summary: string;
    let steps: string[];
    let suggestedFix: { before: string; after: string; note: string } | null = null;
    let poweredBy: "ai" | "heuristic" = "heuristic";

    if (llmResult) {
      poweredBy = "ai";
      summary = llmResult.mismatched
        ? `The reported error${crashMessage ? ` ("${crashMessage}"${crashLine ? ` at line ${crashLine}` : ""})` : ""} doesn't look like it came from ${filePath} — ${llmResult.explanation}`
        : `${llmResult.summary} ${llmResult.explanation}`;
      steps = llmResult.steps.length ? llmResult.steps : [`Open ${filePath} and review it around the reported line.`];
      suggestedFix = reviewableFix(
        llmResult.suggestedFix,
        "AI-suggested — review before using. DevAudit never applies an AI suggestion to your files on its own.",
      );
    } else {
      // Deterministic fallback — everything below is unchanged from the heuristic path, used
      // whenever a mechanical auto-fix already applies, or the AI call is unavailable/fails.
      const crashLooksMismatched =
        !!crashMessage && relevant.length > 0 && !messageReferencesContent(crashMessage, content);

      if (crashLooksMismatched) {
        const top = relevant[0];
        summary =
          `The reported error ("${crashMessage}"${crashLine ? ` at line ${crashLine}` : ""}) doesn't reference ` +
          `anything found in ${filePath}, so it likely didn't originate from this file — check whatever captured ` +
          `it (e.g. the sandbox/runner wrapper) for a mismatched or stale error. Static analysis of ${filePath} ` +
          `found a real issue instead: ${top.message} (line ${top.line}). ${top.suggestion}`;
      } else if (crashMessage) {
        summary =
          `At ${filePath}${crashLine ? `:${crashLine}` : ""}, the error was: "${crashMessage}".` +
          (crashExplanation ? ` ${crashExplanation.explanation}` : "") +
          (relevant.length ? ` Static analysis also found ${relevant.length} related note(s).` : "");
      } else if (relevant.length) {
        summary = `Found ${relevant.length} issue(s) in ${filePath}.`;
      } else {
        summary = `No obvious issues found in ${filePath}.`;
      }

      // For judgment-call findings that won't be auto-applied, still show the person exactly
      // what a fix would look like — a labeled before/after snippet they can review and apply
      // themselves — rather than only a prose description of the problem.
      suggestedFix =
        !canAutoFix && relevant.length > 0
          ? (() => {
              const e = relevant[0];
              const beforeLine = content.split("\n")[e.line - 1] ?? "";
              let afterLine = beforeLine;
              if (/Assignment operator/.test(e.message)) {
                afterLine = beforeLine.replace(IF_ASSIGN_RX, "if ($1 === $2)");
              } else if (/Unhandled asynchronous fetch/.test(e.message)) {
                afterLine = beforeLine.includes("await") ? beforeLine : beforeLine.replace(/fetch\(/, "await fetch(");
              } else if (/null\/undefined dereference/.test(e.message)) {
                const nameMatch = e.message.match(/'([^']+)'/);
                if (nameMatch) {
                  const name = nameMatch[1];
                  afterLine = beforeLine.replace(new RegExp(`(?<!\\?)\\b${escapeForRegex(name)}\\.(?=\\w)`), () => `${name}?.`);
                }
              } else if (/Extra closing curly brace/.test(e.message)) {
                // The most common shape of this typo is exactly one '}' too many on the line —
                // safe to show a precise before/after for, even though we don't auto-apply it.
                const idx = beforeLine.lastIndexOf("}");
                if (idx !== -1) afterLine = beforeLine.slice(0, idx) + beforeLine.slice(idx + 1);
              }
              return afterLine !== beforeLine
                ? { before: beforeLine.trim(), after: afterLine.trim(), note: `Line ${e.line}, suggested but not applied automatically — review before using.` }
                : null;
            })()
          : null;

      steps = canAutoFix
        ? changes
        : relevant.length
        ? relevant.map((e) => `Line ${e.line}: ${e.message} ${e.suggestion}`)
        : crashExplanation
        ? crashExplanation.steps
        : [
            `Open ${filePath}${crashLine ? ` around line ${crashLine}` : ""} and re-check the logic near where the error was thrown.`,
            "Add a console.log or breakpoint near the failing line to confirm the value that's causing the crash.",
            "Fix the underlying cause, save, and re-run to confirm the error is gone.",
          ];
    }

    const fixExplanation = canAutoFix
      ? `Applied automatically:\n• ${changes.join("\n• ")}`
      : poweredBy === "ai"
      ? "Reviewed by AI — the suggested fix (if any) is a starting point, not applied automatically."
      : relevant.length
      ? "This needs a judgment call Claude can't safely automate — the suggested fix below shows what a fix looks like, but review it before using."
      : crashExplanation
      ? "Nothing matched a pattern Claude can safely auto-fix, but the diagnosis and steps above are specific to this error message."
      : "Nothing here matched a pattern Claude can safely auto-fix — follow the guided steps instead.";

    // ---------------------------------------------------------
    // ACTION: "fix_ai" — apply the DETERMINISTIC fix if there is one, and hand back the FULL files
    // map (so the caller can swap its whole workspace in one shot via onApplyFixes()). Anything
    // suggested by the model is returned for review instead of being applied — see below.
    // ---------------------------------------------------------
    if (body.action === "fix_ai") {
      // ONLY the deterministic patcher (attemptAutoFix: fixed regex rules, no model involved) ever
      // rewrites a file here. A before/after snippet that came from the model — or the line-level
      // one derived from static findings — is handed back for the person to REVIEW, and the server
      // never writes it into their code. Two reasons:
      //   * The file's own text goes into the model's prompt, so text planted in a file (a comment,
      //     a string in a dependency) can steer what the model writes. A model's output must not
      //     become a code change without a human looking at it.
      //   * The explanation strings above say "not applied automatically"; applying it anyway made
      //     them untrue.
      // (The old code also did content.replace(before, after). In a replacement STRING, `$$`, `$&`
      // and the backtick/quote forms are special patterns, so it turned `$${amount}` into
      // `${amount}`. Nothing on the server string-replaces with model text any more, and the
      // client that applies a reviewed snippet uses a function replacer.)
      const applied = canAutoFix;
      const fixedContent = applied ? patched : content;

      return NextResponse.json({
        fixedFiles: { ...files, [filePath]: fixedContent },
        targetFile: filePath,
        summary,
        steps,
        canAutoFix,
        fixExplanation: applied
          ? fixExplanation
          : `${fixExplanation} Nothing in your files was changed${
              suggestedFix ? " — review the suggested change below and apply it yourself if it looks right." : "."
            }`,
        patchedFile: applied ? fixedContent : null,
        suggestedFix,
        poweredBy,
      } satisfies AnalysisResponse);
    }

    // ---------------------------------------------------------
    // ACTION: "fix_manual" (default) — turn the same diagnosis into a numbered,
    // learn-it-yourself hint list instead of applying anything.
    // ---------------------------------------------------------
    const hints: GuidanceHint[] = steps.map((s, i) => ({
      step: i + 1,
      concept: `Step ${i + 1}`,
      file: filePath,
      targetLines: crashLine ? String(crashLine) : relevant[0] ? String(relevant[0].line) : "entire file",
      hint: s,
    }));

    return NextResponse.json({
      guidance: { overview: summary, hints },
      targetFile: filePath,
      summary,
      steps,
      canAutoFix,
      fixExplanation,
      patchedFile: canAutoFix ? patched : null,
      suggestedFix,
      poweredBy,
    } satisfies AnalysisResponse);
  } catch (err: unknown) {
    console.error("[ai.POST]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The AI analyzer hit an unexpected error. Please try again." }, { status: 500 });
  }
}
