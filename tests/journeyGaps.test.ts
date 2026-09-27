/**
 * V1-GAPS: automated coverage for the three client journeys qa:ui cannot drive (J04, J09, J12).
 *   J12 production is declaration-only: whichever environment is selected, prod included, DataPass
 *       offers no run / deploy / publish operation as ready, never executes one itself, and the
 *       modules that build operations start no process.
 *   J09 file versions only read Git: every Git sub-command the commands run is read-only, and
 *       nothing in the module writes a file.
 *   J04 an AI proposal is reviewed before any write, and unsupported proposals are refused with a
 *       reason (blocked), never passed silently.
 * The desktop halves are in tests/integration/journeyGapFlows.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildProjectMap } from "../src/core/project/projectMap";
import { CAPABILITIES } from "../src/core/capabilities/registry";
import { environmentOf } from "../src/core/exchange/stamp";
import { stampVerdict } from "../src/core/workOrders/launch";
import { fileLogArgs, REFLOG_ARGS } from "../src/core/git/fileVersions";
import { checkIncoming, reviewIncoming } from "../src/core/project/aiExchange";
import { inputA, manifestA } from "./fixtures/v3/research";

const src = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");
const DEPLOYISH = new Set(["deploy", "run", "publish"]);

// ------------------------------------------------------------------ J12

test("J12: the selected environment is never production while a non-production one exists", () => {
  const envs = manifestA().environments!;
  assert.ok(envs.some(e => e.production), "the fixture declares a production environment");
  assert.equal(environmentOf(envs), "dev");
  // Only when prod is the only declared environment does it become the selected one.
  assert.equal(environmentOf(envs.filter(e => e.production)), "prod");
});

test("J12: with prod selected, no run / deploy / publish operation is ready and none targets prod unless declared", () => {
  const prodOnly = { ...manifestA(), environments: manifestA().environments!.filter(e => e.production) };
  assert.equal(environmentOf(prodOnly.environments), "prod");
  for (const manifest of [manifestA(), prodOnly]) {
    const map = buildProjectMap(inputA({ manifest }));
    const ops = map.components.flatMap(c => c.operations).filter(o => DEPLOYISH.has(o.phase));
    assert.ok(ops.length > 0, "the fixture has deploy/run operations to judge");
    // The graph declares its deploys for dev only: nothing is ever retargeted at production.
    assert.deepEqual(ops.filter(o => o.environment?.production || o.environmentId === "prod").map(o => o.key), []);
    if (manifest === prodOnly) {
      // prod selected: dev is no longer declared, so every deploy/run is blocked with a reason.
      const ready = ops.filter(o => o.result.status === "ready");
      assert.deepEqual(ready.map(o => o.key), [], "no run/deploy operation is offered as ready on prod");
      for (const o of ops) assert.ok(o.result.blockers.length > 0, `${o.key}: ${o.result.status} without a blocker`);
    }
  }
});

test("J12: DataPass never executes a run / deploy / publish itself (copy, open the native tool, or do it there)", () => {
  const deployish = CAPABILITIES.filter(c => DEPLOYISH.has(c.phase));
  assert.ok(deployish.length >= 5);
  const executed = deployish.filter(c => !["copy-command", "open-native", "manual-in-native-tool", "reference-only"].includes(c.actionMode));
  assert.deepEqual(executed.map(c => `${c.id}: ${c.actionMode}`), []);
});

test("J12: the operation path starts no process: pure builders, and the terminal is typed, never run", () => {
  for (const rel of ["src/core/project/projectMap.ts", "src/core/capabilities/preflight.ts", "src/core/capabilities/registry.ts", "src/core/exchange/stamp.ts", "src/core/workOrders/launch.ts"]) {
    assert.doesNotMatch(src(rel), /from "(node:)?child_process"|from "vscode"/, `${rel} imports a process or VS Code API`);
  }
  const wb = src("src/work/workbenchCommands.ts");
  const sends = [...wb.matchAll(/\.sendText\(([^)]*)\)/g)].map(m => m[1]!);
  assert.ok(sends.length > 0);
  for (const s of sends) assert.match(s, /,\s*false$/, `sendText(${s}) would press Enter`);
  assert.doesNotMatch(wb, /tasks\.executeTask|child_process/);
});

test("J12: an order built for dev and launched while prod is selected asks first", () => {
  const dev = { variant: { key: "current", title: "Current" }, environment: "dev", bridge: "a".repeat(40) };
  const verdict = stampVerdict({ id: "wo-1234", stamp: dev }, { ...dev, environment: "prod" });
  assert.equal(verdict.kind, "other-variant");
  assert.match(verdict.kind === "other-variant" ? verdict.message : "", /another environment/);
});

// ------------------------------------------------------------------ J09

test("J09: file versions run read-only Git sub-commands only and write no file", () => {
  const READ_ONLY = new Set(["log", "reflog", "show", "cat-file", "rev-parse", "symbolic-ref", "diff"]);
  assert.ok(READ_ONLY.has(fileLogArgs("a.txt")[0]!));
  assert.ok(READ_ONLY.has(REFLOG_ARGS[0]!));
  const cmds = src("src/work/fileVersionCommands.ts");
  const subs = [...cmds.matchAll(/git\(\s*\[\s*"([a-z-]+)"/g)].map(m => m[1]!);
  assert.ok(subs.length >= 5, `found ${subs.join(", ")}`);
  assert.deepEqual(subs.filter(s => !READ_ONLY.has(s)), []);
  // Every other git( call passes one of the two argument builders above.
  const others = [...cmds.matchAll(/git\(\s*([A-Za-z_][\w]*)/g)].map(m => m[1]!);
  assert.deepEqual([...new Set(others)].sort(), ["REFLOG_ARGS", "fileLogArgs"]);
  assert.doesNotMatch(cmds, /writeFile|fs\.write|\.fs\.write|\.delete\(|applyEdit|"(checkout|reset|restore|commit|stash|fetch|pull|merge|push)"/);
});

test("J09: unavailable version tooling is reported, not silent: each refusal is a user-facing error", () => {
  const cmds = src("src/work/fileVersionCommands.ts");
  for (const why of [/Restricted Mode: trust this workspace/, /is not in a Git repository/, /Open a file first/, /has no commits yet/, /Git could not read the history/, /files on this computer only/]) {
    assert.ok(cmds.split("\n").some(l => l.includes("UserFacingError(") && why.test(l)), `no user-facing error for ${why}`);
  }
});

// ------------------------------------------------------------------ J04

const sheet = () => ({ format: "datapass.sheet", version: "1", datasets: [], formulas: [], runtimes: [], glossary: [{ term: "page coverage", meaning: "Share of pages read." }] });

test("J04: a valid proposal is reviewed (kind, path, size of the change) without writing anything", async () => {
  const reads: string[] = [];
  const r = await reviewIncoming("Here it is:\n```json\n" + JSON.stringify(sheet()) + "\n```", { manifest: manifestA() }, kind => { reads.push(kind); return undefined; });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) {
    assert.equal(r.kind, "sheet");
    assert.equal(r.path, ".datapass/sheet.json");
    assert.equal(r.isNew, true);
    assert.ok(r.added > 0);
  }
  assert.deepEqual(reads, ["sheet"], "the review only reads the current file");
});

test("J04: unsupported proposals are refused with a reason, never passed", async () => {
  const cases: Array<[string, RegExp]> = [
    [JSON.stringify({ format: "datapass.proposal", version: 1, changes: [] }), /not a DataPass file/],
    ["I changed the pipeline, see above.", /./],
    [JSON.stringify({ ...sheet(), glossary: [{ term: "key", meaning: "AccountKey=abcdefghijklmnopqrstuv" }] }), /Refused: .*sensitive/]
  ];
  for (const [raw, why] of cases) {
    assert.throws(() => checkIncoming(raw, { manifest: manifestA() }), why);
    const r = await reviewIncoming(raw, { manifest: manifestA() }, () => { throw new Error("an unsupported proposal must not read the project"); });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, why);
  }
  // Expected one kind, got another: refused too.
  assert.throws(() => checkIncoming(JSON.stringify(sheet()), { manifest: manifestA() }, "board"), /Expected the/);
});
