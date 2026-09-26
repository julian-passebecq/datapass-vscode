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
import { buildReadiness } from "../src/core/readiness/readiness";
import { LATEST_MANIFEST_VERSION } from "../src/core/projectManifestModel";
import { parseExtensionsJson } from "../src/core/toolchain/extensionsJson";
import { manifestSales, SALES_EXTENSIONS_JSON, SALES_IDS } from "../tests/fixtures/v3/salesBi";
import type { WbOrder, WbWorkOrders } from "../src/views/workbenchState";
import { aiExchangeHtml } from "../src/views/aiExchangeHtml";
import { buildCatalogue, parseToolkitFile } from "../src/core/toolkit/toolkit";
import { toolkitState } from "../src/views/toolkitState";
import { hubRecipesJson, hubToolsJson } from "../tests/fixtures/v3/toolkit";

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

// 0.18: the Sales BI example's readiness (tools & versions, ID map, connections) after a check.
const salesTools = new Map<string, ToolObservation>(TOOLS.map(t => [t.id, { toolId: t.id, state: ["cli.git", "cli.fab", "cli.az", "ext.tmdl"].includes(t.id) ? "present" : "absent", version: t.id === "cli.az" ? "2.59.1" : t.id === "cli.fab" ? "1.1.0" : t.id === "cli.git" ? "2.46.0" : "1.6.5", observedAt: T }]));
const salesReadiness = buildReadiness({
  manifest: manifestSales(), coordinationKey: ".", envFiles: new Map(), repositories: [], problems: [], settings: {}, diagramCloudSidecar: false, latestSchemaVersion: LATEST_MANIFEST_VERSION,
  tools: salesTools, platform: "win32", extensionsJson: parseExtensionsJson(JSON.stringify(SALES_EXTENSIONS_JSON)), bindingFolders: new Map([["sales-git", "found"]]),
  connectionProbes: new Map([["cli.az", { tool: "cli.az", ranAt: T, outcome: "ok", signedIn: true, tenantId: SALES_IDS.tenant, subscriptionId: SALES_IDS.subDev }], ["cli.fab", { tool: "cli.fab", ranAt: T, outcome: "ok", signedIn: false }]])
});

// 0.20: work orders as the service shows them (synthetic).
const order = (o: Partial<WbOrder> & Pick<WbOrder, "id" | "title" | "status">): WbOrder => ({
  short: o.id.slice(-4), kind: "change", createdAt: "2026-09-25T18:30:12+02:00", agent: "Claude app", scope: "papers › extract", components: ["extract"], subproject: "papers",
  outputs: [], result: { state: "none", questions: [], followUps: [], checks: [], warnings: [] }, needs: [], next: "", suggestDone: false, canLaunch: true, canResume: false,
  closed: false, changesCoordination: true, proposed: [], timeline: [], ...o
});
const workOrders: WbWorkOrders = {
  allowed: true, why: "", typeLine: "dev project (project.json)", open: 2, needs: 3, selected: "wo-20260925-1830-k3f9",
  orders: [
    order({ id: "wo-20260925-1830-k3f9", title: "Retry PDF pages that time out", status: "reported", agent: "Claude Code · terminal", canResume: true,
      outputs: [{ ref: "pipeline", text: "pipeline #41 open · CI ✓", state: "open", url: "https://github.com/example-org/research-pipeline/pull/41", ci: "passing" }, { ref: "coordination", text: "coordination #12 open · CI ●", state: "open", url: "https://github.com/example-org/research-library/pull/12", ci: "running" }],
      result: { state: "valid", status: "done", summary: "extract now splits PDFs into 50-page batches and retries a failed batch once.", questions: ["The ADF activity timeout is 230 s. Raise it, or keep batches under it?"], followUps: [{ title: "Raise the ADF activity timeout to 600 s", why: "Batches of 50 pages can take 240 s." }], checks: ["pytest -q in functions/: passed (38 passed)"], warnings: [] },
      needs: ["1 question from the agent"], next: "The agent merges its pull requests when CI is green; then Get updates.",
      timeline: [
        { at: "2026-09-25T18:30:12+02:00", what: "written · change · 2 repositories to change, 1 to read", detail: ["papers › extract", "attachments: attachments/result-format.md, attachments/preparation-pack-extract.md"] },
        { at: "2026-09-25T18:31:04+02:00", what: "launched · Claude Code · terminal", detail: ["effort high · session 5f1c2a9e…"] },
        { at: "2026-09-25T18:52:40+02:00", what: "result: done (the agent says)", detail: ["extract now splits PDFs into 50-page batches and retries a failed batch once.", "check: pytest -q in functions/ passed (38 passed) — the agent says", "question: The ADF activity timeout is 230 s. Raise it, or keep batches under it?"], tone: "ok" },
        { what: "pipeline #41 open · CI ✓" }, { what: "coordination #12 open · CI ●" }
      ] }),
    order({ id: "wo-20260925-1602-a1b2", title: "Fill the project sheet", kind: "datapass-files", status: "reported", agent: "Claude app", changesCoordination: false, proposed: ["sheet"],
      result: { state: "valid", status: "done", summary: "Volumes and key columns proposed.", questions: [], followUps: [], checks: [], warnings: [] }, suggestDone: true, next: "The agent says it is done: import the proposed files, then mark it done and publish the summary." }),
    order({ id: "wo-20260924-2140-x9y8", title: "Add a retry counter", status: "launched", agent: "Codex app", outputs: [{ ref: "pipeline", text: "pipeline: no PR for dp/wo-20260924-2140-x9y8", state: "no-pr" }], needs: ["no pull request yet"], next: "The agent is working, or has not written its result yet." }),
    order({ id: "wo-20260923-1000-c3d4", title: "Review the options (storage)", kind: "investigate", status: "done", closed: true, outputs: [], canLaunch: false })
  ]
};

interface Page { name: string; mode: WorkbenchMode; selection: { subproject?: string; component?: string }; ui?: Record<string, unknown>; preview?: boolean; readiness?: boolean; orders?: boolean }
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
  { name: "detail", mode: "detail", selection: { subproject: "papers", component: "extract" } },
  { name: "readiness", mode: "full", selection: {}, readiness: true },
  { name: "work-orders", mode: "full", selection: { subproject: "papers", component: "extract" }, ui: { view: "workOrders" }, orders: true },
  { name: "detail-order", mode: "detail", selection: { subproject: "papers", component: "extract" }, orders: true },
  // 0.21: the toolkit (baseline + the example hub), a card that names a recipe, a component's tools.
  { name: "toolkit", mode: "full", selection: {}, ui: { view: "toolkit", tkFocus: "tool:cli.copilot" } },
  { name: "toolkit-recipe", mode: "full", selection: {}, ui: { view: "toolkit", tkSection: "recipes", tkFocus: "recipe:fabric.item-definition.bulk-edit" } },
  { name: "toolkit-requests", mode: "full", selection: {}, ui: { view: "toolkit", tkSection: "requests" } },
  { name: "board-recipe", mode: "full", selection: {}, ui: { view: "board", boardFocus: "bug-3" } },
  { name: "detail-tools", mode: "detail", selection: { subproject: "papers", component: "extract" } }
];
const hubFiles = [parseToolkitFile(JSON.stringify(hubToolsJson()), "hub/.datapass/toolkit/tools.json", "0.21.0"), parseToolkitFile(JSON.stringify(hubRecipesJson()), "hub/.datapass/toolkit/recipes/fabric.json", "0.21.0")];
const toolkit = toolkitState(buildCatalogue(hubFiles, "0.21.0"), hubFiles, { facts: new Map([["fabric.gitBinding", true]]), tools: new Map([["cli.git", "present"], ["cli.fab", "absent"]]) }, map, "win32");
for (const c of board.cards) if (c.id === "bug-3") c.recipe = { id: "fabric.item-definition.bulk-edit", route: "git" };
for (const p of pages) {
  const state = workbenchState({
    map, selection: p.selection, version: "preview", hasRoot: true, hasManifest: true, manifestErrors: [], trusted: true, observedAt: T, multipleProjectFolders: false,
    options, analysis, sheet: sheetA(), preview: p.preview ? google : undefined, board, readiness: p.readiness ? salesReadiness : undefined,
    workOrders: p.orders ? workOrders : undefined, toolkit
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

// 0.20: the AI view's Agent tab (the webview script is inline; a fake API replays the state).
const aiState = {
  ready: true, files: [], recent: [],
  agent: {
    verdict: { allowed: true, why: "" }, projectType: { type: "dev", source: "project.json", explain: "development project: work orders on, the agent merges its PRs when CI is green" },
    defaults: { choice: "claude-desktop", effort: "high", merge: "agent-when-green", exportScope: "project" },
    choices: [{ id: "claude-desktop", label: "Claude app" }, { id: "claude-terminal", label: "Claude Code · terminal" }, { id: "codex-desktop", label: "Codex app (ChatGPT)" }, { id: "codex-terminal", label: "Codex CLI · terminal" }],
    kinds: [{ id: "change", label: "Change files" }, { id: "investigate", label: "Investigate and report (no pull request)" }, { id: "datapass-files", label: "DataPass files only (.datapass/*.json)" }],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    subprojects: [{ id: "papers", title: "Papers pipeline" }], components: [{ id: "extract", label: "PDF extraction", subproject: "papers", repoKey: "pipeline" }],
    cards: [{ id: "bug-3", title: "Large PDFs time out" }], decisions: [], columns: [],
    repos: [{ key: ".", label: "Coordination repository", coordination: true, usable: true, note: "this folder" }, { key: "pipeline", label: "Document pipeline", coordination: false, usable: true, note: "2 uncommitted files here (not part of the base)" }, { key: "infra", label: "Archive infrastructure", coordination: false, usable: false, note: "planned" }],
    coordinationKey: ".", selection: { subproject: "papers", component: "extract" },
    recent: workOrders.orders.slice(0, 3).map(o => ({ id: o.id, short: o.short, title: o.title, status: o.status, agent: o.agent, createdAt: o.createdAt, outputs: o.outputs.map(x => x.text), result: o.result.state === "valid" ? `${o.result.status} (the agent says)` : undefined, needs: o.needs, next: o.next, suggestDone: o.suggestDone, canResume: o.canResume })),
    counts: { total: 4, open: 3, needs: 3 }
  },
  manual: { gitNeeds: 2, problems: 0, filesMissing: 3, opsReady: "4/9", behind: 1 }
};
let ai = aiExchangeHtml("'self'", "preview").replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "").replace("<style>", `<style>:root{${light ? THEME_LIGHT : THEME_DARK}}\n`)
  .replace('<script nonce="preview">', `<script>window.acquireVsCodeApi=()=>({postMessage:m=>{console.log("to extension",JSON.stringify(m));if(m.type==="ready")setTimeout(()=>window.postMessage({type:"state",state:${JSON.stringify(aiState).replace(/</g, "\\u003c")}},"*"))},getState:()=>({tab:"agent"}),setState:()=>{}});</script><script>`);
const aiFile = join(out, "ai-agent.html");
writeFileSync(aiFile, ai);
console.log(`wrote ${aiFile}`);
