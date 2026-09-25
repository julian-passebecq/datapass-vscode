/**
 * Render the Workbench webviews outside VS Code, with the synthetic V3 project, for a visual
 * check in any browser: out/preview/workbench-*.html. VS Code theme variables are emulated (dark
 * by default, `--light` for light). Nothing here is part of the extension.
 *
 *   npm run build && npx tsx scripts/workbench-preview.ts [--light]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectMap } from "../src/core/project/projectMap";
import { analyzeOptions, evaluatePicks, scenarioPicks } from "../src/core/project/options";
import { workbenchState } from "../src/views/workbenchState";
import { workbenchHtml, type WorkbenchMode } from "../src/views/workbenchHtml";
import { fileObsA, inputA } from "../tests/fixtures/v3/research";
import { optionsA, sheetA } from "../tests/fixtures/v3/researchOptions";
import { boardA } from "../tests/fixtures/v3/researchBoard";
import { boardView } from "../src/core/project/board";
import { TOOLS, type ToolObservation } from "../src/core/capabilities/tools";

const light = process.argv.includes("--light");
const T = new Date().toISOString();
const present = ["cli.python", "cli.func", "ext.python", "cli.databricks", "ext.mongodb", "ext.azure-functions", "ext.cosmosdb"];
const tools = new Map<string, ToolObservation>(TOOLS.map(t => [t.id, { toolId: t.id, state: present.includes(t.id) ? "present" : "absent", observedAt: T }]));
const input = inputA({ tools, fileObservations: fileObsA() });
const map = buildProjectMap(input);
const options = optionsA();
const analysis = analyzeOptions({ base: input, options, baseMap: map });
const google = { key: "scenario:google", title: "Archi 2 — Google for documents", ...evaluatePicks({ base: input, options, baseMap: map }, scenarioPicks(options, "google")!, "scenario:google") };
const board = boardView(boardA(), { map, files: fileObsA(), options, today: "2026-09-25" });

const THEME_DARK = `--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-panel-background:#181818;
--vscode-widget-border:#3c3c3c;--vscode-editorWidget-background:#252526;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#026ec1;
--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-button-secondaryHoverBackground:#3c3c3c;--vscode-textLink-foreground:#4daafc;
--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#ffffff;--vscode-focusBorder:#0078d4;
--vscode-testing-iconPassed:#73c991;--vscode-editorWarning-foreground:#cca700;--vscode-errorForeground:#f85149;--vscode-font-family:'Segoe UI',system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;
--vscode-dropdown-background:#313131;--vscode-dropdown-foreground:#cccccc;--vscode-dropdown-border:#3c3c3c;--vscode-badge-background:#616161;--vscode-badge-foreground:#ffffff;`;
const THEME_LIGHT = `--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;--vscode-panel-background:#f8f8f8;
--vscode-widget-border:#e5e5e5;--vscode-editorWidget-background:#f8f8f8;--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#0258a8;
--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#cccccc;--vscode-textLink-foreground:#005fb8;
--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#e8e8e8;--vscode-list-activeSelectionForeground:#000000;--vscode-focusBorder:#005fb8;
--vscode-testing-iconPassed:#388a34;--vscode-editorWarning-foreground:#bf8803;--vscode-errorForeground:#e51400;--vscode-font-family:'Segoe UI',system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;
--vscode-dropdown-background:#ffffff;--vscode-dropdown-foreground:#3b3b3b;--vscode-dropdown-border:#cecece;--vscode-badge-background:#cccccc;--vscode-badge-foreground:#333333;`;

const script = readFileSync(join(__dirname, "..", "dist", "workbench.js"), "utf8");
const out = join(__dirname, "..", "out", "preview");
mkdirSync(out, { recursive: true });

interface Page { name: string; mode: WorkbenchMode; selection: { subproject?: string; component?: string }; ui?: Record<string, unknown>; preview?: boolean }
const pages: Page[] = [
  { name: "full", mode: "full", selection: { subproject: "papers", component: "extract" } },
  { name: "full-preview", mode: "full", selection: { subproject: "papers" }, ui: { groupBy: "cloud" }, preview: true },
  { name: "options", mode: "full", selection: { subproject: "papers" }, ui: { view: "options", optFocus: "processing", optOption: "bigquery" } },
  { name: "scenarios", mode: "full", selection: { subproject: "papers" }, ui: { view: "options", optFocus: "scenarios" }, preview: true },
  { name: "sheet", mode: "full", selection: {}, ui: { view: "sheet", sheetSection: "datasets", sheetFocus: "pages" } },
  { name: "board", mode: "full", selection: {}, ui: { view: "board", boardFocus: "bug-3" } },
  { name: "board-filtered", mode: "full", selection: {}, ui: { view: "board", boardSub: "papers", boardTypes: ["bug", "task"], boardFocus: "task-review-guide" } },
  { name: "map", mode: "map", selection: { subproject: "papers", component: "extract" } },
  { name: "map-vertical", mode: "map", selection: { subproject: "papers" }, ui: { dir: "TB", groupBy: "level" }, preview: true },
  { name: "detail", mode: "detail", selection: { subproject: "papers", component: "extract" } }
];
for (const p of pages) {
  const state = workbenchState({
    map, selection: p.selection, version: "preview", hasRoot: true, hasManifest: true, manifestErrors: [], trusted: true, observedAt: T, multipleProjectFolders: false,
    options, analysis, sheet: sheetA(), preview: p.preview ? google : undefined, board
  });
  let html = workbenchHtml({ cspSource: "'self'", nonce: "preview", scriptUri: "about:blank", mode: p.mode, title: `DataPass ${p.mode}` });
  // Local preview: no CSP, theme variables inlined, the bundle inlined, a fake VS Code API that logs messages.
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
    .replace("<style>", `<style>:root{${light ? THEME_LIGHT : THEME_DARK}}\n`)
    .replace(/<script nonce="preview" src="about:blank"><\/script>/, `<script>window.acquireVsCodeApi=()=>({postMessage:m=>{console.log("to extension",JSON.stringify(m));const t=document.getElementById("toast");if(t)t.textContent="→ "+JSON.stringify(m)},getState:()=>(${JSON.stringify(p.ui ?? {})}),setState:()=>{}});</script>
<script>${script}</script>
<script>window.__state=${JSON.stringify(state).replace(/</g, "\\u003c")};window.postMessage({type:"state",state:window.__state},"*");</script>
<div id="toast" style="position:fixed;bottom:4px;right:8px;font:11px monospace;opacity:.7"></div>`);
  const file = join(out, `workbench-${p.name}.html`);
  writeFileSync(file, html);
  console.log(`wrote ${file}`);
}
