/**
 * Render the real Galaxy webview HTML (src/views/galaxyHtml.ts) outside VS Code for visual review, fed with the
 * GalaxyState captured by the desktop suite (out/integration/report-<fixture>.json).
 * Writes out/preview/galaxy-{dark,light,hc}.html. Theme colours approximate VS Code's
 * Dark Modern, Light Modern and High Contrast themes.
 *
 *   npm run test:desktop && npx tsx scripts/galaxy-preview.ts [fixture]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { galaxyHtml } from "../src/views/galaxyHtml";

const repo = path.resolve(__dirname, "..");
const fixture = process.argv[2] ?? "v2-retail";

const THEMES: Record<string, Record<string, string>> = {
  dark: {
    "font-family": "'Segoe UI', system-ui, sans-serif", foreground: "#cccccc", descriptionForeground: "#9d9d9d",
    "sideBar-background": "#181818", "editor-background": "#1f1f1f", "widget-border": "#313131",
    "button-background": "#0078d4", "button-foreground": "#ffffff", "button-border": "#ffffff12",
    "button-secondaryBackground": "#313131", "button-secondaryForeground": "#cccccc", "button-secondaryHoverBackground": "#3c3c3c",
    "badge-background": "#616161", "badge-foreground": "#f8f8f8",
    "testing-iconPassed": "#73c991", "editorWarning-foreground": "#cca700", errorForeground: "#f85149"
  },
  light: {
    "font-family": "'Segoe UI', system-ui, sans-serif", foreground: "#3b3b3b", descriptionForeground: "#3b3b3b",
    "sideBar-background": "#f8f8f8", "editor-background": "#ffffff", "widget-border": "#e5e5e5",
    "button-background": "#005fb8", "button-foreground": "#ffffff", "button-border": "#0000001a",
    "button-secondaryBackground": "#e5e5e5", "button-secondaryForeground": "#3b3b3b", "button-secondaryHoverBackground": "#cccccc",
    "badge-background": "#cccccc", "badge-foreground": "#3b3b3b",
    "testing-iconPassed": "#388a34", "editorWarning-foreground": "#bf8803", errorForeground: "#e51400"
  },
  hc: {
    "font-family": "'Segoe UI', system-ui, sans-serif", foreground: "#ffffff", descriptionForeground: "#ffffffb3",
    "sideBar-background": "#000000", "editor-background": "#000000", "widget-border": "#6fc3df",
    "button-background": "#000000", "button-foreground": "#ffffff", "button-border": "#6fc3df",
    "button-secondaryBackground": "#000000", "button-secondaryForeground": "#ffffff", "button-secondaryHoverBackground": "#000000",
    "badge-background": "#000000", "badge-foreground": "#ffffff",
    "testing-iconPassed": "#73c991", "editorWarning-foreground": "#fff200", errorForeground: "#f48771"
  }
};

async function main(): Promise<void> {
  const report = path.join(repo, "out", "integration", `report-${fixture}.json`);
  if (!fs.existsSync(report)) throw new Error(`Run npm run test:desktop first (${path.relative(repo, report)} is missing).`);
  const state = JSON.parse(fs.readFileSync(report, "utf8")).evidence?.galaxyState;
  if (!state) throw new Error(`${report} has no galaxyState evidence.`);

  const html = galaxyHtml("", "preview");

  const out = path.join(repo, "out", "preview");
  fs.mkdirSync(out, { recursive: true });
  for (const [name, vars] of Object.entries(THEMES)) {
    const css = `:root{${Object.entries(vars).map(([k, v]) => `--vscode-${k}:${v}`).join(";")}} body{width:320px;border-right:1px solid var(--vscode-widget-border)}`;
    const boot = `window.acquireVsCodeApi=()=>({postMessage:m=>console.log('postMessage',JSON.stringify(m)),getState:()=>({openPlatforms:["fabric","databricks"]}),setState:()=>{}});`;
    const post = `window.addEventListener('load',()=>window.postMessage({type:'state',state:${JSON.stringify(state)}},'*'));`;
    const page = html
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
      .replace("</head>", `<style>${css}</style><script>${boot}</script></head>`)
      .replace("</body>", `<script>${post}</script></body>`);
    fs.writeFileSync(path.join(out, `galaxy-${name}.html`), page);
  }
  console.log(`Wrote ${Object.keys(THEMES).map(t => `out/preview/galaxy-${t}.html`).join(", ")}`);
}

main().catch(error => { console.error(error); process.exit(1); });
