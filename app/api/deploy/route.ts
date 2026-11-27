import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createBLAKE3 } from 'hash-wasm';
import { supabaseForRequest } from '../_shared/supabaseForRequest';
import { decryptValue, envVarAad } from '../env/crypto';
import { findGithubAccessTokenForUser } from '../_shared/githubConnections';
import { safeError } from '../_shared/safeError';
import { limitByIp, limitByUser } from '../_shared/limits';
import { postToPublicHttps, WebhookUrlError } from '../_shared/safeFetch';

// ---------------------------------------------------------------------------
// Pulls this project's env vars (set via the Deploy tab's Environment Variables panel —
// see app/api/env) and decrypts them in-memory, right here, right before they're sent to
// whichever host is being deployed to. Never logged, never included in any response — only
// ever used to build that host's own API request below. Automatic and silent by design: a
// beginner shouldn't have to re-paste their env vars into every host's own dashboard by hand.
//
// Scoped by RLS to whatever the deploying user (their own access token, forwarded from the
// client) is allowed to see — same mechanism as app/api/env/route.ts, so this can't be used to
// read another project's secrets. If projectId is missing, or the fetch fails for any reason,
// this returns an empty map plus a warning rather than failing the whole deploy — a project with
// no configured env vars is the common case, not an error.
async function fetchProjectEnvVars(req: Request, projectId: string | undefined): Promise<{ envVars: Record<string, string>; warning?: string }> {
  if (!projectId) return { envVars: {} };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
    return { envVars: {}, warning: "That project ID isn't valid — deployed without environment variables." };
  }

  try {
    const supabase = supabaseForRequest(req);
    const { data, error } = await supabase
      .from('project_env_vars')
      .select('key, encrypted_value')
      .eq('project_id', projectId);

    if (error) {
      console.error('[deploy.envVars] load failed:', error.message);
      return { envVars: {}, warning: "Couldn't load this project's environment variables — deployed without them." };
    }
    if (!data || data.length === 0) return { envVars: {} };

    const envVars: Record<string, string> = {};
    let skipped = 0;
    for (const row of data as Array<{ key: string; encrypted_value: string }>) {
      try {
        envVars[row.key] = decryptValue(row.encrypted_value, envVarAad(projectId, row.key));
      } catch {
        // One corrupt/undecryptable row shouldn't take every other variable down with it.
        skipped++;
      }
    }
    return skipped > 0
      ? { envVars, warning: `${skipped} environment variable(s) couldn't be read and were skipped. Re-enter them in the Environment Variables panel.` }
      : { envVars };
  } catch (e: any) {
    console.error('[deploy.envVars] unexpected:', e?.message);
    return { envVars: {}, warning: "Couldn't load this project's environment variables — deployed without them." };
  }
}

function sanitizeName(name: string): string {
  return (name || 'my-app')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{3,}/g, '--')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'my-app';
}

function generateUniqueName(baseName: string): string {
  const clean = sanitizeName(baseName);
  // Not a secret, but there is no reason to use a weak PRNG for anything that ends up public.
  const hash = crypto.randomBytes(4).toString('hex');
  return `${clean}-${hash}`;
}

function calculateSha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

// Cloudflare Pages' Direct Upload asset key is NOT sha256/md5 of the raw bytes — it's
// blake3(base64(content) + fileExtension), hex-encoded, first 32 chars (128 bits). This
// matches wrangler's own hashFile() exactly. Getting this wrong doesn't produce an error;
// the deploy "succeeds" and every asset silently 404s forever, so it has to be exact.
async function cloudflarePagesAssetHash(content: Buffer, extension: string): Promise<string> {
  const base64Content = content.toString('base64');
  const hasher = await createBLAKE3();
  hasher.update(base64Content + extension);
  return hasher.digest('hex').slice(0, 32);
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  webmanifest: 'application/manifest+json',
};

function guessContentType(path: string): string {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// ---- Input limits ----------------------------------------------------------------------------
// Bound everything the client sends BEFORE it is used to build URLs or loop sequential requests.
const MAX_DEPLOY_FILES = 500;
const MAX_DEPLOY_PATH_CHARS = 300;
const MAX_DEPLOY_FILE_CHARS = 1_500_000;
const MAX_DEPLOY_TOTAL_CHARS = 4_000_000;
const SAFE_GH_NAME = /^[A-Za-z0-9._-]+$/;

/** Strictly parses a github.com repository URL into { owner, repo }. The host is compared as a whole
 *  (so `evil.com/github.com/a/b` and `github.com.evil.com/a/b` do NOT match), and the path must be
 *  exactly /owner/name. Anything else returns null. */
function parseGithubRepoUrl(raw: string): { owner: string; repo: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || (host !== 'github.com' && host !== 'www.github.com')) return null;
  if (u.username || u.password || u.port || u.search || u.hash) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!SAFE_GH_NAME.test(owner) || !SAFE_GH_NAME.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  return { owner, repo };
}

// A file path must be a plain relative path: no "..", no empty segments, no backslashes, and no
// "?" or "#" (which would change what URL a host-API call ends up pointing at).
function isSafeDeployPath(p: string): boolean {
  if (p.length === 0 || p.length > MAX_DEPLOY_PATH_CHARS) return false;
  if (/[\u0000-\u001f\u007f\\?#]/.test(p)) return false;
  return p.replace(/^\//, '').split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

function validateDeployFiles(raw: unknown): { ok: true; files: Record<string, string> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, files: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'files must be an object of path → content.' };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_DEPLOY_FILES) return { ok: false, error: `Too many files (max ${MAX_DEPLOY_FILES}).` };
  const files: Record<string, string> = Object.create(null);
  let total = 0;
  for (const [path, value] of entries) {
    if (!isSafeDeployPath(path)) return { ok: false, error: `Invalid file path: ${path.slice(0, 80)}` };
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof content !== 'string') return { ok: false, error: `Invalid content for ${path.slice(0, 80)}.` };
    if (content.length > MAX_DEPLOY_FILE_CHARS) return { ok: false, error: `${path.slice(0, 80)} is too large to deploy.` };
    total += content.length;
    if (total > MAX_DEPLOY_TOTAL_CHARS) return { ok: false, error: 'The project is too large to deploy.' };
    files[path] = content;
  }
  return { ok: true, files };
}

// Encode each path segment separately so "src/app/page.tsx" stays a real path while spaces and
// other special characters can't alter the URL.
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function POST(req: Request) {
  try {
    // Deploying is a signed-in action (HostDeployer sends the bearer token). Without this check,
    // anyone on the internet could use this route as a server-side HTTP client (the Custom
    // webhook branch) or to push files to hosts.
    const limitedIp = await limitByIp(req, 'deploy', 40);
    if (limitedIp) return limitedIp;

    const { data: { user: authedUser } } = await supabaseForRequest(req).auth.getUser();
    if (!authedUser) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    const limitedUser = await limitByUser(authedUser.id, 'deploy', 20);
    if (limitedUser) return limitedUser;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }
    const host = typeof body.host === 'string' ? body.host : '';
    const token = typeof body.token === 'string' ? body.token.trim().slice(0, 4096) : '';
    const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : undefined;
    const projectName = typeof body.projectName === 'string' ? body.projectName.slice(0, 200) : '';
    const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim().slice(0, 300) : '';
    const autoCreateRepo = Boolean(body.autoCreateRepo);
    const repoVisibility = typeof body.repoVisibility === 'string' ? body.repoVisibility : '';
    // Explicit consent to make an EXISTING private repository public (Render needs to read it). Never
    // implied by anything else in the request; see the Render branch below.
    const confirmMakePublic = body.confirmMakePublic === true;
    const cloudflareAccountId = typeof body.cloudflareAccountId === 'string' ? body.cloudflareAccountId.trim() : '';
    const customDeployUrl = typeof body.customDeployUrl === 'string' ? body.customDeployUrl.trim().slice(0, 2048) : '';
    if (cloudflareAccountId && !/^[a-f0-9]{32}$/i.test(cloudflareAccountId)) {
      return NextResponse.json({ error: "That Cloudflare account ID doesn't look valid." }, { status: 400 });
    }
    const filesCheck = validateDeployFiles(body.files);
    if (!filesCheck.ok) return NextResponse.json({ error: filesCheck.error }, { status: 400 });
    const files = filesCheck.files;

    // The GitHub token (only Render's auto-create-repo / visibility update needs it) comes from the
    // server-side github_connections vault. It is never accepted from the browser.
    let githubToken = '';
    if (host === 'Render') {
      try {
        githubToken = (await findGithubAccessTokenForUser(authedUser.id)) ?? '';
      } catch {
        // No token — the Render branch below reports it.
      }
    }

    if (!token && host !== 'Render' && host !== 'Custom') {
      return NextResponse.json({ error: 'Missing access token.' }, { status: 400 });
    }

    const cleanProjectName = sanitizeName(projectName);
    const uniqueProjectName = generateUniqueName(projectName);
    // Only an explicit 'public' creates a public repository. A missing or unrecognised value means
    // private, so a client that forgets the field can never publish someone's code by accident.
    const isPrivate = repoVisibility !== 'public';
    const { envVars, warning: envVarsWarning } = await fetchProjectEnvVars(req, projectId);
    const hasEnvVars = Object.keys(envVars).length > 0;

    // 1. VERCEL DEPLOYMENT
    if (host === 'Vercel') {
      const vercelFiles = Object.entries(files || {}).map(([file, data]) => ({
        file,
        data: typeof data === 'string' ? data : JSON.stringify(data),
      }));

      const res = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: cleanProjectName,
          files: vercelFiles,
          projectSettings: { framework: null },
          // Vercel's v13 deployment-create API takes plain env vars directly on the request —
          // scoped to this one deployment, no separate "set project env vars" call needed.
          ...(hasEnvVars ? { env: envVars } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: data.error?.message || 'Vercel deployment failed.' },
          { status: res.status }
        );
      }

      return NextResponse.json({ success: true, url: `https://${data.url}`, ...(envVarsWarning ? { warning: envVarsWarning } : {}) });
    }

    // 2. NETLIFY DEPLOYMENT
    if (host === 'Netlify') {
      const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: uniqueProjectName }),
      });

      const siteData = await siteRes.json();
      if (!siteRes.ok) {
        return NextResponse.json(
          { error: siteData.message || 'Netlify site creation failed. Check your token.' },
          { status: siteRes.status }
        );
      }

      if (hasEnvVars) {
        // Sets build-time env vars on the site itself (build_settings.env). This project's
        // deploys are static-file uploads rather than Netlify-run builds, so these mainly matter
        // if the person's own code reads them at request time via a Netlify Function later —
        // still worth setting so they're already there rather than something to configure by hand.
        await fetch(`https://api.netlify.com/api/v1/sites/${siteData.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ build_settings: { env: envVars } }),
        });
      }

      const sha1Manifest: Record<string, string> = {};
      const fileContents: Record<string, string> = {};

      Object.entries(files || {}).forEach(([filePath, content]) => {
        const formattedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
        const strContent = typeof content === 'string' ? content : JSON.stringify(content);
        
        const hash = calculateSha1(strContent);
        sha1Manifest[formattedPath] = hash;
        fileContents[formattedPath] = strContent;
      });

      const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteData.id}/deploys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: sha1Manifest }),
      });

      const deployData = await deployRes.json();
      if (!deployRes.ok) {
        return NextResponse.json(
          { error: deployData.message || 'Netlify deploy initialization failed.' },
          { status: deployRes.status }
        );
      }

      const requiredHashes = new Set(deployData.required || []);
      
      for (const [path, content] of Object.entries(fileContents)) {
        const hash = sha1Manifest[path];
        if (requiredHashes.has(hash)) {
          const uploadPath = path.startsWith('/') ? path.slice(1) : path;
          await fetch(`https://api.netlify.com/api/v1/deploys/${deployData.id}/files/${encodePath(uploadPath)}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
            },
            body: content,
          });
        }
      }

      const finalUrl = deployData.ssl_url || deployData.url || siteData.ssl_url || siteData.url;
      return NextResponse.json({ success: true, url: finalUrl, ...(envVarsWarning ? { warning: envVarsWarning } : {}) });
    }

    // 3. GITHUB PAGES DEPLOYMENT
    if (host === 'GitHub Pages') {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'UniversalHostDeployer',
      };

      const userRes = await fetch('https://api.github.com/user', { headers });
      const userData = await userRes.json();
      if (!userRes.ok) {
        return NextResponse.json(
          { error: 'Invalid GitHub token or missing `repo` / `workflow` scopes.' },
          { status: userRes.status }
        );
      }
      const username = userData.login;

      const repoRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: uniqueProjectName,
          auto_init: true,
          private: isPrivate,
          description: 'Deployed via Universal Host Deployer',
        }),
      });
      const repoData = await repoRes.json();
      if (!repoRes.ok) {
        return NextResponse.json(
          { error: repoData.message || 'Failed to create GitHub repository.' },
          { status: repoRes.status }
        );
      }

      for (const [path, content] of Object.entries(files || {})) {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const encodedContent = Buffer.from(
          typeof content === 'string' ? content : JSON.stringify(content)
        ).toString('base64');

        await fetch(`https://api.github.com/repos/${username}/${uniqueProjectName}/contents/${encodePath(cleanPath)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `Deploying ${cleanPath}`,
            content: encodedContent,
          }),
        });
      }

      await fetch(`https://api.github.com/repos/${username}/${uniqueProjectName}/pages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
      });

      return NextResponse.json({
        success: true,
        url: `https://${username}.github.io/${uniqueProjectName}/`,
        ...(hasEnvVars
          ? { warning: "GitHub Pages serves static files only, so this project's environment variables weren't applied — there's no server to inject them into." }
          : {}),
        ...(envVarsWarning ? { warning: envVarsWarning } : {}),
      });
    }

    // 4. RENDER DEPLOYMENT
    if (host === 'Render') {
      let finalRepoUrl = repoUrl;

      if (finalRepoUrl && !finalRepoUrl.startsWith('http://') && !finalRepoUrl.startsWith('https://')) {
        finalRepoUrl = `https://github.com/${finalRepoUrl}`;
      }

      if (finalRepoUrl) {
        finalRepoUrl = finalRepoUrl.trim().replace(/\/$/, '').replace(/\.git$/, '');
      }

      const ghHeaders = {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'UniversalHostDeployer',
      };

      if (autoCreateRepo) {
        if (!githubToken) {
          return NextResponse.json(
            { error: "GitHub isn't connected for this account, so a repository can't be created automatically. Sign out and sign in with GitHub, then try again." },
            { status: 400 }
          );
        }

        const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
        const userData = await userRes.json();
        if (!userRes.ok) {
          return NextResponse.json(
            { error: 'Invalid GitHub token provided for automatic repository creation.' },
            { status: userRes.status }
          );
        }
        const username = userData.login;
        const autoRepoName = uniqueProjectName;

        const repoRes = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            name: autoRepoName,
            auto_init: true,
            private: isPrivate,
            description: 'Auto-created repository for Render deployment',
          }),
        });
        const repoData = await repoRes.json();
        if (!repoRes.ok) {
          return NextResponse.json(
            { error: repoData.message || 'Failed to create GitHub repository for Render.' },
            { status: repoRes.status }
          );
        }

        for (const [path, content] of Object.entries(files || {})) {
          const cleanPath = path.startsWith('/') ? path.slice(1) : path;
          const encodedContent = Buffer.from(
            typeof content === 'string' ? content : JSON.stringify(content)
          ).toString('base64');

          await fetch(`https://api.github.com/repos/${username}/${autoRepoName}/contents/${encodePath(cleanPath)}`, {
            method: 'PUT',
            headers: ghHeaders,
            body: JSON.stringify({
              message: `Add ${cleanPath} for Render`,
              content: encodedContent,
            }),
          });
        }

        finalRepoUrl = (repoData.clone_url || repoData.html_url || '').trim().replace(/\/$/, '').replace(/\.git$/, '');
      } else if (finalRepoUrl) {
        // An existing repository. Parse the URL strictly (host compared as a whole, path exactly
        // /owner/name) so the string that reaches Render and the repo we look at on GitHub are
        // always the same, canonical github.com repository.
        const parsed = parseGithubRepoUrl(finalRepoUrl);
        if (!parsed) {
          return NextResponse.json(
            { error: 'Enter the repository as a GitHub URL like https://github.com/owner/name.' },
            { status: 400 }
          );
        }
        const { owner, repo: repoName } = parsed;
        const fullName = `${owner}/${repoName}`;
        finalRepoUrl = `https://github.com/${fullName}`;

        // Render can only build a repository it can read, so a private one has to be made public.
        // That is a big, hard-to-notice change to someone's code, so it only happens when the person
        // has explicitly confirmed it for THIS repository (confirmMakePublic). Without that, a
        // private repo stops the deploy with a 409 the UI turns into a confirmation step. Nothing
        // is ever made private here, and a repo that is already public is left untouched.
        if (githubToken) {
          const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers: ghHeaders });
          if (!repoRes.ok) {
            return NextResponse.json(
              { error: `Couldn't read ${fullName} with your connected GitHub account. Check the name, and that your account can access it.` },
              { status: 400 }
            );
          }
          const repoInfo = await repoRes.json().catch(() => null);

          if (repoInfo?.private === true) {
            if (!confirmMakePublic) {
              return NextResponse.json(
                {
                  error: `${fullName} is private. Render needs to read it, which means making it public.`,
                  code: 'CONFIRM_MAKE_PUBLIC',
                  repo: fullName,
                },
                { status: 409 }
              );
            }

            const patchRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
              method: 'PATCH',
              headers: {
                ...ghHeaders,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ private: false }),
            });
            // The result matters: if GitHub refused (no admin rights, an organization policy), say so
            // instead of carrying on and letting Render fail later with a confusing message.
            if (!patchRes.ok) {
              console.error('[deploy.render] making repo public failed:', patchRes.status);
              return NextResponse.json(
                { error: `Couldn't make ${fullName} public. You need admin access to the repository, and your organization must allow public repositories.` },
                { status: 400 }
              );
            }
          }
        }
      }

      if (!finalRepoUrl) {
        return NextResponse.json(
          { error: 'Render requires a GitHub repository URL. Please attach your repo or choose automatic creation.' },
          { status: 400 }
        );
      }

      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };

      const ownerRes = await fetch('https://api.render.com/v1/owners', { headers });
      const ownerData = await ownerRes.json();

      if (!ownerRes.ok || !ownerData.length) {
        return NextResponse.json(
          { error: 'Render authorization failed. Please check your Render API Key.' },
          { status: 401 }
        );
      }

      const ownerId = ownerData[0].owner.id;

      // Dynamic build configuration for Render
      const hasPackageJson = files && Object.keys(files).some((f) => f.endsWith('package.json'));
      const buildCommand = hasPackageJson ? 'npm install && npm run build' : '';
      const publishPath = hasPackageJson ? 'dist' : '.';

      const serviceRes = await fetch('https://api.render.com/v1/services', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'static_site',
          name: uniqueProjectName,
          ownerId,
          repo: finalRepoUrl,
          autoDeploy: 'yes',
          serviceDetails: {
            buildCommand,
            publishPath,
          },
          // A static_site has no running process, so these only reach code that runs at build
          // time (e.g. a React build reading process.env.* before publishPath gets served) —
          // still worth setting automatically rather than asking a beginner to paste them into
          // Render's own dashboard by hand.
          ...(hasEnvVars ? { envVars: Object.entries(envVars).map(([key, value]) => ({ key, value })) } : {}),
        }),
      });

      const serviceData = await serviceRes.json();
      if (!serviceRes.ok) {
        const apiMessage = serviceData.message || '';
        return NextResponse.json(
          {
            error: `Render service creation failed: ${apiMessage}. Note: Render requires the GitHub repository to be public. Please ensure your repository visibility is set to Public.`,
          },
          { status: serviceRes.status }
        );
      }

      return NextResponse.json({
        success: true,
        url: serviceData.service?.serviceDetails?.url || serviceData.service?.url || `https://${uniqueProjectName}.onrender.com`,
        ...(envVarsWarning ? { warning: envVarsWarning } : {}),
      });
    }

    // 5. CLOUDFLARE PAGES DEPLOYMENT (Direct Upload API)
    if (host === 'Cloudflare Pages') {
      const cfHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      // Resolve the account ID from the token itself rather than asking the user for it.
      // Confirmed by testing: a "Cloudflare Pages: Edit"-only token cannot list accounts —
      // GET /client/v4/accounts needs "Account Settings: Read" (or Write) on the token too.
      // A caller-supplied cloudflareAccountId (if present) still wins, so this stays
      // backward-compatible with anything that already passes one.
      let accountId = (cloudflareAccountId || '').trim();
      if (!accountId) {
        const acctRes = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: cfHeaders });
        const acctData = await acctRes.json();
        if (!acctRes.ok || !Array.isArray(acctData.result) || acctData.result.length === 0) {
          return NextResponse.json(
            {
              error:
                acctData.errors?.[0]?.message ||
                'Could not determine a Cloudflare account for this token. Make sure it has both "Cloudflare Pages: Edit" and "Account Settings: Read" permissions.',
            },
            { status: acctRes.status || 400 }
          );
        }
        if (acctData.result.length > 1) {
          return NextResponse.json(
            {
              error: `This token can see ${acctData.result.length} Cloudflare accounts (${acctData.result.map((a: any) => a.name).join(', ')}). Pass cloudflareAccountId to pick one.`,
              accounts: acctData.result.map((a: any) => ({ id: a.id, name: a.name })),
            },
            { status: 400 }
          );
        }
        accountId = acctData.result[0].id;
      }

      // Create the project. The generated name is unique per deploy, so a genuine
      // collision is unlikely — but tolerate an "already exists" response just in case.
      const cfEnvVars = hasEnvVars
        ? Object.fromEntries(Object.entries(envVars).map(([key, value]) => [key, { value }]))
        : undefined;

      const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({
          name: uniqueProjectName,
          production_branch: 'main',
          // This app doesn't distinguish preview vs. production env vars, so the same values go
          // to both — simpler and more predictable for a beginner than a split they didn't ask for.
          ...(cfEnvVars ? { deployment_configs: { production: { env_vars: cfEnvVars }, preview: { env_vars: cfEnvVars } } } : {}),
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok && !/already exists/i.test(JSON.stringify(createData.errors || ''))) {
        return NextResponse.json(
          { error: createData.errors?.[0]?.message || 'Failed to create the Cloudflare Pages project. Check the Account ID and that your token has the "Cloudflare Pages — Edit" permission.' },
          { status: createRes.status }
        );
      }

      // Short-lived upload JWT — everything after this uses the JWT, not the API token.
      const tokenRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${uniqueProjectName}/upload-token`,
        { headers: cfHeaders }
      );
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.result?.jwt) {
        return NextResponse.json(
          { error: tokenData.errors?.[0]?.message || 'Failed to obtain a Cloudflare Pages upload token.' },
          { status: tokenRes.status || 500 }
        );
      }
      const uploadJwt: string = tokenData.result.jwt;

      const manifest: Record<string, string> = {};
      const uploadBatch: Array<{ key: string; value: string; metadata: { contentType: string }; base64: true }> = [];

      for (const [rawPath, rawContent] of Object.entries(files || {})) {
        const cleanPath = '/' + (rawPath.startsWith('/') ? rawPath.slice(1) : rawPath);
        const strContent = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        const buf = Buffer.from(strContent, 'utf-8');
        const ext = cleanPath.includes('.') ? cleanPath.slice(cleanPath.lastIndexOf('.') + 1) : '';
        const hash = await cloudflarePagesAssetHash(buf, ext);

        manifest[cleanPath] = hash;
        uploadBatch.push({
          key: hash,
          value: buf.toString('base64'),
          metadata: { contentType: guessContentType(cleanPath) },
          base64: true,
        });
      }

      if (uploadBatch.length > 0) {
        // NOTE: Cloudflare caps a single upload request at 2,000 files / 40MB — fine for the
        // small text-file projects this app deals with, but would need batching for larger ones.
        const uploadRes = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${uploadJwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(uploadBatch),
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          return NextResponse.json(
            { error: uploadData.errors?.[0]?.message || 'Failed to upload assets to Cloudflare Pages.' },
            { status: uploadRes.status }
          );
        }

        const upsertRes = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes', {
          method: 'POST',
          headers: { Authorization: `Bearer ${uploadJwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes: uploadBatch.map((a) => a.key) }),
        });
        if (!upsertRes.ok) {
          const upsertData = await upsertRes.json().catch(() => ({}));
          return NextResponse.json(
            { error: upsertData.errors?.[0]?.message || 'Failed to register uploaded assets with Cloudflare Pages.' },
            { status: upsertRes.status }
          );
        }
      }

      const deployForm = new FormData();
      deployForm.append('branch', 'main');
      deployForm.append('manifest', JSON.stringify(manifest));

      const deployRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${uniqueProjectName}/deployments`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: deployForm }
      );
      const deployData = await deployRes.json();
      if (!deployRes.ok) {
        return NextResponse.json(
          { error: deployData.errors?.[0]?.message || 'Cloudflare Pages deployment failed.' },
          { status: deployRes.status }
        );
      }

      return NextResponse.json({
        success: true,
        url: deployData.result?.url || `https://${uniqueProjectName}.pages.dev`,
        ...(envVarsWarning ? { warning: envVarsWarning } : {}),
      });
    }

    // 6. CUSTOM WEBHOOK DEPLOYMENT — a generic fallback for any host with its own deploy
    // endpoint. Not "deploy to any host" magic: it only works if that endpoint is built to
    // receive { projectName, files } and, optionally, a Bearer token.
    if (host === 'Custom') {
      if (!customDeployUrl) {
        return NextResponse.json({ error: 'A deploy webhook URL is required for Custom deployments.' }, { status: 400 });
      }

      const customHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) customHeaders.Authorization = `Bearer ${token}`;

      // postToPublicHttps (see _shared/safeFetch.ts): https only, resolves the hostname itself and
      // refuses private/internal addresses, connects to the address it validated (no DNS rebinding),
      // never follows redirects, and caps the response size and time.
      let hook: { status: number; text: string };
      try {
        hook = await postToPublicHttps(customDeployUrl, {
          headers: customHeaders,
          body: JSON.stringify({ projectName: cleanProjectName, files, ...(hasEnvVars ? { envVars } : {}) }),
        });
      } catch (fetchErr) {
        if (fetchErr instanceof WebhookUrlError) {
          return NextResponse.json({ error: fetchErr.message }, { status: 400 });
        }
        // Deliberately generic: the raw error would reveal whether an internal host/port exists.
        console.error('[deploy.custom]', fetchErr instanceof Error ? fetchErr.message : fetchErr);
        return NextResponse.json({ error: "Couldn't reach that webhook URL." }, { status: 502 });
      }

      let hookData: any = null;
      try { hookData = hook.text ? JSON.parse(hook.text) : null; } catch { /* not JSON — some webhooks just 200 with no body, that's fine */ }

      if (hook.status < 200 || hook.status > 299) {
        const detail = hookData && typeof hookData.error === 'string' ? hookData.error.slice(0, 200) : '';
        return NextResponse.json({ error: detail || `Webhook responded with status ${hook.status}.` }, { status: 502 });
      }

      const reportedUrl = hookData && typeof hookData.url === 'string' && /^https?:\/\//i.test(hookData.url) ? hookData.url.slice(0, 2048) : '';
      return NextResponse.json({
        success: true,
        url: reportedUrl || customDeployUrl,
        ...(envVarsWarning ? { warning: envVarsWarning } : {}),
      });
    }

    return NextResponse.json({ error: 'Unsupported host provider.' }, { status: 400 });
  } catch (err: any) {
    return safeError('deploy.POST', err, 500, 'Server error encountered during deployment.');
  }
}
