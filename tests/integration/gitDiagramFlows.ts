/**
 * V3-GITDIAG desktop flows, fixture v22-versions (the research project, its pipeline repository cloned
 * beside it). A local, uncommitted change to the PDF extraction block's entry file puts a Git badge on
 * that block in the Workbench state; the badge's command opens VS Code's diff; Show File History lists
 * notes/decisions.md's commits and opens the diff of one commit against the previous version.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const ONLY = ["v22-versions"];
const env = () => JSON.parse(process.env.DATAPASS_IT_V3 ?? "{}") as { pipelineClone: string };
const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
const closeAll = () => vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs));

export function registerGitDiagramFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("V3-GITDIAG: a local change puts a Git badge on its block; the badge opens the diff", async () => {
    await closeAll();
    const file = path.join(env().pipelineClone, "functions", "extract", "function_app.py");
    const before = readFileSync(file, "utf8");
    const block = api().projectMap().components.find(c => c.label === "PDF extraction");
    assert.ok(block, "the fixture has the PDF extraction block");
    try {
      writeFileSync(file, `${before}# local edit (not committed)\n`);
      await api().gitDiagram.refresh();
      const g = await waitFor("the block's Git badge", async () => { await api().gitDiagram.refresh(); return api().workbenchState().gitDiagram?.byComponent[block.id]; });
      assert.equal(g.worst, "local");
      assert.equal(g.count, 1);
      assert.match(g.title, /Local — Local changes in .*1 file\(s\) not committed/);
      assert.equal(api().workbenchState().gitDiagram?.shown, true);
      // Other blocks carry no badge.
      assert.deepEqual(Object.keys(api().workbenchState().gitDiagram!.byComponent), [block.id]);
      await withUi([], () => vscode.commands.executeCommand("datapass.diagram.openGitChanges", block.id));
      const tab = await waitFor("the local diff", () => activeTab()?.input instanceof vscode.TabInputTextDiff ? activeTab() : undefined);
      const input = tab.input as vscode.TabInputTextDiff;
      assert.equal(input.original.scheme, "datapass-rev");
      assert.equal(input.modified.fsPath.toLowerCase(), file.toLowerCase());
      record("gitDiagram.badge", { worst: g.worst, count: g.count, tab: tab.label });

      // The switch hides the badges (setting datapass.diagram.gitBadges).
      await vscode.commands.executeCommand("datapass.diagram.toggleGitBadges");
      await waitFor("badges hidden", async () => { await api().gitDiagram.refresh(); return api().workbenchState().gitDiagram?.shown === false ? true : undefined; });
      await vscode.commands.executeCommand("datapass.diagram.toggleGitBadges");
    } finally {
      writeFileSync(file, before);
      await vscode.workspace.getConfiguration("datapass.diagram").update("gitBadges", undefined, vscode.ConfigurationTarget.Global);
      await closeAll();
    }
    await api().gitDiagram.refresh();
    assert.equal(api().workbenchState().gitDiagram?.byComponent[block.id], undefined, "the badge goes when the change is undone");
  }, ONLY);

  test("V3-GITDIAG: Show File History lists the commits and opens a commit's diff with the previous version", async () => {
    await closeAll();
    const notes = vscode.Uri.joinPath(api().project().root!, "notes", "decisions.md");
    const ui = await withUi([{ pick: "second decisions" }], () => vscode.commands.executeCommand("datapass.fileVersions.history", notes));
    const pick = ui.prompts.find(p => p.kind === "pick");
    assert.deepEqual(pick?.options, ["third decisions", "second decisions", "first decisions"]);
    const tab = await waitFor("the commit's diff", () => activeTab()?.input instanceof vscode.TabInputTextDiff ? activeTab() : undefined);
    const input = tab.input as vscode.TabInputTextDiff;
    assert.equal(input.original.scheme, "datapass-rev");
    assert.equal(input.modified.scheme, "datapass-rev");
    assert.equal((await vscode.workspace.openTextDocument(input.original)).getText(), "# Decisions\n\nfirst\n");
    assert.equal((await vscode.workspace.openTextDocument(input.modified)).getText(), "# Decisions\n\nsecond\n");
    assert.match(tab.label, /decisions\.md \([0-9a-f]{7}: second decisions\)/);
    // The first commit created the file: it opens alone.
    await closeAll();
    await withUi([{ pick: "first decisions" }], () => vscode.commands.executeCommand("datapass.fileVersions.history", notes));
    const doc = await waitFor("the first version", () => vscode.window.activeTextEditor?.document.uri.scheme === "datapass-rev" ? vscode.window.activeTextEditor.document : undefined);
    assert.equal(doc.getText(), "# Decisions\n\nfirst\n");
    record("gitDiagram.history", { tab: tab.label });
    await closeAll();
  }, ONLY);
}
