/**
 * 0.22 modes (package B) desktop flows, fixture v22-modes: the research project opened as a new
 * install (no DataPass settings, so Standard). Checks, in a real VS Code: the views the `when`
 * clauses hide and show, the landing on the architecture, the Project tree / Workbench / AI view
 * sections per mode, the status item, that switching writes no file in any repository, that
 * blockers and a refused secret still show in Vanilla, and that a command hidden from the menus
 * still runs from the palette.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";

const ONLY = ["v22-modes"];
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const tryRun = async (command: string) => { try { await run(command); } catch { /* a hidden view may refuse focus */ } };

export function registerExperienceFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const root = () => api().project().root!.fsPath;
  const gitStatus = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root(), encoding: "utf8" });
  const mode = async (id: string) => { await run("datapass.experience.switchMode", id); await waitFor(`mode ${id}`, () => api().experience.current().preset === id); };
  const panes = () => api().windowInfo().panes;
  const treeSections = async () => (await api().renderProjectTree()).filter(r => r.depth === 0).map(r => r.id ?? r.label);
  const workbenchTab = () => vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label === "DataPass Workbench"));
  let statusBefore = "";

  test("0.22 modes: a new install opens in Standard, on the architecture, with the mode in the status bar", async () => {
    await api().startup();
    await api().experience.ready();
    statusBefore = gitStatus();
    const x = api().experience.current();
    assert.equal(x.preset, "standard");
    assert.deepEqual(x.messages, []);
    assert.equal(await api().experience.landed(), true, "Standard lands on the architecture");
    // V3-SHELL: no bottom-panel Architecture by default: the landing opens the Workbench tab.
    await waitFor("the Workbench tab is open", workbenchTab);
    assert.ok(!panes().includes("architecture"), `panes: ${panes().join(", ")}`);
    const status = api().experience.status();
    assert.equal(status.visible, true);
    assert.equal(status.text, "$(layers) DataPass: Standard");
    assert.match(status.tooltip, /DataPass mode: Standard/);
    record("modes.standard", { panes: panes(), status: status.text });
  }, ONLY);

  test("V1-RC3: an open Quick Pick stays open through the landing, a mode switch and a refresh", async () => {
    const pick = vscode.window.createQuickPick();
    pick.items = [{ label: "one" }, { label: "two" }];
    let hidden = false;
    pick.onDidHide(() => { hidden = true; });
    pick.show();
    try {
      await new Promise(r => setTimeout(r, 300));
      assert.equal(await api().experience.land(), true, "Standard lands on the architecture");
      await waitFor("the Workbench tab is open", workbenchTab);
      assert.equal(hidden, false, "the landing took the keyboard and closed the picker");
      await mode("advanced");
      await run("datapass.refreshProject");
      await new Promise(r => setTimeout(r, 1_500));
      assert.equal(hidden, false, "a mode switch or a refresh took the keyboard and closed the picker");
    } finally {
      pick.dispose();
      await mode("standard");
    }
  }, ONLY);

  test("0.22 modes: Standard hides the Work and Galaxy views (when clauses) and shows the Project tree, Git, AI, Details", async () => {
    await run("datapass.project.focus");
    await waitFor("the Project tree (V3-SHELL: one tree on the left, in Standard too)", () => panes().includes("project"));
    await tryRun("datapass.galaxy.focus");
    await run("datapass.details.focus");
    await waitFor("Details shown", () => panes().includes("details"));
    assert.ok(!panes().includes("galaxy"), `panes: ${panes().join(", ")}`);
    await run("datapass.git.focus");
    await run("datapass.aiExchange.focus");
    await waitFor("the AI view", () => panes().includes("aiExchange"));
    // V1-STAB: Workbench Layout in Standard — the hidden Project view does not stop the Architecture and Details.
    await run("datapass.arrangeWorkbench");
    await waitFor("Details after Workbench Layout", () => panes().includes("details"));
    assert.ok(!panes().includes("architecture"), "Workbench Layout leaves the bottom panel alone while the Architecture view is off");
  }, ONLY);

  test("0.22 modes: Standard marks components with alternatives instead of the Options section; Workbench and AI tabs gated", async () => {
    const sections = await treeSections();
    for (const hidden of ["options", "sheet", "board", "env"]) assert.ok(!sections.includes(hidden), `${hidden} hidden in Standard: ${sections.join(", ")}`);
    assert.ok(sections.includes("repositories"));
    const rows = await api().renderProjectTree();
    const marked = rows.filter(r => / · alternatives exist$/.test(r.description ?? ""));
    assert.ok(marked.length > 0, "components an options.json decision can change are marked");
    const wb = api().workbenchState();
    assert.deepEqual(wb.experience, { hiddenViews: ["options", "sheet", "board", "workOrders", "toolkit"], alternatives: true });
    assert.deepEqual((await api().aiExchange.state() as { hiddenTabs?: string[] }).hiddenTabs, ["agent", "manual", "pilot"]);
    record("modes.standardTree", sections);
  }, ONLY);

  test("0.22 modes: a command hidden from the menus still runs from the palette", async () => {
    // Standard hides the Options view and its menu entry, not the command (D-03).
    await run("datapass.openOptions");
    await waitFor("the Workbench tab", () => vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label === "DataPass Workbench")));
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs.filter(t => t.label === "DataPass Workbench")));
  }, ONLY);

  test("0.22 modes: Vanilla shows Git and the AI view (guided tab only); blockers and refused secrets still show", async () => {
    await mode("vanilla");
    assert.equal(api().experience.status().text, "$(layers) DataPass: Vanilla");
    await tryRun("datapass.architecture.focus");
    await tryRun("datapass.details.focus");
    await run("datapass.git.focus");
    await waitFor("architecture and details hidden", () => !panes().includes("architecture") && !panes().includes("details"));
    assert.deepEqual((await api().aiExchange.state() as { hiddenTabs?: string[] }).hiddenTabs, ["agent", "manual", "pilot"]);
    // Components are not listed in Vanilla, repositories and problems are.
    const sections = await treeSections();
    assert.ok(!sections.some(s => s.startsWith("sp:")), sections.join(", "));
    assert.ok(sections.includes("repositories"));
    // The AI exchange still refuses an answer that carries a secret.
    const options = JSON.parse(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(api().project().root!, ".datapass", "options.json")).then(b => Buffer.from(b).toString("utf8")));
    options.decisions[0].notes = "connect with AccountKey=abcdefghijklmnop";
    const replies = await api().aiExchange.send({ type: "check", seq: 3, text: JSON.stringify(options) });
    assert.equal((replies[0]?.review as { ok: boolean }).ok, false, "a leaky answer cannot be written in Vanilla either");
    // The Git view (visible in Vanilla) is where Restricted Mode and repository blockers show.
    const git = await api().git.renderTree();
    assert.ok(git.length > 0);
    // V3-POLISH-2: Vanilla hides the Airflow DAG view, so the rail offers no DAG button.
    assert.ok(!api().shell.railButtons().includes("airflow"), api().shell.railButtons().join(", "));
    record("modes.vanilla", { panes: panes(), sections });
  }, ONLY);

  test("0.22 modes: Advanced shows everything as in 0.20", async () => {
    await mode("advanced");
    assert.ok(api().shell.railButtons().includes("airflow"), "Advanced shows the DAG button");
    await run("datapass.project.focus");
    await waitFor("the Project tree", () => panes().includes("project"));
    await run("datapass.galaxy.focus");
    await waitFor("the Galaxy view", () => panes().includes("galaxy"));
    const sections = await treeSections();
    for (const shown of ["options", "sheet", "board", "repositories", "readiness"]) assert.ok(sections.includes(shown), `${shown} in Advanced: ${sections.join(", ")}`);
    assert.deepEqual(api().workbenchState().experience?.hiddenViews, []);
    assert.deepEqual((await api().aiExchange.state() as { hiddenTabs?: string[] }).hiddenTabs, []);
    record("modes.advanced", { panes: panes(), sections });
  }, ONLY);

  test("0.22 modes: customizing is kept per machine, marked in the status bar; unknown ids are reported", async () => {
    const cfg = () => vscode.workspace.getConfiguration("datapass.experience");
    await cfg().update("overrides", { "project.board": false, "view.nope": true }, vscode.ConfigurationTarget.Global);
    await waitFor("the override applied", () => api().experience.current().overrides["project.board"] === false);
    assert.equal(api().experience.status().text, "$(layers) DataPass: Advanced *");
    assert.match(api().experience.status().tooltip, /− hidden: Project tree: Board/);
    assert.match(api().experience.current().messages.join(" "), /Unknown surface "view\.nope"/);
    assert.ok(!(await treeSections()).includes("board"));
    await run("datapass.experience.resetOverrides");
    await waitFor("the override removed", () => !Object.keys(api().experience.current().overrides).length);
    assert.equal(cfg().inspect("overrides")?.workspaceValue, undefined, "nothing written to the workspace settings");
  }, ONLY);

  test("V3-SHELL: the default layout — no bottom-panel Architecture, no Workbench column; lenses; rail", async () => {
    await mode("datapass");
    // Bottom panel: the Architecture view is off until switched on.
    assert.equal(api().shell.architectureInPanel(), false);
    await tryRun("datapass.architecture.focus");
    await new Promise(r => setTimeout(r, 500));
    assert.ok(!panes().includes("architecture"), `panes: ${panes().join(", ")}`);
    // Workbench: no Sub-projects / Repositories column unless the setting asks for it.
    assert.equal(api().workbenchState().layout?.navColumn, false);
    await vscode.workspace.getConfiguration("datapass.layout").update("workbenchNavColumn", true, vscode.ConfigurationTarget.Global);
    await waitFor("the old column back on request", () => api().workbenchState().layout?.navColumn === true);
    await vscode.workspace.getConfiguration("datapass.layout").update("workbenchNavColumn", undefined, vscode.ConfigurationTarget.Global);
    // Left tree lenses, remembered per workspace.
    await run("datapass.project.focus");
    await waitFor("the Project tree", () => panes().includes("project"));
    assert.equal(api().shell.lens(), "project");
    // V1.1.x-POLISH-3: the lens is named without hovering — first tree row and status bar.
    const first = (await api().renderProjectTree())[0];
    assert.equal(first?.id, "lens");
    assert.equal(first?.label, "Showing: Project ▾");
    assert.equal(first?.command, "datapass.tree.chooseLens");
    assert.equal(api().shell.lensStatus(), "$(list-tree) DataPass tree: Project");
    await run("datapass.git.focus");
    await waitFor("the Git view beside the Project lens", () => api().shell.gitViewVisible());
    await run("datapass.tree.lens.architecture");
    assert.equal(api().shell.lensStatus(), "$(list-tree) DataPass tree: Architecture");
    assert.equal(api().shell.chosenLens(), "architecture");
    const arch = await treeSections();
    assert.ok(arch.some(s => s.startsWith("sp:")) && arch.includes("repositories"), arch.join(", "));
    assert.ok(!arch.includes("readiness") && !arch.includes("next"), arch.join(", "));
    await run("datapass.tree.lens.readiness");
    assert.ok((await treeSections()).includes("readiness"));
    await run("datapass.tree.lens.ai");
    assert.ok((await treeSections()).includes("ai:orders"));
    await run("datapass.tree.lens.git");
    const git = await api().renderProjectTree();
    assert.equal(git[0]?.label, "Showing: Git ▾");
    assert.ok(git.length > 1 && git.slice(1).every(r => r.id?.startsWith("git/")), JSON.stringify(git.slice(0, 3)));
    // V1.1.x-POLISH-3: the separate Git view would repeat the Git lens: it hides while the lens shows.
    await waitFor("the Git view hidden under the Git lens", () => !api().shell.gitViewVisible());
    // A selection made elsewhere is revealed: the tree follows to the Architecture lens without forgetting Git.
    await api().select({ component: "extract" });
    await waitFor("the tree follows the selection", () => api().shell.lens() === "architecture");
    assert.equal(api().shell.chosenLens(), "git");
    await api().shell.chooseLens("project");
    await run("datapass.git.focus");
    await waitFor("the Git view back with the Project lens", () => api().shell.gitViewVisible());
    // Right rail: the full panel folds into the rail and comes back on a button.
    await run("datapass.details.focus");
    await waitFor("Details", () => panes().includes("details"));
    await run("datapass.rail.collapse");
    assert.equal(api().shell.rail(), true);
    await waitFor("the rail", () => api().shell.railResolved());
    await waitFor("Details folded", () => !panes().includes("details"));
    await api().shell.railSend({ type: "rail", id: "details" });
    assert.equal(api().shell.rail(), false);
    await waitFor("Details back", () => panes().includes("details"));
    // V1.1.x-POLISH-3: the Details button unfolds Details alone; Expand brings the full panel back.
    assert.equal(api().shell.solo(), "details");
    await waitFor("the AI view folded while Details shows alone", () => !panes().includes("aiExchange"));
    await run("datapass.rail.expand");
    assert.equal(api().shell.solo(), undefined);
    await waitFor("the AI view back with the full panel", () => panes().includes("aiExchange"));
    record("shell.default", { panes: panes(), lens: api().shell.lens() });
    // The general tests that follow expect the Architecture panel, as in the other fixtures' profiles.
    await run("datapass.layout.toggleArchitecturePanel", true);
    await waitFor("the Architecture panel on request", () => panes().includes("architecture"));
  }, ONLY);

  // Ends in Advanced: the suite's general tests that follow expect 0.20's surfaces, as in the other fixtures.
  test("0.22 modes: switching modes wrote no file in any repository", async () => {
    for (const id of ["standard", "datapass", "advanced"]) {
      await mode(id);
      assert.equal(gitStatus(), statusBefore, `git status is unchanged after switching to ${id}`);
    }
    const cfg = vscode.workspace.getConfiguration("datapass.experience").inspect("preset");
    assert.equal(cfg?.workspaceValue, undefined);
    assert.equal(cfg?.workspaceFolderValue, undefined);
  }, ONLY);
}
