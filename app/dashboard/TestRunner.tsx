"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, FlaskConical, CheckCircle2, XCircle, AlertCircle, Play, Wand2, Check, X } from "lucide-react";
import { bundleEntry, loadLocalFiles, saveLocalFiles, saveLastTestRun, requestAiTestGen, deriveTestPath, type VFiles } from "./CodeStudio";

type TestResult = { name: string; pass: boolean; message?: string };

// A minimal describe/it/expect implementation, injected as a synthetic module so test files can
// use the familiar Jest-like globals with zero install. Intentionally small: a handful of matchers
// covers the vast majority of "does my project actually work" smoke tests.
const HARNESS = `
window.__devaudit_results = [];
let __stack = [];
function describe(name, fn) { __stack.push(name); try { fn(); } finally { __stack.pop(); } }
function stringify(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function makeMatchers(actual) {
  const fail = (msg) => { throw new Error(msg); };
  return {
    toBe: (exp) => { if (actual !== exp) fail("expected " + stringify(actual) + " to be " + stringify(exp)); },
    toEqual: (exp) => { if (stringify(actual) !== stringify(exp)) fail("expected " + stringify(actual) + " to equal " + stringify(exp)); },
    toBeTruthy: () => { if (!actual) fail("expected " + stringify(actual) + " to be truthy"); },
    toBeFalsy: () => { if (actual) fail("expected " + stringify(actual) + " to be falsy"); },
    toContain: (item) => { if (!actual || actual.indexOf(item) === -1) fail("expected " + stringify(actual) + " to contain " + stringify(item)); },
    toThrow: () => {
      if (typeof actual !== "function") fail("toThrow() needs a function");
      let threw = false;
      try { actual(); } catch (e) { threw = true; }
      if (!threw) fail("expected function to throw, but it didn't");
    },
  };
}
function expect(actual) { return makeMatchers(actual); }
function it(name, fn) {
  const full = __stack.concat(name).join(" > ");
  try { fn(); window.__devaudit_results.push({ name: full, pass: true }); }
  catch (e) { window.__devaudit_results.push({ name: full, pass: false, message: e && e.message ? e.message : String(e) }); }
}
window.describe = describe; window.it = it; window.test = it; window.expect = expect;
`;

function buildEntrySource(testPaths: string[], runId: string): string {
  const list = JSON.stringify(testPaths);
  return `
const RUN_ID = ${JSON.stringify(runId)};
async function __devaudit_run() {
  await import("./__devaudit_harness__.js");
  const paths = ${list};
  for (const p of paths) {
    try { await import("./" + p); }
    catch (e) { (window.__devaudit_results = window.__devaudit_results || []).push({ name: p + " (failed to load)", pass: false, message: e && e.message ? e.message : String(e) }); }
  }
  window.parent.postMessage({ __devaudit_tests: true, runId: RUN_ID, results: window.__devaudit_results || [] }, "*");
}
__devaudit_run();
`;
}

/** Bundles every *.test.* or *.spec.* file (plus the harness above) into one module and runs it in a hidden sandboxed iframe, the same way Preview runs a project — just headless. */
export default function TestRunner({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<VFiles | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [runId, setRunId] = useState("");

  useEffect(() => { setFiles(loadLocalFiles(projectId)); }, [projectId]);

  const testPaths = useMemo(
    () => (files ? Object.keys(files).filter((p) => /\.(test|spec)\.(t|j)sx?$/.test(p)) : []),
    [files],
  );

  // Candidate source files a test could be generated for: anything code-shaped that isn't
  // already a test file itself.
  const sourcePaths = useMemo(
    () => (files ? Object.keys(files).filter((p) => /\.(t|j)sx?$/.test(p) && !/\.(test|spec)\.(t|j)sx?$/.test(p)) : []),
    [files],
  );

  const [genTarget, setGenTarget] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genPreview, setGenPreview] = useState<{ path: string; content: string; summary: string; poweredBy: "ai" | "heuristic"; exists: boolean } | null>(null);

  useEffect(() => {
    if (sourcePaths.length === 0) { setGenTarget(""); return; }
    if (!sourcePaths.includes(genTarget)) setGenTarget(sourcePaths[0]);
  }, [sourcePaths, genTarget]);

  async function generateTests() {
    if (!files || !genTarget || generating) return;
    setGenerating(true); setGenError(null); setGenPreview(null);
    try {
      const result = await requestAiTestGen({ filePath: genTarget, fileContent: files[genTarget] ?? "" });
      const path = deriveTestPath(genTarget);
      setGenPreview({ path, content: result.testContent, summary: result.summary, poweredBy: result.poweredBy, exists: files[path] !== undefined });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Couldn't generate tests for that file.");
    }
    setGenerating(false);
  }

  function acceptGeneratedTest() {
    if (!genPreview || !files) return;
    const next: VFiles = { ...files, [genPreview.path]: genPreview.content };
    setFiles(next);
    saveLocalFiles(projectId, next);
    setGenPreview(null);
  }

  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only the test-runner iframe itself may report results.
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data;
      if (!d || !d.__devaudit_tests || d.runId !== runId) return;
      const r: TestResult[] = d.results ?? [];
      setResults(r);
      setRunning(false);
      const passed = r.filter((x) => x.pass).length;
      saveLastTestRun(projectId, { total: r.length, passed, failed: r.length - passed, when: Date.now() });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [runId, projectId]);

  async function run() {
    if (!files || testPaths.length === 0) return;
    setRunning(true); setBundleError(null); setResults(null); setDoc(null);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRunId(id);
    const merged: VFiles = { ...files, "__devaudit_harness__.js": HARNESS, "__devaudit_test_entry__.js": buildEntrySource(testPaths, id) };
    try {
      const code = await bundleEntry(merged, "__devaudit_test_entry__.js");
      setDoc(`<!doctype html><html><head><meta charset="utf-8" /></head><body><script type="module">${code.replace(/<\/script/gi, "<\\/script")}</script></body></html>`);
    } catch (e) {
      setRunning(false);
      setBundleError(e instanceof Error ? e.message : "Couldn't bundle the tests.");
    }
  }

  const box = "rounded-lg border border-zinc-800/80 bg-zinc-900/40";
  const aiCta = "bg-gradient-to-r from-fuchsia-400 to-cyan-400 text-slate-950 hover:brightness-110 disabled:opacity-40";

  const genControls = sourcePaths.length > 0 && (
    <div className="border-b border-zinc-800/80 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Wand2 size={12} className="shrink-0 text-fuchsia-300" />
        <span className="text-zinc-400">Generate tests for</span>
        <select
          value={genTarget} onChange={(e) => { setGenTarget(e.target.value); setGenPreview(null); setGenError(null); }}
          className="min-w-0 max-w-[14rem] flex-1 rounded border border-zinc-800 bg-[#09090b] px-1.5 py-1 font-mono text-[11px] text-zinc-200 focus:border-fuchsia-500/60 focus:outline-none"
        >
          {sourcePaths.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={generateTests} disabled={generating || !genTarget}
          className={`flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${aiCta}`}
        >
          {generating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          {generating ? "Generating…" : "Generate with AI"}
        </button>
      </div>

      {genError && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-red-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />{genError}
        </p>
      )}

      {genPreview && (
        <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] leading-4">
          <p className="flex items-start gap-1.5 text-emerald-300">
            <CheckCircle2 size={12} className="mt-0.5 shrink-0" />{genPreview.summary}
          </p>
          {genPreview.poweredBy === "heuristic" && (
            <p className="mt-1 text-amber-400">AI was unavailable, so this is a minimal fallback rather than a custom-written test.</p>
          )}
          {genPreview.exists && (
            <p className="mt-1 text-amber-400"><code className="font-mono">{genPreview.path}</code> already exists — adding will overwrite it.</p>
          )}
          <details className="mt-1.5">
            <summary className="cursor-pointer font-mono text-zinc-400">{genPreview.path}</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-400">{genPreview.content}</pre>
          </details>
          <div className="mt-2 flex gap-1.5">
            <button onClick={acceptGeneratedTest} className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${aiCta}`}>
              <Check size={11} />{genPreview.exists ? "Overwrite" : "Add to project"}
            </button>
            <button onClick={() => setGenPreview(null)} className="flex items-center gap-1.5 rounded border border-zinc-800 px-2.5 py-1 text-zinc-400 hover:bg-zinc-800/60">
              <X size={11} />Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (!files) return <div className={`${box} p-4 text-xs text-zinc-500`}>Loading…</div>;

  if (testPaths.length === 0) {
    return (
      <div className={box}>
        {genControls}
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <FlaskConical size={18} className="text-zinc-600" />
          <p className="text-sm text-zinc-300">No test files found</p>
          <p className="max-w-sm text-xs text-zinc-500">
            {sourcePaths.length > 0
              ? <>Generate one with AI above, or create a file ending in <code className="text-zinc-400">.test.js</code> or <code className="text-zinc-400">.test.tsx</code> yourself and call <code className="text-zinc-400">describe</code>/<code className="text-zinc-400">it</code>/<code className="text-zinc-400">expect</code> — they&apos;re injected automatically, no import needed.</>
              : <>Create a file ending in <code className="text-zinc-400">.test.js</code> or <code className="text-zinc-400">.test.tsx</code> anywhere in the project and call <code className="text-zinc-400">describe</code>/<code className="text-zinc-400">it</code>/<code className="text-zinc-400">expect</code> — they&apos;re injected automatically, no import needed.</>}
          </p>
        </div>
      </div>
    );
  }

  const passed = results?.filter((r) => r.pass).length ?? 0;
  const failed = results ? results.length - passed : 0;

  return (
    <div className={box}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <span className="text-xs text-zinc-400">{testPaths.length} test file{testPaths.length === 1 ? "" : "s"}</span>
        <button onClick={run} disabled={running} className="flex items-center gap-1.5 rounded border border-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800/60 disabled:opacity-60">
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}{running ? "Running…" : "Run Tests"}
        </button>
      </div>

      {genControls}

      {bundleError && (
        <p className="flex items-start gap-1.5 border-b border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />{bundleError}
        </p>
      )}

      {results && (
        <div className="flex items-center gap-3 border-b border-zinc-800/80 px-3 py-2 text-xs">
          <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} />{passed} passed</span>
          {failed > 0 && <span className="flex items-center gap-1 text-red-400"><XCircle size={12} />{failed} failed</span>}
        </div>
      )}

      {results && (
        <ul className="divide-y divide-zinc-800/80">
          {results.map((r, i) => (
            <li key={i} className="px-3 py-2 text-xs">
              <span className={`flex items-center gap-1.5 ${r.pass ? "text-zinc-300" : "text-red-400"}`}>
                {r.pass ? <CheckCircle2 size={12} className="shrink-0 text-emerald-400" /> : <XCircle size={12} className="shrink-0 text-red-400" />}
                <span className="truncate font-mono">{r.name}</span>
              </span>
              {!r.pass && r.message && <p className="mt-1 pl-5 font-mono text-[11px] text-zinc-500">{r.message}</p>}
            </li>
          ))}
        </ul>
      )}

      {doc && <iframe ref={frameRef} key={runId} title="Test runner" srcDoc={doc} sandbox="allow-scripts" className="hidden" />}
    </div>
  );
}
