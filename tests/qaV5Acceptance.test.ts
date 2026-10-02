/** V5E2E1: the V5 acceptance rows never count a missing feature, a cut journey or a boundary finding as green. */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { validate } from "@juliandatapass-group/semantic-core";
import { decisionRationaleDocumentSchema } from "@juliandatapass-group/decision-rationale";
import { vendoredPinSchema } from "@juliandatapass-group/project-contracts";
import {
  acceptanceVerdict, boundaryFindings, gitSpawnAllowed, missingFeatures, offerOf, parseV5Acceptance, parseV5Step, rowStatus,
  V5AcceptanceError, type JourneyOutcome, type RowOutcome, type V5Row
} from "../src/qa/v5/acceptance";
import { buildFixture, buildRepoSet, SHOP_BARE_EXCLUDES } from "../scripts/qa/v5Fixtures";
import { parseGraph } from "../src/core/workspace/graph";
import { validateProjectManifest } from "../src/core/projectManifestModel";

const ACCEPTANCE = fs.readFileSync(path.join("qa", "v5", "acceptance.json"), "utf8");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), `datapass-v5-${p}-`));

test("the acceptance file covers the 14 spec rows and the 30 screenshot names, once each", () => {
  const a = parseV5Acceptance(ACCEPTANCE);
  assert.deepEqual(a.rows.map(r => r.id), Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, "0")));
  const shots = a.rows.flatMap(r => r.shots);
  assert.equal(shots.length, 30);
  assert.deepEqual(shots.map(s => s.slice(0, 5)), Array.from({ length: 30 }, (_, i) => `v5-${String(i + 1).padStart(2, "0")}`));
  // Every row of part a that is not cut has a main and a hole journey.
  for (const r of a.rows.filter(x => x.part === "a" && !x.cut)) {
    assert.ok(r.journeys.some(j => j.kind === "main"), `row ${r.id} main`);
    assert.ok(r.journeys.some(j => j.kind === "hole"), `row ${r.id} hole`);
  }
  // TL-10 cuts are cut, never dropped.
  for (const id of ["04", "08"]) assert.ok(a.rows.find(r => r.id === id)?.cut);
});

test("a hole journey must assert the hole and the absence of a placeholder; an unknown step is refused", () => {
  const doc = JSON.parse(ACCEPTANCE) as { rows: Array<{ id: string; journeys: Array<{ kind: string; steps: unknown[] }> }> };
  const hole = doc.rows.find(r => r.id === "05")!.journeys.find(j => j.kind === "hole")!;
  hole.steps = hole.steps.filter(s => !("expectAbsent" in (s as object)));
  assert.throws(() => parseV5Acceptance(JSON.stringify(doc)), (e: unknown) => e instanceof V5AcceptanceError && e.issues.some(i => i.includes("no placeholder")));
  assert.equal(parseV5Step({ teleport: "x" }).kind, "invalid");
  assert.equal(parseV5Step({ shot: "v5-1-bad" }).kind, "invalid");
  assert.equal(parseV5Step({ chooseFile: "../outside.csv" }).kind, "invalid");
  assert.deepEqual(parseV5Step({ appendFile: "a\\.py$", match: true, text: "x" }), { kind: "appendFile", path: "a\\.py$", text: "x", match: true });
  assert.equal(parseV5Step({ run: "DataPass: Show Context" }).kind, "run");
});

const row = (over: Partial<V5Row> = {}): V5Row => ({ id: "01", title: "t", packages: ["P"], part: "a", requires: {}, shots: [], journeys: [], ...over });
const pass = (id: string, boundary: string[] = []): JourneyOutcome => ({ id, kind: "main", status: "PASS", boundary, steps: [] });

test("a feature the build does not contribute is a typed missing hole naming its package, never green", () => {
  const offer = offerOf({ contributes: { commands: [{ command: "datapass.a" }], configuration: [{ properties: { "datapass.s": {} } }], views: { x: [{ id: "datapass.v" }] } } }, rel => rel === "src/here.ts");
  const r = row({ requires: { commands: ["datapass.a", "datapass.b"], settings: ["datapass.s", "datapass.t"], views: ["datapass.v"], sources: ["src/here.ts", "src/gone.ts"] }, providers: { "datapass.b": "PKG !1" } });
  const missing = missingFeatures(r, offer);
  assert.deepEqual(missing, [{ id: "command:datapass.b", provider: "PKG !1" }, { id: "setting:datapass.t" }, { id: "source:src/gone.ts" }]);
  assert.equal(rowStatus(r, "a", missing, []).status, "missing");
  assert.equal(rowStatus(r, "a", [], [pass("V5-01")]).status, "green");
  assert.equal(rowStatus(r, "a", [], [pass("V5-01", ["network: https.request to example.com"])]).status, "red");
  assert.equal(rowStatus(r, "a", [], [{ ...pass("V5-01"), status: "CUT" }]).status, "red", "only cut journeys: nothing proved");
  assert.equal(rowStatus(row({ cut: "TL-10" }), "a", [], []).status, "cut");
  assert.equal(rowStatus(row({ part: "b" }), "a", [], []).status, "deferred");
});

test("the gate is accepted only when every row is green or cut", () => {
  const o = (status: RowOutcome["status"]): RowOutcome => ({ id: "x", title: "x", status, detail: "", journeys: [], shots: [] });
  assert.equal(acceptanceVerdict([o("green"), o("cut")]).accepted, true);
  for (const s of ["missing", "red", "deferred"] as const) assert.equal(acceptanceVerdict([o("green"), o(s)]).accepted, false);
  assert.equal(acceptanceVerdict([]).accepted, false);
});

test("TL-4: only read-only git verbs pass the spawn check", () => {
  for (const args of [["status", "--porcelain"], ["-C", "x", "log", "-n", "5"], ["rev-parse", "HEAD"], ["for-each-ref"], ["diff", "--no-ext-diff"], ["ls-files"], ["submodule", "status"], ["symbolic-ref", "HEAD"], ["config", "--get", "remote.origin.url"]])
    assert.equal(gitSpawnAllowed("C:\\Program Files\\Git\\cmd\\git.exe", args).ok, true, args.join(" "));
  for (const args of [["fetch"], ["pull"], ["checkout", "main"], ["push"], ["config", "user.name", "x"], ["config", "--global", "--get", "a"], ["submodule", "update"], ["diff", "--ext-diff"], ["symbolic-ref", "-d", "HEAD"], ["show", "HEAD"]])
    assert.equal(gitSpawnAllowed("git", args).ok, false, args.join(" "));
  assert.equal(gitSpawnAllowed("python.exe", ["-c", "1"]).ok, false);
});

test("boundary findings: remote network, non-git spawns and writes outside .datapass/ without a user action", () => {
  const f = boundaryFindings([
    { kind: "net", via: "http.request", target: "localhost:5173" },
    { kind: "net", via: "https.request", target: "api.example.com" },
    { kind: "spawn", file: "git", args: ["status"] },
    { kind: "spawn", file: "git", args: ["fetch"] },
    { kind: "write", path: ".datapass/materialization/fct_orders.json" },
    { kind: "write", path: "dbt/models/marts/fct_orders.sql" },
    { kind: "write", path: "fabric/new.Notebook/notebook-content.py" }
  ], new Set(["dbt/models/marts/fct_orders.sql"]));
  assert.deepEqual(f, [
    "network: https.request to api.example.com",
    "spawn: git fetch is not on the TL-4 read-only list (git fetch)",
    "write outside .datapass/ without a user action: fabric/new.Notebook/notebook-content.py"
  ]);
});

test("v5/shop is valid against the manifest, graph and decision-rationale contracts; shop-bare drops facts, not code", () => {
  const b = path.join("tests", "fixtures", "v5", "shop", ".datapass");
  assert.deepEqual(validateProjectManifest(JSON.parse(fs.readFileSync(path.join(b, "project.json"), "utf8"))), []);
  const graph = parseGraph(fs.readFileSync(path.join(b, "graph.json")));
  assert.equal(graph.items.filter(i => i.classification === "confidential").length, 1);
  const r = validate(decisionRationaleDocumentSchema, JSON.parse(fs.readFileSync(path.join(b, "decisions", "rationale.json"), "utf8")));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
  const bare = tmp("bare");
  buildFixture("shop-bare", bare);
  for (const x of SHOP_BARE_EXCLUDES) assert.equal(fs.existsSync(path.join(bare, x)), false, x);
  assert.ok(fs.existsSync(path.join(bare, "dbt", "models", "marts", "fct_orders.sql")));
  assert.ok(fs.existsSync(path.join(bare, "fabric", "ingest_orders.Notebook", "notebook-content.py")));
  fs.rmSync(bare, { recursive: true, force: true });
});

test("v5/repo-set: three local repos, no remote, a dirty lane one commit ahead, a valid vendored pin behind local Common", () => {
  const a = tmp("rs-a");
  const one = buildRepoSet(a);
  // Fixed author, date and content: the same SHAs on every machine (the screenshots and impact are stable).
  assert.deepEqual(one, { pinned: "45a89869d2598708402fb1945b294e17674e6c29", commonHead: "cd09f64314e38d4072e1e00899533869b97eef33" });
  const g = (repo: string, ...args: string[]) => spawnSync("git", args, { cwd: path.join(a, repo), encoding: "utf8" }).stdout.trim();
  for (const repo of ["ingest", "transform", "bi", "common"]) assert.equal(g(repo, "remote"), "", `${repo} has no remote`);
  assert.equal(g("ingest", "rev-parse", "--abbrev-ref", "HEAD"), "feature/order-channel");
  assert.equal(g("ingest", "rev-list", "--left-right", "--count", "main...HEAD"), "0\t1");
  assert.match(g("ingest", "status", "--porcelain"), /load_orders\.py/);
  const repos = JSON.parse(fs.readFileSync(path.join(a, ".datapass", "repos.json"), "utf8")) as { pins: unknown[] };
  assert.equal(validate(vendoredPinSchema, repos.pins[0]).ok, true);
  const noBi = tmp("rs-nobi");
  buildFixture("repo-set-no-bi", noBi);
  assert.equal(fs.existsSync(path.join(noBi, "bi")), false);
  assert.match(fs.readFileSync(path.join(noBi, ".datapass", "repos.json"), "utf8"), /"bi"/, "declared, not cloned");
  for (const d of [a, noBi]) fs.rmSync(d, { recursive: true, force: true });
});
