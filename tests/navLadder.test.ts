import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { classifyArtifactKind } from "../src/core/navigation/artifactKind";
import { buildLadder, fileNodeId, operationNodeId, stepNodeId } from "../src/core/navigation/ladder";
import { ARTIFACT_KINDS, type NavLocation } from "../src/core/navigation/navTypes";
import { buildProjectMap, type ProjectMap } from "../src/core/project/projectMap";
import { parseUnderstanding } from "../src/core/understanding/contract";
import { inputA } from "./fixtures/v3/research";

const HOP = join(__dirname, "..", "examples", "v3", "hop");
const read = (...p: string[]) => readFileSync(join(HOP, ...p), "utf8");
const steps = (path: string) => parseUnderstanding(read("bridge", ".datapass", "understanding", ...path.split("/"))).doc?.steps;

test("artifact kinds: static evidence only, unknown = other", () => {
  const spark = "from pyspark.sql import SparkSession\nspark = SparkSession.builder.getOrCreate()\n";
  const ipynb = (src: string) => JSON.stringify({ cells: [{ cell_type: "code", source: [src] }], metadata: {} });
  assert.equal(classifyArtifactKind("nb/a.ipynb", ipynb("df = spark.read.parquet('x')")), "spark-notebook");
  assert.equal(classifyArtifactKind("nb/a.ipynb", ipynb("import pandas as pd")), "python-notebook");
  assert.equal(classifyArtifactKind("nb/a.ipynb"), "other", "no content read: no guess");
  assert.equal(classifyArtifactKind("x/Load.Notebook/notebook-content.py", "# Fabric notebook source\n%%pyspark\ndf = spark.table('t')"), "spark-notebook");
  assert.equal(classifyArtifactKind("x/Job.SparkJobDefinition/SparkJobDefinitionV1.json"), "spark-job");
  assert.equal(classifyArtifactKind("x/Copy.DataPipeline/pipeline-content.json"), "pipeline");
  assert.equal(classifyArtifactKind("x/Sales.SemanticModel/definition/model.tmdl"), "powerbi");
  assert.equal(classifyArtifactKind("jobs/main.py", `${spark}\nif __name__ == "__main__":\n    main()\n`), "spark-job");
  assert.equal(classifyArtifactKind("lib/util.py", spark), "other", "Spark code without an entry point is not a job");
  assert.equal(classifyArtifactKind("pipelines/dags/daily_sales_dag.py", read("pipelines", "dags", "daily_sales_dag.py")), "airflow-dag");
  assert.equal(classifyArtifactKind("pipelines/sql/customer_orders.sql", read("pipelines", "sql", "customer_orders.sql")), "sql-script");
  assert.equal(classifyArtifactKind("fixdbt/models/intermediate/int_scada_hourly.sql", undefined, { dbtProjectRoot: "fixdbt" }), "dbt-model");
  assert.equal(classifyArtifactKind("fixdbt/macros/safe_divide.sql", undefined, { dbtProjectRoot: "fixdbt" }), "sql-script");
  assert.equal(classifyArtifactKind("models/stg.sql", "select * from {{ ref('raw') }}"), "dbt-model");
  assert.equal(classifyArtifactKind("adf/pipeline/p.json", JSON.stringify({ name: "p", properties: { activities: [] } })), "pipeline");
  assert.equal(classifyArtifactKind("infra/main.tf"), "iac");
  assert.equal(classifyArtifactKind("infra/app.bicep"), "iac");
  assert.equal(classifyArtifactKind("databricks.yml"), "config");
  assert.equal(classifyArtifactKind("README.md"), "other");
  for (const p of ["a.ipynb", "b.sql", "c.py", "d.json", "e.tf", "f.yml", "g"]) assert.ok((ARTIFACT_KINDS as readonly string[]).includes(classifyArtifactKind(p)));
});

test("ladder over the synthetic research map: project → sub-projects → components → files, existing ids", () => {
  const map = buildProjectMap(inputA());
  const l = buildLadder({ map });
  const root = l.root();
  assert.deepEqual(root, { level: "project", nodeId: "research-library", artifactKind: "project" });
  assert.equal(l.parent(root), null);
  const subs = l.children(root);
  assert.deepEqual(subs.map((s) => s.nodeId), map.subprojects.map((s) => s.id));
  const papers = subs[0]!;
  assert.deepEqual(l.children(papers).map((c) => c.nodeId), map.subprojects[0]!.componentIds);
  const extract = l.children(papers).find((c) => c.nodeId === "extract")!;
  assert.equal(extract.level, "artifact");
  const files = l.children(extract);
  assert.ok(files.some((f) => f.nodeId === fileNodeId("pipeline", "functions/extract/function_app.py")));
  for (const f of files) assert.deepEqual(l.parent(f), extract);
  assert.deepEqual(l.parent(extract), papers);
  assert.equal(l.entry(files[0]!)?.componentId, "extract");
  const bundle = l.children(subs[1]!).find((c) => c.nodeId === "lab-bundle")!;
  assert.equal(bundle.artifactKind, "config", "component kind = its entry file's kind");
  assert.deepEqual(l.children(l.children(bundle)[0]!), [], "a file without Hop steps or operations is a leaf");
});

/** A hand-built map over examples/v3/hop: one sub-project, two components (the Spark job, the DAG + SQL). */
function hopMap(): ProjectMap {
  const file = (repoPath: string) => ({ path: repoPath, repoPath, kind: "file", role: "source", requiredFor: [], optional: false, source: "declared", state: "found" });
  const comp = (id: string, entry: string, more: string[] = []) => ({
    id, label: id, kind: "job", subprojects: ["sales"], children: [], operations: [], checklist: [], docs: [], incoming: [], outgoing: [], problems: [],
    health: "ok", headline: "", nextStep: "",
    artifacts: { repoKey: "pipelines", root: "", entry: file(entry), files: [file(entry), ...more.map(file)] }
  });
  return {
    coordinationKey: "hop-example", environments: [], docs: [], repositories: [], relations: [], problems: [], nextStep: "",
    subprojects: [{ id: "sales", title: "Daily sales", implicit: false, componentIds: ["sales-job", "sales-dag"] }],
    components: [comp("sales-job", "jobs/daily_sales.py"), comp("sales-dag", "dags/daily_sales_dag.py", ["sql/customer_orders.sql"])]
  } as unknown as ProjectMap;
}

test("ladder down to Hop steps and analyzer operations, with line ranges and locate()", () => {
  const jobSteps = steps("pipelines/jobs/daily_sales.py.json");
  assert.ok(jobSteps && jobSteps.length > 1, "fixture has Hop steps");
  const first = [...jobSteps].sort((a, b) => a.lines[0] - b.lines[0])[0]!;
  const l = buildLadder({
    map: hopMap(),
    head: (_r, p) => read("pipelines", ...p.split("/")),
    steps: (_r, p) => (p === "jobs/daily_sales.py" ? jobSteps : undefined),
    operations: (_r, p) => (p === "jobs/daily_sales.py" ? [{ id: "read-orders", lines: [first.lines[0], first.lines[0]] }, { id: "no-span" }] : undefined)
  });
  assert.equal(l.root().nodeId, "hop-example");
  const [job, dag] = l.children(l.children(l.root())[0]!);
  assert.equal(dag!.artifactKind, "airflow-dag");
  assert.deepEqual(l.children(dag!).map((f) => f.artifactKind), ["airflow-dag", "sql-script"]);

  const fileId = fileNodeId("pipelines", "jobs/daily_sales.py");
  const file = l.children(job!)[0]!;
  assert.equal(file.nodeId, fileId);
  const kids = l.children(file);
  const stepKids = kids.filter((k) => k.level === "step");
  assert.equal(stepKids.length, jobSteps.length);
  assert.equal(stepKids[0]!.nodeId, stepNodeId(fileId, first.id), "steps in reading order");
  assert.deepEqual(l.entry(stepKids[0]!)?.lines, first.lines);
  assert.ok(kids.some((k) => k.nodeId === operationNodeId(fileId, "no-span")), "an operation without a span sits under its file");

  const op: NavLocation = { level: "operation", nodeId: operationNodeId(fileId, "read-orders"), artifactKind: file.artifactKind };
  const fresh = buildLadder({ map: hopMap(), steps: (_r, p) => (p === "jobs/daily_sales.py" ? jobSteps : undefined),
    operations: (_r, p) => (p === "jobs/daily_sales.py" ? [{ id: "read-orders", lines: [first.lines[0], first.lines[0]] }] : undefined) });
  assert.equal(fresh.parent(op)?.nodeId, stepNodeId(fileId, first.id), "deep links expand the owning file lazily");

  assert.equal(l.locate("pipelines", "jobs/daily_sales.py", first.lines[0])?.nodeId, op.nodeId);
  assert.equal(l.locate("pipelines", "jobs/daily_sales.py")?.nodeId, fileId);
  assert.equal(l.locate("pipelines", "nope.py", 1), undefined);
  assert.deepEqual(l.children(op), []);
});
