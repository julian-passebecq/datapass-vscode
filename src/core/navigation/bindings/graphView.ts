/**
 * V4-NAV NAVFIX1: a provider's raw `BindingGraph` ({nodes, edges}) → the view-spi `datapass.graph-view/1` the
 * `graph` layout draws (review H1: raw graphs always showed the `graph-invalid` hole). No layout or grouping is
 * invented: one flat group-less view, the preset's default look, every node and edge keeps its § 34 origin
 * (mapped to the view-spi origin vocabulary; "theoretical" and "ai-proposed" stay uncertain). Pure (no `vscode`).
 */
import { DEFAULT_STYLE_PRESET, type GraphView } from "@juliandatapass-group/view-spi";
import type { BindingGraph, BindingOrigin } from "./index";

export const GRAPH_VIEW_SCHEMA = "datapass.graph-view/1";

type Node = GraphView["nodes"][number];
type Edge = GraphView["edges"][number];
const NODE_KINDS: readonly string[] = ["group", "field", "dbt-model", "dataset", "secret-ref", "test", "task", "job", "measure", "visual", "dashboard", "topic", "api-endpoint", "ml-model", "ml-feature", "infra-resource"];
const EDGE_KINDS: readonly string[] = ["configures", "reads", "writes", "deploys", "derives", "orchestrates", "tests", "exposes", "serves"];

/** True when a provider already returned a graph view (e.g. projected by view-spi `projectGraph`). */
export function isGraphViewDto(g: unknown): g is GraphView {
  return typeof g === "object" && g !== null && (g as { schema?: unknown }).schema === GRAPH_VIEW_SCHEMA;
}

function originOf(o: BindingOrigin): { origin: Node["origin"]; certain: boolean } {
  if (o === "observed") return { origin: "runtime", certain: true };
  if (o === "ai-proposed") return { origin: "ai-proposed", certain: false };
  if (o === "theoretical") return { origin: "static", certain: false };
  return { origin: "static", certain: true };
}

/** `kind` (a view-spi node / edge kind) is optional on the raw graph; components default to `job`, edges to `derives`. */
export function toGraphView(g: BindingGraph, id: string): GraphView {
  const preset = DEFAULT_STYLE_PRESET;
  const nodes: Node[] = g.nodes.map(n => {
    return { id: n.id, kind: (n.kind && NODE_KINDS.includes(n.kind) ? n.kind : "job") as Node["kind"], label: n.label, groupId: null,
      ...originOf(n.origin), memberIds: [], style: preset.defaultNode, styleRuleId: null };
  });
  const ids = new Set(nodes.map(n => n.id));
  const edges: Edge[] = g.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map((e, i) => {
    const o = originOf(e.origin);
    return { id: `${e.source}->${e.target}#${i}`, fromId: e.source, toId: e.target,
      kinds: [(e.label && EDGE_KINDS.includes(e.label) ? e.label : "derives") as Edge["kinds"][number]],
      ...o, confidence: o.certain ? 1 : 0.5, memberIds: [], volumetry: null, style: preset.defaultEdge, styleRuleId: null };
  });
  return { schema: GRAPH_VIEW_SCHEMA, id, graphId: id, projectionId: "none", stylePresetId: preset.id, zoom: "micro",
    groups: [], nodes, edges, legend: [],
    stats: { sourceNodes: g.nodes.length, sourceEdges: g.edges.length, filteredNodes: nodes.length, filteredEdges: edges.length } };
}
