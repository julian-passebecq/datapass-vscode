/**
 * 0.17 windows and work views (pure parts): views.json validation, layout normalisation, launcher
 * requests, the company workspace file (relative paths on Windows and POSIX, merging an existing
 * file, JSON with comments) and the machine-local list Power Ops reads.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import {
  cleanViewName, describeView, findView, leafCount, MAX_VIEWS, normalizeLayout, parseOpenViewRequest, parseWorkViews, sanitizeDiagramUi,
  serializeWorkViews, viewIdFor, viewProblem, type WorkView, type WorkViewsFile
} from "../src/core/windows/workViews";
import {
  buildCompanyWorkspace, buildPowerOpsExport, cleanCompanyName, defaultExportFile, parseWorkspaceFile, quoteArg, relativeFolderPath, stripJsonc,
  titleBarColors, workspaceFileName, workspaceFolderPaths
} from "../src/core/windows/company";

const NOW = Date.parse("2026-09-25T15:00:00.000Z");

function fullView(over: Partial<WorkView> = {}): WorkView {
  return {
    id: "papers-review", name: "Papers review", savedAt: "2026-09-25T15:00:00.000Z",
    selection: { subproject: "papers", component: "extract" },
    editors: {
      layout: { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] }] },
      groups: [
        { tabs: [{ repo: "pipeline", path: "functions/extract/function_app.py" }, { repo: ".", path: "README.md" }], active: 0 },
        { tabs: [{ workbench: true }] },
        { tabs: [{ folder: "notes", path: "todo.md" }] }
      ],
      activeGroup: 0
    },
    panes: ["project", "architecture", "details"],
    diagram: { full: { view: "architecture", dir: "TB", groupBy: "repository", folded: ["lane:pipeline"], zoom: "fit" }, map: { dir: "LR", groupBy: "none", folded: [], zoom: "100" } },
    preview: { scenario: "archi-3" },
    ...over
  };
}
const file = (views: WorkView[]): WorkViewsFile => ({ format: "datapass.work-views", version: "1", views });
const bytes = (f: unknown) => JSON.stringify(f);

// ------------------------------------------------------------------ views.json

test("views.json: a complete view round-trips through serialize and parse", () => {
  const parsed = parseWorkViews(serializeWorkViews(file([fullView()])));
  assert.deepEqual(parsed.views[0], fullView());
  assert.match(new TextDecoder().decode(serializeWorkViews(file([]))), /Never committed/);
});

test("views.json: machine paths, traversal and unknown fields are refused", () => {
  const withTab = (tab: unknown) => bytes(file([fullView({ editors: { layout: { orientation: 1, groups: [{}] }, groups: [{ tabs: [tab as never] }] } })]));
  assert.throws(() => parseWorkViews(withTab({ repo: "pipeline", path: "C:\\Users\\julia\\secret.txt" })), /absolute drive path/);
  assert.throws(() => parseWorkViews(withTab({ repo: "pipeline", path: "/etc/passwd" })), /absolute/);
  assert.throws(() => parseWorkViews(withTab({ repo: "pipeline", path: "../other/file.py" })), /parent traversal/);
  assert.throws(() => parseWorkViews(withTab({ repo: "pipeline", path: "a\\b.py" })), /write it as a\/b\.py/);
  assert.throws(() => parseWorkViews(withTab({ repo: "Pipeline", path: "a.py" })), /tabs\[0\] does not match any allowed alternative/);
  assert.throws(() => parseWorkViews(withTab({ folder: "x/y", path: "a.py" })), /folder|alternative/);
  assert.throws(() => parseWorkViews(withTab({ repo: "pipeline", path: "a.py", absolute: "C:\\a.py" })), /alternative/);
  assert.throws(() => parseWorkViews(bytes({ ...file([fullView()]), extra: 1 })), /not an allowed property/);
});

test("views.json: structural rules the schema cannot express", () => {
  const bad = (over: Partial<WorkView>, re: RegExp) => assert.throws(() => parseWorkViews(bytes(file([fullView(over)]))), re);
  bad({ editors: { layout: { orientation: 0, groups: [{}, {}] }, groups: [{ tabs: [] }] } }, /grid has 2 group/);
  bad({ editors: { layout: { orientation: 0, groups: [{}] }, groups: [{ tabs: [], active: 0 }] } }, /active tab/);
  bad({ editors: { layout: { orientation: 0, groups: [{}] }, groups: [{ tabs: [] }], activeGroup: 1 } }, /active group/);
  bad({ editors: { layout: { orientation: 0, groups: [{}, {}] }, groups: [{ tabs: [{ workbench: true }] }, { tabs: [{ workbench: true }] }] } }, /two groups/);
  bad({ floatingWorkbench: true }, /both floating and in a group/);
  bad({ preview: { scenario: "a", picks: ["d=o"] } }, /scenario or picks/);
  bad({ panes: ["project", "project"] }, /twice/);
  assert.throws(() => parseWorkViews(bytes(file([fullView(), fullView({ name: "Other" })]))), /two views have the id/);
  assert.throws(() => parseWorkViews(bytes(file(Array.from({ length: MAX_VIEWS + 1 }, (_, i) => fullView({ id: `v${i}`, name: `V${i}` }))))), /at most 40/);
  assert.throws(() => parseWorkViews(bytes(file([fullView({ diagram: { full: { dir: "TB", groupBy: "repository", folded: ["lane: spaced"], zoom: "fit" } } })]))), /folded/);
  assert.equal(viewProblem(fullView()), undefined);
});

test("layout: VS Code's pixel sizes become fractions; deep or huge grids are not saved", () => {
  assert.deepEqual(normalizeLayout({ orientation: 0, groups: [{ size: 472 }, { size: 315 }] }), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4 }] });
  assert.deepEqual(normalizeLayout({ orientation: 0, groups: [{ size: 394 }, { size: 393, groups: [{ size: 417 }, { size: 417 }] }] }),
    { orientation: 0, groups: [{ size: 0.501 }, { size: 0.499, groups: [{ size: 0.5 }, { size: 0.5 }] }] });
  assert.deepEqual(normalizeLayout({ orientation: 1, groups: [{}] }), { orientation: 1, groups: [{}] });
  const deep = { orientation: 0, groups: [{ groups: [{ groups: [{ groups: [{}, {}] }, {}] }, {}] }, {}] };
  assert.equal(normalizeLayout(deep), undefined);
  assert.equal(normalizeLayout({ orientation: 0, groups: Array.from({ length: 10 }, () => ({ size: 1 })) }), undefined);
  assert.equal(normalizeLayout({ orientation: 2, groups: [{}] }), undefined);
  assert.equal(normalizeLayout(null), undefined);
  assert.equal(leafCount({ orientation: 0, groups: [{}, { groups: [{}, {}] }] }), 3);
});

test("names, ids and descriptions", () => {
  assert.equal(viewIdFor("STUDY review", []), "study-review");
  assert.equal(viewIdFor("STUDY review", ["study-review"]), "study-review-2");
  assert.equal(viewIdFor("Études détaillées", []), "tudes-d-taill-es");
  assert.equal(viewIdFor("日本", []), "view");
  assert.equal(cleanViewName("  Wind   lab \n"), "Wind lab");
  assert.equal(cleanViewName("   "), undefined);
  assert.equal(cleanViewName("x".repeat(81)), undefined);
  const f = file([fullView()]);
  assert.equal(findView(f, "papers-review")?.name, "Papers review");
  assert.equal(findView(f, "PAPERS REVIEW")?.id, "papers-review");
  assert.equal(findView(f, "nope"), undefined);
  assert.equal(describeView(fullView(), { component: id => (id === "extract" ? "PDF extraction" : undefined) }),
    "PDF extraction · 3 groups, 3 files · Workbench tab · diagram vertical, lanes by repository · preview archi-3");
  assert.equal(describeView({ id: "a", name: "A", savedAt: "2026-09-25T15:00:00Z", floatingWorkbench: true }), "whole project · Workbench in its own window");
});

test("diagram settings from a webview are bounded and mode-specific", () => {
  assert.deepEqual(sanitizeDiagramUi({ view: "options", dir: "TB", groupBy: "cloud", folded: ["lane:azure", "parent:x", "bad fold", 3, "lane:azure"], zoom: "100" }, "full"),
    { view: "options", dir: "TB", groupBy: "cloud", folded: ["lane:azure", "parent:x"], zoom: "100" });
  assert.deepEqual(sanitizeDiagramUi({ view: "options", dir: "LR", groupBy: "none" }, "map"), { dir: "LR", groupBy: "none", folded: [], zoom: "fit" });
  assert.equal(sanitizeDiagramUi({ dir: "XX", groupBy: "none" }, "map"), undefined);
  assert.equal(sanitizeDiagramUi({ dir: "LR", groupBy: "everything" }, "map"), undefined);
  assert.equal(sanitizeDiagramUi("TB", "map"), undefined);
});

test("launcher requests: fresh only, a name only, nothing else", () => {
  const req = (over: Record<string, unknown> = {}) => JSON.stringify({ format: "datapass.open-view", version: "1", view: "papers-review", requestedAt: "2026-09-25T14:59:30.000Z", ...over });
  assert.deepEqual(parseOpenViewRequest(req(), NOW), { ok: true, view: "papers-review" });
  assert.equal(parseOpenViewRequest(req({ requestedAt: "2026-09-25T14:50:00.000Z" }), NOW).ok, false);
  assert.equal(parseOpenViewRequest(req({ requestedAt: "2026-09-25T15:05:00.000Z" }), NOW).ok, false);
  assert.equal(parseOpenViewRequest(req({ command: "workbench.action.terminal.new" }), NOW).ok, false);
  assert.equal(parseOpenViewRequest(req({ format: "other" }), NOW).ok, false);
  assert.equal(parseOpenViewRequest("{not json", NOW).ok, false);
  assert.equal(parseOpenViewRequest(" ".repeat(5000), NOW).ok, false);
});

// ------------------------------------------------------------------ company workspace file

test("folders are written relative to the workspace file, absolute only on another drive", () => {
  const w = path.win32, p = path.posix;
  assert.deepEqual(relativeFolderPath("D:\\PROJ", "D:\\PROJ\\foil-hub", w), { path: "foil-hub", absolute: false });
  assert.deepEqual(relativeFolderPath("D:\\PROJ\\workspaces", "D:\\PROJ\\foil-hub", w), { path: "../foil-hub", absolute: false });
  assert.deepEqual(relativeFolderPath("D:\\PROJ", "D:\\PROJ\\clients\\acme\\repo", w), { path: "clients/acme/repo", absolute: false });
  assert.deepEqual(relativeFolderPath("D:\\PROJ", "E:\\data\\repo", w), { path: "E:\\data\\repo", absolute: true });
  assert.deepEqual(relativeFolderPath("D:\\PROJ", "D:\\PROJ", w), { path: ".", absolute: false });
  assert.deepEqual(relativeFolderPath("/home/j/proj", "/home/j/proj/hub", p), { path: "hub", absolute: false });
  assert.deepEqual(relativeFolderPath("/home/j/proj", "/srv/repo", p), { path: "../../../srv/repo", absolute: false });
});

test("the company workspace document: folders, company, startup view, title colour", () => {
  const { doc, absolute } = buildCompanyWorkspace({
    file: "D:\\PROJ\\FOIL.code-workspace", company: "FOIL", color: "#1f6feb", startupView: "study",
    folders: ["D:\\PROJ\\foil-v1-vscode-datapass", "D:\\PROJ\\foil_databrick_dab", "d:\\proj\\FOIL_databrick_dab", "E:\\big\\wind-lab"]
  }, path.win32);
  assert.deepEqual(doc.folders, [{ path: "foil-v1-vscode-datapass" }, { path: "foil_databrick_dab" }, { path: "E:\\big\\wind-lab" }]);
  assert.deepEqual(absolute, ["E:\\big\\wind-lab"]);
  assert.deepEqual(doc.settings, {
    "datapass.company": "FOIL", "datapass.startupView": "study",
    "workbench.colorCustomizations": { "titleBar.activeBackground": "#1F6FEB", "titleBar.activeForeground": "#FFFFFF", "titleBar.inactiveBackground": "#1F6FEBB3", "titleBar.inactiveForeground": "#FFFFFFB3" }
  });
  assert.deepEqual(titleBarColors("#abcdef")["titleBar.activeBackground"], "#ABCDEF");
});

test("replacing a workspace file keeps its other settings, colours, extensions and tasks", () => {
  const existing = {
    folders: [{ path: "old" }], extensions: { recommendations: ["databricks.databricks"] }, tasks: { version: "2.0.0", tasks: [] },
    settings: { "editor.fontSize": 15, "datapass.startupView": "old", "workbench.colorCustomizations": { "titleBar.activeBackground": "#000000", "statusBar.background": "#222222" } }
  };
  const { doc } = buildCompanyWorkspace({ file: "/home/j/proj/FOIL.code-workspace", company: "FOIL", folders: ["/home/j/proj/hub"], existing }, path.posix);
  assert.deepEqual(doc.folders, [{ path: "hub" }]);
  assert.deepEqual(doc.extensions, existing.extensions);
  assert.deepEqual(doc.tasks, existing.tasks);
  assert.deepEqual(doc.settings, { "editor.fontSize": 15, "datapass.company": "FOIL", "workbench.colorCustomizations": { "statusBar.background": "#222222" } });
});

test("workspace files are read as JSON with comments and trailing commas", () => {
  const text = "\uFEFF{\n  // the company\n  \"folders\": [\n    { \"path\": \"hub\", \"name\": \"Hub // not a comment\" },\n    { \"uri\": \"vscode-remote://ssh-remote+vm/srv\" },\n    { \"path\": \"a/*b*/c\", },\n  ],\n  /* settings */\n  \"settings\": { \"datapass.company\": \"FOIL\", \"datapass.startupView\": \"study\", \"workbench.colorCustomizations\": { \"titleBar.activeBackground\": \"#1f6feb\" }, \"x\": \"say \\\"hi\\\", /* ok */\", },\n}\n";
  const parsed = parseWorkspaceFile(text);
  assert.deepEqual(parsed.folders, [{ path: "hub", name: "Hub // not a comment" }, { path: "a/*b*/c", name: undefined }]);
  assert.equal(parsed.company, "FOIL");
  assert.equal(parsed.startupView, "study");
  assert.equal(parsed.color, "#1F6FEB");
  assert.equal(parsed.settings.x, "say \"hi\", /* ok */");
  assert.equal(stripJsonc("[1, 2, // two\n]"), "[1, 2 \n]");
  assert.throws(() => parseWorkspaceFile("[1,2]"), /JSON object/);
  assert.deepEqual(workspaceFolderPaths("D:\\PROJ\\FOIL.code-workspace", [{ path: "hub" }, { path: "../other/x" }, { path: "E:\\y" }], path.win32), ["D:\\PROJ\\hub", "D:\\other\\x", "E:\\y"]);
});

test("the Power Ops list: launch command, views, startup flag and request files", () => {
  const doc = buildPowerOpsExport([{
    file: "D:\\PROJ\\Research Co.code-workspace", name: "Research Co", color: "#1F6FEB", startupView: "Papers Review",
    projects: [{ id: "research-library", title: "Research library", folder: "D:\\PROJ\\research-hub", views: [{ id: "papers-review", name: "Papers review", description: "…" }, { id: "lab", name: "Lab", description: "…" }] }]
  }], { generatedAt: "2026-09-25T15:00:00.000Z", generator: "DataPass Control Plane 0.17.0", requestFile: f => path.win32.join(f, ".datapass", "local", "open-view.json") });
  assert.equal(doc.format, "datapass.company-workspaces");
  const c = doc.companies[0]!;
  assert.deepEqual(c.launch, { command: "code", arguments: "\"D:\\PROJ\\Research Co.code-workspace\"" });
  assert.deepEqual(c.projects[0]!.views.map(v => [v.id, v.startup]), [["papers-review", true], ["lab", false]]);
  assert.deepEqual(c.projects[0]!.views[1]!.openView, { file: "D:\\PROJ\\research-hub\\.datapass\\local\\open-view.json", request: { format: "datapass.open-view", version: "1", view: "lab" } });
  assert.doesNotMatch(JSON.stringify(doc), /token|password|secret\"/i);
  assert.equal(quoteArg("D:\\PROJ\\FOIL.code-workspace"), "D:\\PROJ\\FOIL.code-workspace");
  assert.equal(quoteArg("C:\\My Files\\a b.code-workspace"), "\"C:\\My Files\\a b.code-workspace\"");
});

test("export location, file names and company names", () => {
  assert.equal(defaultExportFile({ LOCALAPPDATA: "C:\\Users\\j\\AppData\\Local" }, "win32", "C:\\Users\\j", path.win32), "C:\\Users\\j\\AppData\\Local\\DataPass\\company-workspaces.json");
  assert.equal(defaultExportFile({}, "linux", "/home/j", path.posix), "/home/j/.local/share/datapass/company-workspaces.json");
  assert.equal(defaultExportFile({ XDG_DATA_HOME: "/data" }, "linux", "/home/j", path.posix), "/data/datapass/company-workspaces.json");
  assert.equal(defaultExportFile({}, "darwin", "/Users/j", path.posix), "/Users/j/Library/Application Support/DataPass/company-workspaces.json");
  assert.equal(workspaceFileName("FOIL"), "FOIL.code-workspace");
  assert.equal(workspaceFileName("Acme: R&D / Lab."), "Acme R&D Lab.code-workspace");
  assert.equal(workspaceFileName("???"), "Company.code-workspace");
  assert.equal(cleanCompanyName("  Data  Pass "), "Data Pass");
  assert.equal(cleanCompanyName(""), undefined);
});
