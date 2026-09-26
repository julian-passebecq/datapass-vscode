/**
 * DataPass semantic graph -> reviewed DiagramCloud native document.
 *
 * Target schema: julian-passebecq/diagramcloud src/core/model.ts (schemaVersion 1, inspected at
 * 9a2741675de7f79a9aa3c5db7f17fa3a6d2b5cfa). That schema defaults every visibility to public
 * and requires a public root view, so this projection sets every visibility explicitly, never
 * emits unknown fields, and keeps provenance in a private sidecar instead of the document.
 * Node status is always "idle": diagram animation is illustrative, not telemetry.
 */
import { sha256Bytes } from "../model/ids";
import type { GraphItem, GraphRelation } from "../workspace/graph";

export type DcNodeKind = "source" | "process" | "storage" | "model" | "report" | "app" | "control" | "physics" | "function" | "table";
export type DcEdgeKind = "batch" | "stream" | "query" | "control" | "dependency";
type Vis = "public" | "private";

export interface DcNode { id: string; label: string; kind: DcNodeKind; provider: string; icon: string; summary: string; role: string; status: "idle"; blockIds: string[]; sourceIds: string[]; tags: string[]; visibility: Vis }
export interface DcEdge { id: string; source: string; target: string; label: string; kind: DcEdgeKind; speed: "medium"; visibility: Vis }
export interface DcView { id: string; title: string; description: string; nodeIds: string[]; edgeIds: string[]; positions: Record<string, { x: number; y: number }>; visibility: Vis }
export interface DcDocument {
  schemaVersion: 1; id: string; revision: number; title: string; summary: string; author: string;
  category: "Portfolio" | "Reference" | "Blank"; tags: string[]; rootViewId: string; provenance: string;
  nodes: DcNode[]; edges: DcEdge[]; views: DcView[]; blocks: []; assets: []; sources: []; story: [];
}

export interface ProjectionSidecar {
  format: "datapass.diagramcloud-sidecar";
  version: "0.1-draft";
  audience: "public" | "internal";
  semanticRevision: string;
  layoutRevision: string;
  nativeSchema: "diagramcloud/1";
  documentId: string;
  documentHash: string;
  idMap: Array<{ itemRef: string; nodeId: string }>;
  edgeMap: Array<{ relationRef: string; edgeId: string }>;
  omitted: Array<{ ref: string; reason: string }>;
  lossReport: string[];
  publication: "not-authorized";
}

const KIND_MAP: Partial<Record<GraphItem["kind"], DcNodeKind>> = {
  dataset: "storage", "dataset-snapshot": "storage", notebook: "process", workflow: "control", dataflow: "process",
  "streaming-flow": "process", script: "function", package: "function", application: "app", dashboard: "report",
  report: "report", "semantic-model": "model", model: "model", "infrastructure-definition": "control", resource: "source",
  "artifact-bundle": "storage", "domain-config": "source",
  function: "function", pipeline: "control", storage: "storage", database: "storage", contract: "source", step: "process"
};
const REL_MAP: Partial<Record<GraphRelation["relation"], DcEdgeKind>> = {
  consumes: "batch", produces: "batch", uses: "dependency", dependsOn: "dependency", derivedFrom: "dependency",
  runsOn: "control", invokes: "control", deployedFrom: "control", observedBy: "query", feeds: "batch", orchestrates: "control"
};
const DC_ID = /^[a-z][a-z0-9_.-]{0,79}$/;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function projectToDiagramCloud(opts: {
  documentId: string; title: string; audience: "public" | "internal";
  items: GraphItem[]; relations: GraphRelation[]; semanticRevision: string; layoutRevision: string;
  streamRelations?: ReadonlySet<string>;
}): { document: DcDocument; sidecar: ProjectionSidecar; bytes: Uint8Array } {
  if (!DC_ID.test(opts.documentId)) throw new Error("documentId must be a DiagramCloud id");
  const omitted: ProjectionSidecar["omitted"] = [];
  const loss: string[] = [];
  const nodeVis = (i: GraphItem): Vis | null => {
    const c = i.classification ?? "internal"; // unclassified is never assumed public
    if (c === "confidential") return null;
    if (opts.audience === "public") return c === "public" ? "public" : null;
    return c === "public" ? "public" : "private";
  };

  const nodes: DcNode[] = [];
  const idMap: ProjectionSidecar["idMap"] = [];
  const kept = new Map<string, Vis>();
  for (const item of opts.items) {
    const vis = nodeVis(item);
    if (!vis) { omitted.push({ ref: item.id, reason: `${item.classification ?? "unclassified"} item excluded for ${opts.audience} audience` }); continue; }
    const kind = KIND_MAP[item.kind];
    if (!kind) loss.push(`${item.id}: kind ${item.kind} has no DiagramCloud equivalent; shown as process`);
    nodes.push({
      id: item.id, label: clip(item.label, 160), kind: kind ?? "process", provider: "Generic", icon: "generic",
      summary: "", role: "", status: "idle", blockIds: [], sourceIds: [], tags: [], visibility: vis
    });
    idMap.push({ itemRef: item.id, nodeId: item.id });
    kept.set(item.id, vis);
  }

  const edges: DcEdge[] = [];
  const edgeMap: ProjectionSidecar["edgeMap"] = [];
  for (const r of opts.relations) {
    if (r.relation === "contains") { loss.push(`${r.id}: containment is navigation, not a data-flow edge; not drawn`); continue; }
    if (!kept.has(r.source) || !kept.has(r.target)) { omitted.push({ ref: r.id, reason: "endpoint excluded" }); continue; }
    const vis: Vis = kept.get(r.source) === "public" && kept.get(r.target) === "public" ? "public" : "private";
    const kind = opts.streamRelations?.has(r.id) ? "stream" : REL_MAP[r.relation] ?? "dependency";
    edges.push({ id: r.id, source: r.source, target: r.target, label: r.relation, kind, speed: "medium", visibility: vis });
    edgeMap.push({ relationRef: r.id, edgeId: r.id });
  }

  // Root view is public and contains only public elements. Private elements get their own view.
  const pubNodes = nodes.filter(n => n.visibility === "public").map(n => n.id);
  const pubEdges = edges.filter(e => e.visibility === "public").map(e => e.id);
  const views: DcView[] = [{ id: "overview", title: "Overview", description: "", nodeIds: pubNodes, edgeIds: pubEdges, positions: layout(pubNodes), visibility: "public" }];
  if (nodes.some(n => n.visibility === "private")) {
    views.push({ id: "internal", title: "Internal detail", description: "", nodeIds: nodes.map(n => n.id), edgeIds: edges.map(e => e.id), positions: layout(nodes.map(n => n.id)), visibility: "private" });
    loss.push("Private elements are in a private view. DiagramCloud treats visibility as a label; the file itself still contains them and must not be uploaded publicly.");
  }

  const document: DcDocument = {
    schemaVersion: 1, id: opts.documentId, revision: 0, title: clip(opts.title, 160), summary: "", author: "",
    category: "Blank", tags: [], rootViewId: "overview",
    provenance: "Projected by DataPass. Provenance is kept in a private sidecar, not in this document.",
    nodes, edges, views, blocks: [], assets: [], sources: [], story: []
  };
  const problems = validateDcDocument(document);
  if (problems.length) throw new Error(`Projection failed native checks: ${problems.join("; ")}`);
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2) + "\n");
  return {
    document, bytes,
    sidecar: {
      format: "datapass.diagramcloud-sidecar", version: "0.1-draft", audience: opts.audience,
      semanticRevision: opts.semanticRevision, layoutRevision: opts.layoutRevision, nativeSchema: "diagramcloud/1",
      documentId: opts.documentId, documentHash: sha256Bytes(bytes).value, idMap, edgeMap, omitted, lossReport: loss, publication: "not-authorized"
    }
  };
}

function layout(ids: string[]): Record<string, { x: number; y: number }> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  return Object.fromEntries(ids.map((id, i) => [id, { x: (i % cols) * 240, y: Math.floor(i / cols) * 160 }]));
}

/** Mirror of DiagramCloud's structural + relational checks for the fields this projection emits. */
export function validateDcDocument(d: DcDocument): string[] {
  const errors: string[] = [];
  const ids = (xs: { id: string }[], what: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (!DC_ID.test(x.id)) errors.push(`${what} id ${x.id} is not a DiagramCloud id`);
      if (seen.has(x.id)) errors.push(`Duplicate ${what} ID: ${x.id}`);
      seen.add(x.id);
    }
    return seen;
  };
  const n = ids(d.nodes, "node"), e = ids(d.edges, "edge"), v = ids(d.views, "view");
  if (d.nodes.length > 500 || d.edges.length > 1500 || d.views.length > 80 || d.views.length < 1) errors.push("size limits exceeded");
  if (!v.has(d.rootViewId)) errors.push("rootViewId unknown");
  if (d.views.find(x => x.id === d.rootViewId)?.visibility !== "public") errors.push("Root view must be public");
  for (const x of d.nodes) if (!x.label || x.label.length > 160) errors.push(`${x.id}: label length`);
  for (const x of d.edges) if (!n.has(x.source) || !n.has(x.target)) errors.push(`${x.id}: unknown endpoint`);
  const nodeVis = new Map(d.nodes.map(x => [x.id, x.visibility]));
  for (const view of d.views) {
    view.nodeIds.forEach(r => { if (!n.has(r)) errors.push(`${view.id}: unknown node ${r}`); });
    view.edgeIds.forEach(r => { if (!e.has(r)) errors.push(`${view.id}: unknown edge ${r}`); });
    for (const k of Object.keys(view.positions)) if (!view.nodeIds.includes(k)) errors.push(`${view.id}: position for non-member ${k}`);
    for (const edge of d.edges.filter(x => view.edgeIds.includes(x.id))) {
      if (!view.nodeIds.includes(edge.source) || !view.nodeIds.includes(edge.target)) errors.push(`${view.id}: edge ${edge.id} has an endpoint outside this view`);
    }
    if (view.visibility === "public" && view.nodeIds.some(id => nodeVis.get(id) !== "public")) errors.push(`${view.id}: public view contains private nodes`);
  }
  return errors;
}
