/**
 * V4-STATUS a10: a file's artifact kind comes from the ladder (classifyArtifactKind over its path and
 * decoded head), never from the project-map `type`. Notebooks need the head; SQL is decided by its path.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyArtifactKind } from "../src/core/navigation/artifactKind";
import { buildLadder, fileNodeId } from "../src/core/navigation/ladder";
import type { ProjectMap } from "../src/core/project/projectMap";

const ipynb = (src: string) => JSON.stringify({ cells: [{ cell_type: "code", source: [src] }], metadata: { kernelspec: { name: "python3" } } });
const HEADS: Record<string, string> = {
  "notebooks/explore.ipynb": ipynb("import pandas as pd\ndf = pd.read_csv('x.csv')"),
  "notebooks/spark_load.ipynb": ipynb("df = spark.read.parquet('abfss://raw/orders')"),
  "Lakehouse/Load.Notebook/notebook-content.py": "# Fabric notebook source\n# CELL ********************\n%%pyspark\ndf = spark.table('orders')\n",
  "sql/customer_orders.sql": "select customer_id, count(*) from orders group by customer_id"
};

/** One sub-project, one component per file; the map `kind` says "job" for all of them on purpose. */
function kindMap(): ProjectMap {
  const file = (repoPath: string) => ({ path: repoPath, repoPath, kind: "file", role: "source", requiredFor: [], optional: false, source: "declared", state: "found" });
  const comp = (id: string, entry: string) => ({
    id, label: id, kind: "job", subprojects: ["a10"], children: [], operations: [], checklist: [], docs: [], incoming: [], outgoing: [], problems: [],
    health: "ok", headline: "", nextStep: "",
    artifacts: { repoKey: "lake", root: "", entry: file(entry), files: [file(entry)] }
  });
  const ids = Object.keys(HEADS).map((p, i) => [`c${i}`, p] as const);
  return {
    coordinationKey: "a10", environments: [], docs: [], repositories: [], relations: [], problems: [], nextStep: "",
    subprojects: [{ id: "a10", title: "Kinds", implicit: false, componentIds: ids.map(([id]) => id) }],
    components: ids.map(([id, p]) => comp(id, p))
  } as unknown as ProjectMap;
}

const EXPECTED: Record<string, string> = {
  "notebooks/explore.ipynb": "python-notebook",
  "notebooks/spark_load.ipynb": "spark-notebook",
  "Lakehouse/Load.Notebook/notebook-content.py": "spark-notebook",
  "sql/customer_orders.sql": "sql-script"
};

test("a10: notebooks (.ipynb, Fabric notebook-content.py) and SQL get their kinds from path + head", () => {
  for (const [p, kind] of Object.entries(EXPECTED)) assert.equal(classifyArtifactKind(p, HEADS[p]), kind, p);
});

test("a10: the ladder gives files and components those kinds, not the map's component type", () => {
  const l = buildLadder({ map: kindMap(), head: (repoKey, p) => (repoKey === "lake" ? HEADS[p] : undefined) });
  const comps = l.children(l.children(l.root())[0]!);
  assert.equal(comps.length, Object.keys(EXPECTED).length);
  for (const c of comps) {
    const [file] = l.children(c);
    const p = l.entry(file!)!.file!.repoPath;
    assert.equal(file!.nodeId, fileNodeId("lake", p));
    assert.equal(file!.artifactKind, EXPECTED[p], `file ${p}`);
    assert.equal(c.artifactKind, EXPECTED[p], `component of ${p} takes its entry file's kind`);
  }
});

test("a10: without a head, notebooks stay 'other' (no guess) while SQL is still known from its path", () => {
  const l = buildLadder({ map: kindMap() });
  const kinds = Object.fromEntries(l.children(l.children(l.root())[0]!).map((c) => [l.entry(l.children(c)[0]!)!.file!.repoPath, c.artifactKind]));
  assert.equal(kinds["notebooks/explore.ipynb"], "other");
  assert.equal(kinds["Lakehouse/Load.Notebook/notebook-content.py"], "other");
  assert.equal(kinds["sql/customer_orders.sql"], "sql-script");
});
