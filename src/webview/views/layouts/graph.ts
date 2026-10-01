/**
 * V4-NAV `graph` layout kind: draws a view-spi `GraphView` (groups, nodes, aggregated edges, legend) for
 * architecture, lineage and data-flow views. It reuses the architecture diagram's layered layout
 * (`core/project/layout.ts`) and look (`.canvas` / `.node` / `.edges`), so a nav graph and the Workbench diagram
 * read the same; no new graph engine. Groups become lanes; the Location node gets the selected style.
 * Each node's accent is its `navColor` (shared with the mini-map and code-steps), the border its preset style.
 * Click selects (`{type:"select"}`), double-click goes down (`data-nav-down`, wired by the renderer).
 * The DTO is untrusted: anything off-shape becomes a typed hole, never a guess.
 */
import { layoutGraph, type LayoutEdgeInput } from "../../../core/project/layout";
import { navColor, NAV_HERE_DEFAULT } from "../../../core/navigation/navPalette";
import { cssToken, holesNode, label, type Hole, type Labels, type LayoutModel, type VNode } from "../model";

/** The `datapass.graph-view/1` fields this layout reads (view-spi `GraphView`, structural until vendored). */
export interface GraphViewLike {
  readonly schema: "datapass.graph-view/1";
  readonly groups: readonly { readonly id: string; readonly label: string; readonly memberCount: number; readonly collapsed: boolean; readonly color: string }[];
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly label: string; readonly groupId: string | null; readonly origin: string;
    readonly certain: boolean; readonly memberIds: readonly string[]; readonly style: StyleLike }[];
  readonly edges: readonly { readonly id: string; readonly fromId: string; readonly toId: string; readonly kinds: readonly string[]; readonly origin: string;
    readonly certain: boolean; readonly volumetry: { readonly label: string } | null; readonly style: EdgeStyleLike }[];
  readonly legend: readonly { readonly label: string; readonly target: "node" | "edge"; readonly ruleId: string;
    readonly nodeStyle: StyleLike | null; readonly edgeStyle: EdgeStyleLike | null }[];
}
interface StyleLike { readonly shape: string; readonly color: string; readonly border: string }
interface EdgeStyleLike { readonly line: string; readonly color: string; readonly width: number; readonly arrow: string }

/** Lineage edge kinds → the diagram's flow classes (arrow and stroke look). */
const FLOW_OF: Readonly<Record<string, LayoutEdgeInput["flow"]>> = { reads: "data", writes: "data", derives: "data", serves: "data", exposes: "data", orchestrates: "control", tests: "dependency", configures: "dependency", deploys: "deployment" };

/** A preset colour: `#rrggbb` as is, a token as a theme variable (`--nv-color-<token>`) with a fallback. */
export function styleColor(c: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : `var(--nv-color-${cssToken(c)}, ${fallback})`;
}

export function isGraphView(x: unknown): x is GraphViewLike {
  if (!obj(x) || x.schema !== "datapass.graph-view/1" || !arr(x.groups) || !arr(x.nodes) || !arr(x.edges) || !arr(x.legend)) return false;
  return x.groups.every(g => obj(g) && str(g.id) && str(g.label) && str(g.color))
    && x.nodes.every(n => obj(n) && str(n.id) && str(n.label) && str(n.kind) && str(n.origin) && (n.groupId === null || str(n.groupId)) && arr(n.memberIds) && obj(n.style) && str(n.style.color))
    && x.edges.every(e => obj(e) && str(e.id) && str(e.fromId) && str(e.toId) && arr(e.kinds) && str(e.origin) && obj(e.style) && str(e.style.color) && (e.volumetry === null || (obj(e.volumetry) && str(e.volumetry.label))))
    && x.legend.every(l => obj(l) && str(l.label) && (l.target === "node" || l.target === "edge"));
}

export const graphModel: LayoutModel = ({ view, data, labels, location }) => {
  const holes: Hole[] = [];
  const blocks: VNode[] = [];
  for (const d of data) {
    if (d.graph === undefined) continue;
    if (!isGraphView(d.graph)) { holes.push({ kind: "graph-invalid", reason: label(labels, "graph.invalid"), field: d.source }); continue; }
    blocks.push(graphBlock(d.graph, view.title, labels, location.nodeId));
  }
  const all = holesNode([...data, { source: "graph", origin: "static", holes }], labels);
  const body: VNode = blocks.length ? { tag: "div", cls: "nv-graphs", children: blocks } : { tag: "p", cls: "nv-empty", text: label(labels, "view.noGraph") };
  return { tag: "div", cls: "nv-layout nv-layout-graph", children: all ? [body, all] : [body] };
};

function graphBlock(g: GraphViewLike, title: string, labels: Labels, here: string): VNode {
  const ids = new Set(g.nodes.map(n => n.id));
  const edges = g.edges.filter(e => ids.has(e.fromId) && ids.has(e.toId))
    .map(e => ({ id: e.id, from: e.fromId, to: e.toId, flow: FLOW_OF[e.kinds[0] ?? ""] ?? "data" as const }));
  const grouped = g.nodes.some(n => n.groupId);
  const lanes = grouped ? { of: Object.fromEntries(g.nodes.map(n => [n.id, n.groupId ?? ""])), order: g.groups.map(x => x.id), labels: Object.fromEntries(g.groups.map(x => [x.id, x.label])) } : undefined;
  const L = layoutGraph(g.nodes.map(n => n.id), edges, { direction: "LR", lanes });
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const edgeById = new Map(g.edges.map(e => [e.id, e]));
  const isHere = (n: GraphViewLike["nodes"][number]) => n.id === here || n.memberIds.includes(here);

  const laneNodes: VNode[] = L.lanes.map(lane => {
    const grp = g.groups.find(x => x.id === lane.id);
    return { tag: "div", cls: `lane dir-${L.direction}`, attrs: { style: `left:${lane.x}px;top:${lane.y}px;width:${lane.w}px;height:${lane.h}px${grp ? `;--nv-lane:${styleColor(grp.color, "transparent")}` : ""}` },
      children: [{ tag: "span", cls: "lanehead", text: lane.label || label(labels, "graph.ungrouped") }] };
  });

  const edgeNodes: VNode[] = L.edges.map(le => {
    const e = edgeById.get(le.id)!;
    const dash = e.style.line === "dashed" || !e.certain ? "6 4" : e.style.line === "dotted" ? "2 3" : "";
    const tip = `${byId.get(e.fromId)?.label ?? e.fromId} → ${byId.get(e.toId)?.label ?? e.toId} · ${e.kinds.join(", ")} · ${label(labels, `origin.${e.origin}`)}${e.volumetry ? ` · ${e.volumetry.label}` : ""}`;
    return { tag: "path", cls: `edge ${le.flow}${le.backward ? " backward" : ""}`, attrs: {
      d: le.path, "data-edge-id": e.id, "data-origin": e.origin, stroke: styleColor(e.style.color, "currentColor"), "stroke-width": String(Math.max(1, e.style.width)),
      ...(dash ? { "stroke-dasharray": dash } : {}), ...(e.style.arrow !== "none" ? { "marker-end": `url(#nv-arrow-${le.flow})` } : {}),
      ...(e.style.arrow === "both" ? { "marker-start": `url(#nv-arrow-${le.flow})` } : {}) },
      children: [{ tag: "title", text: tip }] };
  });
  const markers: VNode[] = ["data", "control", "dependency", "deployment"].map(flow => ({ tag: "marker", attrs: { id: `nv-arrow-${flow}`, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
    children: [{ tag: "path", cls: `arrow ${flow}`, attrs: { d: "M0,0 L10,5 L0,10 z" } }] }));
  const svg: VNode = { tag: "svg", cls: "edges", attrs: { width: String(L.width), height: String(L.height), viewBox: `0 0 ${L.width} ${L.height}`, "aria-hidden": "true" },
    children: [{ tag: "defs", children: markers }, ...edgeNodes] };

  const nodes: VNode[] = L.nodes.map(ln => {
    const n = byId.get(ln.id)!;
    const cur = isHere(n);
    const accent = navColor(n.id);
    const style = `left:${ln.x}px;top:${ln.y}px;width:${ln.w}px;height:${ln.h}px;--nv-accent:${accent};--nv-border:${styleColor(n.style.color, accent)}${cur ? `;--nv-here:${NAV_HERE_DEFAULT}` : ""}`;
    const meta = n.kind === "group" ? `${n.memberIds.length} ${label(labels, "graph.members")}` : label(labels, `nodeKind.${n.kind}`);
    return { tag: "div", cls: `node nv-graph-node nv-selectable shape-${cssToken(n.style.shape)} border-${cssToken(n.style.border)}${n.certain ? "" : " uncertain"}${cur ? " selected nv-current" : ""}`,
      attrs: { style, tabindex: "0", role: "button", "data-node-id": n.id, "data-nav-down": n.id, title: `${n.label} · ${label(labels, "graph.openHint")}`, ...(cur ? { "aria-current": "location" } : {}) },
      on: { action: "select", nodeId: n.id },
      children: [
        { tag: "span", cls: "nodetop", text: meta },
        { tag: "span", cls: "nodelabel", text: n.label },
        { tag: "span", cls: `nv-origin nv-origin-${cssToken(n.origin)}`, text: label(labels, `origin.${n.origin}`), attrs: { title: label(labels, "origin.title") } }] };
  });

  const canvas: VNode = { tag: "div", cls: "canvas nv-graph-canvas", attrs: { style: `width:${L.width}px;height:${L.height}px`, role: "group", "aria-label": title }, children: [...laneNodes, svg, ...nodes] };
  const legend: VNode | null = g.legend.length ? { tag: "ul", cls: "nv-legend", attrs: { "aria-label": label(labels, "graph.legend") }, children: g.legend.map(l => {
    const c = l.target === "node" ? l.nodeStyle?.color : l.edgeStyle?.color;
    return { tag: "li", cls: `nv-legend-${l.target}`, attrs: { "data-rule-id": l.ruleId }, children: [
      { tag: "span", cls: "nv-swatch", attrs: { style: `--nv-swatch:${c ? styleColor(c, "currentColor") : "currentColor"}`, "aria-hidden": "true" } },
      { tag: "span", text: l.label }] };
  }) } : null;
  return { tag: "section", cls: "nv-graph diagram", children: [{ tag: "div", cls: "scroller", children: [canvas] }, ...(legend ? [legend] : [])] };
}

const obj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): x is unknown[] => Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";
