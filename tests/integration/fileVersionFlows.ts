/**
 * 0.22 package F desktop flows, fixture v22-versions: the research project where notes/decisions.md has
 * three commits in the coordination repository, and whose pipeline repository gets one update from the
 * AI's clone. Open Version… opens the first commit read-only; Compare opens VS Code's diff editor;
 * Open Latest Version says what is missing without fetching; after a fast-forward, Changed by the
 * Last Update lists the component and opens the diff old..new.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const ONLY = ["v22-versions"];
const env = () => JSON.parse(process.env.DATAPASS_IT_V3 ?? "{}") as { aiClone: string; pipelineClone: string };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=DataPass test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
const closeAll = () => vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs));

export function registerFileVersionFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const notes = () => vscode.Uri.joinPath(api().project().root!, "notes", "decisions.md");

  test("0.22 versions: Open Version… lists the file's three commits and opens the first one read-only", async () => {
    await closeAll();
    const ui = await withUi([{ pick: "first decisions" }], () => vscode.commands.executeCommand("datapass.fileVersions.openVersion", notes()));
    const pick = ui.prompts.find(p => p.kind === "pick");
    assert.deepEqual(pick?.options, ["third decisions", "second decisions", "first decisions"]);
    const doc = await waitFor("the revision tab", () => vscode.window.activeTextEditor?.document.uri.scheme === "datapass-rev" ? vscode.window.activeTextEditor.document : undefined);
    assert.equal(doc.getText(), "# Decisions\n\nfirst\n");
    assert.match(activeTab()?.label ?? "", /^decisions\.md \([0-9a-f]{7} \d{4}-\d{2}-\d{2}\)$/);
    // Read-only: the provider's documents cannot be saved back.
    assert.equal(doc.isUntitled, false);
    assert.equal(doc.uri.scheme, "datapass-rev");
    record("versions.openVersion", { tab: activeTab()?.label });
  }, ONLY);

  test("0.22 versions: Compare with Version… opens VS Code's diff editor against the working file", async () => {
    await closeAll();
    await withUi([{ pick: "second decisions" }], () => vscode.commands.executeCommand("datapass.fileVersions.compare", notes()));
    const tab = await waitFor("a diff tab", () => activeTab()?.input instanceof vscode.TabInputTextDiff ? activeTab() : undefined);
    const input = tab.input as vscode.TabInputTextDiff;
    assert.equal(input.original.scheme, "datapass-rev");
    assert.equal(input.modified.fsPath, notes().fsPath);
    assert.match(tab.label, /decisions\.md \([0-9a-f]{7} ↔ working file\)/);
  }, ONLY);

  test("0.22 versions: Open Latest Version needs origin/<default>; it never fetches", async () => {
    await closeAll();
    const ui = await withUi([], () => vscode.commands.executeCommand("datapass.fileVersions.openLatest", notes()), { allowErrors: true });
    assert.match(ui.errors.join(" "), /No origin\/<default branch> in this clone yet/);
    const file = vscode.Uri.file(path.join(env().pipelineClone, "functions", "extract", "function_app.py"));
    await withUi([], () => vscode.commands.executeCommand("datapass.fileVersions.openLatest", file));
    const doc = await waitFor("the latest version", () => vscode.window.activeTextEditor?.document.uri.scheme === "datapass-rev" ? vscode.window.activeTextEditor.document : undefined);
    assert.match(doc.getText(), /azure\.functions/);
    assert.match(activeTab()?.label ?? "", /^function_app\.py \(origin main [0-9a-f]{7}, fetched /);
  }, ONLY);

  test("0.22 versions: after an update, Changed by the Last Update lists the component and opens the diff", async () => {
    await closeAll();
    const { aiClone, pipelineClone } = env();
    writeFileSync(path.join(aiClone, "functions", "extract", "function_app.py"), "import azure.functions as func\n\napp = func.FunctionApp()\n# pages kept\n");
    git(aiClone, "commit", "-q", "-am", "Keep page numbers");
    git(aiClone, "push", "-q", "origin", "main");
    // What Get updates runs (fetch, then a fast-forward only).
    git(pipelineClone, "fetch", "-q", "origin");
    git(pipelineClone, "merge", "--ff-only", "@{u}");
    await api().refresh();
    const ui = await withUi([{ pick: "functions/extract/function_app.py" }], () => vscode.commands.executeCommand("datapass.fileVersions.lastUpdate"));
    const options = ui.prompts.find(p => p.kind === "pick")?.options ?? [];
    assert.ok(options.includes("PDF extraction"), `grouped by component: ${options.join(" | ")}`);
    const tab = await waitFor("the update's diff", () => activeTab()?.input instanceof vscode.TabInputTextDiff ? activeTab() : undefined);
    const input = tab.input as vscode.TabInputTextDiff;
    assert.equal(input.original.scheme, "datapass-rev");
    assert.equal(input.modified.scheme, "datapass-rev");
    const after = await vscode.workspace.openTextDocument(input.modified);
    assert.match(after.getText(), /# pages kept/);
    record("versions.lastUpdate", options);
    await closeAll();
  }, ONLY);
}
