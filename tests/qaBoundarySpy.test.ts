import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

test("acceptance spy attributes DataPass bundles without capturing nested VS Code extensions", () => {
  const root = "D:/qualification/datapass";
  const events: string[] = [];
  let caller = "";
  let calls = 0;
  const childProcess = { spawn: () => { calls++; return "unchanged-result"; } };
  const modules: Record<string, unknown> = {
    fs: { appendFileSync: (_file: string, value: string) => events.push(value) },
    path: {}, vscode: {}, http: {}, https: {}, net: {}, tls: {}, child_process: childProcess
  };
  vm.runInNewContext(fs.readFileSync("qa/v5/harness/spy/extension.js", "utf8"), {
    require: (name: string) => modules[name], module: { exports: {} }, URL,
    process: { env: { DATAPASS_QA_EXT_ROOT: root, DATAPASS_QA_SPY_LOG: "unused.jsonl" } },
    Error: class { stack = `Error\n at call (${caller}:10:1)`; }
  });
  for (const bundle of ["extension.js", "workbench.js", "navView.js"]) {
    caller = `${root}/dist/${bundle}`;
    assert.equal(childProcess.spawn(), "unchanged-result");
  }
  assert.equal(events.length, 3);
  for (const other of [".vscode-test/vscode/resources/app/extensions/git/dist/main.js", "qa/v5/harness/spy/extension.js", "../datapass-other/dist/extension.js"]) {
    caller = `${root}/${other}`;
    assert.equal(childProcess.spawn(), "unchanged-result");
  }
  assert.equal(events.length, 3, "nested VS Code and recorder calls must not become DataPass boundary events");
  assert.equal(calls, 6, "recording must preserve every original call");
});
