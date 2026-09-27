/** QATMP: qa:ui waits for VS Code's whole process tree to exit before the run root is removed. */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { isAlive, listProcesses, parseProcessRows, processTree, waitForExit } from "../scripts/qa/processTree";

test("parseProcessRows reads ps and PowerShell listings", () => {
  assert.deepEqual(parseProcessRows("  10     1\n 11 10\r\ngarbage\n12 11\n"), [{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }]);
});

test("processTree returns the root and every descendant, not siblings", () => {
  const rows = [{ pid: 1, ppid: 0 }, { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 13, ppid: 10 }, { pid: 20, ppid: 1 }, { pid: 0, ppid: 0 }];
  assert.deepEqual(processTree(10, rows).sort((a, b) => a - b), [10, 11, 12, 13]);
  assert.deepEqual(processTree(99, rows), [99]);
});

test("the real listing finds a spawned grandchild under its parent", { timeout: 60_000 }, async () => {
  const parent = spawn(process.execPath, ["-e", "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' }); setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    let tree: number[] = [];
    for (let i = 0; i < 50 && tree.length < 2; i++) { await new Promise(r => setTimeout(r, 100)); tree = processTree(parent.pid!, listProcesses()); }
    assert.equal(tree.length, 2, "parent and grandchild");
    assert.equal(tree[0], parent.pid);
    const killed = await waitForExit(tree, { timeoutMs: 200 });
    assert.equal(killed.length, 2);
    assert.ok(tree.every(p => !isAlive(p)));
  } finally { parent.kill("SIGKILL"); }
});

test("waitForExit waits for a process that exits on its own and kills nothing", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 700)"], { stdio: "ignore" });
  const started = Date.now();
  assert.deepEqual(await waitForExit([child.pid!], { timeoutMs: 20_000 }), []);
  assert.ok(Date.now() - started >= 400, "it waited");
  assert.equal(isAlive(child.pid!), false);
});
