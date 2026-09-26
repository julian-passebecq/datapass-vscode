/**
 * V1-TEST (GPT T4, A05) desktop flow, fixture v25-doc-pipeline: *Run Component Test* finds the
 * processing component's task in the repository's .vscode/tasks.json, asks before running, runs it
 * through VS Code's task system and keeps a receipt (commit, time, exit code); a failing task is
 * "failed" with its exit code; a component without a task gets "no test declared" and nothing runs.
 * The task's command is swapped for `node` during the flow (CI has no guaranteed `python`), then restored.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const ONLY = ["v25-doc-pipeline"];
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

export function registerNativeTestFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const ws = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const tasksFile = () => path.join(ws(), ".vscode", "tasks.json");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: ws(), encoding: "utf8" }).trim();

  /** Point the example's test task at `node -e "process.exit(<code>)"` and wait until VS Code lists it. */
  async function useExitCode(code: number): Promise<void> {
    const doc = JSON.parse(fs.readFileSync(tasksFile(), "utf8").replace(/^\s*\/\/.*$/gm, ""));
    doc.tasks[0].command = "node";
    doc.tasks[0].args = ["-e", `process.exit(${code})`];
    fs.writeFileSync(tasksFile(), JSON.stringify(doc, null, 2));
    await waitFor(`the task with exit code ${code}`, async () => (await vscode.tasks.fetchTasks()).some(t =>
      t.name === "Test PDF processing" && t.execution instanceof vscode.ProcessExecution && t.execution.args.join(" ").includes(`exit(${code})`)), 20_000);
  }

  test("V1-TEST native Test: task found, confirmed, run with a receipt; failure keeps its exit code; no task → not run", async () => {
    await waitFor("the project map", () => api().workModel() && api().project().manifest, 20_000);
    const found = await api().nativeTests.resolve("process");
    assert.equal(found.resolution.state, "found", JSON.stringify(found.resolution));
    assert.equal((found.resolution as { task: { label: string } }).task.label, "Test PDF processing");
    const none = await api().nativeTests.resolve("orchestrate");
    assert.equal(none.resolution.state, "none");
    const head = git("rev-parse", "HEAD");

    try {
      // Declined: nothing runs, no receipt.
      await useExitCode(0);
      const declined = await withUi([{ dismiss: true }], () => run("datapass.runComponentTest", "process"));
      assert.ok(declined.prompts.some(p => p.modal && /Run the test of PDF processing\?/.test(p.text ?? "") && /Runs: node -e/.test(p.text ?? "")), "the confirmation shows what runs");
      assert.equal(api().nativeTests.receipts().length, 0, "declined: no receipt");

      // Passing.
      const ok = await withUi([{ button: "Run test" }], () => run("datapass.runComponentTest", "process"));
      const pass = api().nativeTests.receipts()[0];
      assert.ok(pass, "a receipt");
      assert.equal(pass.outcome, "passed");
      assert.equal(pass.exitCode, 0);
      assert.equal(pass.commit, head, "the receipt names the commit");
      assert.equal(pass.dirty, true, "tasks.json was changed on disk: the result is for the files on disk");
      assert.equal(pass.cwd, "processing");
      assert.ok(ok.notices.some(n => /test of PDF processing — passed \(exit code 0\)/.test(n)), ok.notices.join(" / "));

      // Failing: exit code kept, never shown as passed or verified.
      await useExitCode(3);
      const bad = await withUi([{ button: "Run test" }], () => run("datapass.runComponentTest", "process"));
      const fail = api().nativeTests.receipts()[0]!;
      assert.equal(fail.outcome, "failed");
      assert.equal(fail.exitCode, 3);
      assert.ok(bad.notices.some(n => /failed \(exit code 3\)/.test(n)));
      assert.ok(!bad.notices.some(n => /verified/i.test(n)));

      // No task for this component: an honest refusal, nothing runs.
      const refused = await withUi([], () => run("datapass.runComponentTest", "orchestrate"));
      assert.ok(refused.notices.some(n => /not run — no test declared/.test(n)), refused.notices.join(" / "));
      assert.equal(api().nativeTests.receipts().length, 2);
      record("nativeTest.receipts", api().nativeTests.receipts().map(r => ({ task: r.task, outcome: r.outcome, exitCode: r.exitCode })));
    } finally {
      git("checkout", "--", ".vscode/tasks.json");
    }
    assert.equal(git("status", "--porcelain", "--untracked-files=all"), "", "nothing left in the repository");
  }, ONLY);
}
