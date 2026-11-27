"use client";

import { useState } from "react";
import { Sparkles, CheckCircle2, AlertTriangle, Wand2, Compass, Play, BookOpen, ChevronRight, X } from "lucide-react";
import type { AnalysisResponse, CodeErrorItem } from "../api/ai/types";

interface AITourGuideProps {
  files: Record<string, string>;
  runtimeErrors?: Array<{ message: string; file?: string; line?: number; stack?: string }>;
  onApplyFixes: (updatedFiles: Record<string, string>) => void;
}

export default function AITourGuide({ files, runtimeErrors, onApplyFixes }: AITourGuideProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [mode, setMode] = useState<"initial" | "roadmap" | "decision" | "manual_guide" | "fixed" | "review">("initial");
  const [reviewError, setReviewError] = useState<string | null>(null);
  // True once the person has clicked "Apply this change" on a reviewed suggestion, so the success
  // banner can say what actually happened instead of repeating the server's "not applied" text.
  const [appliedByPerson, setAppliedByPerson] = useState(false);

  async function handleRunCodeOrAnalyze(action: "run_code" | "fix_ai" | "fix_manual") {
    setLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, files, runtimeErrors }),
      });
      const result: AnalysisResponse = await res.json();
      setData(result);

      if (action === "run_code") {
        if (result.hasErrors) {
          setMode("decision");
        } else {
          setMode("roadmap");
        }
      } else if (action === "fix_ai") {
        setAppliedByPerson(false);
        setReviewError(null);
        if (result.patchedFile && result.fixedFiles) {
          // The server's deterministic patcher made a change: apply it.
          onApplyFixes(result.fixedFiles);
          setMode("fixed");
        } else {
          // Nothing was changed. The server never applies a model-written or analyzer-suggested
          // snippet on its own; show it so the person can review it and choose to apply it.
          setMode("review");
        }
      } else if (action === "fix_manual") {
        setMode("manual_guide");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  /** Applies the reviewed before/after snippet — only on the person's click, and only when `before`
   *  appears in the file exactly once (an ambiguous match could rewrite the wrong spot). */
  function applyReviewedFix() {
    const fix = data?.suggestedFix;
    const path = data?.targetFile;
    if (!fix || !path || !fix.before) return;
    const current = files[path];
    if (typeof current !== "string") { setReviewError("That file isn't in your workspace any more."); return; }
    if (current.split(fix.before).length - 1 !== 1) {
      setReviewError("The code to replace isn't in the file exactly once any more, so it wasn't changed. Edit it by hand instead.");
      return;
    }
    // Function replacer on purpose: with a replacement STRING, `$$`, `$&` etc. in `after` are
    // special patterns and would corrupt code that contains them (e.g. a `$${amount}` template).
    onApplyFixes({ ...files, [path]: current.replace(fix.before, () => fix.after) });
    setReviewError(null);
    setAppliedByPerson(true);
    setMode("fixed");
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#121215] p-5 text-xs text-zinc-300 shadow-xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-slate-950">
            <Compass size={16} />
          </span>
          <div>
            <h3 className="font-semibold text-white">AI Tour Guide</h3>
            <p className="text-[11px] text-zinc-500">Code Analyzer & Learning Companion</p>
          </div>
        </div>

        <button
          onClick={() => handleRunCodeOrAnalyze("run_code")}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-indigo-500 px-3 py-1.5 font-medium text-slate-950 hover:brightness-110 disabled:opacity-50"
        >
          {loading ? <Sparkles size={13} className="animate-spin" /> : <Play size={13} />}
          {loading ? "Analyzing..." : "Run Code & Analyze"}
        </button>
      </div>

      {/* State 1: Code has NO errors -> Display Execution Roadmap */}
      {mode === "roadmap" && data?.roadmap && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400">
            <CheckCircle2 size={16} />
            <span>No bugs detected! Here is the roadmap of how your code operates.</span>
          </div>
          <p className="text-zinc-400">{data.roadmap.summary}</p>
          <div className="space-y-2">
            {data.roadmap.steps.map((step) => (
              <div key={step.step} className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-3">
                <div className="flex items-center justify-between font-medium text-cyan-300">
                  <span>Step {step.step}: {step.title}</span>
                  {step.file && <span className="font-mono text-[10px] text-zinc-500">{step.file}</span>}
                </div>
                <p className="mt-1 text-zinc-400">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* State 2: Code HAS errors -> Display Error Module & Action Choices */}
      {mode === "decision" && data?.hasErrors && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-2.5 text-red-400">
            <AlertTriangle size={16} />
            <span>Detected {data.errors?.length || 0} error(s) or bug(s) in your code.</span>
          </div>

          <div className="space-y-1.5">
            {data.errors?.map((err: CodeErrorItem, idx) => (
              <div key={idx} className="rounded-md border border-zinc-800 bg-[#18181b] p-2.5">
                <div className="flex items-center justify-between font-mono text-red-400">
                  <span>{err.file}:{err.line}</span>
                  <span className="uppercase text-[10px]">{err.severity}</span>
                </div>
                <p className="mt-1 text-zinc-200">{err.message}</p>
                <p className="mt-0.5 text-zinc-500">{err.suggestion}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 text-center">
            <p className="mb-3 font-medium text-indigo-200">How would you like to proceed?</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => handleRunCodeOrAnalyze("fix_ai")}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-fuchsia-500 to-cyan-400 px-3.5 py-2 font-medium text-slate-950 hover:brightness-110"
              >
                <Wand2 size={13} /> Fix with AI
              </button>
              <button
                onClick={() => handleRunCodeOrAnalyze("fix_manual")}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3.5 py-2 font-medium text-zinc-200 hover:bg-zinc-700"
              >
                <BookOpen size={13} /> Fix manually with guidance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State 3: Fix Manually with Guidance */}
      {mode === "manual_guide" && data?.guidance && (
        <div className="space-y-3">
          <p className="text-zinc-300">{data.guidance.overview}</p>
          <div className="space-y-2">
            {data.guidance.hints.map((h) => (
              <div key={h.step} className="rounded-lg border border-zinc-800 bg-[#18181b] p-3">
                <div className="flex items-center justify-between text-cyan-300 font-medium">
                  <span>Hint #{h.step}: {h.concept}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{h.file} ({h.targetLines})</span>
                </div>
                <p className="mt-1 text-zinc-300">{h.hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* State 4: Fix applied (an automatic, deterministic patch, or a suggestion the person approved) */}
      {mode === "fixed" && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300">
          <CheckCircle2 size={16} className="mb-1 inline mr-1.5" />
          {appliedByPerson
            ? "Applied the change you approved to your virtual workspace. Review it in the editor."
            : data?.fixExplanation || "Code fixes have been automatically applied to your virtual workspace!"}
        </div>
      )}

      {/* State 5: a fix was suggested but nothing was changed — the person decides */}
      {mode === "review" && (
        <div className="space-y-3">
          <p className="text-zinc-300">{data?.summary}</p>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-200">
            {data?.fixExplanation || "Nothing in your files was changed."}
          </p>
          {data?.suggestedFix && (
            <div className="space-y-1.5">
              <div className="rounded border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-red-400/80">Replace</p>
                <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-red-200">{data.suggestedFix.before}</code>
              </div>
              <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-emerald-400/80">With</p>
                <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-emerald-200">{data.suggestedFix.after}</code>
              </div>
              {data.suggestedFix.note && <p className="text-[11px] leading-4 text-zinc-600">{data.suggestedFix.note}</p>}
              {reviewError && <p role="alert" className="text-[11px] leading-4 text-red-300">{reviewError}</p>}
              <button
                onClick={applyReviewedFix}
                className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-fuchsia-500 to-cyan-400 px-3.5 py-2 font-medium text-slate-950 hover:brightness-110"
              >
                <Wand2 size={13} /> Apply this change
              </button>
            </div>
          )}
          {data?.steps && data.steps.length > 0 && (
            <ol className="list-decimal space-y-1.5 pl-4 text-zinc-400">
              {data.steps.map((st, i) => <li key={i}>{st}</li>)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}