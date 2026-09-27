/** V1-RC: the release-candidate gates never count a missing fixture, a skipped run or a human step as a pass. */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { externalGates, fixtureGate, rcVerdict, type Gate } from "../scripts/qa/rc";

const pass = (id: string): Gate => ({ id, title: id, status: "PASS", detail: "" });

function autoRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-rc-"));
  fs.cpSync(path.join("tests", "fixtures", "qa", "client"), dir, { recursive: true });
  return dir;
}

test("rcVerdict: qualified only when every gate passed", () => {
  assert.deepEqual(rcVerdict([pass("a"), pass("b")]), { qualified: true, open: [] });
  assert.equal(rcVerdict([]).qualified, false, "no evidence is not a pass");
  for (const status of ["FAIL", "BLOCKED", "NOT_RUN", "HUMAN"] as const) {
    const v = rcVerdict([pass("a"), { id: "b", title: "b", status, detail: "" }]);
    assert.equal(v.qualified, false, status);
    assert.deepEqual(v.open, [`b ${status}`]);
  }
});

test("externalGates: the M3 gates the script cannot run start open, Codex and the real screen included", () => {
  const gates = externalGates();
  assert.ok(gates.every(g => g.status !== "PASS"));
  for (const id of ["verify", "desktop-windows", "desktop-ubuntu", "perf", "qa-ui", "codex-journeys", "restricted-mode", "real-screen"]) assert.ok(gates.some(g => g.id === id), id);
  assert.match(gates.find(g => g.id === "codex-journeys")!.detail, /Playwright results never stand in/);
});

test("fixtureGate: empty or unreachable client repositories are a setup blocker, never a pass", () => {
  assert.equal(fixtureGate(undefined, () => "x").status, "NOT_RUN");
  const auto = autoRepo();
  try {
    const seen: string[] = [];
    const empty = fixtureGate(auto, r => { seen.push(r); return seen.length === 1 ? "abc\trefs/heads/main" : ""; });
    assert.equal(empty.status, "BLOCKED");
    assert.match(empty.detail, /setup blocker.*empty repository/);
    assert.ok(seen.length >= 2, "every declared repository is checked");
    assert.equal(fixtureGate(auto, () => undefined).status, "BLOCKED");
    assert.match(fixtureGate(auto, () => undefined).detail, /not reachable/);
    assert.equal(fixtureGate(auto, () => "abc\trefs/heads/main").status, "PASS");
  } finally { fs.rmSync(auto, { recursive: true, force: true }); }
});

test("fixtureGate: a missing or invalid configuration blocks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-rc-"));
  try {
    assert.equal(fixtureGate(dir, () => "x").status, "BLOCKED");
    fs.writeFileSync(path.join(dir, "datapass-codex-tests.json"), "{ not json");
    assert.match(fixtureGate(dir, () => "x").detail, /invalid/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
