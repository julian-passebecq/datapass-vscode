import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { digestJson, unwrap } from "@juliandatapass-group/semantic-core";
import {
  type DbtFile,
  type DbtMaterializeInput,
  detachStampDigest,
  materializeDbtModels,
  notebookSourceHash,
  previewDbtDiff,
  readDbtArtifacts,
  recordPath
} from "../src/core/materialize/dbtNotebook";
import { materializationGitPlan } from "../src/core/materialize/flow";

const ROOT = join(__dirname, "fixtures", "dbtmat");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files: DbtFile[] = walk(ROOT).map(p => ({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

const REV = "0123456789abcdef0123456789abcdef01234567";
const input = (over: Partial<DbtMaterializeInput> = {}): DbtMaterializeInput => ({
  files,
  environment: "dev",
  environments: {
    dev: { lakehouse: "lh_dev", sources: { "raw.orders": "lh_bronze_dev.orders" } },
    prod: { lakehouse: "lh_prod", schema: "gold", tables: { stg_orders: "lh_prod.silver.stg_orders" } }
  },
  dbtRevision: REV,
  rootDirectory: "fabric",
  at: "2026-10-01T08:00:00Z",
  ...over
});
const notebook = (r: ReturnType<typeof materializeDbtModels>, name: string) => r.files.find(f => f.path === `fabric/${name}.Notebook/notebook-content.py`)!.content;

test("reads models and sources from target/ artefacts, with the compiled/ file as fallback", () => {
  const { projects, holes } = readDbtArtifacts(files);
  assert.deepEqual(holes, []);
  assert.equal(projects.length, 1);
  const p = projects[0]!;
  assert.equal(p.projectName, "shop");
  assert.equal(p.projectDir, "shop");
  assert.deepEqual(p.models.map(m => m.name).sort(), ["customer_totals", "int_helper", "order_events", "stg_orders", "top_customers"]);
  assert.match(p.models.find(m => m.name === "customer_totals")!.compiledSql!, /group by customer_id/);
  assert.equal(p.models.find(m => m.name === "top_customers")!.compiledSql, undefined);
  assert.equal(p.sources[0]!.relationName, "\"warehouse\".\"raw\".\"orders\"");
});

test("no manifest → a hole, never a guessed notebook", () => {
  const r = materializeDbtModels(input({ files: files.filter(f => !f.path.endsWith("manifest.json")) }));
  assert.deepEqual(r.holes.map(h => h.code), ["dbt.manifest-missing"]);
  assert.equal(r.files.length, 0);
});

test("refs and sources become the table names of each environment", () => {
  const dev = materializeDbtModels(input());
  assert.deepEqual(dev.issues, []);
  const stg = notebook(dev, "dbt_stg_orders");
  assert.match(stg, /# MAGIC %%sql/);
  assert.match(stg, /# MAGIC CREATE OR REPLACE VIEW lh_dev\.stg_orders AS/);
  assert.match(stg, /from lh_bronze_dev\.orders/);
  assert.doesNotMatch(stg, /"warehouse"/);
  const totals = notebook(dev, "dbt_customer_totals");
  assert.match(totals, /CREATE OR REPLACE TABLE lh_dev\.customer_totals USING DELTA AS/);
  assert.match(totals, /# MAGIC from lh_dev\.stg_orders/);
  assert.doesNotMatch(totals, /;\n/, "trailing semicolon stripped");
  assert.match(totals, /"default_lakehouse_name": "lh_dev"/);

  const prod = materializeDbtModels(input({ environment: "prod" }));
  assert.match(notebook(prod, "dbt_customer_totals"), /CREATE OR REPLACE TABLE lh_prod\.gold\.customer_totals USING DELTA AS/);
  assert.match(notebook(prod, "dbt_customer_totals"), /from lh_prod\.silver\.stg_orders/);
  assert.match(notebook(prod, "dbt_stg_orders"), /from lh_prod\.gold\.orders/);
});

test("missing compiled SQL, ephemeral and incremental models are reported as holes", () => {
  const r = materializeDbtModels(input());
  const codes = r.holes.map(h => `${h.code}:${h.modelId}`).sort();
  assert.deepEqual(codes, [
    "dbt.compiled-sql-missing:model.shop.top_customers",
    "dbt.ephemeral-not-materialized:model.shop.int_helper",
    "dbt.incremental-full-refresh:model.shop.order_events"
  ]);
  assert.equal(r.files.some(f => f.path.includes("dbt_top_customers")), false);
  assert.equal(r.files.some(f => f.path.includes("dbt_int_helper")), false);
  assert.match(notebook(r, "dbt_order_events"), /cross join __dbt__cte__int_helper h/);
  assert.equal(r.holes.find(h => h.modelId === "model.shop.top_customers")!.path, "shop/models/marts/top_customers.sql");
});

test("unknown environment or model → holes; selection by name", () => {
  assert.deepEqual(materializeDbtModels(input({ environment: "test" })).holes.map(h => h.code), ["dbt.environment-unknown"]);
  const r = materializeDbtModels(input({ models: ["stg_orders", "nope"] }));
  assert.deepEqual(r.holes.map(h => h.code), ["dbt.model-unknown"]);
  assert.deepEqual(r.candidate.units.map(u => u.name), ["dbt_stg_orders"]);
});

test("DETSPI1 record: authority dbt, stable stamp digest, notebook hash ignores the MAT1 stamp line", () => {
  const a = materializeDbtModels(input());
  const b = materializeDbtModels(input());
  assert.deepEqual(a.files, b.files, "byte-identical on the same revision");
  const rec = a.records.find(r => r.modelId === "model.shop.customer_totals")!;
  assert.equal(rec.record.authority, "dbt");
  assert.equal(rec.record.schema, "datapass.materialization-detach/1");
  assert.equal("schemaId" in rec.record, false);
  // Reviewed wire shapes: GitObjectId revision, digest objects, actor {kind, id}, no clock time in the stamp.
  assert.deepEqual(rec.record.stamp.dbtRevision, { algorithm: "git-sha1", oid: REV });
  assert.deepEqual(rec.record.stamp.actor, { kind: "tool", id: rec.record.stamp.actor.id });
  assert.equal("at" in rec.record.stamp, false);
  assert.equal(rec.record.recordedAt, "2026-10-01T08:00:00Z");
  assert.equal(rec.record.stamp.notebookHash.mode, "notebook-source-v1");
  assert.equal(rec.record.stampDigest.mode, "jcs-json");
  assert.equal(rec.path, recordPath("fabric/dbt_customer_totals.Notebook/notebook-content.py"));
  assert.deepEqual(rec.record.stampDigest, unwrap(digestJson(rec.record.stamp)));
  assert.deepEqual(rec.record.stampDigest, detachStampDigest({ ...rec.record.stamp }));
  assert.match(rec.record.stampDigest.value, /^[0-9a-f]{64}$/);
  // Key order is irrelevant (JCS).
  const reordered = Object.fromEntries(Object.entries(rec.record.stamp).reverse()) as typeof rec.record.stamp;
  assert.deepEqual(detachStampDigest(reordered), rec.record.stampDigest);
  // A different revision changes the digest.
  const c = materializeDbtModels(input({ dbtRevision: "f".repeat(40) }));
  assert.notDeepEqual(c.records.find(r => r.modelId === rec.modelId)!.record.stampDigest, rec.record.stampDigest);
  const content = notebook(a, "dbt_customer_totals");
  assert.deepEqual(rec.record.stamp.notebookHash, notebookSourceHash(content));
  assert.deepEqual(notebookSourceHash(content.replace(/^# datapass-provenance: .*\n/m, "")), rec.record.stamp.notebookHash);
  assert.deepEqual(notebookSourceHash(content.replace(/\n/g, "\r\n")), rec.record.stamp.notebookHash);
  assert.notEqual(notebookSourceHash(`${content}-- edit\n`).value, rec.record.stamp.notebookHash.value);
});

test("invalid revision or instant → validation issues", () => {
  const r = materializeDbtModels(input({ dbtRevision: "main", at: "today" }));
  assert.equal(r.issues.filter(i => i.severity === "error").length >= 2, true);
});

test("pipeline follows dbt dependency order", () => {
  const r = materializeDbtModels(input({ pipelineName: "dbt_daily" }));
  assert.deepEqual(r.issues, []);
  const p = r.candidate.units.find(u => u.kind === "data-pipeline");
  assert.ok(p && p.kind === "data-pipeline");
  assert.deepEqual(p.activities.find(a => a.name === "dbt_customer_totals")!.dependsOn, ["dbt_stg_orders"]);
  assert.deepEqual(p.activities.find(a => a.name === "dbt_order_events")!.dependsOn, ["dbt_stg_orders"]);
});

test("diff → branch/MR through MAT1; a detached notebook is never overwritten", () => {
  const r = materializeDbtModels(input());
  const fresh = previewDbtDiff(r, new Map());
  assert.equal(fresh.every(e => e.status === "added"), true);
  const plan = materializationGitPlan({
    userAction: "user-confirmed", branch: "datapass/materialize-dbt-dev", baseBranch: "main",
    candidate: r.candidate, files: r.files, diff: fresh, issues: r.issues, openMergeRequest: false
  });
  assert.equal(plan.writes.length, r.files.length);
  assert.ok(plan.writes.some(w => w.path.startsWith(".datapass/materialization/")));

  const rec = r.records.find(x => x.modelId === "model.shop.stg_orders")!;
  const nbPath = rec.record.stamp.notebookPath;
  const detached = { ...rec.record, authority: "notebook" };
  const existing = new Map(r.files.map(f => [f.path, f.content]));
  existing.set(nbPath, `${existing.get(nbPath)}# hand edit\n`);
  existing.set(rec.path, JSON.stringify(detached));
  const regenerated = previewDbtDiff(r, existing, true);
  const status = (p: string) => regenerated.find(e => e.path === p)!;
  assert.equal(status(nbPath).status, "blocked-detached");
  assert.match(status(nbPath).reason!, /notebook is the authority/);
  assert.equal(status(rec.path).status, "blocked-detached");

  // Not detached, hand-edited, no explicit overwrite: MAT1 blocks the notebook and its record follows.
  const edited = new Map(r.files.map(f => [f.path, f.content]));
  edited.set(nbPath, `${edited.get(nbPath)}# hand edit\n`);
  edited.set(rec.path, "{}");
  const e2 = previewDbtDiff(r, edited);
  assert.equal(e2.find(e => e.path === nbPath)!.status, "blocked-detached");
  assert.equal(e2.find(e => e.path === rec.path)!.status, "blocked-detached");
});

test("target: fabric-notebook by default; spark-job-definition is a hole with no files (SJDMAT1)", () => {
  const byDefault = materializeDbtModels(input());
  const explicit = materializeDbtModels(input({ target: "fabric-notebook" }));
  assert.deepEqual(byDefault.files, explicit.files);
  assert.ok(byDefault.files.some(f => f.path.endsWith(".Notebook/notebook-content.py")));
  const sjd = materializeDbtModels(input({ target: "spark-job-definition" }));
  assert.deepEqual(sjd.holes.map(h => h.code), ["dbt.target-not-yet"]);
  assert.match(sjd.holes[0]!.nextAction, /SJDMAT1/);
  assert.equal(sjd.files.length, 0);
  assert.equal(sjd.records.length, 0);
});

test("re-run at the same revision with a new `at` keeps every record unchanged", () => {
  const first = materializeDbtModels(input());
  const existing = new Map(first.files.map(f => [f.path, f.content]));
  const again = materializeDbtModels(input({ at: "2026-10-02T09:30:00Z", actor: { kind: "human", id: "someone-else" } }));
  const diff = previewDbtDiff(again, existing);
  assert.equal(diff.every(e => e.status === "unchanged"), true, JSON.stringify(diff.filter(e => e.status !== "unchanged")));
  // A new dbt revision does rewrite the records.
  const moved = previewDbtDiff(materializeDbtModels(input({ dbtRevision: "f".repeat(40) })), existing);
  assert.ok(moved.some(e => e.path.endsWith(".detach.json") && e.status === "modified"));
});

const synthetic = (nodes: Record<string, { materialized: string; deps: string[] }>): DbtFile[] => [{
  path: "target/manifest.json",
  text: JSON.stringify({
    metadata: { project_name: "p" },
    nodes: Object.fromEntries(Object.entries(nodes).map(([name, n]) => [`model.p.${name}`, {
      resource_type: "model", name, package_name: "p", alias: name, original_file_path: `models/${name}.sql`,
      config: { materialized: n.materialized }, relation_name: `"w"."s"."${name}"`,
      compiled_code: `select 1 as x${n.deps.map(d => ` union all select x from "w"."s"."${d}"`).join("")}\n`,
      depends_on: { nodes: n.deps.map(d => `model.p.${d}`) }
    }]))
  })
}];

test("pipeline order goes through ephemeral models: A → ephemeral E → B gives A dependsOn B", () => {
  const r = materializeDbtModels(input({
    files: synthetic({ a: { materialized: "table", deps: ["e"] }, e: { materialized: "ephemeral", deps: ["b"] }, b: { materialized: "table", deps: [] } }),
    pipelineName: "dbt_run"
  }));
  const p = r.candidate.units.find(u => u.kind === "data-pipeline");
  assert.ok(p && p.kind === "data-pipeline");
  assert.deepEqual(p.activities.find(x => x.name === "dbt_a")!.dependsOn, ["dbt_b"]);
  assert.deepEqual(p.activities.find(x => x.name === "dbt_b")!.dependsOn, []);
});

test("an unknown materialization is a warning hole, generated as a Delta table", () => {
  const r = materializeDbtModels(input({ files: synthetic({ a: { materialized: "snapshotish", deps: [] } }) }));
  assert.deepEqual(r.holes.map(h => `${h.code}:${h.severity}`), ["dbt.materialization-unknown:warning"]);
  assert.match(r.files.find(f => f.path.endsWith("notebook-content.py"))!.content, /CREATE OR REPLACE TABLE lh_dev\.a USING DELTA AS/);
});
