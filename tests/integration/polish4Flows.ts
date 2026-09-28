/**
 * V1.1.x-POLISH-4 desktop flows (real VS Code, fixture v3-research): the status-bar Home and zoom items,
 * A− / A+ / reset on VS Code's editor.fontSize, keys VS Code leaves free, "Appearance…", "Show DataPass in
 * the Activity Bar", and the Home button restoring the Home page, the DataPass tree and the right rail
 * from a scattered editor arrangement — with and without a saved layout named "Home".
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { ZOOM_COMMANDS, ZOOM_KEYS } from "../../src/core/experience/ergonomics";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const ONLY = ["v3-research"];
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const fontSize = () => vscode.workspace.getConfiguration("editor").get<number>("fontSize");
const workspaceFontSize = () => vscode.workspace.getConfiguration("editor").inspect<number>("fontSize")?.workspaceValue;
const editorTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));

export function registerPolish4Flows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const panes = () => api().windowInfo().panes;
  const rightShown = () => panes().includes("aiExchange") || panes().includes("details") || api().shell.railResolved();

  test("POLISH-4: A− / A+ / reset step editor.fontSize from the status bar, the Home page and the keys", async () => {
    await run("datapass.refreshProject");
    const start = fontSize() ?? 14;
    assert.equal(api().ergonomics.status().home, "$(home) Home");
    assert.equal(api().ergonomics.status().size, `$(text-size) ${start}`);
    await run(ZOOM_COMMANDS.bigger);
    await waitFor("one pixel larger", () => fontSize() === start + 1 || undefined);
    assert.equal(workspaceFontSize(), start + 1, "written in this workspace's settings");
    await waitFor("the status bar follows", () => api().ergonomics.status().size === `$(text-size) ${start + 1}` || undefined);
    // The Home page's A− runs the same command, and its toolbar names the size.
    await run("datapass.openHome");
    await waitFor("the Home tab", () => api().home.isOpen() || undefined);
    assert.equal((await api().home.state()).codeFontSize, start + 1);
    const done = await api().home.send({ type: "action", id: "font.smaller" });
    assert.equal(done?.command, ZOOM_COMMANDS.smaller);
    await waitFor("back to the start size", () => fontSize() === start || undefined);
    await run(ZOOM_COMMANDS.reset);
    await waitFor("the workspace value removed", () => workspaceFontSize() === undefined || undefined);
    record("polish4.zoom", { start, status: api().ergonomics.status() });
  }, ONLY);

  test("POLISH-4: the zoom keys are free in VS Code's default keybindings (only DataPass uses them)", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("vscode://defaultsettings/keybindings.json"));
    const text = doc.getText();
    assert.ok(text.length > 1000, "the default keybindings were read");
    const bound = new Map<string, string[]>();
    for (const m of text.matchAll(/"key":\s*"([^"]+)",\s*"command":\s*"([^"]+)"/g)) bound.set(m[1]!, [...(bound.get(m[1]!) ?? []), m[2]!]);
    for (const [step, key] of Object.entries(ZOOM_KEYS)) {
      const others = (bound.get(key) ?? []).filter(c => !c.startsWith("datapass.") && !c.startsWith("-"));
      assert.deepEqual(others, [], `${key} (${step}) is also bound to ${others.join(", ")}`);
    }
    record("polish4.keys", Object.fromEntries(Object.values(ZOOM_KEYS).map(k => [k, bound.get(k) ?? []])));
    await run("workbench.action.closeActiveEditor");
  }, ONLY);

  test("POLISH-4: Appearance lists every look setting and switches the overlay and the tree icons", async () => {
    const overlay = () => vscode.workspace.getConfiguration("datapass").get<boolean>("overlay.enabled", true);
    const icons = () => vscode.workspace.getConfiguration("datapass").get<boolean>("tree.coloredIcons", false);
    const before = { overlay: overlay(), icons: icons() };
    const ui = await withUi([{ pick: before.overlay ? "Hide the DataPass overlay" : "Show the DataPass overlay" }], () => run("datapass.appearance"));
    const pick = ui.prompts.find(p => p.kind === "pick" && p.title === "DataPass: Appearance");
    assert.ok(pick, JSON.stringify(ui.prompts));
    for (const label of ["Colour theme…", "Overlay colours…", "Smaller code (A−)", "Larger code (A+)", "Code font size…", "Show DataPass in the Activity Bar"]) {
      assert.ok(pick.options?.some(o => o.includes(label)), `${label}: ${pick.options?.join(" | ")}`);
    }
    await waitFor("the overlay switched", () => overlay() !== before.overlay || undefined);
    await run("datapass.appearance", "overlay.toggle");
    await waitFor("the overlay back", () => overlay() === before.overlay || undefined);
    await run("datapass.appearance", "tree.colors");
    await waitFor("the tree icons switched", () => icons() !== before.icons || undefined);
    await run("datapass.appearance", "tree.colors");
    await waitFor("the tree icons back", () => icons() === before.icons || undefined);
    // A webview or a link can only name a choice, never a command.
    const bad = await withUi([], () => run("datapass.appearance", "workbench.action.quit"), { allowErrors: true });
    assert.ok(bad.errors.some(e => /Unknown appearance choice/.test(e)), JSON.stringify(bad.errors));
    record("polish4.appearance", pick.options);
  }, ONLY);

  test("POLISH-4: Show DataPass in the Activity Bar opens the DataPass side bar and says how to keep the icon", async () => {
    await run("workbench.view.explorer");
    await waitFor("the Explorer shows", () => !panes().includes("project") || undefined);
    const ui = await withUi([], () => run("datapass.showInActivityBar"));
    assert.deepEqual(api().ergonomics.lastActivityBar(), { opened: true, barHidden: false });
    await waitFor("the DataPass tree", () => panes().includes("project") || undefined);
    assert.ok(ui.notices.some(n => /right-click the Activity Bar/.test(n) && /tick DataPass/.test(n)), JSON.stringify(ui.notices));
  }, ONLY);

  test("POLISH-4: Home restores the Home page, the tree and the rail from any arrangement, then a saved Home layout", async () => {
    // A scattered window: three editor groups, no side bars, no Home.
    await run("workbench.action.closeAllEditors");
    const files = await vscode.workspace.findFiles(".datapass/*.json", undefined, 3);
    assert.ok(files.length >= 2, "fixture files");
    await vscode.window.showTextDocument(files[0]!, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.window.showTextDocument(files[1]!, { viewColumn: vscode.ViewColumn.Two, preview: false });
    await vscode.window.showTextDocument(files[0]!, { viewColumn: vscode.ViewColumn.Three, preview: false });
    await run("workbench.action.closeSidebar");
    await run("workbench.action.closeAuxiliaryBar");
    await waitFor("the side bars closed", () => (!panes().includes("project") && !rightShown()) || undefined);

    await run("datapass.home.restore");
    await waitFor("the Home tab", () => api().home.isOpen() || undefined);
    await waitFor("the DataPass tree", () => panes().includes("project") || undefined);
    await waitFor("the right rail or panel", () => rightShown() || undefined);
    assert.equal(api().ergonomics.lastRestore()?.layout, undefined, "no saved Home layout yet");
    assert.match((await api().home.state()).homeLayout ?? "none", /^none$/);

    // Save this window as the Home layout (the Home page's button), scatter again, restore it.
    await run("workbench.action.closeAllEditors");
    await vscode.window.showTextDocument(files[1]!, { viewColumn: vscode.ViewColumn.One, preview: false });
    await run("datapass.openHome");
    const saved = await api().home.send({ type: "action", id: "layout.saveHome" });
    assert.equal(saved?.error, undefined);
    const home = (await api().workViews()).views.find(v => v.name === "Home");
    assert.ok(home, "a layout named Home");
    assert.equal((await api().home.state()).homeLayout, "Home");
    await run("workbench.action.closeAllEditors");
    await vscode.window.showTextDocument(files[0]!, { viewColumn: vscode.ViewColumn.Two, preview: false });
    await run("workbench.action.closeSidebar");
    await run("workbench.action.closeAuxiliaryBar");

    await run("datapass.home.restore");
    assert.deepEqual({ layout: api().ergonomics.lastRestore()?.layout, why: api().ergonomics.lastRestore()?.why }, { layout: "Home", why: "home" });
    const name = files[1]!.path.split("/").pop()!;
    await waitFor("the saved file back", () => editorTabs().includes(name) || undefined);
    await waitFor("the Home tab", () => api().home.isOpen() || undefined);
    await waitFor("the DataPass tree", () => panes().includes("project") || undefined);
    await waitFor("the right rail or panel", () => rightShown() || undefined);
    record("polish4.home", { tabs: editorTabs(), panes: panes(), rail: api().shell.rail() });
    await withUi([{ button: "Delete" }], () => run("datapass.deleteWorkView", home.id));
    await run("workbench.action.closeAllEditors");
  }, ONLY);
}
