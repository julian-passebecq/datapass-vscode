/**
 * V1-GAPS desktop flows: the halves of client journeys J04, J09 and J12 that qa:ui cannot drive
 * (clipboard answers, client-repository state, production). Unit halves: tests/journeyGaps.test.ts.
 *   J12 (v3-research, dev + prod declared): no operation targets production; showing every
 *       run / deploy / publish operation and copying its command starts no task and no terminal.
 *   J04 (v3-research): a valid AI proposal opens as a diff for review, the person cancels, and
 *       nothing is written (file, backups, journal, Git status); an unsupported one is refused.
 *   J09 (v22-versions): Open Version / Compare with Version change no file and no Git state
 *       (HEAD, refs, working tree); a file outside Git and a missing file are refused with a reason.
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

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const closeAll = () => vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs));
const listDir = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

/** Everything Git and the working tree hold, for a before/after comparison. */
function gitState(cwd: string): Record<string, string> {
  return {
    head: git(cwd, "rev-parse", "HEAD").trim(),
    refs: git(cwd, "for-each-ref", "--format=%(refname) %(objectname)"),
    status: git(cwd, "status", "--porcelain", "--untracked-files=all"),
    stash: git(cwd, "stash", "list")
  };
}

export function registerJourneyGapFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const root = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;

  test("V1-GAPS J12: production is declaration-only: no operation targets it; showing and copying run/deploy starts no process", async () => {
    await api().refresh();
    const map = api().projectMap();
    const prod = map.environments.filter(e => e.production).map(e => e.id);
    assert.deepEqual(prod, ["prod"], "the fixture declares a production environment");
    const ops = map.components.flatMap(c => c.operations);
    assert.deepEqual(ops.filter(o => o.environment?.production).map(o => o.key), [], "no operation targets production");
    const deployish = ops.filter(o => ["deploy", "run", "publish"].includes(o.phase));
    assert.ok(deployish.length > 0, "the fixture has run/deploy operations");

    const started: string[] = [];
    const subs = [
      vscode.tasks.onDidStartTask(e => started.push(`task ${e.execution.task.name}`)),
      vscode.window.onDidOpenTerminal(t => started.push(`terminal ${t.name}`))
    ];
    const before = vscode.window.terminals.length;
    try {
      for (const op of deployish) {
        // Unscripted: its pick (reviews, copy, open), if any, is dismissed.
        await withUi([], () => run("datapass.showOperation", op.key));
        if (op.command) {
          const ui = await withUi([{ button: "Copy command" }], () => run("datapass.copyComponentCommand", op.key));
          assert.equal(ui.clipboard, op.command.text, `${op.key}: only copied`);
        }
      }
    } finally {
      subs.forEach(s => s.dispose());
    }
    assert.deepEqual(started, [], "no task or terminal was started");
    assert.equal(vscode.window.terminals.length, before);
    record("gaps.j12", deployish.map(o => `${o.key}: ${o.result.status}`));
  }, ["v3-research"]);

  test("V1-GAPS J04: an AI proposal is reviewed as a diff and cancelled: nothing is written; an unsupported one is refused", async () => {
    await closeAll();
    const rel = path.join(".datapass", "sheet.json");
    const file = path.join(root(), rel);
    const onDisk = fs.readFileSync(file);
    const local = path.join(root(), ".datapass", "local");
    const snapshot = () => ({ file: fs.readFileSync(file).toString("base64"), backups: listDir(path.join(local, "backups")), journal: listDir(path.join(local, "journal")), git: gitState(root()) });
    const before = snapshot();

    const sheet = JSON.parse(onDisk.toString("utf8"));
    sheet.glossary = [...(sheet.glossary ?? []), { term: "gap check", meaning: "A term the review must show, then drop." }];
    const answer = "Proposal:\n```json\n" + JSON.stringify(sheet, null, 2) + "\n```";
    const ui = await withUi([{ pick: "From the clipboard" }, { dismiss: true }], async u => { u.clipboard = answer; await run("datapass.importFromAi", "sheet"); });
    assert.ok(ui.prompts.some(p => p.modal && /AI's proposal \(right\)/.test(p.text ?? "")), "the proposal is shown for review before any write");
    const diff = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputTextDiff && (t.input as vscode.TabInputTextDiff).modified.scheme === "datapass-proposal");
    assert.ok(diff, "the review opened VS Code's diff editor");
    assert.deepEqual(snapshot(), before, "cancelled: file, backups, journal and Git status unchanged");

    // Unsupported proposals: not a DataPass file, no JSON at all. Refused with a reason, nothing written.
    for (const raw of [JSON.stringify({ format: "datapass.proposal", version: 1, changes: [{ path: "pipelines/x.json" }] }), "I changed the pipeline, see my previous message."]) {
      const refused = await withUi([{ pick: "From the clipboard" }], async u => { u.clipboard = raw; await run("datapass.importFromAi"); }, { allowErrors: true });
      assert.ok(refused.errors.some(e => /Not imported: /.test(e)), refused.errors.join(" / ") || "no error shown");
    }
    assert.deepEqual(snapshot(), before, "refused: nothing written");
    await closeAll();
  }, ["v3-research"]);

  test("V1-GAPS J09: Open Version and Compare with Version leave files and Git history unchanged; unavailable cases are refused", async () => {
    await closeAll();
    const repo = api().project().root!.fsPath;
    const notes = vscode.Uri.file(path.join(repo, "notes", "decisions.md"));
    const onDisk = fs.readFileSync(notes.fsPath);
    const before = gitState(repo);

    await withUi([{ pick: "first decisions" }], () => run("datapass.fileVersions.openVersion", notes));
    await withUi([{ pick: "second decisions" }], () => run("datapass.fileVersions.compare", notes));
    await withUi([{ dismiss: true }], () => run("datapass.fileVersions.openVersion", notes));
    assert.ok(vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.input instanceof vscode.TabInputTextDiff), "the comparison opened");
    assert.ok(fs.readFileSync(notes.fsPath).equals(onDisk), "the native file is unchanged");
    assert.deepEqual(gitState(repo), before, "HEAD, refs, working tree and stash unchanged");

    // Unavailable version tooling is said, not silent.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dp-gaps-"));
    try {
      const loose = path.join(outside, "loose.md");
      fs.writeFileSync(loose, "not versioned\n");
      const noGit = await withUi([], () => run("datapass.fileVersions.compare", vscode.Uri.file(loose)), { allowErrors: true });
      assert.ok(noGit.errors.some(e => /loose\.md is not in a Git repository/.test(e)), noGit.errors.join(" / ") || "no error shown");
      const remote = await withUi([], () => run("datapass.fileVersions.openVersion", vscode.Uri.parse("untitled:scratch.md")), { allowErrors: true });
      assert.ok(remote.errors.some(e => /files on this computer only/.test(e)), remote.errors.join(" / ") || "no error shown");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    assert.deepEqual(gitState(repo), before);
    await closeAll();
  }, ["v22-versions"]);
}
