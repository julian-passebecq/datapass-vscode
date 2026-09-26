/**
 * What the architecture diagram draws (0.15): the components of the selection, optionally grouped
 * in lanes (sub-project, repository, cloud or service family, level), with a lane or a parent folded
 * into one box, and — in a preview of architecture options — the components an option adds,
 * replaces or removes. Pure: the webview lays out and draws the result; the tests check it.
 */
import type { LayoutEdgeInput } from "./layout";

export type GroupBy = "none" | "subproject" | "repository" | "cloud" | "level";
export const GROUP_BY: readonly GroupBy[] = ["none", "subproject", "repository", "cloud", "level"];
export const GROUP_BY_LABELS: Readonly<Record<GroupBy, string>> = {
  none: "No grouping", subproject: "Sub-project", repository: "Repository", cloud: "Cloud / service family", level: "Level"
};

export interface DiagramComponent { id: string; label: string; providerId?: string; kind: string; subprojects: string[]; repoKey?: string; parent?: string; children: string[] }
export type DiffMark = "added" | "replaced" | "removed";

export interface DiagramInput {
  /** Every component that may be drawn (the project's, a preview's, removed ones). */
  components: ReadonlyMap<string, DiagramComponent>;
  nodeIds: readonly string[];
  edges: ReadonlyArray<LayoutEdgeInput & { diff?: "added" | "removed" }>;
  groupBy: GroupBy;
  /** Folded lanes ("lane:<id>") and folded parents ("parent:<componentId>"). */
  collapsed: ReadonlySet<string>;
  labels: { subprojects: Readonly<Record<string, string>>; repositories: Readonly<Record<string, string>> };
  diff?: Readonly<Record<string, DiffMark>>;
}

export interface DiagramNode {
  id: string;
  kind: "component" | "lane-group" | "parent";
  /** The component drawn (component and parent nodes). */
  componentId?: string;
  label: string;
  memberIds: string[];
  lane: string;
  diff?: DiffMark;
}
export interface DiagramEdge extends LayoutEdgeInput { diff?: "added" | "removed"; merged: number }
export interface DiagramLane { id: string; label: string; count: number; collapsed: boolean }
export interface DiagramModel { nodes: DiagramNode[]; edges: DiagramEdge[]; lanes: DiagramLane[]; laneOf: Record<string, string>; laneOrder: string[]; laneLabels: Record<string, string> }

const FAMILY_OF_PROVIDER: Readonly<Record<string, string>> = {
  "azure-functions": "azure", "azure-data-factory": "azure", "azure-storage": "azure", "cosmos-nosql": "azure", bicep: "azure",
  "google-cloud-storage": "google", "google-drive": "google", bigquery: "google",
  databricks: "databricks", fabric: "fabric", powerbi: "fabric",
  "mongodb-atlas": "mongodb", postgres: "postgres", neon: "postgres",
  python: "code", jupyter: "code", sql: "code", docker: "code",
  terraform: "infrastructure", vm: "infrastructure",
  manual: "people",
  airflow: "other", grafana: "other", "aws-s3": "other", other: "other"
};
export const FAMILY_LABELS: Readonly<Record<string, string>> = {
  azure: "Azure", google: "Google Cloud", databricks: "Databricks", fabric: "Microsoft Fabric / Power BI", mongodb: "MongoDB",
  postgres: "PostgreSQL", code: "Code (Python, notebooks, containers)", infrastructure: "Infrastructure & VMs", people: "People (manual steps)",
  other: "Other services", none: "No service declared"
};
const LEVEL_OF_KIND: Readonly<Record<string, string>> = {
  storage: "storage", dataset: "storage", "dataset-snapshot": "storage",
  function: "processing", pipeline: "processing", script: "processing", notebook: "processing", workflow: "processing", dataflow: "processing",
  "streaming-flow": "processing", package: "processing", "artifact-bundle": "processing",
  database: "databases", "semantic-model": "databases", model: "databases",
  step: "people", decision: "people", question: "people", study: "people",
  application: "apps", dashboard: "apps", report: "apps",
  "infrastructure-definition": "infrastructure", resource: "infrastructure", "domain-config": "infrastructure", contract: "contracts"
};
export const LEVEL_LABELS: Readonly<Record<string, string>> = {
  storage: "Sources & storage", processing: "Processing", databases: "Databases", people: "People & reviews", apps: "Apps & reports",
  contracts: "Contracts", infrastructure: "Infrastructure", other: "Other"
};

export function familyOf(providerId: string | undefined): string {
  return providerId ? FAMILY_OF_PROVIDER[providerId] ?? "other" : "none";
}

export function levelOf(kind: string): string {
  return LEVEL_OF_KIND[kind] ?? "other";
}

function laneKey(c: DiagramComponent | undefined, by: GroupBy): string {
  if (!c) return "";
  switch (by) {
    case "none": return "";
    case "subproject": return c.subprojects[0] ?? "(none)";
    case "repository": return c.repoKey ?? "(none)";
    case "cloud": return familyOf(c.providerId);
    case "level": return levelOf(c.kind);
  }
}

function laneLabel(key: string, input: DiagramInput): string {
  switch (input.groupBy) {
    case "subproject": return input.labels.subprojects[key] ?? (key === "(none)" ? "No sub-project" : key);
    case "repository": return input.labels.repositories[key] ?? (key === "(none)" ? "No files declared" : key);
    case "cloud": return FAMILY_LABELS[key] ?? key;
    case "level": return LEVEL_LABELS[key] ?? key;
    default: return "";
  }
}

function laneOrderFor(input: DiagramInput, present: ReadonlySet<string>): string[] {
  const fixed = input.groupBy === "cloud" ? Object.keys(FAMILY_LABELS)
    : input.groupBy === "level" ? Object.keys(LEVEL_LABELS)
    : input.groupBy === "subproject" ? [...Object.keys(input.labels.subprojects), "(none)"]
    : input.groupBy === "repository" ? [...Object.keys(input.labels.repositories), "(none)"]
    : [""];
  return [...fixed.filter(k => present.has(k)), ...[...present].filter(k => !fixed.includes(k)).sort()];
}

export function buildDiagram(input: DiagramInput): DiagramModel {
  const ids = [...new Set(input.nodeIds)];
  const inSet = new Set(ids);
  const comp = (id: string) => input.components.get(id);
  // Folded parents: every descendant drawn inside the parent's box.
  const rep = new Map<string, string>(ids.map(id => [id, id]));
  const foldedParent = (id: string): string | undefined => {
    let p = comp(id)?.parent, guard = 0, top: string | undefined;
    while (p && guard++ < 20) { if (inSet.has(p) && input.collapsed.has(`parent:${p}`)) top = p; p = comp(p)?.parent; }
    return top;
  };
  for (const id of ids) { const p = foldedParent(id); if (p) rep.set(id, p); }
  const laneOf: Record<string, string> = {};
  for (const id of ids) laneOf[id] = laneKey(comp(rep.get(id)!), input.groupBy);
  const present = new Set(Object.values(laneOf));
  const order = laneOrderFor(input, present);
  const labels: Record<string, string> = Object.fromEntries(order.map(k => [k, laneLabel(k, input)]));
  // Folded lanes: one box per lane.
  const foldedLane = (k: string) => input.groupBy !== "none" && input.collapsed.has(`lane:${k}`);
  for (const id of ids) if (foldedLane(laneOf[id]!)) rep.set(id, `lane:${laneOf[id]}`);

  const nodes: DiagramNode[] = [];
  const byId = new Map<string, DiagramNode>();
  for (const id of ids) {
    const r = rep.get(id)!;
    let n = byId.get(r);
    if (!n) {
      if (r.startsWith("lane:")) n = { id: r, kind: "lane-group", label: labels[laneOf[id]!] ?? r.slice(5), memberIds: [], lane: laneOf[id]! };
      else {
        const c = comp(r);
        n = { id: r, kind: r !== id || input.collapsed.has(`parent:${r}`) ? "parent" : "component", componentId: r, label: c?.label ?? r, memberIds: [], lane: laneOf[r] ?? laneOf[id]!, diff: input.diff?.[r] };
      }
      byId.set(r, n);
      nodes.push(n);
    }
    n.memberIds.push(id);
  }
  // A folded parent whose own box is drawn keeps "parent" even when it was listed after its children.
  for (const n of nodes) if (n.kind === "component" && n.memberIds.length > 1) n.kind = "parent";
  // A folded lane is "added" only when every member is.
  for (const n of nodes) if (n.kind === "lane-group" && input.diff && n.memberIds.every(m => input.diff![m] === "added")) n.diff = "added";

  const edges: DiagramEdge[] = [];
  const seen = new Map<string, DiagramEdge>();
  for (const e of input.edges) {
    const from = rep.get(e.from), to = rep.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}\u0000${e.flow}`;
    const prev = seen.get(key);
    if (prev) { prev.merged++; if (prev.diff !== e.diff) prev.diff = undefined; continue; }
    const d: DiagramEdge = { id: e.id, from, to, flow: e.flow, diff: e.diff, merged: 1 };
    seen.set(key, d);
    edges.push(d);
  }
  const lanes: DiagramLane[] = input.groupBy === "none" ? [] : order.map(k => ({ id: k, label: labels[k]!, count: ids.filter(id => laneOf[id] === k).length, collapsed: foldedLane(k) }));
  const nodeLane: Record<string, string> = Object.fromEntries(nodes.map(n => [n.id, n.lane]));
  return { nodes, edges, lanes, laneOf: nodeLane, laneOrder: order, laneLabels: labels };
}
