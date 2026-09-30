import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogToolId, fabricCapabilityFacts, fabricProjectProfile, routeFabricOperations, routeReportLines, routingBadge, type FabricFactsInput, type FabricProjectProfile
} from "../src/core/capabilities/fabricRouting";
import { CAPABILITIES } from "../src/core/capabilities/registry";
import { preflight } from "../src/core/capabilities/preflight";
import { platformOperations } from "../src/core/capabilities/platformOperations";
import { perOperationStatus } from "../src/core/status";
import type { ToolObservation } from "../src/core/capabilities/tools";
import type { Asset } from "../src/core/inventory/inventory";
import type { ConnectionProbe } from "../src/core/toolchain/connections";

const NOW = "2026-09-30T20:00:00Z";
const tools = (states: Record<string, ToolObservation["state"]>) => new Map(Object.entries(states).map(([toolId, state]) => [toolId, { toolId, state, observedAt: NOW }]));
const item = (type: string): Asset => ({ kind: "fabric-item", path: `x/${type}.${type}/.platform`, name: type, detail: type, open: { type: "folder", path: "x" } }) as Asset;
const WAREHOUSE_DBT = fabricProjectProfile({ assets: [item("Warehouse")], dbtProject: true, gitRepository: true });
const SPARK = fabricProjectProfile({ assets: [item("Notebook"), item("SparkJobDefinition"), { kind: "notebook", path: "a.ipynb", name: "a", open: { type: "file", path: "a.ipynb" } } as Asset], dbtProject: false, gitRepository: true });
const FAB_SIGNED_IN: ConnectionProbe = { tool: "cli.fab", ranAt: NOW, outcome: "ok", signedIn: true };
// One workstation: Fabric core + DE + Jupyter + FabricStudio + OneLake-VSCode + fab + Python + Git + Terraform.
const WORKSTATION = tools({
  "ext.fabric": "present", "ext.fabric-data-engineering": "present", "ext.jupyter": "present", "ext.fabric-studio": "present", "ext.onelake": "present",
  "cli.fab": "present", "cli.python": "present", "cli.git": "present", "cli.terraform": "present", "cli.tofu": "absent", "ext.azure-storage": "absent",
  "ext.powerbi-studio": "absent", "app.pbi-desktop": "unknown"
});
const input = (profile: FabricProjectProfile, over: Partial<FabricFactsInput> = {}): FabricFactsInput =>
  ({ tools: WORKSTATION, fabSignIn: FAB_SIGNED_IN, toolboxConfigured: false, fabricCicdParameterFile: true, profile, ...over });
const op = (r: ReturnType<typeof routeFabricOperations>, id: string) => r.operations.find(o => o.operationId === id)!;

test("project profile: Warehouse + dbt vs Spark / notebooks, Git authority from the clone", () => {
  assert.deepEqual(WAREHOUSE_DBT, { workloads: ["warehouse", "dbt"], authority: "git" });
  assert.deepEqual(SPARK.workloads, ["spark"]);
  assert.equal(fabricProjectProfile({ assets: [], dbtProject: false, gitRepository: false }).authority, "unknown");
});

test("§ 37: a Warehouse / dbt project never requires Fabric Data Engineering", () => {
  const r = routeFabricOperations(input(WAREHOUSE_DBT, { tools: tools({ ...Object.fromEntries([...WORKSTATION].map(([k, v]) => [k, v.state])), "ext.fabric-data-engineering": "absent" }) }));
  const de = r.facts.find(f => f.id === "ext.fabric-data-engineering")!;
  assert.equal(de.state, "absent");
  assert.equal(de.requiredBy, undefined, "not required for Warehouse / dbt");
  for (const id of ["fabric.notebook.edit", "fabric.spark.run-remote", "fabric.spark.observe-plan"]) assert.equal(op(r, id).relevance, "not-needed", id);
  assert.equal(op(r, "fabric.workspace.deploy").relevance, "needed");
  // Missing Fabric DE does not lower what the project needs: deploy stays READY through fab.
  assert.equal(op(r, "fabric.workspace.deploy").readiness, "READY");
  assert.ok(!routingBadge(r).text.includes("/9"), "not-needed operations are not counted");
});

test("§ 37: a Spark / notebook project requires Fabric Data Engineering and Jupyter", () => {
  const r = routeFabricOperations(input(SPARK));
  assert.equal(r.facts.find(f => f.id === "ext.fabric-data-engineering")!.requiredBy, "Spark / notebook items");
  assert.equal(r.facts.find(f => f.id === "ext.jupyter")!.requiredBy, "Spark / notebook items");
  assert.equal(op(r, "fabric.notebook.edit").relevance, "needed");
});

test("the ten § 37 capability facts, under tool-catalog/2 ids, detection only", () => {
  const facts = fabricCapabilityFacts(input(SPARK));
  assert.deepEqual(facts.map(f => f.id), ["ext.fabric", "ext.fabric-data-engineering", "ext.jupyter", "ext.fabric-studio", "ext.onelake-vscode", "ext.powerbi-vscode", "auth.fab-cli", "tool.fabric-cicd", "cli.terraform", "config.fabric-toolbox.clone"]);
  assert.equal(facts.find(f => f.id === "auth.fab-cli")!.state, "present");
  assert.equal(facts.find(f => f.id === "tool.fabric-cicd")!.state, "unknown", "a pip library is never probed");
  assert.equal(catalogToolId("ext.onelake"), "ext.onelake-vscode");
  assert.equal(catalogToolId("ext.powerbi-studio"), "ext.powerbi-vscode");
  assert.equal(catalogToolId("cli.fab"), "cli.fab");
});

test("fab not checked: the sign-in fact is unknown, and routes that need it are UNKNOWN, never READY", () => {
  const r = routeFabricOperations(input(SPARK, { fabSignIn: undefined }));
  assert.equal(r.facts.find(f => f.id === "auth.fab-cli")!.state, "unknown");
  const read = op(r, "onelake.read");
  assert.equal(read.candidates.find(c => c.candidateId === "fab-cli")!.readiness, "UNKNOWN");
  assert.notEqual(read.readiness, "READY");
});

test("no facts at all: every operation reads UNKNOWN / not ready, never READY", () => {
  const r = routeFabricOperations({ tools: new Map(), toolboxConfigured: false, fabricCicdParameterFile: false, profile: SPARK });
  for (const o of r.operations) assert.notEqual(o.readiness, "READY", o.operationId);
  assert.equal(op(r, "fabric.notebook.edit").readiness, "UNKNOWN");
  assert.ok(routeReportLines(op(r, "fabric.notebook.edit")).some(l => l.includes("not ready")));
});

test("PM 22: each candidate shows its own readiness next to the operation's", () => {
  const r = routeFabricOperations(input(WAREHOUSE_DBT));
  const deploy = op(r, "fabric.workspace.deploy");
  assert.equal(deploy.readiness, "READY");
  assert.equal(deploy.preferred!.candidateId, "fab-deploy");
  const cicd = deploy.candidates.find(c => c.candidateId === "fabric-cicd")!;
  assert.equal(cicd.readiness, "UNKNOWN", "fabric-cicd credential is never read");
  assert.equal(cicd.provenance, "official");
  assert.deepEqual(cicd.forks.map(f => f.candidateId), ["fabric-cicd-gbrueckl"], "the fork folds into its upstream");
  assert.match(cicd.gaps.join(), /sign-in not checked/);
  const studio = deploy.candidates.find(c => c.candidateId === "fabric-studio-publish")!;
  assert.equal(studio.provenance, "community");
  assert.match(studio.notPreferred!, /Git-authoritative/);
  const lines = routeReportLines(deploy);
  assert.match(lines[0]!, /READY via fab CLI \[official\]/);
  assert.ok(lines.some(l => l.includes("fabric-cicd [official] UNKNOWN")));
});

test("Observe routes: CU import-only, Spark plan not configured (no live provider in the standalone)", () => {
  const r = routeFabricOperations(input(SPARK));
  assert.equal(op(r, "fabric.capacity.observe-cu").readiness, "IMPORT_ONLY");
  assert.equal(op(r, "fabric.spark.observe-plan").readiness, "NOT_CONFIGURED");
  const badge = routingBadge(r);
  assert.equal(badge.ready, r.operations.filter(o => o.relevance !== "not-needed" && o.readiness === "READY").length, "IMPORT_ONLY is never counted as ready");
  assert.ok(badge.importOnly >= 1 && badge.text.includes("import-only"));
});

test("FABINT1: the Fabric extension's item API is UNSUPPORTED, never present", () => {
  const facts = fabricCapabilityFacts(input(SPARK, { nativeBridge: { installed: true, operations: [
    { operation: "detect", supported: true, reason: "installed" },
    { operation: "revealWorkspaceView", supported: true, reason: "view container" },
    { operation: "workspaceContext", supported: false, reason: "allow-listed" },
    { operation: "itemIdentity", supported: false, reason: "allow-listed" },
    { operation: "openNativeArtifact", supported: false, reason: "allow-listed; portal" }
  ] } }));
  const bridge = facts.filter(f => f.source === "native-bridge");
  assert.deepEqual(bridge.map(f => [f.id, f.state]), [
    ["native.fabric.revealWorkspaceView", "present"], ["native.fabric.workspaceContext", "unsupported"],
    ["native.fabric.itemIdentity", "unsupported"], ["native.fabric.openNativeArtifact", "unsupported"]
  ]);
});

test("Work-view preflight carries the router's routes for linked capabilities", () => {
  const r = routeFabricOperations(input(SPARK));
  const routes = new Map(r.operations.map(o => [o.operationId, o]));
  const ctx = { tools: WORKSTATION, facts: new Map(), reviewsConfirmed: new Set<string>(), routes };
  const deploy = CAPABILITIES.find(c => c.id === "fabric.items.deploy")!;
  assert.equal(preflight(deploy, ctx).route?.operationId, "fabric.workspace.deploy");
  assert.equal(preflight(CAPABILITIES.find(c => c.id === "fabric.notebook.edit-remote-vfs")!, ctx).route?.operationId, "fabric.notebook.edit");
  assert.equal(preflight(CAPABILITIES.find(c => c.id === "fabric.workspace.browse")!, ctx).route, undefined);
  const card = platformOperations(ctx).get("fabric")!.find(o => o.id === "fabric.items.deploy")!;
  assert.match(card.route!, /^READY via fab CLI/);
  for (const c of CAPABILITIES.filter(x => x.routerOperation)) assert.ok(routes.has(c.routerOperation!), `${c.id} links a known router operation`);
});

test("no global Fabric READY: the card status is partial or missing, never ready", () => {
  assert.equal(perOperationStatus([{ id: "a", label: "A", available: true }, { id: "b", label: "B", available: true }]), "partial");
  assert.equal(perOperationStatus([{ id: "a", label: "A", available: false }]), "missing");
});
