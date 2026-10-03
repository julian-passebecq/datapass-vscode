/**
 * V5 STEPBAR1: the Steps view — TOUR2's general steps by default, each with its small checks; the
 * area → step map is data; unmapped checks under "Project checks"; every check the Project tree used to
 * carry keeps its action (FOIL-free fixture). `vscode` is replaced by a small in-memory stub.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type { NavLocation } from "../src/core/navigation/navTypes";
import type { Tour } from "../src/core/navigation/tours/tourTypes";
import type { Readiness } from "../src/core/readiness/readiness";

// ---- vscode stub ----
const executed: { id: string; args: unknown[] }[] = [];
class EventEmitter<T> {
  private ls = new Set<(e: T) => void>();
  event = (l: (e: T) => void) => { this.ls.add(l); return { dispose: () => this.ls.delete(l) }; };
  fire(e: T) { for (const l of this.ls) l(e); }
  dispose() { this.ls.clear(); }
}
const settings: Record<string, unknown> = {};
const vscodeStub = {
  EventEmitter,
  commands: { executeCommand: async (id: string, ...args: unknown[]) => { executed.push({ id, args }); }, registerCommand: () => ({ dispose() { /* none */ } }) },
  window: { registerWebviewViewProvider: () => ({ dispose() { /* none */ } }) },
  workspace: {
    onDidChangeConfiguration: () => ({ dispose() { /* none */ } }),
    getConfiguration: (section: string) => ({ get: <T>(k: string, d?: T) => (settings[`${section}.${k}`] as T) ?? d })
  }
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r: string, ...a: unknown[]) => (r === "vscode" ? "vscode" : resolve.call(Module, r, ...a));
mod._cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: vscodeStub };

/* eslint-disable @typescript-eslint/no-require-imports */
const { assignChecks, checkStepMap, checksFromFiles, checksFromReadiness, exploreSteps, checkCounts } = require("../src/core/steps/stepChecks") as typeof import("../src/core/steps/stepChecks");
const { defaultStepsHtml, injectStepChecks, parseStepBarMessage, projectChecksHtml, stepBarPage, stepBarScript, stepChecksHtml, withDefaultSteps } = require("../src/views/stepBar/stepBarHtml") as typeof import("../src/views/stepBar/stepBarHtml");
const { StepBar, defaultTour } = require("../src/views/stepBar/stepBar") as typeof import("../src/views/stepBar/stepBar");
const { labelPack, toursHtml } = require("../src/views/navToursHtml") as typeof import("../src/views/navToursHtml");
/* eslint-enable @typescript-eslint/no-require-imports */

const loc = (nodeId: string, level: NavLocation["level"] = "artifact", artifactKind = "other"): NavLocation => ({ level, nodeId, artifactKind });

/** FOIL-free readiness: one tool to install, one extension tool missing, extensions.json, two connections, env file + keys, ids, a manifest note. */
function readiness(): Readiness {
  return {
    declared: true, files: [{ id: "f1", path: ".env", optional: false, state: "missing", git: "unknown", keysDefined: 0 }],
    keys: [{ name: "API_URL", state: "set", definedIn: [".env"], source: "vault" }, { name: "DB_NAME", state: "missing", definedIn: [], source: "vault" }],
    identifiers: [{ id: "tenant", label: "Tenant id", environments: [], pending: false }, { id: "later", label: "Later id", environments: [], pending: true }],
    companions: [{ module: "diagramcloud", label: "DiagramCloud", state: "not-configured", detail: "not set" }],
    repositories: [],
    toolchain: { declared: true, entries: [
      { tool: "python", label: "Python", where: "local", optional: false, state: "missing", detail: "not found", install: { command: "winget install Python.Python.3.12" } },
      { tool: "ms-python", label: "Python extension", where: "local", optional: false, state: "missing", detail: "not installed", extensionId: "ms-python.python" },
      { tool: "node", label: "Node.js", where: "local", optional: false, state: "ok", version: "22.0.0", detail: "ok" }
    ], summary: { ok: 1, total: 3, attention: 2, notChecked: 0 } },
    extensions: { state: "present", expected: [{ tool: "ms-python", extensionId: "ms-python.python", label: "Python extension", recommended: false, optional: false, unwanted: false }], extra: [] },
    connections: [
      { id: "az", kind: "sign-in", label: "Azure", tool: "az", state: "signed-out", detail: "signed out", signIn: { tool: "az" } },
      { id: "portal", kind: "binding", label: "Workspace", state: "declared", detail: "declared", hasPortal: true },
      { id: "later", kind: "sign-in", label: "Databricks", tool: "databricks", state: "not-checked-yet", detail: "not checked yet" }
    ],
    checks: [
      { id: "manifest.version", severity: "info", area: "manifest", message: "The manifest is schemaVersion 4." },
      { id: "tools.missing:python", severity: "warning", area: "tools", message: "Python is not installed here." }
    ],
    summary: { errors: 0, warnings: 1, infos: 1, keysSet: 1 }
  } as unknown as Readiness;
}
const FILES = { components: [
  { id: "ingest", label: "Ingest", artifacts: { repoKey: "app", files: [
    { path: "ingest.py", repoPath: "src/ingest.py", kind: "file", state: "found", optional: false, source: "declared", role: "code", requiredFor: [] },
    { path: "schema.sql", repoPath: "src/schema.sql", kind: "file", state: "missing", optional: false, source: "declared", role: "code", requiredFor: ["build"] }
  ] } },
  { id: "report", label: "Report", artifacts: { repoKey: "app", files: [{ path: "report.pbix", repoPath: "bi/report.pbix", kind: "file", state: "unknown", optional: false, source: "declared", role: "report", requiredFor: [] }] } }
] } as never;

test("check map: built-in data, overridable flat or nested; unmapped areas fall back to Project checks", () => {
  const base = checkStepMap();
  assert.equal(base.areas.tools, "first");
  assert.equal(base.areas.files, "component");
  assert.equal(base.labels.projectChecks, "Project checks");
  assert.equal(checkStepMap({ tools: "report" }).areas.tools, "report");
  const nested = checkStepMap({ areas: { manifest: "project-checks" }, labels: { projectChecks: "Other" }, bogus: 3 });
  assert.equal(nested.areas.manifest, "project-checks");
  assert.equal(nested.labels.projectChecks, "Other");
  assert.equal(checkStepMap([1, 2]).areas.tools, "first", "an array is ignored");
  assert.equal(checkStepMap({ tools: 5 }).areas.tools, "first", "non-string targets are ignored");
});

test("assign: first step, the component's step, a step matched by id / kind, unmapped → Project checks", () => {
  const steps = [{ id: "1", location: loc("ingest") }, { id: "2", location: loc("report", "artifact", "power-bi") }];
  const checks = [
    { id: "a", label: "tool", status: "fail" as const, area: "tools" },
    { id: "b", label: "file", status: "fail" as const, area: "files", nodeId: "report" },
    { id: "c", label: "file elsewhere", status: "fail" as const, area: "files", nodeId: "ghost" },
    { id: "d", label: "custom", status: "pass" as const, area: "custom" },
    { id: "e", label: "by kind", status: "hole" as const, area: "bi" }
  ];
  const map = checkStepMap({ bi: "power-bi" });
  const { byStep, project } = assignChecks(steps, checks, map);
  assert.deepEqual(byStep.map((s) => s.map((c) => c.id)), [["a"], ["b", "e"]]);
  assert.deepEqual(project.map((c) => c.id), ["c", "d"]);
  assert.deepEqual(assignChecks([], checks, map).project.length, checks.length, "no step: everything under Project checks");
  assert.deepEqual(checkCounts(checks), { fail: 3, hole: 1, "not-checked": 0, pass: 1 });
});

test("checks from readiness: statuses and every former tree action", () => {
  const cs = checksFromReadiness(readiness());
  const by = (id: string) => cs.find((c) => c.id === id)!;
  assert.deepEqual(by("tool:python@local").action, { command: "datapass.toolchain.copyInstall", title: "Copy install command", arguments: ["python"] });
  assert.equal(by("tool:ms-python@local").action!.command, "datapass.installTool");
  assert.equal(by("tool:node@local").status, "pass");
  assert.equal(by("tool:extensions-json").action!.command, "datapass.showRecommendedExtensions");
  assert.equal(by("tool:extensions-json").status, "fail");
  assert.equal(by("connection:az").action!.command, "datapass.connections.copySignIn");
  assert.equal(by("connection:portal").action!.command, "datapass.connections.openPortal");
  assert.equal(by("connection:later").action!.command, "datapass.checkConnections");
  assert.equal(by("connection:later").status, "not-checked");
  assert.equal(by("env:file:f1").action!.command, "datapass.env.openFile");
  assert.equal(by("env:key:DB_NAME").status, "fail");
  assert.equal(by("env:key:API_URL").action!.command, "datapass.env.copyKeyName");
  assert.equal(by("env:id:tenant").action!.command, "datapass.env.copyIdentifier");
  assert.equal(by("env:id:later").status, "hole");
  assert.equal(by("env:id:later").action, undefined, "a pending id is never copied");
  assert.equal(by("companion:diagramcloud").status, "not-checked");
  assert.ok(cs.some((c) => c.area === "manifest"), "manifest findings kept");
  assert.ok(!cs.some((c) => c.id.startsWith("check:tools.")), "tool findings are not repeated (the tool row carries them)");
});

test("checks from expected files: one per file, on its component, open or explain", () => {
  const cs = checksFromFiles(FILES);
  assert.deepEqual(cs.map((c) => [c.nodeId, c.status, c.action!.command]), [
    ["ingest", "pass", "datapass.openComponentFile"], ["ingest", "fail", "datapass.explainMissingFile"], ["report", "hole", "datapass.explainMissingFile"]]);
});

test("explore: project then sub-projects when the project declares no journey", () => {
  const steps = exploreSteps([loc("app", "artifact"), loc("p", "project"), loc("s1", "subproject"), loc("s2", "subproject")]);
  assert.deepEqual(steps.map((s) => s.location.nodeId), ["p", "s1", "s2"]);
});

test("default journey: the first declared general journey, else the first built-in general one", () => {
  const t = (id: string, mode?: Tour["mode"]): Tour => ({ id, titleRef: `text:${id}`, ...(mode ? { mode } : {}), steps: [] });
  const built = t("datapass.journey.lineage.1", "general"), learn = t("user.learn", "learning"), mine = t("user.mine");
  assert.equal(defaultTour([built, learn, mine], new Set(["user.learn", "user.mine"]))!.id, "user.mine");
  assert.equal(defaultTour([built, learn], new Set(["user.learn"]))!.id, built.id);
  assert.equal(defaultTour([learn], new Set()), undefined);
});

test("html: checks after each step button, default steps replace 'No tour yet', Project checks + links", () => {
  const labels = checkStepMap().labels;
  const model = { labels: labelPack(undefined), journeys: [], tours: [], explanation: null, canPrev: false, canNext: true, jump: { query: "", hits: [] },
    steps: [{ index: 0, number: "1", depth: 0, label: "Ingest", preview: "", status: "ok" as const, current: true }, { index: 1, number: "2", depth: 0, label: "Report", preview: "", status: "ok" as const, current: false }] };
  const inner = toursHtml(model);
  const out = injectStepChecks(inner, [[{ id: "x", label: "Python", status: "fail", area: "tools", action: { command: "datapass.toolchain.copyInstall", title: "Copy" } }], []], labels);
  assert.match(out, /data-tour-step="0"[^]*?<\/button><div class="step-checks">[^]*data-step-check="x"/);
  assert.ok(out.indexOf("data-step-check") < out.indexOf('data-tour-step="1"'), "the check sits under step 1, not step 2");
  assert.equal(stepChecksHtml([], labels), "");
  const passOnly = stepChecksHtml([{ id: "p", label: "ok.py", status: "pass", area: "files", action: { command: "c", title: "Open" } }], labels);
  assert.match(passOnly, /1 ✓/);
  assert.doesNotMatch(passOnly, /data-step-check/, "passing files are counted, not listed");
  const empty = toursHtml({ ...model, steps: [] });
  const none = labelPack(undefined)["ui.none"]!;
  const d = withDefaultSteps(empty, none, defaultStepsHtml({ title: "Data lineage", tourId: "t1", steps: [{ label: "Ingest", checks: [] }] }, labels));
  assert.ok(!d.includes(none));
  assert.match(d, /data-step-start="0" data-step-tour="t1"/);
  assert.match(defaultStepsHtml({ title: "Explore", steps: [{ label: "P", checks: [] }] }, labels), /data-step-go="0"/);
  assert.match(projectChecksHtml([], labels, [{ command: "datapass.readinessReport", label: "Show readiness report" }]), /data-step-link="datapass.readinessReport"/);
  assert.match(stepChecksHtml([{ id: "<i>", label: "<b>", status: "fail", area: "x" }], labels), /&lt;b&gt;/);
  assert.match(stepBarScript("api"), /step-check/);
  assert.match(stepBarPage("csp:", "N0NCE", ["1;"]), /script-src 'nonce-N0NCE'/);
});

test("messages: validated, anything else dropped", () => {
  assert.deepEqual(parseStepBarMessage({ type: "step-check", id: "tool:a" }), { type: "step-check", id: "tool:a" });
  assert.deepEqual(parseStepBarMessage({ type: "step-start", tourId: "t", index: 2 }), { type: "step-start", tourId: "t", index: 2 });
  assert.equal(parseStepBarMessage({ type: "step-go", index: -1 }), null);
  assert.equal(parseStepBarMessage({ type: "step-check", id: "" }), null);
  assert.equal(parseStepBarMessage({ type: "step-link", command: "workbench.action.terminal.new" }), null, "only DataPass commands");
  assert.equal(parseStepBarMessage({ type: "tour", action: "next" }), null);
  assert.equal(parseStepBarMessage("x"), null);
});

/** A NavTours-like fake: the extension contract (addExtension / current / visible / start / goStep) only. */
function fakeTours(tours: Tour[], declared: Tour[] = []) {
  const exts: { model?: (m: unknown) => unknown; html?: (h: string, m: unknown) => string; handle?: (raw: unknown) => boolean | Promise<boolean> }[] = [];
  let cursor: { tour: Tour; index: number } | undefined;
  const started: string[] = [];
  return {
    exts, started,
    addExtension(e: (typeof exts)[number]) { exts.push(e); return { dispose() { /* none */ } }; },
    refresh() { /* none */ },
    current: () => (cursor ? { tour: cursor.tour, step: cursor.tour.steps[cursor.index]!, index: cursor.index } : undefined),
    fileDocument: () => ({ schema: "datapass.tour/1", tours: declared }),
    visible: () => tours, tours: () => tours,
    explain: (ref: string) => ref.replace(/^text:/, ""),
    start(t: Tour) { cursor = { tour: t, index: 0 }; started.push(`${t.id}@0`); },
    goStep(i: number) { if (cursor) { cursor = { ...cursor, index: i }; started.push(`${cursor.tour.id}@${i}`); } }
  };
}

test("bar: default journey's steps with their checks; a step click starts it there; every check action reachable", async () => {
  const tour: Tour = { id: "datapass.journey.lineage.1", titleRef: "text:Data lineage", mode: "general", journey: "lineage", steps: [
    { id: "1", location: loc("ingest"), viewId: "detail", explanationRef: "text:a", origin: "datapass-guidance" },
    { id: "2", location: loc("report"), viewId: "detail", explanationRef: "text:b", origin: "datapass-guidance" }] };
  const tours = fakeTours([tour]);
  const dispatched: unknown[] = [];
  const host = { nav: { ladder: {}, dispatch: (c: unknown) => dispatched.push(c) }, label: (l: NavLocation) => l.nodeId, session: { projectMap: () => FILES, onDidChange: () => ({ dispose() { /* none */ } }) } };
  const bar = new StepBar(host as never, tours as never, { readiness, projectMap: () => FILES });
  const ext = tours.exts[0]!;
  const model = { labels: labelPack(undefined), journeys: [], tours: [], steps: [], explanation: null, canPrev: false, canNext: false, jump: { query: "", hits: [] } };
  ext.model!(model);
  const html = ext.html!(toursHtml(model), model);
  assert.match(html, /<h4>Data lineage<\/h4>/);
  assert.match(html, /data-step-start="0" data-step-tour="datapass.journey.lineage.1"><span class="tour-n">1<\/span> ingest/);
  // Step 1 (first) carries tools / env / connections; step 1 also its component's files; step 2 the report hole.
  const step2 = html.slice(html.indexOf('data-step-start="1"'));
  assert.match(step2, /report\.pbix/);
  assert.match(html, /<h4>Project checks<\/h4>[^]*DiagramCloud/, "companion → Project checks (data map)");
  // Every action the tree carried is reachable from the bar.
  const actions = [...html.matchAll(/data-step-check="([^"]+)"/g)].map((m) => m[1]!.replace(/&quot;/g, "\"").replace(/&amp;/g, "&"));
  for (const id of actions) await ext.handle!({ type: "step-check", id });
  const commands = new Set(executed.map((e) => e.id));
  for (const c of ["datapass.toolchain.copyInstall", "datapass.installTool", "datapass.showRecommendedExtensions", "datapass.connections.copySignIn",
    "datapass.connections.openPortal", "datapass.checkConnections", "datapass.env.openFile", "datapass.env.copyKeyName", "datapass.env.copyIdentifier", "datapass.explainMissingFile"]) {
    assert.ok(commands.has(c), `reachable: ${c}`);
  }
  executed.length = 0;
  await ext.handle!({ type: "step-link", command: "datapass.readinessReport" });
  await ext.handle!({ type: "step-link", command: "datapass.somethingElse" });
  assert.deepEqual(executed.map((e) => e.id), ["datapass.readinessReport"]);
  await ext.handle!({ type: "step-start", tourId: tour.id, index: 1 });
  assert.deepEqual(tours.started, [`${tour.id}@0`, `${tour.id}@1`]);
  // Running tour: checks go right after each step button of TOUR2's own list.
  ext.model!(model);
  const running = ext.html!(toursHtml({ ...model, steps: [{ index: 0, number: "1", depth: 0, label: "ingest", preview: "", status: "ok", current: false }, { index: 1, number: "2", depth: 0, label: "report", preview: "", status: "ok", current: true }] }), model);
  assert.match(running, /data-tour-step="1"[^]*?<\/button><div class="step-checks">[^]*report\.pbix/);
  assert.equal(await ext.handle!({ type: "tour", action: "next" }), false, "TOUR2's messages are not the bar's");
  bar.dispose();
});

test("bar: no journey at all → 'Explore the project' (project, sub-projects); a click goes there", async () => {
  const tours = fakeTours([]);
  const dispatched: unknown[] = [];
  const ladder = { root: () => loc("p", "project"), children: (l: NavLocation) => (l.level === "project" ? [loc("s1", "subproject")] : []) };
  const host = { nav: { ladder, dispatch: (c: unknown) => dispatched.push(c) }, label: (l: NavLocation) => l.nodeId, session: { projectMap: () => ({ components: [] }) } };
  const bar = new StepBar(host as never, tours as never, { readiness: () => undefined, projectMap: () => ({ components: [] }) as never });
  const ext = tours.exts[0]!;
  const model = { labels: labelPack(undefined), journeys: [], tours: [], steps: [], explanation: null, canPrev: false, canNext: false, jump: { query: "", hits: [] } };
  ext.model!(model);
  const html = ext.html!(toursHtml(model), model);
  assert.match(html, /<h4>Explore the project<\/h4>/);
  assert.match(html, /data-step-go="1"><span class="tour-n">2<\/span> s1/);
  await ext.handle!({ type: "step-go", index: 1 });
  assert.deepEqual(dispatched, [{ type: "go", location: loc("s1", "subproject") }]);
  bar.dispose();
});
