/**
 * Desktop flows for 0.22 package C: *Copy Context for My AI* from any file, in real VS Code on the
 * v3-research fixture (a bridge repository as the workspace, the pipeline repository cloned next to
 * it). The Explorer entry is run the way the Explorer runs it (uri, selected uris); the editor entry
 * with an unsaved buffer and a selection; a second worktree of the pipeline remote resolves to
 * itself. Every pack is checked for absolute local paths.
 */
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test } from "./harness";
import { withUi } from "./ui";

const EXTENSION_ID = "julian-passebecq.datapass-vscode";
const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const v3Env = () => JSON.parse(process.env.DATAPASS_IT_V3 ?? "{}") as { pipelineClone: string };
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

function noLocalPath(what: string, text: string, ...folders: string[]): void {
  for (const f of [...folders, os.homedir(), root().fsPath]) {
    for (const form of [f, f.replace(/\\/g, "/")]) assert.ok(!text.toLowerCase().includes(form.toLowerCase()), `${what} leaked ${form}`);
  }
  assert.doesNotMatch(text, /\b[A-Za-z]:[\\/]/, `${what} holds a drive-letter path`);
}

export function registerFileContextFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("0.22 C: the Explorer and editor menus contribute Copy Context for My AI (files only)", async () => {
    const menus = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON.contributes.menus as Record<string, Array<{ command: string; when?: string }>>;
    const explorer = menus["explorer/context"]!.find(m => m.command === "datapass.copyFileContext");
    assert.ok(explorer, "Explorer context menu entry");
    assert.match(explorer.when ?? "", /!explorerResourceIsFolder/);
    assert.ok(menus["editor/title/context"]!.some(m => m.command === "datapass.copyFileContext"));
    assert.ok(menus["editor/context"]!.some(m => m.command === "datapass.copyFileContext"));
  }, ["v3-research"]);

  test("0.22 C: the Explorer entry copies a pack for a native-repository file: component, scope, revisions, rules", async () => {
    await api().refresh();
    const clone = v3Env().pipelineClone;
    const file = vscode.Uri.file(path.join(clone, "functions", "extract", "function_app.py"));
    const ui = await withUi([{ input: "Why is the extraction slow?" }, { button: "Copy" }], () => run("datapass.copyFileContext", file, [file]));
    const t = ui.clipboard;
    assert.match(t, /^# DataPass file context: functions\/extract\/function_app\.py/);
    assert.match(t, /Project: Research library \(research-library\)/);
    assert.match(t, /## Question\nWhy is the extraction slow\?/);
    assert.match(t, /Document pipeline \(`pipeline`\), a native repository declared by the bridge · remote github\.com\/example-org\/research-pipeline/);
    assert.match(t, /Git: branch main · HEAD [0-9a-f]{12} · this file: unchanged since HEAD/);
    assert.match(t, /Component: PDF extraction \(`extract`, function, azure-functions\) — files in `functions\/extract\/`/);
    assert.match(t, /Scope: Papers pipeline/);
    assert.match(t, /## Repositories the component uses \(revisions\)\n- Document pipeline \(`pipeline`\): local · main @ [0-9a-f]{12}/);
    assert.match(t, /\(`\.`, bridge\): local/);
    assert.match(t, /      function_app\.py   ← this file/);
    assert.match(t, /      tests\//);
    assert.match(t, /```python\nimport azure\.functions as func/);
    assert.match(t, /separate\*\* pull request in the bridge repository/);
    noLocalPath("Explorer pack", t, clone);
    const modal = ui.prompts.find(p => p.kind === "message" && p.modal);
    assert.match(modal?.text ?? "", /Component: PDF extraction/);
    record("fileContext.explorer", { bytes: Buffer.byteLength(t) });
  }, ["v3-research"]);

  test("0.22 C: the editor entry uses the unsaved buffer and the selection; nothing is written", async () => {
    const readme = vscode.Uri.joinPath(root(), "README.md");
    const onDisk = fs.readFileSync(readme.fsPath, "utf8");
    const status = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root().fsPath, encoding: "utf8" });
    const before = status();
    const doc = await vscode.workspace.openTextDocument(readme);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(e => e.insert(new vscode.Position(doc.lineCount, 0), "UNSAVED_LINE api_key=sk-abcdefghijklmnopqrstuvwx\n"));
    assert.ok(doc.isDirty);
    editor.selection = new vscode.Selection(doc.lineCount - 2, 0, doc.lineCount - 1, 0);
    try {
      const ui = await withUi([{ input: "" }, { button: "Copy" }], () => run("datapass.copyFileContext"));
      const t = ui.clipboard;
      assert.match(t, /\*\*Unsaved changes\*\*/);
      assert.match(t, /## Selection \(lines \d+–\d+\)/);
      assert.match(t, /UNSAVED_LINE api_key=<redacted>/);
      assert.ok(!t.includes("sk-abcdefghij"), "secret scrubbed");
      assert.ok(!t.includes("## Question"), "an empty question adds no section");
      assert.match(t, /the bridge repository \(coordination repository\) of this project/);
      noLocalPath("editor pack", t);
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
    assert.equal(fs.readFileSync(readme.fsPath, "utf8"), onDisk, "the file on disk is untouched");
    assert.equal(status(), before, "the command wrote nothing in the bridge repository");
  }, ["v3-research"]);

  test("0.22 C: a second worktree of the pipeline remote resolves to the worktree that holds the file", async () => {
    const clone = v3Env().pipelineClone;
    const wt = path.join(path.dirname(path.dirname(clone)), "worktrees", "pipeline-fix");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/fix-extract", wt], { cwd: clone, stdio: "ignore" });
    try {
      const file = vscode.Uri.file(path.join(wt, "adf", "pipeline", "build_candidates.json"));
      const ui = await withUi([{ input: "" }, { button: "Copy" }], () => run("datapass.copyFileContext", file, [file]));
      const t = ui.clipboard;
      assert.match(t, /Document pipeline \(`pipeline`\)/);
      assert.match(t, /another clone or worktree of that repository \(same remote\)/);
      assert.match(t, /branch claude\/fix-extract/);
      assert.match(t, /Component: Build candidates pipeline \(`adf`/);
      assert.match(t, /this file is its declared entry file/);
      noLocalPath("worktree pack", t, clone, wt);
    } finally {
      execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: clone, stdio: "ignore" });
      execFileSync("git", ["branch", "-q", "-D", "claude/fix-extract"], { cwd: clone, stdio: "ignore" });
    }
  }, ["v3-research"]);

  test("0.22 C: a file outside every declared repository says 'not in the bridge'", async () => {
    const outside = path.join(path.dirname(path.dirname(v3Env().pipelineClone)), "scratch-notes");
    fs.mkdirSync(outside, { recursive: true });
    const file = path.join(outside, "todo.md");
    fs.writeFileSync(file, "- [ ] ask about token=abc123secret\n");
    try {
      const ui = await withUi([{ input: "" }, { button: "Copy" }], () => run("datapass.copyFileContext", vscode.Uri.file(file), [vscode.Uri.file(file)]));
      const t = ui.clipboard;
      assert.match(t, /scratch-notes: \*\*not in the bridge\*\*/);
      assert.match(t, /Git: not read \(not a Git repository\)/);
      assert.match(t, /todo\.md   ← this file/);
      assert.ok(!t.includes("abc123secret"));
      noLocalPath("outside pack", t, outside);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }, ["v3-research"]);
}
