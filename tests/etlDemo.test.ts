/**
 * V3-DEMO: examples/v3/etl-demo, a synthetic data-engineering client (Airflow DAG, two PySpark jobs,
 * SQL models, Bicep, a Dockerfile) and its bridge. The bridge loads without errors for the runtime and
 * the editor schemas, and every DataPass Hop explanation is "ok" against its native file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { parseGraph } from "../src/core/workspace/graph";
import { optionsProblems, parseOptions } from "../src/core/project/options";
import { linksProblems, parseLinks } from "../src/core/project/links";
import { loadUnderstanding } from "../src/core/understanding/load";

const ROOT = join(__dirname, "..");
const DEMO = join(ROOT, "examples", "v3", "etl-demo");
const BRIDGE = join(DEMO, "bridge");
const read = (rel: string) => readFileSync(join(BRIDGE, ".datapass", rel), "utf8");
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const schema = (f: string) => ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", f), "utf8")));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

test("etl-demo: manifest, graph, options and links are valid for the runtime and the editor schemas", () => {
  const manifest: DataPassProjectManifest = JSON.parse(read("project.json"));
  assert.deepEqual(validateProjectManifest(manifest), []);
  const p = schema("datapass-project.schema.json");
  assert.ok(p(manifest), JSON.stringify(p.errors));

  const graph = parseGraph(read("graph.json"));
  assert.ok(graph);
  const g = schema("datapass-graph.schema.json");
  assert.ok(g(JSON.parse(read("graph.json"))), JSON.stringify(g.errors));
  const providers = new Set(JSON.parse(read("graph.json")).items.map((i: { provider: string }) => i.provider));
  for (const want of ["azure-storage", "azure-data-factory", "airflow", "databricks", "sql", "docker", "powerbi", "bicep"]) assert.ok(providers.has(want), want);

  const o = parseOptions(read("options.json"));
  const os = schema("datapass-options.schema.json");
  assert.ok(os(JSON.parse(read("options.json"))), JSON.stringify(os.errors));
  assert.deepEqual(optionsProblems(o, manifest, graph).filter(x => x.severity === "error"), []);
  assert.deepEqual(o.scenarios?.map(s => s.id), ["a-local", "b-databricks", "c-fabric"]);

  const links = parseLinks(read("links.json"));
  const ls = schema("datapass-links.schema.json");
  assert.ok(ls(JSON.parse(read("links.json"))), JSON.stringify(ls.errors));
  assert.deepEqual(linksProblems(links, manifest.environments?.map(e => e.id)), []);
});

test("etl-demo: every repository the manifest names exists beside the bridge, and every declared entry file exists", () => {
  const manifest = JSON.parse(read("project.json"));
  for (const [key, repo] of Object.entries(manifest.repositories as Record<string, { path: string }>)) {
    assert.ok(existsSync(join(BRIDGE, repo.path)), key);
  }
  const graph = JSON.parse(read("graph.json"));
  for (const item of graph.items) {
    const a = item.artifacts;
    if (!a?.repoRef) continue;
    const base = join(BRIDGE, manifest.repositories[a.repoRef].path, a.root ?? ".");
    if (a.entry) assert.ok(existsSync(join(base, a.entry)), `${item.id}: ${a.entry}`);
    for (const f of a.files ?? []) { const rel = typeof f === "string" ? f : f.path; assert.ok(existsSync(join(base, rel)), `${item.id}: ${rel}`); }
  }
});

test("etl-demo: every DataPass Hop explanation is ok against its native file and valid for the editor schema", async () => {
  const manifest = JSON.parse(read("project.json"));
  const repos = new Map(Object.entries(manifest.repositories as Record<string, { path: string }>).map(([k, r]) => [k, join(BRIDGE, r.path)] as [string, string]));
  const { entries, index } = await loadUnderstanding(BRIDGE, repos);
  assert.deepEqual(index.diagnostics, []);
  assert.deepEqual(entries.map(e => `${e.doc?.target.repository}:${e.nativePath}:${e.state}:${e.doc?.target.language}`).sort(), [
    "api:Dockerfile:ok:dockerfile",
    "ingest:dags/meter_readings_daily.py:ok:airflow",
    "spark-jobs:jobs/clean_meter_readings.py:ok:pyspark",
    "spark-jobs:jobs/daily_site_energy.py:ok:pyspark",
    "warehouse:models/dim_site.sql:ok:sql",
    "warehouse:models/fct_site_energy_daily.sql:ok:sql",
    "warehouse:models/rpt_sites_over_contract.sql:ok:sql"
  ]);
  for (const e of entries) assert.deepEqual(e.diagnostics, [], e.nativePath);
  // Every explanation names a component of the graph.
  const ids = new Set(JSON.parse(read("graph.json")).items.map((i: { id: string }) => i.id));
  for (const e of entries) assert.ok(ids.has(e.doc?.component), `${e.nativePath}: ${e.doc?.component}`);
  // SQL: the three models cover inner, left (with COALESCE) and semi joins; the DAG has six tasks.
  const joinTypes = new Set(entries.filter(e => e.doc?.target.language === "sql").flatMap(e => e.doc?.joins?.map(j => j.type) ?? []));
  assert.deepEqual([...joinTypes].sort(), ["inner", "left", "semi"]);
  const dag = entries.find(e => e.doc?.target.language === "airflow")!;
  assert.equal(dag.doc?.steps.filter(s => s.kind === "task" || s.kind === "test").length, 6);
  const validate = schema("datapass-understanding.schema.json");
  for (const f of index.files) assert.ok(validate(JSON.parse(readFileSync(f.file, "utf8"))), `${f.nativePath}: ${JSON.stringify(validate.errors)}`);
});

test("etl-demo: synthetic and public — no client names, no secrets, only example.com or localhost links", () => {
  const text = walk(DEMO).map(f => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(text, /foil/i);
  assert.doesNotMatch(text, /(password|secret|token)\s*[:=]\s*["'][^"']+["']/i);
  assert.doesNotMatch(text, /AccountKey=|sig=|dapi[0-9a-f]{8}/);
  for (const url of JSON.parse(read("links.json")).groups.flatMap((g: { links: Array<{ url: string }> }) => g.links.map(l => l.url))) {
    assert.match(url, /^https:\/\/[a-z.]*example\.com\/|^http:\/\/localhost:/, url);
  }
});
