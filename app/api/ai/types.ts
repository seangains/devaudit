export interface CodeErrorItem {
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
}

export interface RoadmapStep {
  step: number;
  title: string;
  file?: string;
  description: string;
}

export interface GuidanceHint {
  step: number;
  concept: string;
  file: string;
  targetLines: string;
  hint: string;
}

// One shared response shape across all six actions the AI Tour Guide/New Project form/AI
// Assistant panel/Test Runner can request ("run_code", "fix_ai", "fix_manual", "scaffold",
// "chat", "generate_tests"). Each action only populates the subset of fields relevant to it,
// which is why almost everything below is optional — check which action you called to know
// which fields will actually be present.
export interface AnalysisResponse {
  // Populated by "run_code"
  hasErrors?: boolean;
  errors?: CodeErrorItem[];
  roadmap?: { summary: string; steps: RoadmapStep[] };

  // Populated by "fix_ai": the full files map. It differs from the input only when the deterministic
  // patcher applied something (check patchedFile). A model- or analyzer-suggested snippet is NEVER
  // applied here; it comes back in suggestedFix for the person to review.
  fixedFiles?: Record<string, string>;

  // Populated by "fix_manual"
  guidance?: { overview: string; hints: GuidanceHint[] };

  // Populated by "scaffold" — a whole new project generated from a one-line description,
  // used by the New Project form as an alternative to picking a static template.
  scaffoldSummary?: string;
  scaffoldFiles?: Record<string, string>;
  suggestedProjectName?: string;

  // Populated by "chat" — a free-form reply from the AI Assistant panel, plus any complete
  // file contents it's proposing (shown to the person to review and apply, never applied
  // automatically).
  chatReply?: string;
  chatProposedFiles?: Record<string, string>;

  // Populated by "generate_tests" — a full test file for one source file, for the Test Runner's
  // "Generate tests with AI" button. The caller derives the test file's path itself (same
  // directory, ".test." inserted before the extension) rather than trusting the model with it.
  testSummary?: string;
  testFileContent?: string;

  // Shared diagnosis fields, present on "fix_ai" and "fix_manual" responses
  summary?: string;
  steps?: string[];
  canAutoFix?: boolean;
  fixExplanation?: string;
  patchedFile?: string | null;
  /** The file the diagnosis, patchedFile and suggestedFix are about. */
  targetFile?: string;
  suggestedFix?: { before: string; after: string; note: string } | null;

  // Present on "fix_ai"/"fix_manual" ("ai" | "heuristic") and on "scaffold" ("ai" | "heuristic",
  // the latter meaning both LLM providers were unreachable/unconfigured and a closest-matching
  // static starter was used instead).
  poweredBy?: "ai" | "heuristic";
}
