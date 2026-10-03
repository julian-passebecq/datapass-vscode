/**
 * DAGUX1: Airflow DAG view — operator → family mapping from the JSON preset, the
 * `datapass.airflow.dagFamilies` override, the layout setting/toggle and the placement setting.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_DAG_FAMILIES, DEFAULT_UNCLASSIFIED_LABEL, FALLBACK_FAMILY, familyOf, resolveFamilies } from "../src/core/dagux/families";
import { directionOf, layoutSettingOf, placementOf, toggledLayout } from "../src/core/dagux/placement";
import { extractDag } from "../src/core/airflow/dagExtract";
import { airflowViewState } from "../src/views/airflowDagHtml";

const fam = (op: string, families = DEFAULT_DAG_FAMILIES) => familyOf(op, families).id;

test("dagux: operator → family (default preset)", () => {
  const cases: Array<[string, string]> = [
    ["FileSensor", "sensor"], ["S3KeySensor", "sensor"], ["ExternalTaskSensor", "sensor"], ["@task.sensor", "sensor"],
    ["TriggerDagRunOperator", "trigger"], ["ExternalTaskMarker", "trigger"],
    ["BranchPythonOperator", "branch"], ["ShortCircuitOperator", "branch"], ["@task.branch", "branch"],
    ["EmptyOperator", "dummy"], ["DummyOperator", "dummy"],
    ["S3ToRedshiftOperator", "transfer"], ["GCSToBigQueryOperator", "transfer"], ["LocalFilesystemToS3Operator", "transfer"], ["S3CopyObjectOperator", "transfer"],
    ["SparkSubmitOperator", "compute"], ["DatabricksSubmitRunOperator", "compute"], ["DataprocSubmitJobOperator", "compute"], ["@task.pyspark", "compute"],
    ["SQLExecuteQueryOperator", "sql"], ["PostgresOperator", "sql"], ["BigQueryInsertJobOperator", "sql"], ["SnowflakeOperator", "sql"],
    ["KubernetesPodOperator", "container"], ["DockerOperator", "container"],
    ["BashOperator", "bash"], ["SSHOperator", "bash"], ["@task.bash", "bash"],
    ["EmailOperator", "notify"], ["SlackWebhookOperator", "notify"],
    ["PythonOperator", "python"], ["PythonVirtualenvOperator", "python"], ["@task", "python"], ["ExternalPythonOperator", "python"],
    ["MyCustomOperator", FALLBACK_FAMILY], ["Operator", FALLBACK_FAMILY]
  ];
  for (const [op, want] of cases) assert.equal(fam(op), want, op);
  // The seven families the view promises all exist, with a shape and an icon or glyph.
  for (const id of ["sensor", "branch", "transfer", "compute", "sql", "trigger", "dummy"]) {
    const f = DEFAULT_DAG_FAMILIES.find(x => x.id === id);
    assert.ok(f && f.shape && (f.icon || f.glyph), id);
  }
  // Distinct shapes for the decision-bearing families.
  const shapes = new Set(["sensor", "branch", "transfer", "compute", "sql", "trigger"].map(id => DEFAULT_DAG_FAMILIES.find(x => x.id === id)!.shape));
  assert.equal(shapes.size, 6);
  assert.equal(DEFAULT_DAG_FAMILIES[DEFAULT_DAG_FAMILIES.length - 1]!.id, FALLBACK_FAMILY);
});

test("dagux: an unknown operator gets the generic shape labelled \"unclassified\" (V5 spec), from data", () => {
  const f = familyOf("MyCustomOperator", DEFAULT_DAG_FAMILIES);
  assert.equal(f.id, FALLBACK_FAMILY);
  assert.equal(f.label, "unclassified");
  assert.equal(f.shape, "rect");
  assert.equal(DEFAULT_UNCLASSIFIED_LABEL, "unclassified");
  // The label is data: the setting renames it, and a base without `other` falls back to the default.
  assert.equal(familyOf("MyCustomOperator", resolveFamilies({ other: { label: "non classé" } })).label, "non classé");
  const noFallback = DEFAULT_DAG_FAMILIES.filter(x => x.id !== FALLBACK_FAMILY);
  assert.equal(familyOf("MyCustomOperator", resolveFamilies(undefined, noFallback)).label, DEFAULT_UNCLASSIFIED_LABEL);
});

test("dagux: the setting overrides preset fields and adds families before the fallback", () => {
  const families = resolveFamilies({
    sql: { shape: "rect", color: "#123456" },
    lakehouse: { label: "Lakehouse", shape: "hexagon", glyph: "▦", color: "#00ff00", match: ["lakehouse"] },
    sensor: { shape: "not-a-shape", color: "red", match: ["(unclosed"] },
    other: { label: "Something else" },
    broken: "nope"
  });
  const sql = families.find(f => f.id === "sql")!;
  assert.equal(sql.shape, "rect");
  assert.equal(sql.color, "#123456");
  assert.equal(sql.icon, "co:database", "fields not overridden are kept");
  assert.equal(fam("PostgresOperator", families), "sql");
  assert.equal(fam("FabricLakehouseOperator", families), "lakehouse");
  // Bad values fall back to the preset's; an invalid regex is dropped.
  const sensor = families.find(f => f.id === "sensor")!;
  assert.equal(sensor.shape, "pill");
  assert.equal(sensor.color, DEFAULT_DAG_FAMILIES.find(f => f.id === "sensor")!.color);
  assert.deepEqual(sensor.match, []);
  assert.equal(fam("FileSensor", families), FALLBACK_FAMILY, "an override's match list replaces the preset's");
  assert.equal(families[families.length - 1]!.id, FALLBACK_FAMILY);
  assert.equal(families[families.length - 1]!.label, "Something else");
  assert.equal(families[families.length - 2]!.id, "lakehouse");
  assert.ok(!families.some(f => f.id === "broken"));
  // A glyph override replaces the preset icon.
  assert.equal(resolveFamilies({ sql: { glyph: "DB" } }).find(f => f.id === "sql")!.icon, undefined);
  // No setting, or a wrong type: the preset as is.
  assert.deepEqual(resolveFamilies(undefined), [...DEFAULT_DAG_FAMILIES]);
  assert.deepEqual(resolveFamilies([1, 2]), [...DEFAULT_DAG_FAMILIES]);
});

test("dagux: the view state carries each task's family and the families on screen", () => {
  const x = extractDag(readFileSync("tests/fixtures/airflow/etl_dag.py", "utf8"));
  const s = airflowViewState(x, "etl_dag.py", 0, { explanation: false, direction: "down" });
  const byId = Object.fromEntries(s.tasks.map(t => [t.id, t.family]));
  assert.equal(byId.wait_for_file, "sensor");
  assert.equal(byId.extract, "bash");
  assert.equal(byId.transform_spark, "compute");
  assert.equal(byId.load_sql, "sql");
  assert.equal(byId.notify, "notify");
  assert.deepEqual(Object.keys(s.families).sort(), [...new Set(Object.values(byId))].sort());
  assert.equal(s.families.sql!.shape, "cylinder");
  assert.ok(s.families.sql!.path, "a bundled icon is resolved to its path");
  assert.equal(s.families.bash!.glyph, "$_");
  // Families from the setting reach the state.
  const custom = airflowViewState(x, "etl_dag.py", 0, { explanation: false, direction: "down", families: resolveFamilies({ sql: { label: "Warehouse SQL", shape: "rect" } }) });
  assert.equal(custom.families.sql!.label, "Warehouse SQL");
  assert.equal(custom.families.sql!.shape, "rect");
  assert.deepEqual(airflowViewState(undefined, undefined, 0, { explanation: false, direction: "down" }).families, {});
});

test("dagux: layout setting and toolbar toggle", () => {
  assert.equal(directionOf("top-down"), "down");
  assert.equal(directionOf("left-right"), "right");
  // No explicit setting: the direction chosen before DAGUX1 is kept.
  assert.equal(directionOf(undefined, "right"), "right");
  assert.equal(directionOf(undefined, undefined), "down");
  assert.equal(directionOf("top-down", "right"), "down", "the setting wins");
  assert.equal(directionOf("sideways"), "down");
  assert.equal(toggledLayout("down"), "left-right");
  assert.equal(toggledLayout("right"), "top-down");
  assert.equal(directionOf(toggledLayout(directionOf(toggledLayout("down")))), "down");
  assert.equal(layoutSettingOf("right"), "left-right");
  const x = extractDag(readFileSync("tests/fixtures/airflow/etl_dag.py", "utf8"));
  assert.equal(airflowViewState(x, "f.py", 0, { explanation: false, direction: directionOf("left-right") }).direction, "right");
});

test("dagux: placement setting", () => {
  assert.equal(placementOf("panel"), "panel");
  assert.equal(placementOf("editor"), "editor");
  assert.equal(placementOf("sidebar"), "sidebar");
  assert.equal(placementOf(undefined), "sidebar");
  assert.equal(placementOf("floating"), "sidebar");
});

test("dagux: package.json contributes the settings, the panel view and the commands", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const props = pkg.contributes.configuration.properties;
  assert.deepEqual(props["datapass.airflow.dagPlacement"].enum, ["sidebar", "panel", "editor"]);
  assert.deepEqual(props["datapass.airflow.dagLayout"].enum, ["top-down", "left-right"]);
  assert.equal(props["datapass.airflow.dagFamilies"].type, "object");
  const panel = pkg.contributes.views["datapass-airflow"].find((v: { id: string }) => v.id === "datapass.airflowDagPanel");
  assert.match(panel.when, /dagPlacement == panel/);
  const side = pkg.contributes.views["datapass-details"].find((v: { id: string }) => v.id === "datapass.airflowDag");
  assert.match(side.when, /dagPlacement != panel/);
  assert.match(side.when, /dagPlacement != editor/);
  const cmds = pkg.contributes.commands.map((c: { command: string }) => c.command);
  for (const c of ["datapass.airflow.toggleLayout", "datapass.airflow.choosePlacement"]) assert.ok(cmds.includes(c), c);
});
