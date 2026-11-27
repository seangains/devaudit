// ---------------------------------------------------------------------------
// Shared "ask a free coding model for a JSON answer" helper, used by
// app/v1/errors/[id]/fix/route.ts (via generateFix.ts) and app/api/host-ai/route.ts.
//
// This deliberately mirrors the provider pattern already in app/api/ai/route.ts — same two
// providers (OpenRouter, then Groq), same fallback chain, same "any failure → try the next
// model" behavior, same extractJson tolerance for models that wrap JSON in fences or prose —
// so all AI features in the app behave the same way. app/api/ai/route.ts keeps its own private
// copies for now (untouched, so nothing there can regress); it can adopt this file later.
//
// Differences from the copies in ai/route.ts, all on purpose:
//   * `accept` lets the CALLER validate each model's answer; a rejected answer moves on to the
//     next model instead of failing the whole request.
//   * `finish_reason === "length"` is treated as a failure — the output was cut off, and a
//     truncated answer must never be trusted.
//   * A total time budget across the whole chain, so nine slow models can't add up to minutes.
//
// Returns null when there's no API key, or every model failed/was rejected. Callers must have
// a sensible fallback for null.
// ---------------------------------------------------------------------------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ModelCandidate {
  provider: "openrouter" | "groq";
  model: string;
}

// Same chain as app/api/ai/route.ts. Free-tier models rotate out without notice — if you update
// the list there, update it here too (or migrate ai/route.ts to import this one).
export const FREE_CODER_MODELS: ModelCandidate[] = [
  // --- OpenRouter (requires OPENROUTER_API_KEY) ---
  { provider: "openrouter", model: "qwen/qwen3-coder:free" },
  { provider: "openrouter", model: "poolside/laguna-s-2.1:free" },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  { provider: "openrouter", model: "qwen/qwen3-235b-a22b:free" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
  // --- Groq (requires GROQ_API_KEY) — separate quota from OpenRouter above ---
  { provider: "groq", model: "qwen/qwen3.6-27b" },
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "groq", model: "openai/gpt-oss-20b" },
  { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" },
];

const DEFAULT_PER_MODEL_TIMEOUT_MS = 20000;
const DEFAULT_TOTAL_BUDGET_MS = 50000;

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY);
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

// Free, open-weight models are less consistent than a frontier model about respecting "JSON
// only" instructions. Try a direct parse first, then fall back to the first {...} block.
export function extractJson(text: string): any | null {
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

export async function callJsonModel<T>(opts: {
  system: string;
  user: string;
  maxTokens: number;
  /** Validate/convert one model's parsed JSON. Return null to reject it and try the next model. */
  accept: (parsed: any) => T | null;
  temperature?: number;
  perModelTimeoutMs?: number;
  totalBudgetMs?: number;
}): Promise<T | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!openrouterKey && !groqKey) return null;

  const perModelTimeout = opts.perModelTimeoutMs ?? DEFAULT_PER_MODEL_TIMEOUT_MS;
  const totalBudget = opts.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const started = Date.now();

  for (const { provider, model } of FREE_CODER_MODELS) {
    const apiKey = provider === "openrouter" ? openrouterKey : groqKey;
    if (!apiKey) continue; // provider never set up — skip without wasting a request

    const remaining = totalBudget - (Date.now() - started);
    if (remaining < 1500) break; // out of time budget

    const url = provider === "openrouter" ? OPENROUTER_URL : GROQ_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(perModelTimeout, remaining));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0,
          max_tokens: opts.maxTokens,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) continue; // rate-limited / model gone — next model

      const data = await res.json();
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === "length") continue; // output cut off — never trust it
      const text: unknown = choice?.message?.content;
      if (typeof text !== "string" || !text) continue;

      const parsed = extractJson(text);
      if (!parsed) continue;

      const accepted = opts.accept(parsed);
      if (accepted !== null) return accepted;
      // rejected by the caller's validation — try the next model
    } catch {
      continue; // timeout or network error — next model
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}
