// Copies third-party browser assets out of node_modules into /public so they are served from
// DevAudit's own origin instead of a CDN:
//
//   esbuild-wasm's esbuild.wasm  ->  public/esbuild.wasm   (the in-browser bundler used by CodeStudio)
//   monaco-editor's min/vs       ->  public/monaco/vs      (the code editor)
//
// Why: anything loaded from a CDN into the main page runs with full access to the page's origin
// (including the Supabase session in localStorage). Serving these from 'self' means a compromised
// CDN can no longer inject code into the app, and lets the CSP drop every third-party script host.
//
// Runs on postinstall, and again before dev/build so `npm ci --ignore-scripts` can't leave the
// files missing. The copies are build artifacts: add `public/esbuild.wasm` and `public/monaco/` to
// .gitignore rather than committing ~15 MB of vendored files.

import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => join(root, "node_modules", ...p);
const pub = (...p) => join(root, "public", ...p);

function need(path, what) {
  if (!existsSync(path)) {
    console.error(`copy-static-assets: ${what} not found at ${path}. Run \`npm install\` first.`);
    process.exit(1);
  }
}

need(nm("esbuild-wasm", "esbuild.wasm"), "esbuild-wasm's esbuild.wasm");
need(nm("monaco-editor", "min", "vs"), "monaco-editor's min/vs");

mkdirSync(pub(), { recursive: true });
copyFileSync(nm("esbuild-wasm", "esbuild.wasm"), pub("esbuild.wasm"));

rmSync(pub("monaco", "vs"), { recursive: true, force: true });
mkdirSync(pub("monaco"), { recursive: true });
cpSync(nm("monaco-editor", "min", "vs"), pub("monaco", "vs"), { recursive: true });

console.log("copy-static-assets: esbuild.wasm and monaco/vs copied to public/");
