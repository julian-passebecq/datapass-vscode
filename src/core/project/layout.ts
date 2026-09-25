/**
 * Layered left-to-right layout for architecture diagrams. Pure and deterministic: the same graph
 * always gets the same picture, so a diagram never "moves" between refreshes.
 *
 * Steps: break cycles (for layering only), assign layers by longest path from the sources,
 * order each layer by the barycenter of its neighbours (a few sweeps), then place nodes on a grid
 * and draw each edge as a cubic curve from the right side of its source to the left side of its
 * target (edges going backwards loop below the nodes).
 */

export interface LayoutEdgeInput { id: string; from: string; to: string; flow: "data" | "control" | "dependency" | "deployment" }
export interface LayoutNode { id: string; x: number; y: number; w: number; h: number; layer: number }
export interface LayoutEdge { id: string; from: string; to: string; flow: LayoutEdgeInput["flow"]; path: string; backward: boolean }
export interface Layout { width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[] }

export const NODE_W = 184;
export const NODE_H = 66;
const GAP_X = 72;
const GAP_Y = 26;
const PAD = 16;

export interface LayoutOptions { nodeW?: number; nodeH?: number; gapX?: number; gapY?: number }

/** Number of columns (layers) the layout of this graph uses; lets a caller size nodes to its width first. */
export function layerCount(nodeIds: readonly string[], edges: readonly LayoutEdgeInput[]): number {
  return layoutGraph(nodeIds, edges).nodes.reduce((m, n) => Math.max(m, n.layer + 1), 0);
}

/**
 * Node width and gap that make `layers` columns fit `width` pixels, within readable bounds
 * (at least 128 px per node); a caller scales or scrolls when even that does not fit.
 */
export function sizeForWidth(width: number, layers: number): Required<LayoutOptions> {
  const n = Math.max(1, layers);
  const gapX = n > 1 ? Math.max(32, Math.min(GAP_X, Math.floor((width - PAD * 2) * 0.07))) : GAP_X;
  const nodeW = Math.max(128, Math.min(NODE_W + 16, Math.floor((width - PAD * 2 - (n - 1) * gapX) / n)));
  return { nodeW, nodeH: nodeW < 170 ? 78 : NODE_H, gapX, gapY: GAP_Y };
}

export function layoutGraph(nodeIds: readonly string[], edgesIn: readonly LayoutEdgeInput[], opts: LayoutOptions = {}): Layout {
  const NW = opts.nodeW ?? NODE_W, NH = opts.nodeH ?? NODE_H, GX = opts.gapX ?? GAP_X, GY = opts.gapY ?? GAP_Y;
  const ids = [...new Set(nodeIds)];
  const known = new Set(ids);
  const edges = edgesIn.filter(e => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  if (!ids.length) return { width: 0, height: 0, nodes: [], edges: [] };

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
  // Pull sources right next to their first consumer, so a lone input does not sit far left.
  for (const id of ids) {
    if (preds.get(id)!.length || !succs.get(id)!.length) continue;
    const minNext = Math.min(...succs.get(id)!.map(s => layer.get(s)!));
    layer.set(id, Math.max(0, minNext - 1));
  }

  // 3. Order within layers: barycenter sweeps, starting from input order.
  const maxLayer = Math.max(...layer.values());
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of ids) layers[layer.get(id)!]!.push(id);
  const pos = new Map<string, number>();
  const index = () => layers.forEach(l => l.forEach((id, i) => pos.set(id, i)));
  index();
  const bary = (id: string, neighbours: string[]) => (neighbours.length ? neighbours.reduce((s, n) => s + pos.get(n)!, 0) / neighbours.length : pos.get(id)!);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of order) {
      const keyed = l.map((id, i) => ({ id, i, b: bary(id, down ? preds.get(id)! : succs.get(id)!) }));
      keyed.sort((a, b) => a.b - b.b || a.i - b.i);
      l.splice(0, l.length, ...keyed.map(k => k.id));
      index();
    }
  }

  // 4. Coordinates: layers are columns, centred vertically.
  const tallest = Math.max(...layers.map(l => l.length));
  const height = PAD * 2 + tallest * NH + (tallest - 1) * GY;
  const nodes: LayoutNode[] = [];
  layers.forEach((l, li) => {
    const colHeight = l.length * NH + (l.length - 1) * GY;
    const top = PAD + (height - PAD * 2 - colHeight) / 2;
    l.forEach((id, i) => nodes.push({ id, layer: li, w: NW, h: NH, x: PAD + li * (NW + GX), y: Math.round(top + i * (NH + GY)) }));
  });
  const width = PAD * 2 + (maxLayer + 1) * NW + maxLayer * GX;
  const at = new Map(nodes.map(n => [n.id, n]));

  // 5. Edges.
  const laid: LayoutEdge[] = edges.map(e => {
    const a = at.get(e.from)!, b = at.get(e.to)!;
    const forward = b.layer > a.layer;
    if (forward) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      const dx = Math.max(24, (x2 - x1) / 2);
      return { ...e, backward: false, path: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` };
    }
    // Same layer or backwards: leave from the bottom of the source, loop under, enter the target from below.
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y + b.h;
    const drop = Math.max(y1, y2) + 34;
    return { ...e, backward: true, path: `M${x1},${y1} C${x1},${drop} ${x2},${drop} ${x2},${y2}` };
  });
  const bottom = laid.some(e => e.backward) ? 40 : 0;
  return { width, height: height + bottom, nodes, edges: laid };
}
