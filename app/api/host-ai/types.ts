export interface HostEvaluation {
  hostName: string;
  category: string;
  fitScore: number;
  pricingTier: string;
  estimatedCost: string;
  pros: string[];
  cons: string[];
  bestFor: string;
}

export interface HostEvaluatorResponse {
  projectSummary: {
    framework: string;
    detectedServices: string[];
  };
  topRecommendation: {
    hostName: string;
    deploymentDifficulty: string;
    whySelected: string;
  };
  evaluatedHosts: HostEvaluation[];
  requiredEnvVars?: string[];
  // "ai" when a model produced the scores/pros/cons/rationale; "heuristic" when no model was
  // available and the built-in rules were used instead.
  poweredBy?: "ai" | "heuristic";
}
