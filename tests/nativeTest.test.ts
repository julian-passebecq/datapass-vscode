/** V1-TEST (GPT T4, A05): the native Test route — finding the task, refusing honestly, receipts. */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolObservation } from "../src/core/capabilities/tools";
import { addReceipt, MAX_RECEIPTS, MAX_TASKS_BYTES, outcomeOf, parseTasksFile, receiptLines, resolveCwd, resolveTestTask, type TestReceipt } from "../src/core/nativeTest/tasks";

const file = (tasks: unknown[]) => parseTasksFile(JSON.stringify({ version: "2.0.0", tasks }));
const t = (label: string, cwd?: string, group: unknown = "test", extra: Record<string, unknown> = {}) =>
  ({ label, type: "process", command: "python", args: ["-m", "pytest"], ...(cwd !== undefined ? { options: { cwd } } : {}), group, ...extra });

test("resolveCwd: ${workspaceFolder} and relative paths; anything else is not placed", () => {
  assert.equal(resolveCwd(undefined), "");
  assert.equal(resolveCwd("${workspaceFolder}"), "");
  assert.equal(resolveCwd("${workspaceFolder}/processing/"), "processing");
  assert.equal(resolveCwd("${workspaceFolder}\\a\\.\\b"), "a/b");
  assert.equal(resolveCwd("processing"), "processing");
  assert.equal(resolveCwd("${workspaceFolder}/.."), undefined);
  assert.equal(resolveCwd("${env:HOME}/x"), undefined);
  assert.equal(resolveCwd("C:/x"), undefined);
  assert.equal(resolveCwd("/abs"), undefined);
});

test("parseTasksFile: comments allowed, only the test group kept, object groups and default", () => {
  const f = parseTasksFile(`// hand-written
  { "version": "2.0.0", "tasks": [
    { "label": "build", "type": "shell", "command": "make", "group": "build" },
    { "label": "unit", "type": "shell", "command": "pytest", "group": { "kind": "test", "isDefault": true }, /* trailing */ },
    { "label": "no group", "type": "shell", "command": "x" }
  ] }`);
  assert.equal(f.state, "read");
  if (f.state !== "read") return;
  assert.deepEqual(f.tests.map(x => [x.label, x.isDefault, x.commandLine]), [["unit", true, "pytest"]]);
});

test("parseTasksFile: invalid JSON, a non-list and an oversized file are unreadable, never absent", () => {
  assert.equal(parseTasksFile("{ nope").state, "unreadable");
  assert.equal(parseTasksFile(JSON.stringify({ tasks: {} })).state, "unreadable");
  const big = parseTasksFile("{}", MAX_TASKS_BYTES + 1);
  assert.equal(big.state, "unreadable");
  assert.equal(parseTasksFile(undefined).state, "absent");
});

test("resolveTestTask: no file, no test task, not for this component → honest 'no test declared'", () => {
  const none = resolveTestTask({ state: "absent" }, "processing", false);
  assert.equal(none.state, "none");
  assert.match((none as { reason: string }).reason, /no test declared/);
  assert.equal(resolveTestTask(file([t("build", undefined, "build")]), "processing", false).state, "none");
  const other = resolveTestTask(file([t("other", "${workspaceFolder}/elsewhere")]), "processing", false);
  assert.equal(other.state, "none");
});

test("resolveTestTask: the task running in the component folder is found", () => {
  const r = resolveTestTask(file([t("root", "${workspaceFolder}"), t("proc", "${workspaceFolder}/processing")]), "processing", false);
  assert.equal(r.state, "found");
  assert.equal((r as { task: { label: string } }).task.label, "proc");
});

test("resolveTestTask: a root task counts for a root component, or for the repository's only component", () => {
  assert.equal(resolveTestTask(file([t("all")]), ".", false).state, "found");
  assert.equal(resolveTestTask(file([t("all")]), "processing", true).state, "found");
  assert.equal(resolveTestTask(file([t("all")]), "processing", false).state, "none", "several components: a root task is not guessed to be this one's");
});

test("resolveTestTask: two candidates are ambiguous unless exactly one is the default", () => {
  const two = resolveTestTask(file([t("a", "processing"), t("b", "${workspaceFolder}/processing")]), "processing", false);
  assert.equal(two.state, "ambiguous");
  assert.deepEqual((two as { labels: string[] }).labels, ["a", "b"]);
  const def = resolveTestTask(file([t("a", "processing"), t("b", "processing", { kind: "test", isDefault: true })]), "processing", false);
  assert.equal(def.state, "found");
  assert.equal((def as { task: { label: string } }).task.label, "b");
});

test("resolveTestTask: an unplaceable cwd or an unreadable file is unsupported, not 'none' and not found", () => {
  assert.equal(resolveTestTask(file([t("x", "${env:X}/processing")]), "processing", false).state, "unsupported");
  assert.equal(resolveTestTask(parseTasksFile("{"), "processing", false).state, "unsupported");
});

test("outcomeOf: exit 0 passed, non-zero failed, no code unknown, cancel cancelled", () => {
  assert.equal(outcomeOf(0, false), "passed");
  assert.equal(outcomeOf(2, false), "failed");
  assert.equal(outcomeOf(undefined, false), "unknown");
  assert.equal(outcomeOf(0, true), "cancelled");
});

test("receipts: lines name commit, dirty state and exit code; never 'verified' or 'deployed'; bounded list", () => {
  const r: TestReceipt = { componentId: "process", repoKey: "bridge", task: "unit", commandLine: "pytest", cwd: "processing", commit: "0123456789abcdef", dirty: true, startedAt: "s", endedAt: "e", exitCode: 3, outcome: "failed", dataPassVersion: "0.27.0" };
  const lines = receiptLines(r).join("\n");
  assert.match(lines, /failed \(exit code 3\)/);
  assert.match(lines, /0123456789ab \+ uncommitted changes/);
  assert.doesNotMatch(lines, /verified|deployed successfully/i);
  let list: TestReceipt[] = [];
  for (let i = 0; i < MAX_RECEIPTS + 5; i++) list = addReceipt(list, { ...r, task: String(i) });
  assert.equal(list.length, MAX_RECEIPTS);
  assert.equal(list[0]!.task, String(MAX_RECEIPTS + 4), "newest first");
});

test("doc-pipeline example: the processing component has a test task, orchestration has none", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "examples", "v3", "doc-pipeline", ".vscode", "tasks.json"), "utf8");
  const f = parseTasksFile(text);
  assert.equal(resolveTestTask(f, "processing", false).state, "found");
  assert.equal(resolveTestTask(f, "orchestration/direct", false).state, "none");
});

test("src/core/nativeTest runs nothing: no child_process or vscode import", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "nativeTest", "tasks.ts"), "utf8");
  assert.doesNotMatch(src, /child_process|from "vscode"|\bexecFile\(|\bspawn\(/);
});

test("truthful tool states: every tool present and signed in still never reads 'verified' without an operation probe", async () => {
  const { buildIntegrationEvidence } = await import("../src/core/evidence/integrations");
  const { knownTools } = await import("../src/core/toolchain/toolchain");
  const at = "2026-09-27T00:00:00.000Z";
  const tools = new Map([...knownTools().keys(), "ws.mcp"].map((id): [string, ToolObservation] => [id, { toolId: id, state: "present", observedAt: at, via: id, entries: ["fabric-mgmt"] }]));
  const connectionProbes = new Map(["cli.az", "cli.databricks", "cli.fab"].map(id => [id, { tool: id, ranAt: at, outcome: "ok", signedIn: true }]));
  for (const e of buildIntegrationEvidence({ tools, connectionProbes: connectionProbes as never })) {
    assert.equal(e.chain.find(l => l.link === "verified")!.state, "unknown", e.id);
    assert.notEqual(e.tone, "ok", e.id);
    assert.doesNotMatch(e.summary, /(^|\/ )verified/, e.id);
  }
});
