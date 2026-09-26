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
  let statusBefore = "";

  test("0.22 modes: a new install opens in Standard, on the architecture, with the mode in the status bar", async () => {
    await api().startup();
    await api().experience.ready();
    statusBefore = gitStatus();
    const x = api().experience.current();
    assert.equal(x.preset, "standard");
    assert.deepEqual(x.messages, []);
    assert.equal(await api().experience.landed(), true, "Standard lands on the architecture panel");
    await waitFor("the architecture panel is shown", () => panes().includes("architecture"));
    const status = api().experience.status();
    assert.equal(status.visible, true);
    assert.equal(status.text, "$(layers) DataPass: Standard");
    assert.match(status.tooltip, /DataPass mode: Standard/);
    record("modes.standard", { panes: panes(), status: status.text });
  }, ONLY);

  test("0.22 modes: Standard hides the Project, Work and Galaxy views (when clauses) and shows Git, AI, Details", async () => {
    await tryRun("datapass.project.focus");
    await tryRun("datapass.galaxy.focus");
    await run("datapass.details.focus");
    await waitFor("Details shown", () => panes().includes("details"));
    assert.ok(!panes().includes("project"), `panes: ${panes().join(", ")}`);
    assert.ok(!panes().includes("galaxy"), `panes: ${panes().join(", ")}`);
    await run("datapass.git.focus");
    await run("datapass.aiExchange.focus");
    await waitFor("the AI view", () => panes().includes("aiExchange"));
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
    record("modes.vanilla", { panes: panes(), sections });
  }, ONLY);

  test("0.22 modes: Advanced shows everything as in 0.20", async () => {
    await mode("advanced");
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
