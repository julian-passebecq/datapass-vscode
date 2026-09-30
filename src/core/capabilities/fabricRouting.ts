/**
 * CAPROUTE1b (brief § 20, 35, 37; PM AC-D2): Fabric readiness per operation, from the Common
 * capability router. The standalone keeps its probes and UI: it turns what it observed into
 * capability facts, hands them to `routeOperation`, and renders the ranked candidates. There is no
 * global "Fabric READY": each operation has its own readiness, and each candidate shows its own.
 *
 * Detection only: no sign-in, no token read, no route executed. A fact DataPass did not observe is
 * `unknown`, never `present`. Pure (no `vscode` import) so unit tests drive it with fixtures.
 */
import { fabricOperationCatalog, routeOperation, type Gap, type RankedCandidate, type Readiness, type RouteDecision, type RouterCatalog } from "@juliandatapass-group/capability-router";
import type { Asset } from "../inventory/inventory";
import type { ConnectionProbe } from "../toolchain/connections";
import { TOOL_INDEX, type ToolObservation } from "./tools";

/** Standalone probe ids that differ from the tool-catalog/2 ids the router uses. */
export const CATALOG_TOOL_ID: Readonly<Record<string, string>> = { "ext.onelake": "ext.onelake-vscode", "ext.powerbi-studio": "ext.powerbi-vscode" };
export const catalogToolId = (probeId: string): string => CATALOG_TOOL_ID[probeId] ?? probeId;
const PROBE_ID: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(CATALOG_TOOL_ID).map(([probe, catalog]) => [catalog, probe]));

// ------------------------------------------------------------------ project profile (§ 37)

/** What the project's own files show it runs. Static: file names and Fabric item types, never content. */
export type Workload = "spark" | "warehouse" | "dbt" | "powerbi" | "iac";
export type ProjectAuthority = "git" | "workspace" | "unknown";
export interface FabricProjectProfile {
  workloads: Workload[];
  authority: ProjectAuthority;
}

const SPARK_ITEMS = new Set(["Notebook", "SparkJobDefinition", "Environment"]);
const BI_ITEMS = new Set(["SemanticModel", "Report"]);

export function fabricProjectProfile(input: { assets: readonly Asset[]; dbtProject: boolean; gitRepository: boolean }): FabricProjectProfile {
  const w = new Set<Workload>();
  for (const a of input.assets) {
    if (a.kind === "notebook" || (a.kind === "fabric-item" && SPARK_ITEMS.has(a.detail ?? ""))) w.add("spark");
    if (a.kind === "fabric-item" && a.detail === "Warehouse") w.add("warehouse");
    if (a.kind === "pbip" || (a.kind === "fabric-item" && BI_ITEMS.has(a.detail ?? ""))) w.add("powerbi");
    if (a.kind === "iac") w.add("iac");
  }
  if (input.dbtProject) w.add("dbt");
  const order: Workload[] = ["spark", "warehouse", "dbt", "powerbi", "iac"];
  return { workloads: order.filter(x => w.has(x)), authority: input.gitRepository ? "git" : "unknown" };
}

/**
 * Operations that only matter for some workloads. Others (deploy, OneLake, capacity CU) apply to any
 * Fabric project. Data, not code: a new operation in the Common catalog is general until listed here.
 */
export const OPERATION_WORKLOADS: Readonly<Record<string, readonly Workload[]>> = {
  "fabric.notebook.edit": ["spark"],
  "fabric.spark.run-remote": ["spark"],
  "fabric.spark.observe-plan": ["spark"],
  "fabric.iac.terraform-deploy": ["iac"],
  "powerbi.pbir.edit": ["powerbi"]
};
const WORKLOAD_TEXT: Record<Workload, string> = { spark: "Spark / notebook", warehouse: "Warehouse", dbt: "dbt", powerbi: "Power BI", iac: "Terraform / IaC" };

export type Relevance = "needed" | "not-needed" | "undetected";
export function operationRelevance(operationId: string, profile: FabricProjectProfile): { relevance: Relevance; reason: string } {
  const wants = OPERATION_WORKLOADS[operationId];
  if (!wants) return { relevance: "needed", reason: "any Fabric project" };
  const hit = wants.filter(x => profile.workloads.includes(x));
  if (hit.length) return { relevance: "needed", reason: `${hit.map(x => WORKLOAD_TEXT[x]).join(", ")} found in this project` };
  if (!profile.workloads.length) return { relevance: "undetected", reason: "project type not detected yet" };
  return { relevance: "not-needed", reason: `no ${wants.map(x => WORKLOAD_TEXT[x]).join(" / ")} item in this project (${profile.workloads.map(x => WORKLOAD_TEXT[x]).join(", ")})` };
}

// ------------------------------------------------------------------ capability facts (§ 37)

export type FactState = "present" | "absent" | "unknown" | "unsupported";
export interface CapabilityFact {
  id: string;
  label: string;
  state: FactState;
  /** Where the state comes from; "not observed" facts are unknown by construction. */
  source: "tool-probe" | "sign-in-check" | "workspace-files" | "setting" | "native-bridge" | "not-observed";
  detail: string;
  /** Required by this project's workloads (Fabric Data Engineering only for Spark / notebooks). */
  requiredBy?: string;
}

/** The FABINT1 facts the router consumes (structural: `fabricNativeBridgeFacts()` output). */
export interface NativeBridgeInput {
  installed: boolean;
  operations: ReadonlyArray<{ operation: string; supported: boolean; reason: string }>;
}

export interface FabricFactsInput {
  tools: ReadonlyMap<string, ToolObservation>;
  /** Latest read-only `fab auth status` the person ran (Check connections); absent = not checked. */
  fabSignIn?: ConnectionProbe;
  toolboxConfigured: boolean;
  /** A fabric-cicd parameter file (parameter.yml) exists in the workspace. */
  fabricCicdParameterFile: boolean;
  nativeBridge?: NativeBridgeInput;
  profile: FabricProjectProfile;
}

const probeState = (tools: ReadonlyMap<string, ToolObservation>, id: string): FactState => tools.get(id)?.state ?? "unknown";
const probeDetail = (o: ToolObservation | undefined): string =>
  !o ? "not probed yet" : o.state === "present" ? `detected${o.version ? ` ${o.version}` : ""}${o.via ? ` (${o.via})` : ""}` : o.state === "absent" ? "not installed" : "cannot be probed here";

export function fabricCapabilityFacts(input: FabricFactsInput): CapabilityFact[] {
  const { tools } = input;
  const spark = input.profile.workloads.includes("spark");
  const tool = (probeId: string, label: string, requiredBy?: string): CapabilityFact =>
    ({ id: catalogToolId(probeId), label, state: probeState(tools, probeId), source: "tool-probe", detail: probeDetail(tools.get(probeId)), requiredBy });
  const tf = ["cli.terraform", "cli.tofu"].map(id => tools.get(id));
  const tfPresent = tf.find(o => o?.state === "present");
  const facts: CapabilityFact[] = [
    tool("ext.fabric", "Fabric core extension"),
    tool("ext.fabric-data-engineering", "Fabric Data Engineering", spark ? "Spark / notebook items" : undefined),
    tool("ext.jupyter", "Jupyter", spark ? "Spark / notebook items" : undefined),
    tool("ext.fabric-studio", "FabricStudio (community)"),
    tool("ext.onelake", "OneLake-VSCode (community)"),
    tool("ext.powerbi-studio", "PowerBI-VSCode (community)"),
    fabAuthFact(tools.get("cli.fab"), input.fabSignIn),
    { id: "tool.fabric-cicd", label: "fabric-cicd", state: "unknown", source: "not-observed", detail: "Python library: DataPass does not run pip to check it" },
    {
      id: "cli.terraform", label: "Terraform / OpenTofu", source: "tool-probe",
      state: tfPresent ? "present" : tf.every(o => o?.state === "absent") ? "absent" : "unknown",
      detail: tfPresent ? probeDetail(tfPresent) : tf.every(o => o?.state === "absent") ? "neither terraform nor tofu installed" : "not probed yet"
    },
    { id: "config.fabric-toolbox.clone", label: "Fabric Toolbox clone configured", state: input.toolboxConfigured ? "present" : "absent", source: "setting",
      detail: input.toolboxConfigured ? "local clone configured" : "datapass.fabric.toolboxRoot / platforms.fabric.toolboxRoot not set" }
  ];
  // FABINT1: the official extension's item API is allow-listed to Microsoft satellites, so these are
  // UNSUPPORTED facts (static analysis + portal link instead), never READY.
  for (const op of input.nativeBridge?.operations ?? []) {
    if (op.operation === "detect") continue;
    facts.push({ id: `native.fabric.${op.operation}`, label: `Fabric extension API: ${op.operation}`, state: op.supported ? "present" : "unsupported", source: "native-bridge", detail: op.reason });
  }
  return facts;
}

function fabAuthFact(fab: ToolObservation | undefined, probe: ConnectionProbe | undefined): CapabilityFact {
  const base = { id: "auth.fab-cli", label: "fab authenticated", source: "sign-in-check" as const };
  if (fab?.state === "absent" || probe?.outcome === "not-installed") return { ...base, state: "absent", detail: "Fabric CLI not installed" };
  if (!probe) return { ...base, state: "unknown", source: "not-observed", detail: "not checked: Check connections runs fab auth status (read-only, needs a declared cli.fab sign-in)" };
  if (probe.outcome !== "ok") return { ...base, state: "unknown", detail: probe.reason ?? "fab auth status failed" };
  return { ...base, state: probe.signedIn ? "present" : "absent", detail: `${probe.signedIn ? "signed in" : "not signed in"} (fab auth status, ${probe.ranAt})` };
}

/** Router request facts: every probed tool under its catalog id, plus the provider state DataPass knows. */
export function routerFacts(input: FabricFactsInput): { tools: Array<{ id: string; state: "present" | "absent" | "unknown" }>; providerState: Array<{ id: string; state: "present" | "absent" | "unknown" }> } {
  const tools = [...input.tools.values()].map(o => ({ id: catalogToolId(o.toolId), state: o.state }));
  const auth = fabAuthFact(input.tools.get("cli.fab"), input.fabSignIn).state;
  const providerState = [
    ...(auth === "unknown" ? [] : [{ id: "auth.fab-cli", state: auth as "present" | "absent" }]),
    { id: "config.fabric-cicd.parameter-file", state: input.fabricCicdParameterFile ? "present" as const : "absent" as const },
    // The standalone has no live provider reading (AC-D4: replay/import only in V1) and no Spark-monitoring export configured.
    { id: "config.observe.live-provider-gate", state: "absent" as const },
    { id: "config.spark-monitoring.export", state: "absent" as const }
  ];
  return { tools, providerState };
}

// ------------------------------------------------------------------ routing

export interface RoutedCandidate {
  candidateId: string;
  providerId: string;
  providerLabel: string;
  provenance: RankedCandidate["provenance"];
  readiness: Readiness;
  tier: RankedCandidate["tier"];
  actionMode: RankedCandidate["actionMode"];
  sideEffects: RankedCandidate["sideEffects"];
  /** What is missing, in words ("install Fabric CLI", "sign-in not checked"). */
  gaps: string[];
  notPreferred?: string;
  forks: Array<{ candidateId: string; providerLabel: string; readiness: Readiness }>;
}

export interface RoutedOperation {
  operationId: string;
  label: string;
  /** The operation's readiness (preferred route's, else best candidate's). UNKNOWN reads as unknown, never ready. */
  readiness: Readiness;
  relevance: Relevance;
  relevanceReason: string;
  preferred?: RoutedCandidate;
  fallback?: RoutedCandidate;
  candidates: RoutedCandidate[];
}

export interface FabricRouting {
  profile: FabricProjectProfile;
  facts: CapabilityFact[];
  operations: RoutedOperation[];
  catalogVersion: string;
}

const PROVIDER_LABEL: Readonly<Record<string, string>> = {
  "service.fabric-portal": "Fabric portal", "service.fabric-git": "Fabric Git integration", "service.fabric-rest": "Fabric REST (live)",
  "service.fabric-capacity-metrics": "Capacity Metrics export", "tool.fabric-cicd": "fabric-cicd", "tool.fabric-cicd.gbrueckl": "fabric-cicd (gbrueckl fork)",
  "toolbox.fabric": "Fabric Toolbox (FUAM, Spark Monitoring)", "ref.fabric-toolbox.gbrueckl": "Fabric.Toolbox (gbrueckl, reference)",
  "terraform/microsoft-fabric": "Terraform Fabric provider", "cli.fab": "fab CLI"
};
export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? TOOL_INDEX.get(PROBE_ID[id] ?? id)?.label ?? id;
}
const factLabel = (id: string): string => TOOL_INDEX.get(PROBE_ID[id] ?? id)?.label ?? id;

export function gapText(g: Gap): string {
  const what = g.anyOf.map(factLabel).join(" or ");
  if (g.class === "tool") return g.state === "absent" ? `install ${what}` : `${what}: not probed`;
  if (g.class === "auth") return g.state === "absent" ? `sign in (${what})` : `sign-in not checked (${what})`;
  return g.state === "absent" ? `configure ${what}` : `${what}: not known`;
}

function candidateView(c: RankedCandidate): RoutedCandidate {
  return {
    candidateId: c.candidateId, providerId: c.providerId, providerLabel: providerLabel(c.declaredProviderId), provenance: c.provenance,
    readiness: c.readiness, tier: c.tier, actionMode: c.actionMode, sideEffects: [...c.sideEffects], gaps: c.gaps.map(gapText),
    ...(c.contextNotes.includes("git-authoritative-direct-publish-not-preferred") ? { notPreferred: "Git-authoritative project: direct publish is possible, not preferred" } : {}),
    forks: c.forks.map(f => ({ candidateId: f.candidateId, providerLabel: providerLabel(f.providerId), readiness: f.readiness }))
  };
}

export function routeFabricOperations(input: FabricFactsInput, catalog: RouterCatalog = fabricOperationCatalog()): FabricRouting {
  const facts = routerFacts(input);
  const operations = catalog.operations.map((op): RoutedOperation => {
    const { relevance, reason } = operationRelevance(op.operationId, input.profile);
    const result = routeOperation(catalog, { operationId: op.operationId, project: { authority: input.profile.authority }, ...facts });
    if (!result.ok) return { operationId: op.operationId, label: op.label, readiness: "UNKNOWN", relevance, relevanceReason: reason, candidates: [] };
    const d: RouteDecision = result.value;
    const candidates = d.candidates.map(candidateView);
    const find = (id?: string) => (id ? candidates.find(c => c.candidateId === id) : undefined);
    return { operationId: op.operationId, label: op.label, readiness: d.readiness, relevance, relevanceReason: reason, preferred: find(d.preferred?.candidateId), fallback: find(d.fallback?.candidateId), candidates };
  });
  return { profile: input.profile, facts: fabricCapabilityFacts(input), operations, catalogVersion: catalog.version };
}

// ------------------------------------------------------------------ text (card, preflight report)

const PROVENANCE_BADGE: Readonly<Record<string, string>> = { official: "official", community: "community", fork: "fork", accelerator: "accelerator", "sample-reference": "reference" };
export const provenanceBadge = (p: RoutedCandidate["provenance"]): string => (p ? PROVENANCE_BADGE[p] ?? p : "unknown provenance");

/** One line per candidate: its own readiness next to the operation's (PM 22 review note). */
export function candidateLine(c: RoutedCandidate): string {
  return `${c.providerLabel} [${provenanceBadge(c.provenance)}] ${c.readiness}${c.tier === "fallback" ? " (fallback)" : ""}${c.gaps.length ? ` · ${c.gaps.join("; ")}` : ""}${c.notPreferred ? ` · ${c.notPreferred}` : ""}${c.forks.length ? ` · folds ${c.forks.map(f => `${f.providerLabel} ${f.readiness}`).join(", ")}` : ""}`;
}

export function routeSummary(op: RoutedOperation): string {
  const via = op.preferred ? ` via ${op.preferred.providerLabel} [${provenanceBadge(op.preferred.provenance)}]` : "";
  const fb = op.fallback && op.fallback !== op.preferred ? ` · fallback ${op.fallback.providerLabel} ${op.fallback.readiness}` : "";
  return `${op.readiness}${via}${fb}`;
}

/** Lines for the preflight report of a registry capability linked to a router operation. */
export function routeReportLines(op: RoutedOperation): string[] {
  return [
    `Router (Common capability-router): ${op.label} ${routeSummary(op)}${op.relevance === "not-needed" ? ` · not needed here: ${op.relevanceReason}` : ""}`,
    ...op.candidates.map(c => `  - ${candidateLine(c)}`),
    ...(op.readiness === "UNKNOWN" ? ["  UNKNOWN means a fact could not be observed; it is not ready."] : [])
  ];
}

/**
 * Card badge: how many operations this project needs are ready, never one global status. Only READY counts;
 * IMPORT_ONLY (exported evidence, no live route) is reported beside it, never as ready.
 */
export function routingBadge(r: FabricRouting): { text: string; ready: number; importOnly: number; needed: number } {
  const needed = r.operations.filter(o => o.relevance !== "not-needed");
  const ready = needed.filter(o => o.readiness === "READY").length;
  const importOnly = needed.filter(o => o.readiness === "IMPORT_ONLY").length;
  return { text: `${ready}/${needed.length} ops ready${importOnly ? ` · ${importOnly} import-only` : ""}`, ready, importOnly, needed: needed.length };
}
