import { DEFAULT_FILES, type VFiles } from "./CodeStudio";

export type ProjectTemplateKey = "blank" | "html" | "react" | "node-api";

export type ProjectTemplate = {
  key: ProjectTemplateKey;
  label: string;
  /** One line shown under the option in the picker. */
  description: string;
  /** False for templates that can't actually execute in the in-browser Preview
   *  (e.g. a real Node server) — the picker shows a small note instead of a Run promise it can't keep. */
  runnable: boolean;
  files: VFiles;
};

const HTML_FILES: VFiles = {
  "README.md":
    "# New project\n\nA plain HTML/CSS/JS starter. Open `index.html` to see what ships to the Preview tab — edit `style.css` or `script.js` and press Run Code again.",
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>My Site</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <h1>Hello, world 👋</h1>
    <p>Edit <code>index.html</code>, <code>style.css</code> or <code>script.js</code> — then hit <strong>Run Code</strong>.</p>
    <button id="count-btn">Clicked 0 times</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
  "style.css": `:root { color-scheme: dark; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #09090b;
  color: #e4e4e7;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
main { text-align: center; padding: 2rem; }
h1 { margin-bottom: 0.5rem; }
button {
  margin-top: 1.5rem;
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 0.5rem;
  background: linear-gradient(to right, #22d3ee, #6366f1);
  color: #09090b;
  font-weight: 600;
  cursor: pointer;
}
button:hover { filter: brightness(1.1); }
`,
  "script.js": `let count = 0;
const btn = document.getElementById("count-btn");
btn.addEventListener("click", () => {
  count += 1;
  btn.textContent = \`Clicked \${count} time\${count === 1 ? "" : "s"}\`;
});
`,
};

const REACT_FILES: VFiles = {
  "README.md":
    "# New project\n\nA client-side React starter, bundled in the browser with esbuild. There's no `index.html` in this project on purpose — the Preview tab bundles `src/main.tsx` and mounts it into its own `#root` div automatically. Edit `src/App.tsx` and press Run Code.",
  "package.json": `{\n  "name": "new-project",\n  "private": true,\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1"\n  }\n}`,
  "src/main.tsx": `import { createRoot } from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
`,
  "src/App.tsx": `import { useState } from "react";
import "./App.css";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="app">
      <h1>Hello, React 👋</h1>
      <p>Edit <code>src/App.tsx</code> and press Run Code to see your changes.</p>
      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} time{count === 1 ? "" : "s"}</button>
    </div>
  );
}
`,
  "src/App.css": `.app {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #09090b;
  color: #e4e4e7;
  font-family: ui-sans-serif, system-ui, sans-serif;
  text-align: center;
}
.app button {
  margin-top: 1.5rem;
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 0.5rem;
  background: linear-gradient(to right, #22d3ee, #6366f1);
  color: #09090b;
  font-weight: 600;
  cursor: pointer;
}
.app button:hover { filter: brightness(1.1); }
`,
};

const NODE_API_FILES: VFiles = {
  "README.md":
    "# New project\n\nA minimal Express API skeleton. This template targets a real Node runtime (Vercel/Render/Fly/etc via Pre-Push & Deploy) — the in-browser Preview tab runs everything inside a browser sandbox with no Node process, so `Run Code` won't start this server. Push it to GitHub and deploy it from the Pre-Push & Deploy tab to actually run it.",
  "package.json": `{\n  "name": "new-project",\n  "private": true,\n  "scripts": {\n    "start": "node src/server.js"\n  },\n  "dependencies": {\n    "express": "^4.19.2"\n  }\n}`,
  "src/server.js": `const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Hello from your new API" });
});

app.listen(port, () => {
  console.log(\`Listening on port \${port}\`);
});
`,
};

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    key: "blank",
    label: "Blank",
    description: "Minimal starting point — a single script, nothing else.",
    runnable: true,
    files: DEFAULT_FILES,
  },
  {
    key: "html",
    label: "HTML / CSS / JS",
    description: "A static page you can see the moment you press Run Code.",
    runnable: true,
    files: HTML_FILES,
  },
  {
    key: "react",
    label: "React",
    description: "A client-side React app, bundled and run in the browser.",
    runnable: true,
    files: REACT_FILES,
  },
  {
    key: "node-api",
    label: "Node / Express API",
    description: "A server skeleton meant for deploying, not for the in-browser Preview.",
    runnable: false,
    files: NODE_API_FILES,
  },
];

export const DEFAULT_TEMPLATE_KEY: ProjectTemplateKey = "blank";

export function getTemplate(key: ProjectTemplateKey): ProjectTemplate {
  return PROJECT_TEMPLATES.find((t) => t.key === key) ?? PROJECT_TEMPLATES[0];
}
