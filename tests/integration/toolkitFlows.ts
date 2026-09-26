/**
 * Desktop flows for 0.21, the toolkit catalogue, in real VS Code on the "Sales BI" example (fixture
 * v18-toolchain, which since 0.21 has a board whose cards name recipes). Without a hub DataPass shows
 * its built-in baseline with dated prices; with the hub of the fixture (found through the
 * datapass.catalogs setting) the hub's tools, recipes and "Needs a newer DataPass" requests are
 * layered over it, recipe routes are resolved against the project, and a card's AI pack carries its
 * recipe. Links and install commands go through the scripted UI: nothing is opened or run.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const setCatalogs = (v: string[]) => vscode.workspace.getConfiguration("datapass").update("catalogs", v, vscode.ConfigurationTarget.Global);

export function registerToolkitFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const toolkit = () => api().workbenchState().toolkit!;

  test("toolkit: without a hub, the built-in baseline with dated prices; cards keep their recipe", async () => {
    await setCatalogs([]);
    await run("datapass.refreshProject");
    const k = toolkit();
    assert.equal(k.hub, false);
    assert.equal(k.files.length, 0);
    assert.ok(k.tools.length >= 49, `${k.tools.length} tools`);
    const copilot = k.tools.find(t => t.id === "cli.copilot")!;
    assert.equal(copilot.price.dated, "2026-09-26");
    assert.match(copilot.price.text, /^Free tier · paid from /);
    assert.ok(k.components.load?.tools.includes("ext.fabric"), "the notebook component's official tool is in the catalogue");
    const card = api().boardView()!.cards.find(c => c.id === "lowercase-copyjob")!;
    assert.deepEqual(card.recipe, { id: "fabric.item-definition.bulk-edit", route: "git" });
    // No toolkit read: the card's recipe is not reported as unknown.
    assert.ok(!api().projectMap().problems.some(p => p.message.includes("recipe")), "no recipe warning without a hub");
    record("toolkitBaselineTools", k.tools.length);
  }, ["v18-toolchain"]);

  test("toolkit: the hub's files layer over the baseline; routes resolved; Needs a newer DataPass listed", async () => {
    const hub = process.env.DATAPASS_IT_HUB;
    assert.ok(hub, "the fixture names its hub catalog");
    await setCatalogs([hub]);
    await run("datapass.refreshProject");
    const k = await waitFor("the hub's toolkit", () => toolkit().hub ? toolkit() : undefined);
    assert.deepEqual(k.files.map(f => f.path.replace(/^hub\//, "")).sort(), [".datapass/toolkit/recipes/fabric.json", ".datapass/toolkit/tools.json"]);
    assert.ok(k.files.every(f => !f.error && !f.skipped.length && !f.newer), JSON.stringify(k.files));
    assert.deepEqual(k.problems, []);
    assert.equal(k.tools.find(t => t.id === "ext.fabric-studio")?.source, "built-in, changed by the hub");
    assert.equal(k.tools.find(t => t.id === "acc.fabric-toolbox")?.source, "hub");
    assert.deepEqual(k.requests.map(r => r.title), ["Probe the Tabular Editor 3 version"]);
    const bulk = k.recipes.find(r => r.id === "fabric.item-definition.bulk-edit")!;
    // Sales BI declares the workspace's Git binding: the Git route applies and is suggested.
    assert.equal(bulk.routes.find(r => r.id === "git")?.applies, "yes");
    assert.equal(bulk.suggested, "git");
    assert.ok(!api().projectMap().problems.some(p => p.where.startsWith("board.json") && p.message.includes("recipe")), "every card names a known recipe");
    record("toolkitHub", { tools: k.tools.length, recipes: k.recipes.length, requests: k.requests.length });
  }, ["v18-toolchain"]);

  test("toolkit: a card's AI pack carries its recipe; install commands and links go through the person", async () => {
    const pack = await withUi([{ pick: "Implement it" }, { button: "Copy" }], () => run("datapass.board.aiPack", { item: "lowercase-copyjob" }));
    assert.match(pack.clipboard, /## Recipe the card follows \(toolkit\)/);
    assert.match(pack.clipboard, /Route "Git integration \(official\)" \(`git`, the card's route; applies here/);
    assert.doesNotMatch(pack.clipboard, /Route "Fabric CLI"/);
    const copy = await withUi([], () => run("datapass.toolkit.copyInstall", { tool: "ext.fabric-studio", index: 0 }));
    assert.equal(copy.clipboard, "code --install-extension GerhardBrueckl.fabricstudio");
    const step = await withUi([], () => run("datapass.toolkit.copyStep", { recipe: "fabric.item-definition.bulk-edit", route: "fab", step: 0 }));
    assert.equal(step.clipboard, "fab export <ws>.Workspace/<item>.CopyJob -o <folder>");
    const open = await withUi([{ button: "Open" }], () => run("datapass.toolkit.openLink", { tool: "cli.copilot", link: "pricing" }));
    assert.deepEqual(open.opened, ["https://github.com/features/copilot/plans"]);
    const refused = await withUi([], () => run("datapass.toolkit.openLink", { tool: "cli.copilot", link: "javascript" }), { allowErrors: true });
    assert.deepEqual(refused.opened, []);
    await run("datapass.openToolkit", "recipe:fabric.item-definition.bulk-edit");
    await run("workbench.action.closeAllEditors");
    await setCatalogs([]);
  }, ["v18-toolchain"]);
}
