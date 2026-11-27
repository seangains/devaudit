import { NextResponse } from "next/server";
import type { HostEvaluation, HostEvaluatorResponse } from "./types";
import { callJsonModel } from "../_shared/llm";
import { supabaseForRequest } from "../_shared/supabaseForRequest";
import { limitByIp, limitByUser } from "../_shared/limits";
import { safeError } from "../_shared/safeError";

// ---------------------------------------------------------------------------
// POST /api/host-ai — recommends where to deploy a project.
//
// Split of responsibilities:
//   * Deterministic (never AI): framework detection, env-var extraction, and each host's
//     category / pricing tier / estimated cost. Pricing is a fact, and free models make prices
//     up, so it comes from the static catalog below.
//   * AI: each host's fitScore, pros, cons, bestFor, plus the top recommendation's rationale and
//     difficulty — judged from the project's actual evidence (dependencies, files, env vars).
//   * If no model is available or every model fails, the original rule-based scores/text are
//     used unchanged and the response says poweredBy: "heuristic".
//
// PRIVACY: only file NAMES, package.json, and requirements.txt/pyproject.toml contents are ever
// sent to a model. Other files' contents (which can include .env files or secrets) are never
// included, and env vars are sent as names only, never values.
//
// NOTE: this catalog must only ever contain hosts /api/deploy actually implements — recommending
// one it can't fulfill leads to an "Unsupported host provider" dead end after the person enters a
// token and clicks Deploy. Cloudflare Pages is kept here because it was in the previous version;
// if /api/deploy doesn't implement it, remove it from HOST_CATALOG and heuristicHosts().
// ---------------------------------------------------------------------------

const MAX_PACKAGE_JSON_CHARS = 4000;
const MAX_PY_DEPS_CHARS = 2000;
const MAX_FILE_NAMES = 80;
const DIFFICULTIES = ["Easy (Automated)", "Moderate", "Advanced"] as const;

// Facts that don't come from a model.
const HOST_CATALOG: Record<string, { category: string; pricingTier: string; estimatedCost: string }> = {
  Vercel: { category: "Serverless / Edge", pricingTier: "Free Hobby Tier", estimatedCost: "$0/mo" },
  Render: { category: "PaaS", pricingTier: "Free Tier Available", estimatedCost: "$0 - $7/mo" },
  "GitHub Pages": { category: "Static / Jamstack", pricingTier: "100% Free", estimatedCost: "$0/mo" },
  Netlify: { category: "Static / Jamstack", pricingTier: "Free Tier Available", estimatedCost: "$0/mo" },
  "Cloudflare Pages": { category: "Edge Network", pricingTier: "Generous Free Tier", estimatedCost: "$0/mo" },
};

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return JSON.stringify(v);
  return "";
}

function detectFramework(files: Record<string, unknown>) {
  const fileNames = Object.keys(files);
  const packageJsonString = asText(files["package.json"]);
  const hasDockerfile = fileNames.some((f) => f.toLowerCase() === "dockerfile");
  const hasPython = fileNames.includes("requirements.txt") || fileNames.includes("pyproject.toml");

  let framework = "Static HTML/JS";
  if (packageJsonString) {
    const pkgLower = packageJsonString.toLowerCase();
    if (pkgLower.includes('"next"')) framework = "Next.js";
    else if (pkgLower.includes('"@remix-run') || pkgLower.includes('"remix"')) framework = "Remix";
    else if (pkgLower.includes('"@sveltejs/kit"')) framework = "SvelteKit";
    else if (pkgLower.includes('"react"')) framework = "React SPA";
    else if (pkgLower.includes('"express"') || pkgLower.includes('"fastify"')) framework = "Node.js API";
  } else if (hasDockerfile) {
    framework = "Docker Container";
  } else if (hasPython) {
    framework = "Python Service";
  }

  return { framework, fileNames, hasDockerfile, packageJsonString };
}

// The original rule-based evaluation — the fallback when no AI is available.
function heuristicHosts(framework: string): HostEvaluation[] {
  return [
    {
      hostName: "Vercel",
      ...HOST_CATALOG["Vercel"],
      fitScore: ["Next.js", "React SPA", "SvelteKit", "Remix"].includes(framework) ? 98 : 65,
      pros: ["Native framework optimizations", "Global Edge CDN & preview deployments"],
      cons: ["Execution timeouts on free serverless functions"],
      bestFor: "Frontend & Next.js full-stack applications",
    },
    {
      hostName: "Render",
      ...HOST_CATALOG["Render"],
      fitScore: ["Node.js API", "Docker Container", "Python Service"].includes(framework) ? 95 : 80,
      pros: ["Full Node/Docker persistent runtime", "Automated SSL & background workers"],
      cons: ["Free web services spin down during inactivity"],
      bestFor: "APIs, Docker containers, and persistent backends",
    },
    {
      hostName: "GitHub Pages",
      ...HOST_CATALOG["GitHub Pages"],
      fitScore: framework === "Static HTML/JS" ? 92 : framework === "React SPA" ? 70 : 30,
      pros: ["Native GitHub integration", "Zero hosting cost, zero configuration"],
      cons: ["Static HTML/CSS/JS only — no server runtime or API routes"],
      bestFor: "Pure static sites with no backend needed",
    },
    {
      hostName: "Netlify",
      ...HOST_CATALOG["Netlify"],
      fitScore: ["React SPA", "Static HTML/JS", "SvelteKit"].includes(framework) ? 90 : 60,
      pros: ["Instant static/JAMstack deploys", "Built-in form handling & CI/CD"],
      cons: ["Server-side workloads need extra Functions setup"],
      bestFor: "JAMstack applications and static builds",
    },
    {
      hostName: "Cloudflare Pages",
      ...HOST_CATALOG["Cloudflare Pages"],
      fitScore: framework === "Static HTML/JS" || framework === "React SPA" ? 96 : 75,
      pros: ["Unlimited bandwidth on free tier", "Ultra-fast global distribution"],
      cons: ["Requires an Account ID plus a Pages-scoped API token"],
      bestFor: "Static sites, Jamstack, and single-page apps",
    },
  ];
}

interface AiHost {
  fitScore: number;
  pros: string[];
  cons: string[];
  bestFor: string;
}

interface AiEvaluation {
  hosts: Map<string, AiHost>;
  topHostName: string | null;
  whySelected: string | null;
  difficulty: string | null;
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

async function aiEvaluate(input: {
  framework: string;
  fileNames: string[];
  hasDockerfile: boolean;
  packageJson: string;
  pythonDeps: string;
  envVars: string[];
}): Promise<AiEvaluation | null> {
  const hostNames = Object.keys(HOST_CATALOG);

  const system =
    "You are a deployment advisor inside a tool that can deploy a project to exactly these hosts: " +
    `${hostNames.join(", ")}. You will be given evidence about ONE project: its detected framework, its file ` +
    "names, its package.json and/or Python dependency file, whether it has a Dockerfile, and the names of " +
    "environment variables its code reads. Score EVERY one of those hosts from 0 to 100 for how well it fits " +
    "THIS project, and ground each judgment in the evidence: name real dependencies, files, or env vars you " +
    "were shown (e.g. 'uses express with a persistent server, which static hosts can't run'), never generic " +
    "marketing copy that would fit any project. Consider whether the project needs a server runtime, " +
    "server-side rendering, API routes, background work, a database connection, or is purely static. " +
    "Do NOT state prices, quotas, or limits — pricing is handled elsewhere. Only ever mention hosts from the " +
    "list above. Give 2-3 short pros and 1-2 short cons per host, and a one-line bestFor. " +
    "Then pick the single best host for this project: its whySelected must be 1-2 plain sentences that cite " +
    "specific evidence from the project, and deploymentDifficulty must be exactly one of: " +
    `${DIFFICULTIES.map((d) => `"${d}"`).join(", ")}. ` +
    "Respond with ONLY a raw JSON object — no markdown fences, no prose before or after it — matching exactly: " +
    '{"topRecommendation": {"hostName": string, "whySelected": string, "deploymentDifficulty": string}, ' +
    '"hosts": [{"hostName": string, "fitScore": number, "pros": string[], "cons": string[], "bestFor": string}]} ' +
    "with one entry in \"hosts\" for each host in the list.";

  const user = JSON.stringify({
    detectedFramework: input.framework,
    hasDockerfile: input.hasDockerfile,
    fileNames: input.fileNames.slice(0, MAX_FILE_NAMES),
    packageJson: input.packageJson.slice(0, MAX_PACKAGE_JSON_CHARS) || null,
    pythonDependencies: input.pythonDeps.slice(0, MAX_PY_DEPS_CHARS) || null,
    envVarsReferencedInCode: input.envVars,
  });

  return callJsonModel<AiEvaluation>({
    system,
    user,
    maxTokens: 1800,
    temperature: 0.2,
    accept: (p) => {
      if (!Array.isArray(p.hosts)) return null;

      const hosts = new Map<string, AiHost>();
      for (const h of p.hosts) {
        if (!h || typeof h.hostName !== "string" || !(h.hostName in HOST_CATALOG)) continue;
        const score = Number(h.fitScore);
        if (!Number.isFinite(score)) continue;
        const pros = strList(h.pros, 3);
        const cons = strList(h.cons, 3);
        if (pros.length === 0 || cons.length === 0 || typeof h.bestFor !== "string" || !h.bestFor.trim()) continue;
        hosts.set(h.hostName, {
          fitScore: Math.round(Math.min(100, Math.max(0, score))),
          pros,
          cons,
          bestFor: h.bestFor.trim(),
        });
      }

      // Require a complete, coherent set. A partial answer would mix AI scores with rule-based
      // ones on different scales, so it's rejected and the next model gets a turn.
      if (hosts.size !== hostNames.length) return null;

      const top = p.topRecommendation;
      const difficulty =
        top && typeof top.deploymentDifficulty === "string" && (DIFFICULTIES as readonly string[]).includes(top.deploymentDifficulty)
          ? top.deploymentDifficulty
          : null;

      return {
        hosts,
        topHostName: top && typeof top.hostName === "string" ? top.hostName : null,
        whySelected: top && typeof top.whySelected === "string" && top.whySelected.trim() ? top.whySelected.trim() : null,
        difficulty,
      };
    },
  });
}

export async function POST(req: Request) {
  try {
    // Signed-in only, and rate limited: this route calls the LLM, so it must not be open to the
    // internet. HostDeployer sends the caller's bearer token (authHeader) with this request.
    //
    // Both limits FAIL CLOSED (limitByIp / limitByUser answer 503 if the limiter itself is down):
    // this route costs money per call, so "limiter broken" must not mean "no limit". The per-IP
    // check runs first, before the auth lookup, so a flood is cut off cheaply and covers one
    // person spreading calls across many accounts. It is deliberately looser than the per-user
    // limit so offices and schools sharing one address aren't locked out.
    const limitedIp = await limitByIp(req, "host-ai", 30);
    if (limitedIp) return limitedIp;

    const {
      data: { user },
    } = await supabaseForRequest(req).auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const limitedUser = await limitByUser(user.id, "host-ai", 10);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);

    if (!body || !body.files || typeof body.files !== "object" || Object.keys(body.files).length === 0) {
      return NextResponse.json({ error: "No valid code files provided for evaluation." }, { status: 400 });
    }

    const files: Record<string, unknown> = body.files;
    const { framework, fileNames, hasDockerfile, packageJsonString } = detectFramework(files);

    // Extract process.env usages across provided code files
    const detectedEnvVars = new Set<string>();
    for (const content of Object.values(files)) {
      if (typeof content === "string") {
        const matches = content.match(/process\.env\.([A-Z0-9_]+)/g);
        if (matches) {
          matches.forEach((m) => detectedEnvVars.add(m.replace("process.env.", "")));
        }
      }
    }
    const envVars = Array.from(detectedEnvVars);

    let evaluatedHosts = heuristicHosts(framework);
    let poweredBy: "ai" | "heuristic" = "heuristic";

    const ai = await aiEvaluate({
      framework,
      fileNames,
      hasDockerfile,
      packageJson: packageJsonString,
      pythonDeps: [asText(files["requirements.txt"]), asText(files["pyproject.toml"])].filter(Boolean).join("\n---\n"),
      envVars,
    });

    if (ai) {
      // Pricing/category stay from the static catalog; the judgment fields come from the model.
      evaluatedHosts = evaluatedHosts.map((h) => {
        const a = ai.hosts.get(h.hostName);
        return a ? { ...h, fitScore: a.fitScore, pros: a.pros, cons: a.cons, bestFor: a.bestFor } : h;
      });
      poweredBy = "ai";
    }

    const topHost = evaluatedHosts.reduce((max, h) => (h.fitScore > max.fitScore ? h : max), evaluatedHosts[0]);

    // The model's rationale is only used if it's actually about the host that ended up on top;
    // otherwise it would describe a different host than the one being recommended.
    const useAiRationale = poweredBy === "ai" && ai?.topHostName === topHost.hostName && ai.whySelected;

    return NextResponse.json({
      projectSummary: {
        framework,
        detectedServices: fileNames.slice(0, 10),
      },
      topRecommendation: {
        hostName: topHost.hostName,
        deploymentDifficulty: (poweredBy === "ai" && ai?.difficulty) || "Easy (Automated)",
        whySelected: useAiRationale
          ? (ai!.whySelected as string)
          : `Optimal compatibility match (${topHost.fitScore}%) for ${framework} architectures.`,
      },
      evaluatedHosts,
      requiredEnvVars: envVars,
      poweredBy,
    } satisfies HostEvaluatorResponse);
  } catch (err: unknown) {
    // Generic message to the client; the real one is logged server-side only.
    return safeError("host-ai.POST", err, 500, "The deployment evaluator hit an unexpected error. Please try again.");
  }
}
