/** V4-NAV NAVFAB1: the "On Fabric" context section reads Git files only, with origins and holes. */
import assert from "node:assert/strict";
import test from "node:test";
import { describeSchedule, onFabricSection, parseNotebookContent, parsePlatform } from "../src/core/navigation/context/onFabric";

const loc = { level: "artifact", nodeId: "nb1", artifactKind: "spark-notebook" };
const WS = "11111111-2222-3333-4444-555555555555";
const LH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const platform = (type: string) => JSON.stringify({
  $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
  metadata: { type, displayName: "Load sales" }, config: { version: "2.0", logicalId: "9f0c1d2e-0000-4000-8000-000000000001" }
});

const notebook = [
  "# Fabric notebook source", "",
  "# METADATA ********************", "",
  "# META {",
  "# META   \"kernel_info\": { \"name\": \"synapse_pyspark\" },",
  "# META   \"dependencies\": {",
  "# META     \"lakehouse\": {",
  `# META       "default_lakehouse": "${LH}",`,
  "# META       \"default_lakehouse_name\": \"bronze\",",
  `# META       "default_lakehouse_workspace_id": "${WS}",`,
  `# META       "known_lakehouses": [ { "id": "${LH}" }, { "id": "bbbbbbbb-0000-0000-0000-000000000000" } ]`,
  "# META     },",
  "# META     \"environment\": { \"environmentId\": \"cccccccc-0000-0000-0000-000000000000\", \"workspaceId\": \"x\" }",
  "# META   }",
  "# META }", "",
  "# PARAMETERS CELL ********************", "",
  "run_date = \"2026-01-01\"",
  "limit: int = 100",
  "# comment = 1", "",
  "# METADATA ********************", "",
  "# CELL ********************", "",
  "df = spark.read.table('x')"
].join("\n");

test("notebook: item, lakehouse, environment, parameters, all static with sources", () => {
  const s = onFabricSection({ location: loc, folder: "fabric/Load sales.Notebook", workspace: { name: "Sales", id: WS },
    files: { ".platform": platform("Notebook"), "notebook-content.py": notebook } });
  const v = (label: string) => s.facts!.filter(f => f.label === label).map(f => f.value);
  assert.deepEqual(v("Item type"), ["Notebook"]);
  assert.deepEqual(v("Default lakehouse"), [`bronze (${LH})`]);
  assert.deepEqual(v("Lakehouse workspace"), []); // same as the workspace
  assert.deepEqual(v("Other attached lakehouses"), ["bbbbbbbb-0000-0000-0000-000000000000"]);
  assert.deepEqual(v("Environment"), ["cccccccc-0000-0000-0000-000000000000"]);
  assert.deepEqual(v("Parameter"), ["run_date = \"2026-01-01\"", "limit = 100"]);
  assert.ok(s.facts!.every(f => f.origin === "static"));
  assert.equal(s.facts!.find(f => f.label === "Item type")!.source, "fabric/Load sales.Notebook/.platform");
  assert.equal(s.link!.url, `https://app.fabric.microsoft.com/groups/${WS}`);
  assert.match(s.body, /default lakehouse/);
  assert.ok(s.holes.some(h => /schedule/i.test(h.reason)));
  assert.ok(s.holes.some(h => /logical id/i.test(h.reason)));
  assert.ok(!JSON.stringify(s).match(/production confirmed/i));
});

test("non-Fabric artifact: one-line hole", () => {
  const s = onFabricSection({ location: { ...loc, artifactKind: "sql-script" }, files: {} });
  assert.deepEqual(s.holes, [{ reason: "not a Fabric item" }]);
  assert.equal(s.facts, undefined);
});

test("pipeline parameters, schedules, no workspace id", () => {
  const pipe = JSON.stringify({ properties: { activities: [], parameters: { region: { type: "string", defaultValue: "eu" }, days: { type: "int" } } } });
  const sched = JSON.stringify({ schedules: [{ enabled: true, jobType: "Pipeline", configuration: { type: "Daily", times: ["06:00"], localTimeZoneId: "UTC" } }] });
  const s = onFabricSection({ location: loc, workspace: { name: "Sales" },
    files: { ".platform": platform("DataPipeline"), "pipeline-content.json": pipe, ".schedules": sched } });
  assert.deepEqual(s.facts!.filter(f => f.label === "Parameter").map(f => f.value), ["region: string = \"eu\"", "days: int = (no default)"]);
  assert.deepEqual(s.facts!.filter(f => f.label === "Schedule").map(f => f.value), ["enabled · Pipeline · Daily · at 06:00 · (UTC)"]);
  assert.ok(!s.holes.some(h => /schedule/i.test(h.reason)));
  assert.ok(s.holes.some(h => /No workspace id/.test(h.reason)));
  assert.equal(s.link!.url, "https://app.fabric.microsoft.com/");
});

test("spark job definition and label overrides", () => {
  const sjd = JSON.stringify({ executableFile: "main.py", defaultLakehouseArtifactId: LH, environmentArtifactId: "00000000-0000-0000-0000-000000000000", commandLineArguments: "--full" });
  const s = onFabricSection({ location: loc, files: { ".platform": platform("SparkJobDefinition"), "SparkJobDefinitionV1.json": sjd },
    labels: { title: "Sur Fabric", nextAction: { SparkJobDefinition: "Lance-le." } } });
  assert.equal(s.title, "Sur Fabric");
  assert.equal(s.body, "Lance-le.");
  assert.deepEqual(s.facts!.filter(f => f.label === "Environment"), []); // zero GUID ignored
  assert.equal(s.facts!.find(f => f.label === "Main definition file")!.value, "main.py");
  assert.ok(s.holes.some(h => /workspace declared/.test(h.reason)));
});

test("parsers are defensive", () => {
  assert.equal(parsePlatform("not json"), undefined);
  assert.equal(parsePlatform("{}"), undefined);
  const nb = parseNotebookContent("# METADATA ********************\n# META { broken\n");
  assert.ok(nb.metaError);
  assert.deepEqual(parseNotebookContent("print(1)"), { knownLakehouses: [], parameters: [] });
  assert.equal(describeSchedule(undefined), undefined);
  const s = onFabricSection({ location: loc, files: { ".platform": platform("Lakehouse") } });
  assert.match(s.body, /tables/);
});
