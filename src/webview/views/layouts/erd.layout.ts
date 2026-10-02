/**
 * V4-NAV `erd` layout kind (NAVERD1): table boxes with their columns (name, type, PK/FK markers) and key edges.
 * Declared keys are solid lines; inferred joins dashed and labelled 'theoretical'. Click a table = `select`,
 * double-click = `down` (attribute `data-nav-dblclick`). At most `maxTables` boxes (default 200); the rest is a 'more' hole.
 * Pure: builds the node tree `renderer.ts` draws (SVG tags are namespaced there); no DOM, no measuring.
 * Types mirror `../model` (NAVREN1) and `navPalette` (NAVMAP1) structurally until both are on main.
 */
import type { LayoutEntry } from "../model";
import type { ErdEdge, ErdGraph, ErdTable } from "../../../core/navigation/bindings/schemaErd";

interface Hole { readonly reason: string; readonly kind?: string; readonly field?: string }
interface BindingData { readonly source: string; readonly origin: string; readonly holes: readonly Hole[]; readonly graph?: unknown }
export interface VNode { readonly tag: string; readonly cls?: string; readonly text?: string; readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly VNode[]; readonly on?: { readonly action: "select"; readonly nodeId: string } }
export interface ErdLayoutInput {
  readonly view: { readonly id: string; readonly title: string };
  readonly data: readonly BindingData[];
  readonly labels: Readonly<Record<string, string>>;
  /** Colour per table id (NAVMAP1 `navColor`); default: a CSS variable the palette sheet defines. */
  readonly color?: (id: string) => string;
  readonly maxTables?: number;
}

export const ERD_MAX_TABLES = 200;
const L = (labels: Readonly<Record<string, string>>, k: string): string => labels[k] ?? k;
// Geometry (px); boxes in a grid of layers: referenced tables (PK side) to the left of the tables that point to them.
const BOX_W = 220, ROW_H = 20, HEAD_H = 26, GAP_X = 90, GAP_Y = 30;

function isErdGraph(g: unknown): g is ErdGraph {
  return typeof g === "object" && g !== null && (g as ErdGraph).kind === "erd" && Array.isArray((g as ErdGraph).tables) && Array.isArray((g as ErdGraph).edges);
}

/** Layer = longest FK chain to a root; deterministic order inside a layer (name). */
function layers(tables: readonly ErdTable[], edges: readonly ErdEdge[]): Map<string, number> {
  const ids = new Set(tables.map(t => t.id));
  const out = new Map<string, number>(tables.map(t => [t.id, 0]));
  for (let pass = 0; pass < tables.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
      const want = out.get(e.to)! + 1;
      if (want > out.get(e.from)! && want < tables.length) { out.set(e.from, want); changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

const cardText = (labels: Readonly<Record<string, string>>, e: ErdEdge): string | null => e.cardinality ? L(labels, `erd.cardinality.${e.cardinality}`) : null;

export function erdModel({ view, data, labels, color, maxTables = ERD_MAX_TABLES }: ErdLayoutInput): VNode {
  const graphs = data.map(d => d.graph).filter(isErdGraph);
  const all = graphs.flatMap(g => g.tables);
  const shown = [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, maxTables);
  const ids = new Set(shown.map(t => t.id));
  const edges = graphs.flatMap(g => g.edges).filter(e => ids.has(e.from) && ids.has(e.to));
  const holes: Hole[] = data.flatMap(d => d.holes);
  if (all.length > shown.length) holes.push({ kind: "more", reason: `${all.length - shown.length} ${L(labels, "erd.moreTables")}` });
  const holesNode: VNode | null = holes.length ? { tag: "div", cls: "nv-holes", children: holes.map(h => ({
    tag: "div", cls: "nv-hole", attrs: { role: "note", "data-hole-kind": h.kind ?? "unknown" }, children: [
      { tag: "span", cls: "nv-hole-kind", text: L(labels, `hole.${h.kind ?? "unknown"}`) },
      ...(h.field ? [{ tag: "code", text: h.field }] : []),
      { tag: "span", cls: "nv-hole-reason", text: h.reason }] })) } : null;
  if (!shown.length) {
    const empty: VNode = { tag: "p", cls: "nv-empty", text: L(labels, "erd.noTables") };
    return { tag: "div", cls: "nv-layout nv-layout-erd", children: holesNode ? [empty, holesNode] : [empty] };
  }

  const layer = layers(shown, edges);
  const cols = new Map<number, ErdTable[]>();
  for (const t of shown) { const l = layer.get(t.id)!; cols.set(l, [...(cols.get(l) ?? []), t]); }
  const pos = new Map<string, { x: number; y: number; h: number }>();
  let width = 0, height = 0;
  for (const [l, ts] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    let y = 0;
    for (const t of ts) {
      const h = HEAD_H + ROW_H * Math.max(1, t.columns?.length ?? 1);
      const x = l * (BOX_W + GAP_X);
      pos.set(t.id, { x, y, h }); y += h + GAP_Y;
      width = Math.max(width, x + BOX_W); height = Math.max(height, y);
    }
  }
  const colY = (t: ErdTable | undefined, name: string | undefined): number => {
    const p = pos.get(t?.id ?? "")!;
    const i = name && t?.columns ? t.columns.findIndex(c => c.name.toLowerCase() === name.toLowerCase()) : -1;
    return p.y + (i >= 0 ? HEAD_H + ROW_H * i + ROW_H / 2 : HEAD_H / 2);
  };
  const byId = new Map(shown.map(t => [t.id, t]));
  const edgeNodes: VNode[] = edges.map(e => {
    const a = pos.get(e.from)!, z = pos.get(e.to)!;
    const ax = a.x <= z.x ? a.x + BOX_W : a.x, zx = a.x <= z.x ? z.x : z.x + BOX_W;
    const ay = colY(byId.get(e.from), e.fromColumns[0]), zy = colY(byId.get(e.to), e.toColumns[0]);
    const mid = (ax + zx) / 2;
    const tip = [e.declared ? L(labels, "erd.edge.declared") : L(labels, "erd.edge.inferred"), e.name, cardText(labels, e),
      `${e.fromColumns.join(", ")} → ${e.toColumns.join(", ")}`].filter(Boolean).join(" · ");
    const card = cardText(labels, e);
    const path: VNode = { tag: "path", attrs: { d: `M${ax},${ay} C${mid},${ay} ${mid},${zy} ${zx},${zy}`, fill: "none", ...(e.declared ? {} : { "stroke-dasharray": "6 4" }) } };
    const text = (cls: string, t: string, y: number): VNode => ({ tag: "text", cls, text: t, attrs: { x: String(mid), y: String(y), "text-anchor": "middle" } });
    return { tag: "g", cls: `nv-erd-edge ${e.declared ? "nv-erd-declared" : "nv-erd-inferred"}`, attrs: { "data-edge-id": e.id, "data-origin": e.origin }, children: [
      { tag: "title", text: tip },
      path,
      ...(!e.declared ? [text("nv-erd-edge-label", L(labels, "origin.theoretical"), (ay + zy) / 2 - 4)] : []),
      ...(card ? [text("nv-erd-card", card, (ay + zy) / 2 + 12)] : [])] };
  });
  const boxes: VNode[] = shown.map(t => {
    const p = pos.get(t.id)!;
    const rows: VNode[] = t.columns === null
      ? [{ tag: "li", cls: "nv-erd-col nv-erd-unknown", text: L(labels, "erd.columnsUnknown") }]
      : t.columns.length === 0 ? [{ tag: "li", cls: "nv-erd-col nv-erd-unknown", text: L(labels, "erd.noColumns") }]
      : t.columns.map(c => ({ tag: "li", cls: `nv-erd-col${c.pk ? " nv-erd-pk" : ""}${c.fk ? " nv-erd-fk" : ""}`, attrs: { "data-origin": c.origin }, children: [
        { tag: "span", cls: "nv-erd-keys", text: [c.pk ? L(labels, "erd.pk") : "", c.fk ? L(labels, "erd.fk") : ""].filter(Boolean).join(" ") },
        { tag: "span", cls: "nv-erd-name", text: c.name },
        { tag: "span", cls: "nv-erd-type", text: c.type ?? L(labels, "erd.typeUnknown") }] }));
    return { tag: "section", cls: `nv-erd-table nv-erd-${t.kind}${t.origin === "theoretical" ? " nv-erd-inferred" : ""}`,
      attrs: { tabindex: "0", role: "button", "aria-label": `${L(labels, `erd.kind.${t.kind}`)} ${t.name}`, "data-node-id": t.id, "data-nav-dblclick": "down",
        "data-origin": t.origin, style: `left:${p.x}px;top:${p.y}px;width:${BOX_W}px;--nv-node-color:${color ? color(t.id) : `var(--nv-erd-default-color)`}` },
      on: { action: "select", nodeId: t.id },
      children: [{ tag: "h3", cls: "nv-erd-head", text: t.name }, { tag: "ul", cls: "nv-erd-cols", children: rows }] };
  });
  const canvas: VNode = { tag: "div", cls: "nv-erd-canvas", attrs: { role: "group", "aria-label": view.title, style: `width:${width}px;height:${height}px` }, children: [
    { tag: "svg", cls: "nv-erd-edges", attrs: { width: String(width), height: String(height), "aria-hidden": "true" }, children: edgeNodes },
    ...boxes] };
  return { tag: "div", cls: "nv-layout nv-layout-erd", children: holesNode ? [canvas, holesNode] : [canvas] };
}

/** NAVWIRE1 self-registration: the renderer picks the `erd` kind up from out/gen/layouts.ts. */
export default { kind: "erd", model: input => erdModel(input) } satisfies LayoutEntry;
