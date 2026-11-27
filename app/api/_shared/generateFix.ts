import { callJsonModel } from "./llm";

// ---------------------------------------------------------------------------
// Turns one recorded error + the file's CURRENT content into a full patched file, for
// app/v1/errors/[id]/fix/route.ts to commit.
//
// Why a before/after edit instead of asking the model for the whole rewritten file: a full-file
// answer from a free model can be truncated, "helpfully" reformatted, or have chunks replaced by
// "// ...rest unchanged" — and whatever comes back gets COMMITTED to the user's repo. With a
// small edit, the server applies it to the real file content itself, and rejects anything that
// doesn't match exactly once. A bad answer can only ever fail; it can't silently damage the file.
// ---------------------------------------------------------------------------

const MAX_FILE_CHARS_FOR_PROMPT = 16000;
const WINDOW_LINES_EACH_SIDE = 200;
const MAX_FIX_TOKENS = 1500;

export interface FixRequest {
  filePath: string;
  content: string; // the file's real current content — the edit is applied to THIS
  line: number | null;
  severity: string | null;
  message: string;
  cause: string | null;
  suggestedFix: string | null; // the free-text hint recorded at ingest time, if any
}

export interface GeneratedFix {
  patched: string; // complete new file content
  explanation: string; // 1–2 plain-language sentences
}

// Big files: send a window around the reported line rather than the whole thing. Safe because
// the model's edit is applied to the FULL content afterwards, not to what the model saw.
function promptView(content: string, line: number | null): { view: string; note: string } {
  if (content.length <= MAX_FILE_CHARS_FOR_PROMPT) return { view: content, note: "Complete file." };

  const lines = content.split("\n");
  const center = line && line > 0 ? Math.min(line - 1, lines.length - 1) : 0;
  const start = Math.max(0, center - WINDOW_LINES_EACH_SIDE);
  const end = Math.min(lines.length, center + WINDOW_LINES_EACH_SIDE + 1);
  let view = lines.slice(start, end).join("\n");
  if (view.length > MAX_FILE_CHARS_FOR_PROMPT) view = view.slice(0, MAX_FILE_CHARS_FOR_PROMPT);
  return {
    view,
    note: `Partial view: lines ${start + 1}-${end} of ${lines.length}. The rest of the file exists but is omitted.`,
  };
}

// Applies the edit only if `before` matches exactly once. Returns null otherwise.
function applyEdit(content: string, before: string, after: string): string | null {
  if (!before.trim() || before === after) return null;

  // If the file uses CRLF but the model answered with LF, convert so the match can succeed.
  const usesCrlf = content.includes("\r\n");
  const toFileEol = (s: string) => (usesCrlf && !s.includes("\r\n") ? s.replace(/\n/g, "\r\n") : s);
  const b = toFileEol(before);
  const a = toFileEol(after);

  const first = content.indexOf(b);
  if (first === -1) return null; // model didn't copy the code exactly
  if (content.indexOf(b, first + 1) !== -1) return null; // ambiguous — matches more than once

  const patched = content.slice(0, first) + a + content.slice(first + b.length);
  return patched.trim() ? patched : null;
}

export async function generateFixPatch(req: FixRequest): Promise<GeneratedFix | null> {
  const { view, note } = promptView(req.content, req.line);

  const system =
    "You fix ONE reported bug in ONE source file by proposing ONE small, targeted edit. " +
    "You are given the file, a note on whether you're seeing all of it, and the recorded problem " +
    "(message, likely cause, line, and sometimes a hint). " +
    "Change only what is needed to fix the reported problem — never reformat, rename, reorder, or " +
    "refactor unrelated code, and never touch code you can't tie to the problem. " +
    '"before" MUST be copied EXACTLY from the file, character for character, including indentation ' +
    "and line breaks, and MUST appear exactly once in the file: include just enough surrounding " +
    "lines to be unique (usually 1-10 lines), no more. \"after\" is what replaces it. " +
    "If you cannot identify a safe, specific fix from what you've been given, return empty strings for " +
    'both "before" and "after" and say why in "explanation" — never guess. ' +
    "Respond with ONLY a raw JSON object — no markdown fences, no prose before or after it — matching exactly: " +
    '{"explanation": string (1-2 plain-language sentences on what was wrong and what you changed), ' +
    '"before": string, "after": string}';

  const user = JSON.stringify({
    filePath: req.filePath,
    fileNote: note,
    fileContent: view,
    reportedProblem: {
      message: req.message,
      line: req.line,
      severity: req.severity,
      likelyCause: req.cause,
      hint: req.suggestedFix,
    },
  });

  return callJsonModel<GeneratedFix>({
    system,
    user,
    maxTokens: MAX_FIX_TOKENS,
    temperature: 0,
    accept: (p) => {
      if (typeof p.before !== "string" || typeof p.after !== "string") return null;
      const patched = applyEdit(req.content, p.before, p.after);
      if (!patched) return null; // no usable edit — try the next model
      const explanation =
        typeof p.explanation === "string" && p.explanation.trim() ? p.explanation.trim() : "AI-suggested fix.";
      return { patched, explanation };
    },
  });
}
