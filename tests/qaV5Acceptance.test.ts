/** V5E2E1 (a + b): the V5 acceptance rows never count a missing feature, a cut journey or a boundary finding as green. */
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
  acceptanceVerdict, boundaryFindings, gitSpawnAllowed, judgeSpawn, missingFeatures, offerOf, parseSpawnTriggers, parseV5Acceptance, parseV5Step, rowStatus,
  V5AcceptanceError, type JourneyOutcome, type RowOutcome, type V5Row
} from "../src/qa/v5/acceptance";
import { buildFixture, buildRepoSet, buildStudioOverlay, findStudio, SHOP_BARE_EXCLUDES, STUDIO_DEMO_WORKSPACE, V5_FIXTURE_DIR } from "../scripts/qa/v5Fixtures";
import { materializeDbtModels, type DbtFile } from "../src/core/materialize/dbtNotebook";
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
  // Parts a and b are both written: every row that is not cut has a main and a hole journey.
  assert.equal(a.part, "all");
  for (const r of a.rows.filter(x => !x.cut)) {
    assert.ok(r.journeys.some(j => j.kind === "main"), `row ${r.id} main`);
    assert.ok(r.journeys.some(j => j.kind === "hole"), `row ${r.id} hole`);
  }
  // TL-10 cuts are cut, never dropped.
  for (const id of ["04", "08"]) assert.ok(a.rows.find(r => r.id === id)?.cut);
  // V5E2E1b: rows whose feature MR is open say so; Studio runs in Chromium; the explainer is stepped through offline.
  assert.deepEqual(a.rows.filter(r => r.pendingMerge).map(r => r.id), ["02", "07", "11", "13"]);
  assert.ok(a.rows.find(r => r.id === "14")!.journeys.every(j => j.host === "chromium"));
  const offline = a.rows.find(r => r.id === "12")!.journeys.find(j => j.id === "V5-12-OFFLINE")!;
  assert.ok(offline.steps.some(s => s.kind === "openInChromium") && offline.steps.some(s => s.kind === "shot" && s.name === "v5-27-explainer-page"));
  // A confirmed Write is the user's action: rows 01, 02 and 06 accept what it wrote, right after the click.
  for (const id of ["01", "02", "06"]) for (const j of a.rows.find(r => r.id === id)!.journeys) {
    const i = j.steps.findIndex(s => s.kind === "click" && s.text === "Write");
    if (i >= 0) assert.equal(j.steps[i + 1]?.kind, "acceptWrites", `${j.id}: acceptWrites right after Write`);
  }
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
  // V5E2E1b steps.
  assert.deepEqual(parseV5Step({ chooseCassette: "tour-bi.json" }), { kind: "chooseCassette", name: "tour-bi.json" });
  assert.equal(parseV5Step({ chooseCassette: "../secrets.json" }).kind, "invalid");
  assert.deepEqual(parseV5Step({ expectElement: "g.task" }), { kind: "expectElement", selector: "g.task", timeoutMs: 15000 });
  assert.equal(parseV5Step({ expectNoOverlap: "" }).kind, "invalid");
  assert.equal(parseV5Step({ acceptWrites: "(" }).kind, "invalid");
  assert.deepEqual(parseV5Step({ closeChromium: true }), { kind: "closeChromium" });
  // QAFIX1: a save dialog is accepted at the default it offers, nothing else.
  assert.deepEqual(parseV5Step({ chooseSave: "default" }), { kind: "chooseSave", answer: "default" });
  assert.equal(parseV5Step({ chooseSave: "C:/elsewhere.html" }).kind, "invalid");
  // A Chromium journey never drives VS Code, and only a Studio fixture runs in Chromium.
  const chromium = JSON.parse(ACCEPTANCE) as { rows: Array<{ id: string; journeys: Array<{ id: string; host?: string; steps: unknown[] }> }> };
  chromium.rows.find(r => r.id === "14")!.journeys[0]!.steps.unshift({ run: "DataPass: Show Context" });
  assert.throws(() => parseV5Acceptance(JSON.stringify(chromium)), (e: unknown) => e instanceof V5AcceptanceError && e.issues.some(i => i.includes("needs VS Code")));
  const host = JSON.parse(ACCEPTANCE) as typeof chromium;
  delete host.rows.find(r => r.id === "14")!.journeys[0]!.host;
  assert.throws(() => parseV5Acceptance(JSON.stringify(host)), (e: unknown) => e instanceof V5AcceptanceError && e.issues.some(i => i.includes("host chromium")));
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
  assert.equal(rowStatus(row({ part: "b" }), "all", [], [pass("V5-01")]).status, "green");
  // An open feature MR: pending-merge while the build lacks it, judged like any row once it is there.
  const pending = row({ pendingMerge: "PKG !9" });
  assert.equal(rowStatus(pending, "all", missing, []).status, "pending-merge");
  assert.equal(rowStatus(pending, "all", [], [pass("V5-01", ["spawn: x"])]).status, "red");
});

test("the gate is accepted only when every row is green or cut", () => {
  const o = (status: RowOutcome["status"]): RowOutcome => ({ id: "x", title: "x", status, detail: "", journeys: [], shots: [] });
  assert.equal(acceptanceVerdict([o("green"), o("cut")]).accepted, true);
  for (const s of ["missing", "red", "deferred", "pending-merge"] as const) assert.equal(acceptanceVerdict([o("green"), o(s)]).accepted, false);
  assert.equal(acceptanceVerdict([]).accepted, false);
});

const TRIGGERS = parseV5Acceptance(ACCEPTANCE).spawnTriggers;

test("spawns are judged by core/spawnAllowList.ts: read-only any time, lazy-probe after its view or command, user-command after its command", () => {
  // TL-4 through the allow-list: read-only git passes, writes and unknown programs are refused.
  for (const args of [["status", "--porcelain"], ["log", "-n", "5"], ["rev-parse", "HEAD"], ["for-each-ref"], ["diff", "--no-ext-diff"], ["ls-files"], ["symbolic-ref", "HEAD"], ["config", "--get", "remote.origin.url"], ["show", "HEAD:a.sql"]])
    assert.equal(gitSpawnAllowed("C:\\Program Files\\Git\\cmd\\git.exe", args).ok, true, args.join(" "));
  for (const args of [["pull"], ["checkout", "main"], ["push"], ["config", "user.name", "x"], ["config", "user.name"], ["diff", "--ext-diff"], ["symbolic-ref", "-d", "HEAD"], ["submodule", "update"]])
    assert.equal(gitSpawnAllowed("git", args).ok, false, args.join(" "));
  assert.equal(gitSpawnAllowed("python.exe", ["-c", "1"]).ok, false);
  // Timing: a read-only verb needs no trigger; a probe at activation and a fetch before its command are findings.
  assert.equal(judgeSpawn("git", ["status"], 5, [], TRIGGERS), undefined);
  assert.match(judgeSpawn("C:\\java\\bin\\java.exe", ["-version"], 5, [], TRIGGERS)!, /probe\.cli\.java \(lazy-probe\) ran before its own view or command/);
  assert.equal(judgeSpawn("java", ["-version"], 5, [{ at: 1, surfaces: ["view:Galaxy"] }], TRIGGERS), undefined);
  assert.match(judgeSpawn("java", ["-version"], 5, [{ at: 9, surfaces: ["view:Galaxy"] }], TRIGGERS)!, /ran before/, "the view opened after the probe");
  assert.match(judgeSpawn("git", ["fetch"], 5, [{ at: 1, surfaces: ["view:Git"] }], TRIGGERS)!, /git\.fetch \(user-command\) ran before its own command/);
  assert.equal(judgeSpawn("git", ["fetch", "--quiet", "origin", "main"], 5, [{ at: 1, surfaces: ["command:datapass.workOrders.launch"] }], TRIGGERS), undefined, "a command family");
  assert.match(judgeSpawn("az", ["account", "show", "--output", "json"], 5, [], TRIGGERS)!, /az\.account-show \(user-command\)/);
  assert.match(judgeSpawn("java", ["-version"], 5, [{ at: 1, surfaces: ["view:Galaxy"] }], {})!, /no trigger in spawnTriggers/);
  assert.match(judgeSpawn("python", ["-c", "print(1)"], 5, [], TRIGGERS)!, /not on the DataPass spawn allow-list/);
  // The trigger table names real, non-read-only allow-list entries.
  const issues: string[] = [];
  parseSpawnTriggers({ "git.status": ["command:x"], "nope.*": ["command:x"], "git.fetch": ["somewhere"] }, issues);
  assert.equal(issues.length, 3, issues.join("\n"));
});

test("boundary findings: remote network, spawns out of the allow-list or before their trigger, writes outside .datapass/ without a user action", () => {
  const f = boundaryFindings([
    { kind: "net", via: "http.request", target: "localhost:5173" },
    { kind: "net", via: "https.request", target: "api.example.com" },
    { kind: "spawn", file: "git", args: ["status"], at: 2 },
    { kind: "spawn", file: "git", args: ["fetch"], at: 2 },
    { kind: "spawn", file: "git", args: ["fetch"], at: 20 },
    { kind: "spawn", file: "git", args: ["pull"], at: 20 },
    { kind: "write", path: ".datapass/materialization/fct_orders.json" },
    { kind: "write", path: "dbt/models/marts/fct_orders.sql" },
    { kind: "write", path: "fabric/new.Notebook/notebook-content.py" }
  ], new Set(["dbt/models/marts/fct_orders.sql"]), { timeline: [{ at: 10, surfaces: ["command:datapass.git.fetchAll"] }], triggers: TRIGGERS });
  assert.deepEqual(f, [
    "network: https.request to api.example.com",
    "spawn: git.fetch (user-command) ran before its own command (git fetch)",
    "spawn: git pull is not on the allow-list (git pull)",
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

const dbtFiles = (root: string): DbtFile[] => {
  const out: DbtFile[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push({ path: path.relative(root, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") }); } };
  walk(path.join(root, "dbt", "target"));
  return out;
};

test("v5/shop carries dbt's compiled artefacts and a materialize config: fct_orders materializes with no error hole; shop-macro keeps a typed hole", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(V5_FIXTURE_DIR, "shop", ".datapass", "dbt-materialize.json"), "utf8")) as { environments: Record<string, never>; rootDirectory: string };
  const run = (root: string) => materializeDbtModels({ files: dbtFiles(root), environment: "dev", environments: cfg.environments, dbtRevision: "a".repeat(40), models: ["fct_orders"], rootDirectory: cfg.rootDirectory, at: "2026-10-02T00:00:00Z" });
  const shop = run(path.join(V5_FIXTURE_DIR, "shop"));
  assert.deepEqual(shop.holes.filter(h => h.severity === "error"), []);
  assert.deepEqual(shop.issues.filter(i => i.severity === "error"), []);
  assert.ok(shop.files.some(f => /fct_orders/.test(f.path)));
  const macro = tmp("macro");
  buildFixture("shop-macro", macro);
  const holes = run(macro).holes.map(h => h.code);
  assert.ok(holes.includes("dbt.compiled-sql-jinja"), holes.join(", "));
  const milestone = tmp("milestone");
  buildFixture("shop-milestone", milestone);
  const graph = parseGraph(fs.readFileSync(path.join(milestone, ".datapass", "graph.json")));
  assert.equal(graph.items.find(i => i.id === "fct-orders")?.checklist?.[0]?.id, "gold-ready");
  for (const d of [macro, milestone]) fs.rmSync(d, { recursive: true, force: true });
});

test("V5E2E1b fixtures and cassettes: synthetic DAGs, FastAPI replay, tour and architect-review answers on real ids", () => {
  const dag = tmp("dag");
  buildFixture("dag", dag);
  assert.match(fs.readFileSync(path.join(dag, "dags", "odd_operators.py"), "utf8"), /ZorbOperator/);
  const api = tmp("api");
  buildFixture("fastapi-orders", api);
  const spans = (JSON.parse(fs.readFileSync(path.join(api, "replay", "otlp-orders.json"), "utf8")) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }> }).resourceSpans[0]!.scopeSpans[0]!.spans;
  const attr = (sp: (typeof spans)[number], k: string) => sp.attributes.find(a => a.key === k)?.value.stringValue;
  const endpoints = new Set(spans.filter(sp => attr(sp, "http.route")).map(sp => `${attr(sp, "http.request.method")} ${attr(sp, "http.route")}`));
  assert.equal(endpoints.size, 4, [...endpoints].join(", "));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(api, "replay", "empty.json"), "utf8")), { resourceSpans: [] });
  for (const d of [dag, api]) fs.rmSync(d, { recursive: true, force: true });
  // The cassettes point only at ids of v5/shop, except the hole one; every step and answer is ai-proposed.
  const ex = (n: string) => JSON.parse(fs.readFileSync(path.join(V5_FIXTURE_DIR, "exchange", n), "utf8"));
  const ids = new Set(["shop-lakehouse", ...(JSON.parse(fs.readFileSync(path.join(V5_FIXTURE_DIR, "shop", ".datapass", "graph.json"), "utf8")) as { items: Array<{ id: string }> }).items.map(i => i.id)]);
  const tour = ex("tour-bi.json") as { tours: Array<{ id: string; generation: { exclude: string[] }; steps: Array<{ location: { nodeId: string }; origin: string; section: string }> }> };
  assert.equal(tour.tours[0]!.id, "ai.bi");
  assert.ok(tour.tours[0]!.steps.every(st => ids.has(st.location.nodeId) && st.origin === "ai-proposed"));
  assert.ok(tour.tours[0]!.steps.some(st => tour.tours[0]!.generation.exclude.includes(st.section)), "one step of an excluded section, to be dropped");
  const unknown = ex("tour-bi-unknown.json") as typeof tour;
  assert.ok(unknown.tours[0]!.steps.some(st => !ids.has(st.location.nodeId)));
  for (const n of ["architect-review.json", "architect-review-unverified.json"]) {
    const a = ex(n) as { origin: string; requestId: string; findings: Array<{ subjectNodeIds: string[] }> };
    assert.equal(a.origin, "ai-proposed");
    assert.match(a.requestId, /^datapass:architect-review:[0-9a-f]{64}$/);
    assert.ok(a.findings.every(f => f.subjectNodeIds.every(x => ids.has(x))));
  }
});

test("Studio fixtures: the hole workspace is the demo with no health data, served before the checkout's files", () => {
  const studio = tmp("studio");
  const dir = path.join(studio, "examples", "studio2");
  fs.mkdirSync(path.join(dir, "datapass", "views"), { recursive: true });
  fs.mkdirSync(path.join(studio, "apps", "studio-shell"), { recursive: true });
  fs.writeFileSync(path.join(studio, ...STUDIO_DEMO_WORKSPACE.split("/")), JSON.stringify({ id: "demo", title: "Demo", datapassInputs: [{ id: "views", schema: "datapass.view-catalog/1", location: "./datapass/views/catalog.json" }] }));
  fs.writeFileSync(path.join(dir, "datapass", "views", "catalog.json"), JSON.stringify({ locations: [{ location: { level: "project" }, data: { health: { metrics: [] }, map: {} } }] }));
  const overlay = tmp("overlay");
  assert.equal(buildStudioOverlay("studio-demo", studio, overlay), STUDIO_DEMO_WORKSPACE);
  const ws = buildStudioOverlay("studio-hole", studio, overlay);
  const doc = JSON.parse(fs.readFileSync(path.join(overlay, ...ws.split("/")), "utf8")) as { title: string; datapassInputs: Array<{ location: string }> };
  assert.match(doc.title, /no health data/);
  const cat = JSON.parse(fs.readFileSync(path.join(overlay, "examples", "studio2", ...doc.datapassInputs[0]!.location.replace(/^\.\//, "").split("/")), "utf8")) as { locations: Array<{ data: Record<string, unknown> }> };
  assert.deepEqual(Object.keys(cat.locations[0]!.data), ["map"]);
  assert.equal(findStudio(path.join(studio, "x"), studio), studio);
  for (const d of [studio, overlay]) fs.rmSync(d, { recursive: true, force: true });
});
