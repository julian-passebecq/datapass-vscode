import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITIES, CAPABILITY_INDEX } from "../src/core/capabilities/registry";
import { TOOL_INDEX, type ToolObservation } from "../src/core/capabilities/tools";
import { preflight, type PreflightContext } from "../src/core/capabilities/preflight";

const T = "2026-09-24T00:00:00Z";
function ctx(present: string[], absent: string[] = [], facts: Record<string, string | boolean> = {}, reviews: string[] = []): PreflightContext {
  const tools = new Map<string, ToolObservation>();
  for (const id of present) tools.set(id, { toolId: id, state: "present", observedAt: T });
  for (const id of absent) tools.set(id, { toolId: id, state: "absent", observedAt: T });
  return { tools, facts: new Map(Object.entries(facts)), reviewsConfirmed: new Set(reviews) };
}
const get = (id: string) => CAPABILITY_INDEX.get(id)!;

test("registry integrity: unique ids, known tools, documented sources", () => {
  assert.equal(new Set(CAPABILITIES.map(c => c.id)).size, CAPABILITIES.length);
  for (const c of CAPABILITIES) {
    for (const r of c.requirements) for (const t of r.anyOf) assert.ok(TOOL_INDEX.has(t), `${c.id} -> ${t}`);
    assert.ok(c.sources.length > 0, c.id);
    assert.ok(c.fallback.length > 0, c.id);
  }
});

test("Fabric notebook without Copilot/MCP/FabricStudio is not blocked by optional tools", () => {
  const r = preflight(get("fabric.notebook.edit-local-sync"),
    ctx(["ext.fabric-data-engineering", "ext.jupyter", "cli.java"], ["cli.copilot", "ws.mcp", "ext.fabric-studio", "ext.onelake"], { "fabric.workspace": "foil-dev" }));
  assert.equal(r.status, "ready");
  assert.equal(r.blockers.length, 0);
  assert.equal(r.optionalMissing.length, 2);
});

test("Fabric notebook without the Data Engineering extension is blocked even when core Fabric is present", () => {
  const r = preflight(get("fabric.notebook.edit-local-sync"),
    ctx(["ext.fabric", "ext.jupyter", "cli.java"], ["ext.fabric-data-engineering"], { "fabric.workspace": "w" }));
  assert.equal(r.status, "blocked");
  assert.match(r.nextStep, /Fabric Data Engineering/);
});

test("Eventstream deploy requires activation/rebind/budget review even with tools present", () => {
  const cap = get("fabric.eventstream.deploy");
  const r = preflight(cap, ctx(["ext.fabric"], [], { "fabric.workspace": "w" }));
  assert.equal(r.status, "needs-review");
  assert.ok(r.pendingReviews.some(p => /active/.test(p.label)));
  assert.ok(r.sideEffects.includes("activates-resources"));
  // Confirmations are bound to the exact target: the keys come from the evaluation itself.
  const allReviewed = Object.values(r.reviewKeys);
  assert.equal(allReviewed.length, cap.reviews.length);
  assert.equal(preflight(cap, ctx(["ext.fabric"], [], { "fabric.workspace": "w" }, allReviewed)).status, "ready");
  // The pre-0.13 key shape (capability:review, no target) no longer satisfies anything.
  assert.equal(preflight(cap, ctx(["ext.fabric"], [], { "fabric.workspace": "w" }, cap.reviews.map(x => `${cap.id}:${x.id}`))).status, "needs-review");
});

test("F04: a review confirmed for one target does not carry over to another target", () => {
  const cap = get("databricks.bundle.deploy");
  const dev = { "databricks.bundleRoot": true, "databricks.target": "dev" };
  const prod = { "databricks.bundleRoot": true, "databricks.target": "prod" };
  const first = preflight(cap, ctx(["cli.databricks"], [], dev));
  assert.equal(first.status, "needs-review");
  const confirmed = Object.values(first.reviewKeys);
  assert.equal(preflight(cap, ctx(["cli.databricks"], [], dev, confirmed)).status, "ready");
  const afterSwitch = preflight(cap, ctx(["cli.databricks"], [], prod, confirmed));
  assert.equal(afterSwitch.status, "needs-review", "the dev confirmation must not approve prod");
  assert.notEqual(afterSwitch.targetDigest, first.targetDigest);
  // A component operation is bound to its environment, declared target names and files.
  const subject = (env: string, files: string) => ({ key: `wind-dab:${cap.id}@${env}`, environment: env, target: { bundleTarget: env }, artifactDigest: files, requirements: [] });
  const base = { tools: new Map([["cli.databricks", { toolId: "cli.databricks", state: "present" as const, observedAt: T }]]), facts: new Map(Object.entries(dev)), reviewsConfirmed: new Set<string>() };
  const a = preflight(cap, { ...base, subject: subject("dev", "files-1") });
  const keys = new Set(Object.values(a.reviewKeys));
  assert.equal(preflight(cap, { ...base, reviewsConfirmed: keys, subject: subject("dev", "files-1") }).status, "ready");
  assert.equal(preflight(cap, { ...base, reviewsConfirmed: keys, subject: subject("dev", "files-2") }).status, "needs-review", "changed files need a new review");
  assert.equal(preflight(cap, { ...base, reviewsConfirmed: keys, subject: subject("prod", "files-1") }).status, "needs-review", "another environment needs a new review");
});

test("F01: a declared path that was not observed never makes an operation ready", () => {
  const cap = get("databricks.bundle.validate");
  // Declared but not found: blocked, and the preflight says what was declared and what is missing.
  const missing = preflight(cap, { ...ctx(["cli.databricks"]), factNotes: new Map([["databricks.bundleRoot", { state: "missing" as const, detail: "Declared \"../nowhere\", but databricks.yml was not found there." }]]) });
  assert.equal(missing.status, "blocked");
  assert.match(missing.blockers[0]!.detail, /not found/);
  // Declared but not checkable (Restricted Mode, unreadable folder): unknown, not missing.
  const unknown = preflight(cap, { ...ctx(["cli.databricks"]), factNotes: new Map([["databricks.bundleRoot", { state: "unknown" as const, detail: "could not check" }]]) });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.blockers.length, 0);
});

test("Airflow Git-Sync with workspace identity is needs-config, never generic Ready", () => {
  const r = preflight(get("airflow.fabric-job.git-sync"),
    ctx(["cli.git"], [], { "airflow.gitSync.repo": "x", "airflow.mode": "fabric-git-sync", "airflow.identity": "workspace-identity" }));
  assert.equal(r.status, "needs-config");
});

test("Grafana Git Sync reports that datasources remain a separate prerequisite", () => {
  const r = preflight(get("grafana.dashboards.git-sync"), ctx(["cli.git"], [], { "grafana.repo": "r" }));
  assert.equal(r.status, "ready");
  assert.ok(r.warnings.some(w => /datasources/.test(w)));
});

test("an unprobeable desktop app is unknown, not missing", () => {
  const r = preflight(get("powerbi.project.open-desktop"), ctx([], [], { "powerbi.pbip": true }));
  assert.equal(r.status, "unknown");
  assert.equal(r.blockers.length, 0);
});

test("TMDL editing needs no AI tooling and asks to protect unsaved Desktop work", () => {
  const r = preflight(get("powerbi.semantic-model.edit-tmdl"), ctx([], ["cli.copilot", "ws.mcp", "ext.tmdl"], { "powerbi.semanticModel": true }));
  assert.equal(r.status, "needs-review");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.pendingReviews.some(p => /unsaved/.test(p.label)));
});

test("Ready is never phrased as success", () => {
  const r = preflight(get("databricks.bundle.validate"), ctx(["cli.databricks"], [], { "databricks.bundleRoot": "." }));
  assert.equal(r.status, "ready");
  assert.match(r.evidenceNote, /not that the operation will succeed/);
});
