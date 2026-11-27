'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { listRepos, hasGithubToken, GhError, saveLastDeploy } from './CodeStudio';
import type { HostEvaluatorResponse, HostEvaluation } from '../api/host-ai/types';
import { listEnvVars, setEnvVar, deleteEnvVar, authHeader, type EnvVarMeta } from './envVars';

interface HostGuide {
  tokenUrl: string;
  steps: string[];
  extraField?: { label: string; placeholder: string };
}

interface Notice {
  type: 'info' | 'success' | 'error';
  message: string;
  url?: string;
}

const HOST_GUIDES: Record<string, HostGuide> = {
  Vercel: {
    tokenUrl: 'https://vercel.com/account/tokens',
    steps: [
      'Click "Get Vercel Token" to open Account Settings.',
      'Click "Create Token", set a name and scope (e.g., Full Access).',
      'Copy the token and paste it into the field below.',
    ],
  },
  'GitHub Pages': {
    tokenUrl: 'https://github.com/settings/tokens/new?description=UniversalHostDeployer&scopes=repo,workflow',
    steps: [
      'Click "Get GitHub Token" (pre-selects required repo & workflow scopes).',
      'Scroll to the bottom and click "Generate token".',
      'Copy your token (starts with ghp_) and paste it below.',
    ],
  },
  Netlify: {
    tokenUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
    steps: [
      'Click "Get Netlify Token" to open Personal Access Tokens.',
      'Click "New access token", give it a description, and generate.',
      'Copy the generated token and paste it below.',
    ],
  },
  Render: {
    tokenUrl: 'https://dashboard.render.com/u/settings#api-keys',
    steps: [
      'Click "Get Render Token" to open Account Settings.',
      'Click "Create API Key", name it, and generate.',
      'Copy your key (starts with rnd_) and paste it below.',
    ],
  },
  'Fly.io': {
    tokenUrl: 'https://fly.io/user/personal_access_tokens',
    steps: [
      'Click "Get Fly.io Token" to access tokens dashboard.',
      'Generate a new token or run `fly auth token` in terminal.',
      'Copy your token and paste it below.',
    ],
  },
  'Cloudflare Pages': {
    tokenUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    steps: [
      'Click "Get Cloudflare Pages Token" to open the API Tokens dashboard.',
      'Create a token with two permissions: Account > Cloudflare Pages > Edit, and Account > Account Settings > Read (click "Add more" for the second one — it\'s what lets us detect your Account ID).',
      'Paste the token below.',
    ],
  },
  Railway: {
    tokenUrl: 'https://railway.com/account/tokens',
    steps: [
      'Click "Get Railway Token" to open your account tokens page.',
      'Click "Create Token", leave the workspace dropdown on "No workspace" for an account-wide token, and name it.',
      'Copy the generated token and paste it below.',
    ],
  },
  Custom: {
    tokenUrl: '',
    steps: [],
    extraField: { label: 'Deploy Webhook URL', placeholder: 'https://your-ci.example.com/deploy-hook' },
  },
};

const DEFAULT_HOSTS: HostEvaluation[] = [
  {
    hostName: 'Vercel',
    category: 'Serverless / Edge',
    fitScore: 95,
    pricingTier: 'Free Tier Available',
    estimatedCost: '$0/mo on Hobby Tier',
    pros: ['Zero-config deployment', 'Global CDN & edge support'],
    cons: ['Execution timeout limits on free tier'],
    bestFor: 'Next.js, React, and frontend frameworks',
  },
  {
    hostName: 'GitHub Pages',
    category: 'Static / Jamstack',
    fitScore: 90,
    pricingTier: 'Free Tier Available',
    estimatedCost: '100% Free',
    pros: ['Native GitHub integration', 'Zero hosting cost'],
    cons: ['Static HTML/CSS/JS only; no server runtime'],
    bestFor: 'Pure frontend or static sites',
  },
  {
    hostName: 'Netlify',
    category: 'Static / Jamstack',
    fitScore: 88,
    pricingTier: 'Free Tier Available',
    estimatedCost: 'Free Tier Available',
    pros: ['Easy form handling', 'Built-in CI/CD pipelines'],
    cons: ['Bandwidth overage costs on high traffic'],
    bestFor: 'JAMstack applications and static builds',
  },
  {
    hostName: 'Render',
    category: 'PaaS',
    fitScore: 85,
    pricingTier: 'Free Tier Available',
    estimatedCost: '$0 - $7/mo',
    pros: ['Supports Node, Docker, WebSockets, background workers'],
    cons: ['Free tier instances sleep on inactivity'],
    bestFor: 'Full-stack Express apps and Dockerized API services',
  },
  {
    hostName: 'Cloudflare Pages',
    category: 'Edge Network',
    fitScore: 90,
    pricingTier: 'Generous Free Tier',
    estimatedCost: '$0/mo',
    pros: ['Unlimited bandwidth on free tier', 'Ultra-fast global distribution'],
    cons: ['Requires a Pages-scoped API token'],
    bestFor: 'Static sites, Jamstack, and single-page apps',
  },
];

// Not a real evaluated host — always shown alongside the curated list so people can deploy
// to a provider we don't have a dedicated integration for, via their own webhook endpoint.
const CUSTOM_HOST: HostEvaluation = {
  hostName: 'Custom',
  category: 'Webhook',
  fitScore: 0,
  pricingTier: 'Depends on your target',
  estimatedCost: 'Varies',
  pros: ['Deploy to literally any endpoint you control'],
  cons: ['Only works if that endpoint understands the payload — your own CI hook, a self-hosted deploy script, etc.'],
  bestFor: 'Any host with its own deploy webhook',
};

// ─── SecretInput ────────────────────────────────────────────────────────────────────────────
// A token field that behaves like a phone password box: each typed character is visible for a
// moment, then collapses to a dot. Pasted / autofilled text becomes dots immediately. An eye
// button toggles the whole value on and off.
//
// How it works: the real token lives only in React state (`value`). The <input> is type="text"
// but is always handed a *masked* string (dots, plus the one just-typed character while it's
// "peeking"). On each change we work out what the user did to the masked text and apply the same
// edit to the real value. Because every dot looks identical, we can't tell which one was
// deleted by comparing strings — so we use the caret/selection position captured in `beforeinput`.

const MASK_CHAR = '•';
const PEEK_MS = 1000;

type Peek = { start: number; end: number; forValue: string };
type PreEdit = { start: number; type: string };

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function maskToken(value: string, peek: Peek | null): string {
  // Only honour a peek while the value is exactly what was typed — if the parent changed it
  // (e.g. cleared the field on host switch), never leak a stale character.
  if (!peek || peek.forValue !== value) return MASK_CHAR.repeat(value.length);
  const s = Math.min(peek.start, value.length);
  const e = Math.min(peek.end, value.length);
  return MASK_CHAR.repeat(s) + value.slice(s, e) + MASK_CHAR.repeat(value.length - e);
}

// Works out which slice of the old (displayed) text was replaced by what.
function resolveEdit(prev: string, next: string, caret: number, pre: PreEdit | null) {
  const delta = next.length - prev.length;

  if (pre) {
    // Typing/pasting leaves the caret after the new text; backspace moves it back; delete holds it.
    const start = caret >= pre.start ? pre.start : caret;
    const insertedLen = caret >= pre.start ? caret - pre.start : 0;
    const removedLen = insertedLen - delta;
    if (
      removedLen >= 0 &&
      start + removedLen <= prev.length &&
      start + insertedLen <= next.length &&
      prev.slice(0, start) === next.slice(0, start) &&
      prev.slice(start + removedLen) === next.slice(start + insertedLen)
    ) {
      return { start, removedLen, inserted: next.slice(start, start + insertedLen) };
    }
  }

  // Fallback (programmatic fills, browsers without beforeinput): plain prefix/suffix diff.
  let start = 0;
  const min = Math.min(prev.length, next.length);
  while (start < min && prev[start] === next[start]) start++;
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd--;
    nextEnd--;
  }
  return { start, removedLen: prevEnd - start, inserted: next.slice(start, nextEnd) };
}

function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
  label = 'token',
  wrapperClassName = '',
  inputClassName = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Used in the eye button's accessible name: "Show {label}" / "Hide {label}". */
  label?: string;
  /** Sizing/layout of the wrapper (e.g. "flex-1 min-w-0" or "w-40"). */
  wrapperClassName?: string;
  /** Look of the input itself (bg, border, padding, font…). Needs no width class. */
  inputClassName?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preEditRef = useRef<PreEdit | null>(null);
  const caretRef = useRef<[number, number] | null>(null);

  const display = revealed ? value : maskToken(value, peek);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const rememberCaret = () => {
    const el = inputRef.current;
    if (el && el.selectionStart != null) caretRef.current = [el.selectionStart, el.selectionEnd ?? el.selectionStart];
  };

  // Browsers jump the caret to the end whenever the input's text is swapped out from under it
  // (dot-ifying a letter, toggling the eye). Put it back so editing mid-token feels normal.
  useIsoLayoutEffect(() => {
    const el = inputRef.current;
    const caret = caretRef.current;
    if (!el || !caret || document.activeElement !== el) return;
    if (el.selectionStart !== caret[0] || el.selectionEnd !== caret[1]) el.setSelectionRange(caret[0], caret[1]);
  }, [display]);

  // `beforeinput` is the only point where the selection is still the *pre-edit* one, and it tells
  // us whether this was typing, a paste, a delete, etc. Undo/redo is blocked: the browser's undo
  // stack would be full of dots and could restore garbage.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onBeforeInput = (ev: Event) => {
      const type = (ev as InputEvent).inputType || '';
      if (type === 'historyUndo' || type === 'historyRedo') {
        ev.preventDefault();
        return;
      }
      preEditRef.current = { start: el.selectionStart ?? 0, type };
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const next = el.value;
    const caret = el.selectionStart ?? next.length;
    caretRef.current = [caret, el.selectionEnd ?? caret];

    // Eye is on: the field shows the real text, so the browser's value *is* the new value.
    if (revealed) {
      preEditRef.current = null;
      onChange(next);
      return;
    }

    const pre = preEditRef.current;
    preEditRef.current = null;
    const { start, removedLen, inserted } = resolveEdit(display, next, caret, pre);
    const nextValue = value.slice(0, start) + inserted + value.slice(start + removedLen);

    // One real keystroke → peek at it. Paste, autofill, drop, delete, cut → straight to dots.
    const isKeystroke =
      !!pre && (pre.type === 'insertText' || pre.type === 'insertCompositionText') && inserted.length === 1;

    onChange(nextValue);
    clearTimer();
    if (isKeystroke) {
      setPeek({ start, end: start + 1, forValue: nextValue });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        rememberCaret();
        setPeek(null);
      }, PEEK_MS);
    } else {
      setPeek(null);
    }
  };

  const toggleReveal = () => {
    rememberCaret();
    clearTimer();
    setPeek(null);
    setRevealed((r) => !r);

    // Soft fade on the text so dots ⇄ letters doesn't snap.
    const el = inputRef.current;
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (el && !reduceMotion && typeof el.animate === 'function') {
      el.animate([{ color: 'rgba(255,255,255,0)' }, { color: getComputedStyle(el).color }], {
        duration: 220,
        easing: 'ease-out',
      });
    }
  };

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        ref={inputRef}
        type="text"
        value={display}
        onChange={handleChange}
        onBlur={() => {
          clearTimer();
          setPeek(null);
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore
        className={`w-full ${inputClassName}`}
        style={{ paddingRight: '1.75rem' }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep focus (and caret) in the input
        onClick={toggleReveal}
        disabled={disabled}
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={revealed}
        title={revealed ? `Hide ${label}` : `Show ${label}`}
        className={`absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 disabled:opacity-40 ${
          revealed ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {/* The slash draws itself across the eye when the token is visible. */}
          <line
            x1="3"
            y1="3"
            x2="21"
            y2="21"
            strokeDasharray="26"
            strokeDashoffset={revealed ? 0 : 26}
            style={{ transition: 'stroke-dashoffset 220ms ease-out' }}
          />
        </svg>
      </button>
    </div>
  );
}

export default function HostDeployer({
  projectId,
  codeFiles,
  projectName,
  repoUrl,
  onRedirectToRepoConfig,
}: {
  projectId: string;
  codeFiles: Record<string, string>;
  projectName: string;
  repoUrl?: string;
  onRedirectToRepoConfig?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<HostEvaluatorResponse | null>(null);
  const [selectedHost, setSelectedHost] = useState<string>('Vercel');
  const [accessToken, setAccessToken] = useState('');
  const [extraFieldValue, setExtraFieldValue] = useState('');
  const [hostSearch, setHostSearch] = useState('');

  // Render Modal & Repo handling state
  const [showRenderModal, setShowRenderModal] = useState(false);
  const [renderModalMode, setRenderModalMode] = useState<'choice' | 'attach' | 'create' | 'confirm-public'>('choice');
  // Set when the server says an attached repository is private and Render needs it public. The
  // deploy only goes ahead after the person explicitly confirms making THIS repository public.
  const [confirmPublic, setConfirmPublic] = useState<{ repo: string; repoUrl: string } | null>(null);
  const [userRepos, setUserRepos] = useState<Array<{ name: string; full_name: string; clone_url: string }>>([]);
  const [selectedRepoUrl, setSelectedRepoUrl] = useState('');
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [repoVisibility, setRepoVisibility] = useState<'public' | 'private'>('public');

  const [notice, setNotice] = useState<Notice | null>(null);
  const [deploying, setDeploying] = useState(false);

  // Environment variables — encrypted server-side (see app/api/env). Only key names and
  // timestamps ever come back to the client; values are write-only.
  const [envVars, setEnvVars] = useState<EnvVarMeta[] | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [editingEnvValue, setEditingEnvValue] = useState('');
  const [savingEnvKey, setSavingEnvKey] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setEnvLoading(true);
    listEnvVars(projectId)
      .then((v) => { if (active) setEnvVars(v); })
      .catch((e) => { if (active) setEnvError(e instanceof Error ? e.message : 'Failed to load environment variables.'); })
      .finally(() => { if (active) setEnvLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const configuredEnvKeys = new Set((envVars ?? []).map((v) => v.key));

  async function saveEnvVar(key: string, value: string) {
    const trimmedKey = key.trim();
    if (!projectId || !trimmedKey || !value.trim()) return;
    setSavingEnvKey(trimmedKey);
    setEnvError(null);
    try {
      await setEnvVar(projectId, trimmedKey, value);
      setEnvVars(await listEnvVars(projectId));
      setNewEnvKey('');
      setNewEnvValue('');
      setEditingEnvKey(null);
      setEditingEnvValue('');
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : 'Failed to save that variable.');
    } finally {
      setSavingEnvKey(null);
    }
  }

  async function removeEnvVar(key: string) {
    if (!projectId) return;
    setSavingEnvKey(key);
    setEnvError(null);
    try {
      await deleteEnvVar(projectId, key);
      setEnvVars((v) => (v ?? []).filter((x) => x.key !== key));
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : 'Failed to delete that variable.');
    } finally {
      setSavingEnvKey(null);
    }
  }

  const activeGuide = HOST_GUIDES[selectedHost] || HOST_GUIDES['Vercel'];

  const runHostEvaluation = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch('/api/host-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ files: codeFiles }),
      });

      const contentType = res.headers.get('content-type') || '';
      const rawBody = await res.text();

      if (!contentType.includes('application/json')) {
        // Server returned HTML/plain text instead of JSON — almost always a
        // 404 (route not found at /api/host-ai) or an unhandled server error page.
        const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 120);
        const hint =
          res.status === 404
            ? "The /api/host-ai route wasn't found — check it's saved at app/api/host-ai/route.ts."
            : `Server returned status ${res.status} instead of JSON.`;
        setNotice({
          type: 'error',
          message: `Host evaluator returned an unexpected response. ${hint} (${snippet || 'empty body'})`,
        });
        return;
      }

      let data: HostEvaluatorResponse;
      try {
        data = JSON.parse(rawBody);
      } catch {
        setNotice({ type: 'error', message: 'Host evaluator returned malformed JSON.' });
        return;
      }

      if (res.ok && data.topRecommendation) {
        setEvaluation(data);
        setSelectedHost(data.topRecommendation.hostName);
      } else {
        setNotice({ type: 'error', message: (data as any).error || 'Host evaluation failed.' });
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: `Error running host evaluator: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const executeDeployment = async (finalRepoUrl?: string, autoCreate?: boolean, opts: { confirmMakePublic?: boolean } = {}) => {
    const rawRepoUrl = repoUrl || finalRepoUrl;

    let normalizedRepoUrl = rawRepoUrl;
    if (normalizedRepoUrl && !normalizedRepoUrl.startsWith('http://') && !normalizedRepoUrl.startsWith('https://')) {
      normalizedRepoUrl = `https://github.com/${normalizedRepoUrl}`;
    }

    const activeRepoUrl = normalizedRepoUrl ? normalizedRepoUrl.trim().replace(/\/$/, '').replace(/\.git$/, '') : undefined;
    // Only used when a NEW repository is created. An existing repository's visibility is never
    // changed from here, except through the explicit confirmation step (confirmMakePublic).
    const effectiveVisibility = repoVisibility;

    if (selectedHost === 'Render') {
      if (!autoCreate && !activeRepoUrl) {
        setNotice({ type: 'error', message: 'GitHub repository is required for Render deployment.' });
        return;
      }
      if (!accessToken) {
        setNotice({ type: 'error', message: 'Please enter your Render API Key.' });
        return;
      }
    } else if (selectedHost === 'Custom') {
      if (!extraFieldValue) {
        setNotice({ type: 'error', message: 'Please enter a deploy webhook URL.' });
        return;
      }
    } else if (!accessToken) {
      setNotice({ type: 'error', message: `Please enter your ${selectedHost} token.` });
      return;
    }

    setDeploying(true);
    setShowRenderModal(false);
    setNotice({
      type: 'info',
      message: `Deploying '${projectName}' to ${selectedHost}...`,
    });

    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          host: selectedHost,
          token: accessToken,
          projectId,
          projectName,
          repoUrl: activeRepoUrl,
          autoCreateRepo: selectedHost === 'Render' && autoCreate,
          repoVisibility: effectiveVisibility,
          confirmMakePublic: opts.confirmMakePublic === true,
          files: codeFiles,
          customDeployUrl: selectedHost === 'Custom' ? extraFieldValue : undefined,
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.code === 'CONFIRM_MAKE_PUBLIC' && typeof data.repo === 'string' && activeRepoUrl) {
        // Nothing was deployed or changed. Ask the person before making their repository public.
        setNotice(null);
        setConfirmPublic({ repo: data.repo, repoUrl: activeRepoUrl });
        setRenderModalMode('confirm-public');
        setShowRenderModal(true);
        return;
      }

      if (res.ok && data.success) {
        const deployedMessage = selectedHost === 'Render'
          ? `Successfully deployed to Render! (Initial build takes ~30s)`
          : `Successfully deployed '${projectName}' to ${selectedHost}!`;
        setNotice({
          type: 'success',
          // Env vars are meant to be invisible when everything went fine — this only ever
          // surfaces the one time something about them didn't (a host with no server to inject
          // into, or the lookup itself failing), appended rather than replacing the good news.
          message: data.warning ? `${deployedMessage} ${data.warning}` : deployedMessage,
          url: data.url,
        });
        if (projectId) saveLastDeploy(projectId, { host: selectedHost, url: data.url, success: true, message: deployedMessage, when: Date.now() });
      } else {
        const message = data.error || `Failed to deploy to ${selectedHost}. Please verify your credentials.`;
        setNotice({ type: 'error', message });
        if (projectId) saveLastDeploy(projectId, { host: selectedHost, success: false, message, when: Date.now() });
      }
    } catch (err: any) {
      const message = `Deployment failed: ${err.message}`;
      setNotice({ type: 'error', message });
      if (projectId) saveLastDeploy(projectId, { host: selectedHost, success: false, message, when: Date.now() });
    } finally {
      setDeploying(false);
    }
  };

  const handleDeployClick = () => {
    if (selectedHost === 'Render' && !repoUrl) {
      setRenderModalMode('choice');
      setShowRenderModal(true);
      return;
    }
    if (selectedHost === 'GitHub Pages' && !repoUrl) {
      if (onRedirectToRepoConfig) {
        onRedirectToRepoConfig();
      } else {
        setNotice({ type: 'error', message: 'GitHub Pages requires a linked GitHub repository — attach one first.' });
      }
      return;
    }
    executeDeployment();
  };

  const fetchUserRepositories = async () => {
    setFetchingRepos(true);
    setNotice(null);
    try {
      if (!hasGithubToken()) {
        setUserRepos([]);
        setNotice({ type: 'error', message: 'No GitHub token saved for this session — sign out and sign in again to grant access.' });
        setFetchingRepos(false);
        return;
      }

      const reposList = await listRepos();
      const formattedRepos = reposList.map((fullName) => ({
        name: fullName.split('/')[1] || fullName,
        full_name: fullName,
        clone_url: `https://github.com/${fullName}`,
      }));

      setUserRepos(formattedRepos);
      if (formattedRepos.length > 0) {
        setSelectedRepoUrl(formattedRepos[0].clone_url);
      }
    } catch (err: any) {
      setUserRepos([]);
      setNotice({
        type: 'error',
        message: err instanceof GhError || err instanceof Error ? err.message : 'Couldn\'t load your repositories.',
      });
    } finally {
      setFetchingRepos(false);
    }
  };

  useEffect(() => {
    if (showRenderModal && (renderModalMode === 'attach' || renderModalMode === 'create')) {
      fetchUserRepositories();
    }
  }, [showRenderModal, renderModalMode]);

  const query = hostSearch.trim().toLowerCase();
  const matchesQuery = (h: HostEvaluation) =>
    !query ||
    h.hostName.toLowerCase().includes(query) ||
    h.category.toLowerCase().includes(query) ||
    h.bestFor.toLowerCase().includes(query);

  const knownHosts = evaluation?.evaluatedHosts || DEFAULT_HOSTS;
  const hostsToDisplay: HostEvaluation[] = [...knownHosts, CUSTOM_HOST].filter(matchesQuery);

  return (
    <div className="bg-[#0e1017] border border-gray-800 rounded-xl p-5 text-gray-200 relative">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Universal Host Deployer
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Evaluate project architecture with AI and ship straight to live cloud providers.
          </p>
        </div>

        <button
          onClick={runHostEvaluation}
          disabled={loading || deploying}
          className="px-3.5 py-2 text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-lg shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          {loading ? 'Analyzing Codebase...' : '✨ AI Host Matchmaker'}
        </button>
      </div>

      {/* AI Evaluation Summary Card */}
      {evaluation && (
        <div className="mt-4 p-4 rounded-lg bg-indigo-950/30 border border-indigo-800/50 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-indigo-300 bg-indigo-900/60 px-2.5 py-1 rounded-md">
              Framework: {evaluation.projectSummary.framework}
            </span>
            <span className="text-xs text-emerald-400 font-medium">
              Top Pick: {evaluation.topRecommendation.hostName} ({evaluation.topRecommendation.deploymentDifficulty})
            </span>
          </div>

          <p className="text-xs text-indigo-200/90 leading-relaxed">
            {evaluation.topRecommendation.whySelected}
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {evaluation.projectSummary.detectedServices.map((svc, i) => (
              <span key={i} className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
                {svc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Host Search */}
      <div className="mt-4">
        <input
          type="text"
          value={hostSearch}
          onChange={(e) => setHostSearch(e.target.value)}
          placeholder="Search hosts by name, category, or use case…"
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 text-white placeholder-gray-600"
        />
      </div>

      {/* Host Option Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        {hostsToDisplay.length === 0 && (
          <p className="sm:col-span-2 text-xs text-gray-500 py-2">
            No hosts match "{hostSearch}". Try a different search, or use Custom to deploy via your own webhook.
          </p>
        )}
        {hostsToDisplay.map((host) => {
          const isSelected = selectedHost === host.hostName;
          const isAIRecommended = evaluation?.topRecommendation.hostName === host.hostName;
          const isCustom = host.hostName === 'Custom';

          return (
            <div
              key={host.hostName}
              onClick={() => {
                setSelectedHost(host.hostName);
                setAccessToken('');
                setExtraFieldValue('');
                setNotice(null);
              }}
              className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all relative ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-950/30 ring-1 ring-indigo-500'
                  : isCustom
                  ? 'border-dashed border-gray-700 bg-gray-900/30 hover:border-gray-600'
                  : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
              }`}
            >
              {isAIRecommended && (
                <span className="absolute -top-2 -right-1 bg-gradient-to-r from-amber-500 to-orange-500 text-[10px] font-bold text-black px-2 py-0.5 rounded-full shadow">
                  AI Choice
                </span>
              )}
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-white">{host.hostName}</span>
                <span className="text-xs text-indigo-400 font-mono">
                  {isCustom ? 'Bring your own' : `${host.fitScore}% Match`}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{host.bestFor}</p>
              <div className="mt-2 text-[10px] text-gray-500 font-mono">
                {host.category} • {host.estimatedCost}
              </div>
            </div>
          );
        })}
      </div>

      {/* Environment variables — available as soon as a project is open, whether or not a host
          evaluation has run yet; detected keys (if any) are merged in and flagged as missing
          until someone sets a value for them. */}
      {projectId && (() => {
        const detectedKeys = evaluation?.requiredEnvVars ?? [];
        const extraConfiguredKeys = (envVars ?? []).map((v) => v.key).filter((k) => !detectedKeys.includes(k));
        const allKeys = [...detectedKeys, ...extraConfiguredKeys];

        return (
          <div className="mt-4 p-3 rounded-lg bg-gray-900/40 border border-gray-800 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-200">Environment Variables</span>
              {envLoading && <span className="animate-spin text-sm">🔄</span>}
            </div>
            <p className="mt-1 text-gray-500">
              Stored encrypted on the server. Values are write-only — once saved, they&apos;re never shown again, only replaced or removed.
            </p>

            {envError && (
              <p className="mt-2 p-2 rounded bg-red-950/30 border border-red-900/40 text-red-300">{envError}</p>
            )}

            {allKeys.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-800/60">
                {allKeys.map((key) => {
                  const configured = configuredEnvKeys.has(key);
                  const detected = detectedKeys.includes(key);
                  const isEditing = editingEnvKey === key;
                  const busy = savingEnvKey === key;
                  return (
                    <li key={key} className="py-1.5 flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono text-[11px] flex items-center gap-1.5 text-gray-300">
                        <span>{configured ? '✅' : detected ? '⚠️' : '➕'}</span>
                        {key}
                      </span>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <SecretInput
                            value={editingEnvValue}
                            onChange={setEditingEnvValue}
                            placeholder="value"
                            label="value"
                            wrapperClassName="w-40"
                            inputClassName="px-2 py-1 rounded bg-black/60 border border-gray-700 text-white text-[11px] font-mono focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            onClick={() => saveEnvVar(key, editingEnvValue)}
                            disabled={busy || !editingEnvValue.trim()}
                            className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-medium"
                          >
                            {busy ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingEnvKey(null); setEditingEnvValue(''); }}
                            className="px-2 py-1 rounded border border-gray-700 text-gray-400 hover:bg-gray-800 text-[11px]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-600">{configured ? '••••••••' : 'not set'}</span>
                          <button
                            onClick={() => { setEditingEnvKey(key); setEditingEnvValue(''); }}
                            className="px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 text-[11px]"
                          >
                            {configured ? 'Update' : 'Set'}
                          </button>
                          {configured && (
                            <button
                              onClick={() => removeEnvVar(key)}
                              disabled={busy}
                              className="px-2 py-1 rounded border border-red-900/50 text-red-400 hover:bg-red-950/30 disabled:opacity-40 text-[11px]"
                            >
                              {busy ? '…' : 'Remove'}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-2.5 pt-2.5 border-t border-gray-800 flex flex-wrap items-center gap-1.5">
              <input
                value={newEnvKey}
                onChange={(e) => setNewEnvKey(e.target.value.toUpperCase())}
                placeholder="MY_CUSTOM_KEY"
                className="w-40 px-2 py-1 rounded bg-black/60 border border-gray-700 text-gray-200 text-[11px] font-mono focus:outline-none focus:border-indigo-500"
              />
              <SecretInput
                value={newEnvValue}
                onChange={setNewEnvValue}
                placeholder="value"
                label="value"
                wrapperClassName="w-40"
                inputClassName="px-2 py-1 rounded bg-black/60 border border-gray-700 text-white text-[11px] font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => saveEnvVar(newEnvKey, newEnvValue)}
                disabled={!newEnvKey.trim() || !newEnvValue.trim() || savingEnvKey === newEnvKey.trim()}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-medium"
              >
                Add
              </button>
            </div>
          </div>
        );
      })()}

      {/* Deployment & Token Input Section */}
      <div className="mt-5 pt-4 border-t border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-300">
            Deploying to <span className="text-indigo-400 font-bold">{selectedHost}</span>
          </label>
          {activeGuide.tokenUrl && (
            <a
              href={activeGuide.tokenUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline flex items-center gap-1"
            >
              Get {selectedHost} Token ↗
            </a>
          )}
        </div>

        {selectedHost === 'Custom' ? (
          <div className="mb-3 p-3 rounded-lg bg-gray-900/80 border border-gray-800 text-xs text-gray-400">
            <p className="font-medium text-gray-300 mb-1">Bring your own deploy target</p>
            <p>
              Paste any HTTPS endpoint your own pipeline exposes below. We'll POST your project's files as JSON to
              that URL, with your token sent as <code className="text-gray-300">Authorization: Bearer &lt;token&gt;</code>{' '}
              if you provide one — the token field is optional here.
            </p>
          </div>
        ) : (
          <div className="mb-3 p-3 rounded-lg bg-gray-900/80 border border-gray-800 text-xs text-gray-400">
            <p className="font-medium text-gray-300 mb-1">Quick steps to get your token:</p>
            <ol className="list-decimal list-inside space-y-1">
              {activeGuide.steps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {notice && (
          <div
            className={`mb-3 p-3 rounded-lg text-xs border flex items-center justify-between gap-2 transition-all ${
              notice.type === 'info'
                ? 'bg-indigo-950/50 border-indigo-800/60 text-indigo-200'
                : notice.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-200'
                : 'bg-rose-950/50 border-rose-800/60 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.type === 'info' && <span className="animate-spin text-sm">🔄</span>}
              {notice.type === 'success' && <span className="text-sm">✅</span>}
              {notice.type === 'error' && <span className="text-sm">⚠️</span>}
              <span>{notice.message}</span>
              {notice.url && (
                <a
                  href={notice.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline hover:opacity-80 ml-1"
                >
                  View Deployment ↗
                </a>
              )}
            </div>
            <button
              onClick={() => setNotice(null)}
              className="text-gray-400 hover:text-white text-sm leading-none"
            >
              ×
            </button>
          </div>
        )}

        {activeGuide.extraField && (
          <div className="mb-2">
            <label className="block text-[11px] font-medium text-gray-400 mb-1">{activeGuide.extraField.label}</label>
            <input
              type="text"
              placeholder={activeGuide.extraField.placeholder}
              value={extraFieldValue}
              onChange={(e) => setExtraFieldValue(e.target.value)}
              disabled={deploying}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50 text-white"
            />
          </div>
        )}

        <div className="flex gap-2">
          <SecretInput
            placeholder={
              selectedHost === 'Custom' ? 'Auth token (optional)...' : `Enter your ${selectedHost} token...`
            }
            value={accessToken}
            onChange={setAccessToken}
            disabled={deploying}
            label="token"
            wrapperClassName="flex-1 min-w-0"
            inputClassName="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50 text-white"
          />
          <button
            onClick={handleDeployClick}
            disabled={deploying}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0"
          >
            {deploying ? 'Deploying...' : selectedHost === 'Custom' ? 'Deploy via Webhook' : `Deploy to ${selectedHost}`}
          </button>
        </div>
      </div>

      {/* Render Specific Repository Selection Modal */}
      {showRenderModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#12151f] border border-gray-800 rounded-xl max-w-md w-full p-6 text-gray-200 shadow-2xl">
            <h3 className="text-base font-semibold text-white mb-1">
              {renderModalMode === 'confirm-public' ? 'Confirm repository visibility' : 'GitHub Repository Required'}
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              {renderModalMode === 'confirm-public'
                ? 'Nothing has been deployed or changed yet.'
                : 'Render requires a linked GitHub repository. How would you like to connect?'}
            </p>

            {renderModalMode === 'choice' && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setRenderModalMode('attach')}
                  className="p-4 rounded-xl border border-gray-800 bg-gray-900/60 hover:border-indigo-500 hover:bg-indigo-950/20 text-left transition-all group"
                >
                  <div className="text-sm font-medium text-white group-hover:text-indigo-400 mb-1">🔗 Attach</div>
                  <p className="text-[11px] text-gray-400">Select an existing repository from your GitHub account.</p>
                </button>
                <button
                  onClick={() => setRenderModalMode('create')}
                  className="p-4 rounded-xl border border-gray-800 bg-gray-900/60 hover:border-indigo-500 hover:bg-indigo-950/20 text-left transition-all group"
                >
                  <div className="text-sm font-medium text-white group-hover:text-indigo-400 mb-1">✨ Create</div>
                  <p className="text-[11px] text-gray-400">Automatically generate a new repo and proceed to deploy.</p>
                </button>
              </div>
            )}

            {renderModalMode === 'attach' && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-300">
                  <p className="font-medium text-white mb-1">🔗 Attach an existing repository</p>
                  <p className="text-gray-400">
                    Render has to be able to read the repository. If the one you pick is{' '}
                    <span className="text-amber-400 font-medium">private</span>, you&apos;ll be asked to confirm before it
                    is made public — nothing about its visibility changes until you do.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1.5">Use existing repository</label>
                  {fetchingRepos ? (
                    <div className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-xs text-gray-400 flex items-center gap-2">
                      <span className="animate-spin text-sm">🔄</span> Loading your repositories...
                    </div>
                  ) : (
                    <select
                      value={selectedRepoUrl}
                      onChange={(e) => setSelectedRepoUrl(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                    >
                      {userRepos.length === 0 ? (
                        <option value="">No repositories found</option>
                      ) : (
                        userRepos.map((repo) => (
                          <option key={repo.clone_url} value={repo.clone_url}>
                            {repo.full_name || repo.name}
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setRenderModalMode('choice')}
                    className="px-3.5 py-2 text-xs font-medium text-gray-400 hover:text-white transition-all"
                  >
                    Back
                  </button>
                  {userRepos.length > 0 && (
                    <button
                      onClick={() => executeDeployment(selectedRepoUrl, false)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-all"
                    >
                      Attach & Deploy
                    </button>
                  )}
                </div>
              </div>
            )}

            {renderModalMode === 'confirm-public' && confirmPublic && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-700/50 text-xs text-amber-100">
                  <p className="font-medium text-amber-300 mb-1">⚠️ Make {confirmPublic.repo} public?</p>
                  <p className="text-amber-100/80 leading-relaxed">
                    This repository is private, and Render can only deploy a repository it can read. Making it public means
                    anyone on the internet can read all of its code and its full history. Check there are no passwords or
                    keys in it first. You can make it private again from the Repository page afterwards.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setConfirmPublic(null);
                      setShowRenderModal(false);
                      setNotice({ type: 'info', message: 'Deployment cancelled. The repository was left private.' });
                    }}
                    className="px-3.5 py-2 text-xs font-medium text-gray-400 hover:text-white transition-all"
                  >
                    Keep it private
                  </button>
                  <button
                    onClick={() => executeDeployment(confirmPublic.repoUrl, false, { confirmMakePublic: true })}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium transition-all"
                  >
                    Make public &amp; deploy
                  </button>
                </div>
              </div>
            )}

            {renderModalMode === 'create' && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-300">
                  <p className="font-medium text-white mb-1">✨ Automatic Repository Creation</p>
                  <p className="text-gray-400">
                    A new repository named <span className="font-mono text-indigo-400">{projectName}</span> will be created automatically under your connected GitHub account.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-lg border border-gray-800">
                    <button
                      type="button"
                      onClick={() => setRepoVisibility('public')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                        repoVisibility === 'public'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepoVisibility('private')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                        repoVisibility === 'private'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Private
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setRenderModalMode('choice')}
                      className="px-3.5 py-2 text-xs font-medium text-gray-400 hover:text-white transition-all"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => executeDeployment(undefined, true)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-all"
                    >
                      Create & Deploy
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 pt-3 border-t border-gray-800/80 flex justify-end">
              <button
                onClick={() => setShowRenderModal(false)}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}