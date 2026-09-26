/**
 * Layered layout for architecture diagrams, left-to-right or top-to-bottom, optionally in lanes.
 * Pure and deterministic: the same graph always gets the same picture, so a diagram never "moves"
 * between refreshes.
 *
 * Steps: break cycles (for layering only), assign layers by longest path from the sources, order
 * each layer by the barycenter of its neighbours (a few sweeps), keep each lane's nodes together,
 * then place nodes on a grid. Layers run along the main axis (columns left to right, or rows top to
 * bottom); lanes are bands across it (horizontal bands for left-to-right, vertical columns for
 * top-to-bottom). Edges are cubic curves from the source's outgoing side to the target's incoming
 * side; edges going backwards loop around the nodes.
 */

export interface LayoutEdgeInput { id: string; from: string; to: string; flow: "data" | "control" | "dependency" | "deployment" }
export interface LayoutNode { id: string; x: number; y: number; w: number; h: number; layer: number }
export interface LayoutEdge { id: string; from: string; to: string; flow: LayoutEdgeInput["flow"]; path: string; backward: boolean }
export interface LayoutLane { id: string; label: string; x: number; y: number; w: number; h: number }
export type Direction = "LR" | "TB";
export interface Layout { width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[]; lanes: LayoutLane[]; direction: Direction }

export const NODE_W = 184;
export const NODE_H = 66;
const GAP_X = 72;
const GAP_Y = 26;
const PAD = 16;
/** Top-to-bottom: vertical gap between layers, horizontal gap between siblings. */
const TB_GAP_LAYER = 46;
const TB_GAP_SIBLING = 22;
/** Lane band: title strip and inner padding. */
const LANE_HEAD = 20;
const LANE_PAD = 8;
const LANE_GAP = 10;

export interface LaneSpec {
  /** Lane of each node (nodes without one go to a lane named ""). */
  of: Readonly<Record<string, string>>;
  /** Lane order; lanes not listed come after, in first-appearance order. */
  order: readonly string[];
  labels?: Readonly<Record<string, string>>;
}

export interface LayoutOptions { nodeW?: number; nodeH?: number; gapX?: number; gapY?: number; direction?: Direction; lanes?: LaneSpec }

/** Number of columns (layers) the layout of this graph uses; lets a caller size nodes to its width first. */
export function layerCount(nodeIds: readonly string[], edges: readonly LayoutEdgeInput[]): number {
  return layers(nodeIds, edges).layers.length;
}

/**
 * How many nodes sit side by side across the main axis at most (top-to-bottom: per row, lanes
 * added up), so a caller can size nodes for a vertical layout.
 */
export function crossCount(nodeIds: readonly string[], edges: readonly LayoutEdgeInput[], lanes?: LaneSpec): number {
  const { layers: ls } = layers(nodeIds, edges);
  if (!lanes) return Math.max(1, ...ls.map(l => l.length));
  const perLane = new Map<string, number>();
  for (const l of ls) {
    const counts = new Map<string, number>();
    for (const id of l) { const k = lanes.of[id] ?? ""; counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const [k, n] of counts) perLane.set(k, Math.max(perLane.get(k) ?? 0, n));
  }
  return Math.max(1, [...perLane.values()].reduce((a, b) => a + b, 0));
}

/**
 * Node width and gap that make `layers` columns fit `width` pixels, within readable bounds
 * (at least 128 px per node); a caller scales or scrolls when even that does not fit.
 */
export function sizeForWidth(width: number, layers: number): Required<Omit<LayoutOptions, "direction" | "lanes">> {
  const n = Math.max(1, layers);
  const gapX = n > 1 ? Math.max(32, Math.min(GAP_X, Math.floor((width - PAD * 2) * 0.07))) : GAP_X;
  const nodeW = Math.max(128, Math.min(NODE_W + 16, Math.floor((width - PAD * 2 - (n - 1) * gapX) / n)));
  return { nodeW, nodeH: nodeW < 170 ? 78 : NODE_H, gapX, gapY: GAP_Y };
}

/** Top-to-bottom: node width so that `across` nodes fit `width` side by side. */
export function sizeForWidthVertical(width: number, across: number): Required<Omit<LayoutOptions, "direction" | "lanes">> {
  const n = Math.max(1, across);
  const nodeW = Math.max(128, Math.min(NODE_W + 16, Math.floor((width - PAD * 2 - (n - 1) * TB_GAP_SIBLING - 2 * LANE_PAD * n) / n)));
  return { nodeW, nodeH: nodeW < 170 ? 78 : NODE_H, gapX: TB_GAP_SIBLING, gapY: TB_GAP_LAYER };
}

/** Steps 1–3: cycle breaking, longest-path layering, barycenter ordering. */
function layers(nodeIds: readonly string[], edgesIn: readonly LayoutEdgeInput[]): { ids: string[]; edges: LayoutEdgeInput[]; layer: Map<string, number>; layers: string[][]; backward: Set<string> } {
  const ids = [...new Set(nodeIds)];
  const known = new Set(ids);
  const edges = edgesIn.filter(e => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  if (!ids.length) return { ids, edges, layer: new Map(), layers: [], backward: new Set() };

  // 1. Break cycles with a DFS in input order: edges into a node on the current path are reversed for layering.
  const out = new Map<string, LayoutEdgeInput[]>(ids.map(id => [id, []]));
  for (const e of edges) out.get(e.from)!.push(e);
  const backward = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    state.set(n, 1);
    for (const e of out.get(n)!) {
      const s = state.get(e.to);
      if (s === 1) backward.add(e.id);
      else if (!s) visit(e.to);
    }
    state.set(n, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const dag = edges.map(e => (backward.has(e.id) ? { ...e, from: e.to, to: e.from } : e));

  // 2. Longest-path layering.
  const preds = new Map<string, string[]>(ids.map(id => [id, []]));
  const succs = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const e of dag) { preds.get(e.to)!.push(e.from); succs.get(e.from)!.push(e.to); }
  const layer = new Map<string, number>();
  const layerOf = (n: string, depth = 0): number => {
    if (layer.has(n)) return layer.get(n)!;
    if (depth > ids.length) return 0;
    const l = preds.get(n)!.length ? Math.max(...preds.get(n)!.map(p => layerOf(p, depth + 1) + 1)) : 0;
    layer.set(n, l);
    return l;
  };
  for (const id of ids) layerOf(id);
  // Pull sources right next to their first consumer, so a lone input does not sit far away.
  for (const id of ids) {
    if (preds.get(id)!.length || !succs.get(id)!.length) continue;
    const minNext = Math.min(...succs.get(id)!.map(s => layer.get(s)!));
    layer.set(id, Math.max(0, minNext - 1));
  }

  // 3. Order within layers: barycenter sweeps, starting from input order.
  const maxLayer = Math.max(...layer.values());
  const ls: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of ids) ls[layer.get(id)!]!.push(id);
  const pos = new Map<string, number>();
  const index = () => ls.forEach(l => l.forEach((id, i) => pos.set(id, i)));
  index();
  const bary = (id: string, neighbours: string[]) => (neighbours.length ? neighbours.reduce((s, n) => s + pos.get(n)!, 0) / neighbours.length : pos.get(id)!);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? ls.slice(1) : ls.slice(0, -1).reverse();
    for (const l of order) {
      const keyed = l.map((id, i) => ({ id, i, b: bary(id, down ? preds.get(id)! : succs.get(id)!) }));
      keyed.sort((a, b) => a.b - b.b || a.i - b.i);
      l.splice(0, l.length, ...keyed.map(k => k.id));
      index();
    }
  }
  return { ids, edges, layer, layers: ls, backward };
}

export function layoutGraph(nodeIds: readonly string[], edgesIn: readonly LayoutEdgeInput[], opts: LayoutOptions = {}): Layout {
  const dir: Direction = opts.direction ?? "LR";
  const NW = opts.nodeW ?? NODE_W, NH = opts.nodeH ?? NODE_H;
  const { edges, layers: ls } = layers(nodeIds, edgesIn);
  if (!ls.length) return { width: 0, height: 0, nodes: [], edges: [], lanes: [], direction: dir };
  const nodes: LayoutNode[] = [];
  const laneBoxes: LayoutLane[] = [];

  if (dir === "LR") {
    const GX = opts.gapX ?? GAP_X, GY = opts.gapY ?? GAP_Y;
    const width = PAD * 2 + ls.length * NW + (ls.length - 1) * GX;
    if (!opts.lanes) {
      // 4. Layers are columns, centred vertically.
      const tallest = Math.max(...ls.map(l => l.length));
      const height = PAD * 2 + tallest * NH + (tallest - 1) * GY;
      ls.forEach((l, li) => {
        const colHeight = l.length * NH + (l.length - 1) * GY;
        const top = PAD + (height - PAD * 2 - colHeight) / 2;
        l.forEach((id, i) => nodes.push({ id, layer: li, w: NW, h: NH, x: PAD + li * (NW + GX), y: Math.round(top + i * (NH + GY)) }));
      });
      return finish(nodes, edges, width, height, laneBoxes, dir);
    }
    // Lanes are horizontal bands; within a band each column lists that lane's nodes in barycenter order.
    const order = laneOrder(ls, opts.lanes);
    let top = PAD;
    for (const lane of order) {
      const cols = ls.map(l => l.filter(id => (opts.lanes!.of[id] ?? "") === lane));
      const rows = Math.max(...cols.map(c => c.length));
      if (!rows) continue;
      const h = LANE_HEAD + LANE_PAD * 2 + rows * NH + (rows - 1) * GY;
      laneBoxes.push({ id: lane, label: opts.lanes.labels?.[lane] ?? lane, x: PAD / 2, y: top, w: width - PAD, h });
      cols.forEach((c, li) => c.forEach((id, i) => nodes.push({ id, layer: li, w: NW, h: NH, x: PAD + li * (NW + GX), y: top + LANE_HEAD + LANE_PAD + i * (NH + GY) })));
      top += h + LANE_GAP;
    }
    return finish(nodes, edges, width, top - LANE_GAP + PAD, laneBoxes, dir);
  }

  // Top-to-bottom: layers are rows; nodes of a row sit side by side.
  const GL = opts.gapY ?? TB_GAP_LAYER, GS = opts.gapX ?? TB_GAP_SIBLING;
  const height = PAD * 2 + ls.length * NH + (ls.length - 1) * GL;
  if (!opts.lanes) {
    const widest = Math.max(...ls.map(l => l.length));
    const width = PAD * 2 + widest * NW + (widest - 1) * GS;
    ls.forEach((l, li) => {
      const rowWidth = l.length * NW + (l.length - 1) * GS;
      const left = PAD + (width - PAD * 2 - rowWidth) / 2;
      l.forEach((id, i) => nodes.push({ id, layer: li, w: NW, h: NH, x: Math.round(left + i * (NW + GS)), y: PAD + li * (NH + GL) }));
    });
    return finish(nodes, edges, width, height, laneBoxes, dir);
  }
  // Lanes are vertical columns; the lane title sits above the first row.
  const order = laneOrder(ls, opts.lanes);
  let left = PAD;
  const laneTop = PAD;
  for (const lane of order) {
    const rows = ls.map(l => l.filter(id => (opts.lanes!.of[id] ?? "") === lane));
    const across = Math.max(...rows.map(r => r.length));
    if (!across) continue;
    const w = LANE_PAD * 2 + across * NW + (across - 1) * GS;
    laneBoxes.push({ id: lane, label: opts.lanes.labels?.[lane] ?? lane, x: left, y: laneTop, w, h: height - PAD + LANE_HEAD });
    rows.forEach((r, li) => r.forEach((id, i) => nodes.push({ id, layer: li, w: NW, h: NH, x: left + LANE_PAD + i * (NW + GS), y: laneTop + LANE_HEAD + li * (NH + GL) })));
    left += w + LANE_GAP;
  }
  return finish(nodes, edges, left - LANE_GAP + PAD, height + LANE_HEAD, laneBoxes, dir);
}

function laneOrder(ls: string[][], lanes: LaneSpec): string[] {
  const seen: string[] = [...lanes.order];
  for (const l of ls) for (const id of l) { const k = lanes.of[id] ?? ""; if (!seen.includes(k)) seen.push(k); }
  return seen;
}

/** 5. Edges, drawn once every node has its place. */
function finish(nodes: LayoutNode[], edges: LayoutEdgeInput[], width: number, height: number, lanes: LayoutLane[], dir: Direction): Layout {
  const at = new Map(nodes.map(n => [n.id, n]));
  let extraBottom = 0, extraRight = 0;
  const laid: LayoutEdge[] = edges.map(e => {
    const a = at.get(e.from)!, b = at.get(e.to)!;
    const forward = b.layer > a.layer;
    if (dir === "LR") {
      if (forward) {
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
        const dx = Math.max(24, (x2 - x1) / 2);
        return { ...e, backward: false, path: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` };
      }
      // Same layer or backwards: leave from the bottom of the source, loop under, enter the target from below.
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y + b.h;
      const drop = Math.max(y1, y2) + 34;
      extraBottom = Math.max(extraBottom, drop + 6 - height);
      return { ...e, backward: true, path: `M${x1},${y1} C${x1},${drop} ${x2},${drop} ${x2},${y2}` };
    }
    if (forward) {
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
      const dy = Math.max(18, (y2 - y1) / 2);
      return { ...e, backward: false, path: `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}` };
    }
    // Top-to-bottom, same row or backwards: loop on the right side.
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2;
    const out = Math.max(x1, x2) + 34;
    extraRight = Math.max(extraRight, out + 6 - width);
    return { ...e, backward: true, path: `M${x1},${y1} C${out},${y1} ${out},${y2} ${x2},${y2}` };
  });
  return { width: width + Math.max(0, extraRight), height: height + Math.max(0, extraBottom), nodes, edges: laid, lanes, direction: dir };
}
