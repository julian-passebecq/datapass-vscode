/**
 * V1-HONEST: incomplete things are shown as incomplete (generic fixtures only).
 *   F01 a component declared "planned" (a docs-only adapter folder) is planned or partial, never ready,
 *       and offers no deploy.
 *   F04 tools, identifiers and connections may name the routes (variants) that need them: missing
 *       ones only warn on those routes, never on the local route.
 *   F06 an unknown cost is "unknown", never 0 or free.
 *   F08 an identifier with no value (envKey only) is valid and "pending", never ready; localEnv.files may be empty.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectMap } from "../src/core/project/projectMap";
import { parseGraph } from "../src/core/workspace/graph";
import { graphAJson, inputA } from "./fixtures/v3/research";
import { buildToolchain, toolStateText } from "../src/core/toolchain/toolchain";
import { buildConnections } from "../src/core/toolchain/connections";
import { buildReadiness, validateReadinessSections, readinessSnapshot, type ReadinessInput } from "../src/core/readiness/readiness";
import { outOfRoute, selectedVariantKeys, validateVariantRefs } from "../src/core/readiness/variantScope";
import { formatCostTotal, sumCostLines, sumPickedOptions } from "../src/core/project/costs";
import { LATEST_MANIFEST_VERSION, validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import type { ToolObservation } from "../src/core/capabilities/tools";
import { wbReadiness } from "../src/views/workbenchState";

const T = "2026-09-27T10:00:00Z";
const absent = (...ids: string[]) => new Map<string, ToolObservation>(ids.map(id => [id, { toolId: id, state: "absent", observedAt: T }]));

function plannedMap() {
  const j = graphAJson() as { items: Array<Record<string, unknown>> };
  for (const it of j.items) if (it.id === "extract" || it.id === "cosmos") it.status = "planned";
  return buildProjectMap(inputA({ graph: parseGraph(JSON.stringify(j)) }));
}

test("F01: a planned component with files (docs-only adapter) is planned · partial, never ready, and cannot deploy", () => {
  const map = plannedMap();
  for (const id of ["extract", "cosmos"]) {
    const c = map.components.find(x => x.id === id)!;
    assert.equal(c.health, "planned", `${id}: ${c.headline}`);
    assert.match(c.headline, /^planned · partial/);
    assert.doesNotMatch(c.headline, /ready/);
  }
  const deploy = map.components.find(x => x.id === "extract")!.operations.find(o => o.phase === "deploy")!;
  assert.equal(deploy.result.status, "blocked");
  assert.ok(deploy.result.blockers.some(b => /planned/.test(JSON.stringify(b))), JSON.stringify(deploy.result.blockers));
  // A sub-project holding a planned component is not green.
  for (const s of map.subprojects.filter(x => x.componentIds.includes("extract"))) assert.notEqual(s.health, "ok");
});

test("F04: a tool scoped to a cloud route never warns while the local route is in view", () => {
  const toolchain = { tools: [{ tool: "cli.python" }, { tool: "cli.az", variants: ["cloud"] }, { tool: "cli.func", variants: ["hosting=functions"] }] };
  const local = buildToolchain({ toolchain, tools: absent("cli.az", "cli.func"), platform: "win32", selected: selectedVariantKeys(new Map([["hosting", "local"]])) });
  assert.equal(local.summary.attention, 0, "missing az/func do not block the local route");
  const az = local.entries.find(e => e.tool === "cli.az")!;
  assert.equal(az.outOfRoute, true);
  assert.match(toolStateText(az), /needed only for cloud/);
  const cloud = buildToolchain({ toolchain, tools: absent("cli.az", "cli.func"), platform: "win32", selected: selectedVariantKeys(new Map([["hosting", "functions"]]), "cloud") });
  assert.equal(cloud.summary.attention, 2, "the cloud route needs both");
  // An unscoped tool is still needed everywhere.
  const plain = buildToolchain({ toolchain: { tools: [{ tool: "cli.az" }] }, tools: absent("cli.az"), platform: "win32", selected: new Set() });
  assert.equal(plain.summary.attention, 1);
});

test("F04: variant refs, selection keys and out-of-route", () => {
  assert.deepEqual(validateVariantRefs(["cloud", "hosting=functions"], "x"), []);
  assert.equal(validateVariantRefs([], "x").length, 1);
  assert.equal(validateVariantRefs(["Not An Id"], "x").length, 1);
  const keys = selectedVariantKeys(new Map([["hosting", "local"]]), "starter");
  assert.deepEqual([...keys].sort(), ["hosting=local", "local", "starter"]);
  assert.equal(outOfRoute(undefined, keys), false);
  assert.equal(outOfRoute(["cloud"], keys), true);
  assert.equal(outOfRoute(["starter"], keys), false);
});

const manifest = (): DataPassProjectManifest => ({
  schemaVersion: 5,
  project: { id: "honest-demo", title: "Honest demo" },
  repositories: { coordination: { remote: "https://github.com/example/honest-demo.git", role: "coordination" } },
  environments: [{ id: "dev" }],
  localEnv: { files: [], requiredKeys: ["CLOUD_WORKSPACE_ID"] },
  identifiers: [
    { id: "tenant", label: "Tenant", kind: "tenant", envKey: "CLOUD_TENANT_ID", variants: ["cloud"] },
    { id: "workspace", label: "Cloud workspace", kind: "workspace", envKey: "CLOUD_WORKSPACE_ID" }
  ],
  toolchain: { tools: [{ tool: "cli.git" }, { tool: "cli.az", variants: ["cloud"] }] },
  connections: [{ id: "az", kind: "sign-in", tool: "cli.az", identifier: "tenant", variants: ["cloud"] }]
} as unknown as DataPassProjectManifest);

const input = (selected: Set<string>, over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  manifest: manifest(), coordinationKey: ".", envFiles: new Map(), repositories: [], problems: [], settings: {}, diagramCloudSidecar: false,
  latestSchemaVersion: LATEST_MANIFEST_VERSION, tools: absent("cli.az"), platform: "win32", selected, ...over
});

test("F08: an envKey-only identifier and an empty localEnv.files are valid", () => {
  const doc = manifest() as unknown as Record<string, unknown>;
  assert.deepEqual(validateReadinessSections(doc, new Set(["coordination"])), []);
  assert.deepEqual(validateProjectManifest(doc).filter(e => /identifier|localEnv|variants/.test(e)), []);
  // Both value and values stays invalid.
  const both = { ...doc, identifiers: [{ id: "x", label: "X", value: "abc", values: { dev: "abc" } }] };
  assert.ok(validateReadinessSections(both, new Set()).some(e => /both value and values/.test(e)));
});

test("F08 + F04: a pending id is shown pending, never copied or ready; it and the cloud tool only warn on the cloud route", () => {
  const local = buildReadiness(input(new Set(["local"])));
  const ws = local.identifiers.find(d => d.id === "workspace")!;
  assert.equal(ws.pending, true);
  assert.equal(local.checks.find(c => c.id === "identifier.pending:workspace")?.severity, "warning", "an unscoped pending id is a warning");
  assert.equal(local.checks.find(c => c.id === "identifier.pending:tenant")?.severity, "info", "the cloud tenant is only a note on the local route");
  assert.equal(local.checks.find(c => c.id === "tools.missing:cli.az")?.severity, "info");
  assert.ok(!local.checks.some(c => c.severity !== "info" && /cli\.az|Azure CLI|Tenant/.test(`${c.id} ${c.message}`)), JSON.stringify(local.checks));
  assert.equal(local.toolchain.summary.attention, 0);
  const cloud = buildReadiness(input(new Set(["cloud"])));
  assert.equal(cloud.checks.find(c => c.id === "tools.missing:cli.az")?.severity, "warning");
  assert.equal(cloud.checks.find(c => c.id === "identifier.pending:tenant")?.severity, "warning");
  // Projections carry "pending" and never a value.
  assert.equal(readinessSnapshot(local).identifiers.find(d => d.id === "workspace")?.pending, true);
  const wb = wbReadiness(local);
  assert.equal(wb.identifiers.find(d => d.id === "workspace")?.pending, true);
  assert.equal(wb.identifiers.find(d => d.id === "tenant")?.outOfRoute, true);
});

test("F08: a sign-in naming a pending tenant is never ok, even when the check passed", () => {
  const m = manifest();
  const views = buildConnections({
    connections: m.connections!, identifiers: m.identifiers, present: () => true,
    probes: new Map([["cli.az", { tool: "cli.az", outcome: "ok", signedIn: true, tenantId: "anything", ranAt: T } as never]])
  });
  const [az] = views;
  assert.equal(az?.state, "identifier-pending");
  assert.equal(az?.signIn, undefined);
  assert.match(az?.detail ?? "", /pending/);
});

test("F06: an unknown cost is unknown, never 0 or free", () => {
  assert.equal(formatCostTotal(sumCostLines([], "USD")), "unknown · no cost declared");
  const t = formatCostTotal(sumPickedOptions([{ costs: [{ currency: "USD" }] }, {}], "USD"));
  assert.match(t, /^unknown · not priced \(0 of 2 decisions\)/);
  assert.doesNotMatch(t, /\b0 USD|free/);
  const partial = formatCostTotal(sumPickedOptions([{ costs: [{ monthly: 10 }] }, {}], "USD"));
  assert.match(partial, /partial: 1 of 2 decisions priced/);
});
