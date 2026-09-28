/** QAEXIT: qa:ui exits 0 only with a report holding every journey, reached; any other end is non-zero. */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reportProblem, runCli, withTimeout, type UiRunResult } from "../scripts/qa/ui-run";

class FakeProcess extends EventEmitter {
  codes: number[] = [];
  exit = (code?: number) => { this.codes.push(code ?? 0); };
}

function reportFile(journeys: Array<{ id: string; outcome: string }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qaexit-"));
  const file = path.join(dir, "report.json");
  fs.writeFileSync(file, JSON.stringify({ journeys }));
  return file;
}

const quiet = () => undefined;

test("a run that settles with 0 and a full report exits 0", async () => {
  const proc = new FakeProcess();
  const file = reportFile([{ id: "J01", outcome: "reached" }, { id: "J02", outcome: "reached" }]);
  await runCli(async () => ({ code: 0, reportFile: file, reasons: [], outcomes: { J01: "reached", J02: "reached" } }), proc, quiet);
  assert.deepEqual(proc.codes, [0]);
});

test("a run whose promise never settles exits 1 when the event loop drains", async () => {
  const proc = new FakeProcess();
  void runCli(() => new Promise<UiRunResult>(() => undefined), proc, quiet);
  proc.emit("beforeExit", 0);
  assert.deepEqual(proc.codes, [1]);
});

test("beforeExit after a settled run changes nothing", async () => {
  const proc = new FakeProcess();
  await runCli(async () => ({ code: 1, reasons: [] }), proc, quiet);
  proc.emit("beforeExit", 0);
  assert.deepEqual(proc.codes, [1]);
});

test("an unhandled rejection or a thrown run exits 1", async () => {
  const proc = new FakeProcess();
  void runCli(() => new Promise<UiRunResult>(() => undefined), proc, quiet);
  proc.emit("unhandledRejection", new Error("boom"), Promise.resolve());
  assert.deepEqual(proc.codes, [1]);
  const proc2 = new FakeProcess();
  await runCli(async () => { throw new Error("boom"); }, proc2, quiet);
  assert.deepEqual(proc2.codes, [1]);
});

test("a claimed success without a sound report exits 1", async () => {
  const cases: UiRunResult[] = [
    { code: 0, reasons: [] },
    { code: 0, reportFile: path.join(os.tmpdir(), "qaexit-none", "report.json"), reasons: [] },
    { code: 0, reportFile: reportFile([{ id: "J01", outcome: "reached" }]), reasons: [], outcomes: { J01: "reached", J02: "reached" } },
    { code: 0, reportFile: reportFile([{ id: "J01", outcome: "failed" }]), reasons: [], outcomes: { J01: "reached" } },
    { code: 0, reportFile: reportFile([]), reasons: [] }
  ];
  for (const r of cases) {
    assert.ok(reportProblem(r), JSON.stringify(r));
    const proc = new FakeProcess();
    await runCli(async () => r, proc, quiet);
    assert.deepEqual(proc.codes, [1], JSON.stringify(r));
  }
});

test("withTimeout gives up on a promise that never settles", async () => {
  assert.equal(await withTimeout(new Promise(() => undefined), 20), undefined);
  assert.equal(await withTimeout(Promise.resolve(7), 1_000), 7);
});
