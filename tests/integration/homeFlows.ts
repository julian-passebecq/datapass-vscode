/**
 * V3-HOME desktop flows (real VS Code, offline): the Home opens as an editor tab, a tile runs the
 * existing command behind it, the project links page lists .datapass/links.json and opens a link
 * only after the confirmation, and a work view saves and restores the Home tab.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const webviewTab = (type: string) => vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(type)));

export function registerHomeFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("V3-HOME: the Home opens as a tab, lists the modules by skill area, and a tile runs its command", async () => {
    await run("datapass.refreshProject");
    await run("workbench.action.closeAllEditors");
    await run("datapass.openHome");
    await waitFor("the Home tab", () => webviewTab("datapass.home") || undefined);
    assert.equal(api().home.isOpen(), true);
    const s = await api().home.state();
    assert.deepEqual(s.areas.flatMap(a => a.tiles.map(t => t.id)), ["architecture", "understand", "git", "ai", "board", "readiness", "links"]);
    assert.equal(s.links.state, "ok");
    assert.equal(s.links.count, 7);
    assert.ok(s.preview && s.preview.components > 0, "the architecture preview");
    // A tile opens its module alone: the board tile runs datapass.openBoard (the Workbench tab on the board).
    const done = await api().home.send({ type: "action", id: "board.open" });
    assert.equal(done?.command, "datapass.openBoard");
    assert.equal(done?.error, undefined);
    await waitFor("the Workbench tab", () => webviewTab("datapass.workbench") || undefined);
    // Untrusted messages: an unknown action or a command name is refused, nothing runs.
    const refused = await withUi([], () => api().home.send({ type: "action", id: "datapass.getUpdates" }), { allowErrors: true });
    assert.ok(refused.errors.some(e => /Unknown Home action/.test(e)), JSON.stringify(refused.errors));
    record("homeTiles", s.areas.map(a => `${a.title}: ${a.tiles.map(t => `${t.title} — ${t.summary}`).join(" | ")}`));
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("V3-HOME: the Project links page opens a link only after the confirmation, never by itself", async () => {
    await run("datapass.openProjectLinks");
    await waitFor("the Project links tab", () => webviewTab("datapass.projectLinks") || undefined);
    const declined = await withUi([{ dismiss: true }], () => api().home.send({ type: "link", group: 0, index: 0 }));
    assert.deepEqual(declined.opened, [], "declined: nothing opened");
    const ui = await withUi([{ button: "Open" }], () => api().home.send({ type: "link", group: 0, index: 0 }));
    assert.deepEqual(ui.opened, ["https://adb-1234567890123456.7.azuredatabricks.net/?o=1234567890123456"]);
    assert.ok(ui.prompts.some(p => p.modal && /links\.json/.test(p.text ?? "")));
    const bad = await withUi([], () => api().home.send({ type: "link", group: 9, index: 0 }), { allowErrors: true });
    assert.equal(bad.opened.length, 0);
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("V3-HOME: a saved layout keeps the Home tab and applying it reopens the Home", async () => {
    await run("workbench.action.closeAllEditors");
    await run("datapass.openHome");
    await waitFor("the Home tab", () => webviewTab("datapass.home") || undefined);
    await run("datapass.saveWorkView", "Home only");
    const saved = (await api().workViews()).views.find(v => v.name === "Home only");
    assert.ok(saved?.editors?.groups.some(g => g.tabs.some(t => "home" in t)), JSON.stringify(saved));
    await run("workbench.action.closeAllEditors");
    await waitFor("the Home closed", () => !api().home.isOpen() || undefined);
    const s = await api().home.state();
    assert.ok(s.layouts.some(l => l.id === saved!.id && /Home tab/.test(l.detail)));
    const done = await api().home.send({ type: "layout", id: saved!.id });
    assert.equal(done?.error, undefined);
    await waitFor("the Home reopened by the layout", () => api().home.isOpen() || undefined);
    await withUi([{ button: "Delete" }], () => run("datapass.deleteWorkView", saved!.id));
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);
}
