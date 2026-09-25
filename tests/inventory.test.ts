import assert from "node:assert/strict";
import test from "node:test";
import { classifyAsset, describeRepo, parseStatusV2, staticDagIds } from "../src/core/inventory/inventory";

const platform = (type: string, displayName: string) => JSON.stringify({ metadata: { type, displayName }, config: { version: "2.0", logicalId: "00000000-0000-0000-0000-000000000000" } });

test("inventory: notebooks, PBIP, Fabric Git items and bundles are recognised from path and header", () => {
  assert.deepEqual(classifyAsset("analysis/eda.ipynb"), { kind: "notebook", path: "analysis/eda.ipynb", name: "eda.ipynb", open: { type: "file", path: "analysis/eda.ipynb" } });
  assert.equal(classifyAsset("bi/Sales.pbip")?.module, "powerbi");
  const nb = classifyAsset("fabric/hello.Notebook/.platform", platform("Notebook", "Hello notebook"))!;
  assert.deepEqual([nb.kind, nb.name, nb.detail, nb.module, nb.open.type, nb.open.path], ["fabric-item", "Hello notebook", "Notebook", "fabric", "folder", "fabric/hello.Notebook"]);
  assert.equal(classifyAsset("fabric/Model.SemanticModel/.platform", platform("SemanticModel", "Model"))?.module, "powerbi");
  assert.equal(classifyAsset("fabric/x.Lakehouse/.platform", "{ not json")?.name, "x", "an unreadable .platform falls back to the folder name");
  assert.equal(classifyAsset("random/.platform"), undefined);
  const bundle = classifyAsset("databricks.yml", "# comment\nbundle:\n  name: retail_etl\n\ntargets:\n  dev:\n")!;
  assert.deepEqual([bundle.kind, bundle.name, bundle.module], ["databricks-bundle", "retail_etl", "databricks"]);
});

test("inventory: Databricks notebooks, Airflow DAGs and ADF pipelines are read statically, never run", () => {
  assert.equal(classifyAsset("src/hello.py", "# Databricks notebook source\nprint(1)\n")?.kind, "databricks-notebook");
  assert.equal(classifyAsset("fabric/n.Notebook/notebook-content.py", "# Fabric notebook source\n"), undefined, "a Fabric notebook body is part of its item, not a Databricks notebook");
  const dag = classifyAsset("dags/weekly.py", "from airflow import DAG\nwith DAG(dag_id=\"weekly_refresh\", schedule=None) as d:\n    pass\n")!;
  assert.deepEqual([dag.kind, dag.name, dag.module], ["airflow-dag", "weekly_refresh", "airflow"]);
  const decorated = classifyAsset("dags/tf.py", "from airflow.decorators import dag\n@dag(schedule=None)\ndef make():\n    pass\n")!;
  assert.equal(decorated.detail, "DAG id not static", "a computed id is reported as such, not guessed");
  assert.equal(classifyAsset("tools/x.py", "import airflow  # helper only\nprint('no dag')\n"), undefined);
  assert.equal(classifyAsset("notes/x.py", "s = 'DAG(\"fake\")'\n"), undefined, "no airflow import, no DAG");
  assert.deepEqual(staticDagIds("DAG('a'); DAG(dag_id='b'); dag_id=\"a\"; DAG(f'{x}')"), ["b", "a"]);
  const adf = classifyAsset("adf/pipeline/CopySales.json", JSON.stringify({ name: "CopySales", properties: { activities: [{}, {}] } }))!;
  assert.deepEqual([adf.kind, adf.name, adf.detail], ["adf-pipeline", "CopySales", "2 activities"]);
  assert.equal(classifyAsset("adf/pipeline/notes.json", JSON.stringify({ name: "x" })), undefined);
  assert.equal(classifyAsset("adf/pipeline/broken.json", "{"), undefined);
});

test("repositories: local Git state from porcelain v2, and plain wording for each state", () => {
  const clean = parseStatusV2("# branch.oid 0123456789abcdef0123456789abcdef01234567\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n");
  assert.deepEqual(clean, { changes: 0, head: "0123456789abcdef0123456789abcdef01234567", branch: "main", upstream: "origin/main", ahead: 0, behind: 0 });
  assert.equal(describeRepo({ key: "w", label: "W", state: "ok", ...clean }), "main · 0123456 · clean · in sync (as of last fetch)");
  const dirty = parseStatusV2("# branch.oid 0123456789abcdef0123456789abcdef01234567\n# branch.head feature\n# branch.upstream origin/feature\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x.ts\n? new.txt\n");
  assert.equal(describeRepo({ key: "w", label: "W", state: "ok", ...dirty }), "feature · 0123456 · 2 changes · ↑2 ↓1");
  const fresh = parseStatusV2("# branch.oid (initial)\n# branch.head main\n? a.txt\n");
  assert.equal(describeRepo({ key: "w", label: "W", state: "ok", ...fresh }), "main · no commit · 1 change · no upstream");
  assert.match(describeRepo({ key: "c", label: "C", state: "missing" }), /never cloned automatically/);
  assert.equal(describeRepo({ key: "s", label: "S", state: "remote-only", remote: "github.com/example/site" }), "remote-only · github.com/example/site");
});
