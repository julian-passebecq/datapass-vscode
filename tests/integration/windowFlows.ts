/**
 * 0.17 desktop flows (real VS Code): the editor-layout API DataPass relies on, work views saved and
 * applied through the real commands, unsaved work kept, the status-bar switcher, the Workbench in a
 * floating window (VS Code's own command), the company workspace file, the Power Ops list, a
 * launcher's one-shot request, and a company workspace file that opens with its startup view.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DataPassTestApi } from "../../src/extension";
import { parseWorkspaceFile } from "../../src/core/windows/company";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const layout = () => vscode.commands.executeCommand<unknown>("vscode.getEditorLayout");
const leaves = (l: unknown): number => {
  const groups = (l as { groups?: unknown[] } | null)?.groups;
  return Array.isArray(groups) && groups.length ? groups.reduce((n: number, g) => n + leaves(g), 0) : 1;
};
const groups = () => [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn).map(g => ({ column: g.viewColumn, tabs: g.tabs.map(t => t.label) }));
const closeEverything = async () => { await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs)); };
/** A machine path in a file that must hold only repository-relative paths. */
const MACHINE_PATH = /[A-Za-z]:[\\/]|"\/(home|Users|tmp|var|private|srv|mnt)\//;
const v3Env = () => JSON.parse(process.env.DATAPASS_IT_V3 ?? "{}") as { pipelineClone: string };

export function registerWindowFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const root = () => api().project().root!;
  const local = (name: string) => path.join(root().fsPath, ".datapass", "local", name);

  // ------------------------------------------------------------ v3-research (a single-folder window)

  test("0.17: the VS Code layout commands DataPass relies on exist and report the grid", async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    for (const c of ["vscode.getEditorLayout", "vscode.setEditorLayout", "workbench.action.moveEditorToNewWindow", "workbench.action.closePanel", "workbench.action.closeAuxiliaryBar"]) assert.ok(all.has(c), `${c} is not registered`);
    await closeEverything();
    await run("vscode.setEditorLayout", { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4 }] });
    const l = await layout();
    assert.equal(leaves(l), 2, JSON.stringify(l));
    record("editorLayoutApi", { reported: l, note: "sizes are reported in pixels and accepted as weights" });
  }, ["v3-research"]);

  test("0.17: Save Work View keeps the grid, repository-relative files, the Workbench, panes, diagram and selection", async () => {
    await closeEverything();
    await api().select({ component: "extract" });
    await run("vscode.setEditorLayout", { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4 }] });
    const readme = vscode.Uri.joinPath(root(), "README.md");
    const fnApp = vscode.Uri.file(path.join(v3Env().pipelineClone, "functions", "extract", "function_app.py"));
    await run("vscode.open", readme, { viewColumn: 1, preview: false });
    await run("vscode.open", fnApp, { viewColumn: 1, preview: false });
    await run("workbench.action.focusSecondEditorGroup");
    await run("datapass.openWorkbench");
    await run("datapass.architecture.focus");
    await run("datapass.details.focus");
    await run("datapass.project.focus");
    await api().setDiagramUi({ full: { view: "architecture", dir: "TB", groupBy: "repository", folded: [], zoom: "fit" }, map: { dir: "LR", groupBy: "cloud", folded: [], zoom: "fit" } });
    await run("vscode.open", fnApp, { viewColumn: 1, preview: false, preserveFocus: false });
    await waitFor("the DataPass views to show", () => (["project", "architecture", "details"] as const).every(p => api().windowInfo().panes.includes(p)));
    await withUi([{ input: "Papers review" }], () => run("datapass.saveWorkView"));
    const v = (await api().workViews()).views.find(x => x.id === "papers-review");
    assert.ok(v, "the view was not saved");
    assert.deepEqual(v!.selection, { subproject: "papers", component: "extract" });
    assert.equal(leaves(v!.editors!.layout), 2);
    assert.deepEqual(v!.editors!.groups[0], { tabs: [{ repo: ".", path: "README.md" }, { repo: "pipeline", path: "functions/extract/function_app.py" }], active: 1 });
    assert.deepEqual(v!.editors!.groups[1]!.tabs, [{ workbench: true }]);
    assert.equal(v!.editors!.activeGroup, 0);
    for (const p of ["project", "architecture", "details"] as const) assert.ok(v!.panes?.includes(p), `pane ${p} not recorded: ${JSON.stringify(v!.panes)}`);
    assert.equal(v!.diagram?.full?.dir, "TB");
    assert.equal(v!.diagram?.map?.groupBy, "cloud");
    assert.equal(v!.floatingWorkbench, undefined);
    assert.doesNotMatch(fs.readFileSync(local("views.json"), "utf8"), MACHINE_PATH, "views.json holds a machine path");
    assert.match(fs.readFileSync(local(".gitignore"), "utf8"), /^\*$/m, ".datapass/local does not ignore itself");
    record("workViewSaved", v);
  }, ["v3-research"]);

  test("0.17: Apply Work View restores the grid, files, Workbench, panes, selection and diagram in one call", async () => {
    await closeEverything();
    await run("vscode.setEditorLayout", { orientation: 1, groups: [{}, {}, {}] });
    await api().select({ subproject: "lab" });
    await api().setDiagramUi({ full: { view: "options", dir: "LR", groupBy: "none", folded: [], zoom: "100" } });
    await run("workbench.action.closePanel");
    const start = Date.now();
    await withUi([], () => run("datapass.applyWorkView", "papers-review"));
    const ms = Date.now() - start;
    assert.equal(leaves(await layout()), 2);
    const g = groups();
    assert.deepEqual(g.map(x => x.tabs), [["README.md", "function_app.py"], ["DataPass Workbench"]], JSON.stringify(g));
    assert.equal(vscode.window.tabGroups.all.find(x => x.viewColumn === 1)?.activeTab?.label, "function_app.py");
    assert.deepEqual(api().selection(), { subproject: "papers", component: "extract" });
    const info = api().windowInfo();
    assert.equal(info.diagramUi.full?.dir, "TB");
    assert.equal(info.diagramUi.full?.view, "architecture");
    assert.equal(info.lastApplied, "papers-review");
    await waitFor("the Architecture panel shown again", () => api().windowInfo().panes.includes("architecture"));
    record("workViewApplied", { ms, groups: g, panes: info.panes });
  }, ["v3-research"]);

  test("0.17: a work view never closes unsaved work", async () => {
    const draft = await vscode.workspace.openTextDocument({ content: "draft notes", language: "markdown" });
    await vscode.window.showTextDocument(draft, { viewColumn: vscode.ViewColumn.One, preview: false });
    await withUi([], () => run("datapass.applyWorkView", "papers-review"));
    assert.ok(vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.isDirty)), "the unsaved tab was closed");
    await vscode.window.showTextDocument(draft);
    await run("workbench.action.revertAndCloseActiveEditor");
  }, ["v3-research"]);

  test("0.17: rename keeps the id; a single-folder window refuses a startup view; delete asks first", async () => {
    await withUi([{ input: "Papers — review" }], () => run("datapass.renameWorkView", "papers-review"));
    assert.equal((await api().workViews()).views.find(v => v.id === "papers-review")?.name, "Papers — review");
    const refused = await withUi([], () => run("datapass.setStartupView", "papers-review"), { allowErrors: true });
    assert.match(refused.errors.join(" "), /no workspace file/);
    await withUi([{ input: "Scratch" }], () => run("datapass.saveWorkView"));
    await withUi([{ button: "Delete" }], () => run("datapass.deleteWorkView", "scratch"));
    assert.deepEqual((await api().workViews()).views.map(v => v.id), ["papers-review"]);
  }, ["v3-research"]);

  test("0.17: the status-bar switcher shows company · sub-project and switches in one pick", async () => {
    await api().select({ subproject: "papers" });
    await waitFor("switcher text", () => /Research library · Papers pipeline/.test(api().windowInfo().switcherText));
    const ui = await withUi([{ pick: "Simulation lab" }], () => run("datapass.openSwitcher"));
    assert.equal(api().selection().subproject, "lab");
    await waitFor("the switcher follows the selection", () => /Research library · Simulation lab/.test(api().windowInfo().switcherText));
    await withUi([{ pick: "Papers — review" }], () => run("datapass.openSwitcher"));
    assert.deepEqual(api().selection(), { subproject: "papers", component: "extract" });
    record("switcher", { text: api().windowInfo().switcherText, tooltip: api().windowInfo().switcherTooltip, items: ui.prompts[0]?.options });
  }, ["v3-research"]);

  test("0.17: Open the Workbench in a floating window uses VS Code's own command; files still open in the main window", async () => {
    await closeEverything();
    await run("vscode.setEditorLayout", { orientation: 0, groups: [{}] });
    let saved: Awaited<ReturnType<DataPassTestApi["workViews"]>>["views"][number] | undefined;
    try {
      await withUi([], () => run("datapass.openWorkbenchFloating"));
      assert.equal(await api().workbenchFloating(), true, `not floating: ${JSON.stringify(groups())}`);
      const floating = groups();
      // A component file opened while the Workbench floats goes to the main window's first group.
      await run("datapass.openComponentFile", "extract", "functions/extract/function_app.py");
      assert.equal(vscode.window.tabGroups.all.find(g => g.tabs.some(t => t.label === "function_app.py"))?.viewColumn, 1, JSON.stringify(groups()));
      // Asking again is harmless.
      await withUi([], () => run("datapass.openWorkbenchFloating"));
      // A view saved now records the floating Workbench, or DataPass refuses because the floating window has the focus
      // (VS Code arranges the focused window); which one depends on how this desktop hands focus to new windows.
      const save = await withUi([{ input: "Second screen" }], () => run("datapass.saveWorkView"), { allowErrors: true });
      saved = (await api().workViews()).views.find(v => v.id === "second-screen");
      if (save.errors.length) assert.match(save.errors.join(" "), /floating window has the focus/);
      else assert.equal(saved?.floatingWorkbench, true, JSON.stringify(saved));
      record("floatingWorkbench", { groups: floating, afterOpenFile: groups(), savedWhileFloating: save.errors.length ? "refused (focus in the floating window)" : saved });
    } finally {
      // Back to one window whatever happened, so later tests start from the main window.
      await closeEverything();
      await waitFor("the floating window closes with its last tab", async () => vscode.window.tabGroups.all.length === 1 && !(await api().workbenchFloating()));
    }
    if (saved) await withUi([{ button: "Delete" }], () => run("datapass.deleteWorkView", "second-screen"));
  }, ["v3-research"]);

  test("0.17: Create the Company Workspace File writes relative folders, the company, a title colour and the startup view", async () => {
    const file = path.join(path.dirname(root().fsPath), "Research Co.code-workspace");
    const ui = await withUi([
      { pick: ["research-hub", "research-pipeline", "lab-clone"] },
      { input: "Research Co" },
      { save: vscode.Uri.file(file) },
      { pick: "Teal" },
      { pick: "Papers — review" },
      { dismiss: true }
    ], () => run("datapass.createCompanyWorkspace"));
    const text = fs.readFileSync(file, "utf8");
    const doc = parseWorkspaceFile(text);
    const paths = doc.folders.map(f => f.path);
    assert.deepEqual(paths.slice(0, 2), ["research-hub", "research-pipeline"], text);
    for (const p of paths) assert.ok(!path.isAbsolute(p), `absolute folder path ${p}`);
    assert.doesNotMatch(text, MACHINE_PATH);
    assert.equal(doc.company, "Research Co");
    assert.equal(doc.startupView, "papers-review");
    assert.equal(doc.color, "#0E7C86");
    assert.ok(ui.prompts.some(p => p.kind === "message" && /VS Code Profiles/.test(p.text ?? "")), "no note about VS Code Profiles");
    record("companyWorkspace", { file: path.basename(file), folders: paths, settings: doc.settings, prompts: ui.prompts.map(p => `${p.kind}: ${p.title ?? p.text?.split("\n")[0] ?? ""}`) });
  }, ["v3-research"]);

  test("0.17: the Power Ops list names the company workspace, its work views and each view's request file", async () => {
    const out = path.join(path.dirname(root().fsPath), "power-ops", "company-workspaces.json");
    // Left in place for the rest of this run: later changes keep this list (not a real one) up to date.
    api().setExportFile(out);
    await withUi([{ dismiss: true }], () => run("datapass.exportCompanyWorkspaces"));
    const doc = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(doc.format, "datapass.company-workspaces");
    const company = doc.companies.find((c: { name: string }) => c.name === "Research Co");
    assert.ok(company, JSON.stringify(doc.companies.map((c: { name: string }) => c.name)));
    assert.equal(company.launch.command, "code");
    assert.match(company.launch.arguments, /Research Co\.code-workspace/);
    const project = company.projects.find((p: { id: string }) => p.id === "research-library");
    assert.deepEqual(project.views.map((v: { id: string }) => v.id), ["papers-review"]);
    assert.equal(project.views[0].startup, true);
    assert.match(project.views[0].openView.file, /[\\/]\.datapass[\\/]local[\\/]open-view\.json$/);
    assert.deepEqual(project.views[0].openView.request, { format: "datapass.open-view", version: "1", view: "papers-review" });
    // Kept up to date: renaming the view rewrites the list.
    const renameUi = await withUi([{ input: "Papers review" }], () => run("datapass.renameWorkView", "papers-review"));
    // V1-STAB diagnostic for the Windows flake: was the view renamed at all, or did the list lag behind it?
    const stored = (await api().workViews()).views.find(v => v.id === "papers-review")?.name;
    assert.equal(stored, "Papers review", `rename not stored; prompts: ${JSON.stringify(renameUi.prompts)}`);
    const again = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(again.companies.find((c: { name: string }) => c.name === "Research Co").projects[0].views[0].name, "Papers review");
    record("powerOpsList", doc);
  }, ["v3-research"]);

  test("0.17: a launcher's request applies a work view once and is deleted; a stale request is refused", async () => {
    await api().select({ subproject: "lab" });
    const request = local("open-view.json");
    fs.writeFileSync(request, JSON.stringify({ format: "datapass.open-view", version: "1", view: "papers-review", requestedAt: new Date().toISOString() }));
    await waitFor("the requested view applied", () => api().selection().component === "extract", 20000);
    await waitFor("the request deleted", () => !fs.existsSync(request));
    await api().select({ subproject: "lab" });
    fs.writeFileSync(request, JSON.stringify({ format: "datapass.open-view", version: "1", view: "papers-review", requestedAt: new Date(Date.now() - 10 * 60_000).toISOString() }));
    await waitFor("the stale request deleted", () => !fs.existsSync(request), 20000);
    assert.equal(api().selection().subproject, "lab", "a stale request was applied");
  }, ["v3-research"]);

  // ------------------------------------------------------------ v17-company (a company workspace file)

  test("0.17: a company workspace file opens with its startup work view", async () => {
    const applied = await api().startup();
    assert.equal(applied, "review");
    assert.match(vscode.workspace.workspaceFile?.fsPath ?? "", /Research Co\.code-workspace$/);
    assert.equal(vscode.workspace.workspaceFolders?.length, 2);
    assert.deepEqual(api().selection(), { subproject: "papers", component: "review" });
    assert.equal(leaves(await layout()), 2);
    const g = groups();
    assert.deepEqual(g.map(x => x.tabs), [["README.md"], ["chunks.json"]], JSON.stringify(g));
    const info = api().windowInfo();
    assert.equal(info.company, "Research Co");
    assert.match(info.switcherText, /Research Co · Papers pipeline/);
    assert.equal(info.diagramUi.full?.dir, "TB");
    const repos = Object.fromEntries(api().projectMap().repositories.map(r => [r.key, `${r.state}:${r.source ?? ""}`]));
    assert.equal(repos.pipeline, "local:workspace-folder", JSON.stringify(repos));
    record("companyStartup", { groups: g, switcher: info.switcherText, repositories: repos });
  }, ["v17-company"]);

  test("0.17: choosing the startup view writes it into the workspace file (and clearing removes it)", async () => {
    const file = vscode.workspace.workspaceFile!.fsPath;
    await withUi([{ input: "Second" }], () => run("datapass.saveWorkView"));
    await withUi([], () => run("datapass.setStartupView", "second"));
    await waitFor("workspace file updated", () => /"datapass\.startupView":\s*"second"/.test(fs.readFileSync(file, "utf8")));
    await withUi([], () => run("datapass.setStartupView", ""));
    await waitFor("startup view removed", () => !/datapass\.startupView/.test(fs.readFileSync(file, "utf8")));
    assert.match(fs.readFileSync(file, "utf8"), /"datapass\.company":\s*"Research Co"/);
  }, ["v17-company"]);
}
