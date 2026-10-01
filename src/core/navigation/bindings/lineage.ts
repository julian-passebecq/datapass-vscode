/**
 * V4-NAV NAVLIN1 binding `lineage`: the upstream / downstream graph around a Location, cut from the one
 * lineage graph (lineage-core `datapass.lineage-graph/1`) and projected through view-spi `projectGraph`
 * with `HOP_PROJECTION` restricted to the neighbourhood (`filter.includeIds`). Pure: the host supplies
 * the graph, the Location → node mapping and (once NAVSVC1 vendors view-spi) the projector; without a
 * projector the raw neighbourhood is returned for the graph layout. Nothing is guessed: no graph, or a
 * Location with no lineage node, is a typed hole.
 *
 * The graph types are the structural subset the `lineage` and `data-flow` bindings read, typed here so
 * no runtime dependency is needed; a real lineage-core graph satisfies them as-is. Flow edges point in
 * data-flow direction (`fromId` upstream, `toId` downstream; lineage-core README, PM ruling 30 Sept 2026).
 */
import { NAV_LEVELS, type NavLocation, type ViewCatalog, type ViewDef } from "../navTypes";
import type { NavOrigin } from "./origin";

export const LINEAGE_SOURCE = "lineage";

export const LINEAGE_GRAPH_SCHEMA = "datapass.lineage-graph/1";
export type LineageOrigin = "runtime" | "artifact" | "static" | "ai-confirmed" | "ai-proposed";
export type LineageEdgeKind = "reads" | "writes" | "derives" | "orchestrates" | "tests" | "exposes" | "deploys" | "serves" | "configures";

export interface LineageEvidenceLike {
  readonly origin: LineageOrigin;
  readonly locator: { readonly kind: string; readonly path: string } | null;
}
export interface LineageNodeLike {
  readonly id: string; readonly kind: string; readonly name: string; readonly parentId: string | null;
  readonly origin: LineageOrigin; readonly evidence: readonly LineageEvidenceLike[];
}
export interface LineageVolumetryLike {
  readonly rowsPerRun: number | null; readonly bytesPerRun: number | null; readonly frequency: string | null;
  readonly basis: "observed" | "theoretical" | "ai-proposed";
}
export interface LineageEdgeLike {
  readonly id: string; readonly kind: LineageEdgeKind; readonly fromId: string; readonly toId: string;
  readonly volumetry: LineageVolumetryLike | null; readonly origin: LineageOrigin; readonly evidence: readonly LineageEvidenceLike[];
}
export interface LineageGraphLike {
  readonly schema: typeof LINEAGE_GRAPH_SCHEMA; readonly id: string; readonly namespace: string;
  readonly nodes: readonly LineageNodeLike[]; readonly edges: readonly LineageEdgeLike[];
}

/** Lineage origin → § 34 origin (data: a host may pass its own table). */
export const LINEAGE_TO_NAV_ORIGIN: Readonly<Record<LineageOrigin, NavOrigin>> = {
  runtime: "observed", artifact: "declared", static: "static", "ai-confirmed": "declared", "ai-proposed": "ai-proposed",
};
/** Weakest first: a summary of several values carries the weakest origin, never a stronger one. */
export const NAV_ORIGIN_STRENGTH: readonly NavOrigin[] = ["ai-proposed", "theoretical", "datapass-guidance", "static", "declared", "observed"];
export function weakestOrigin(origins: readonly NavOrigin[], fallback: NavOrigin = "static"): NavOrigin {
  if (!origins.length) return fallback;
  return origins.reduce((a, b) => (NAV_ORIGIN_STRENGTH.indexOf(a) <= NAV_ORIGIN_STRENGTH.indexOf(b) ? a : b));
}

/** Maps a Location to the lineage node IDs it stands for. Supplied by the host (NAVLOC1). */
export interface LineageLocator {
  nodesAt(location: NavLocation, graph: LineageGraphLike): readonly string[];
}

/** Default locator helper: nodes with evidence in `path` (an artifact file) or under it (a folder, `dir/`). */
export function nodesByEvidencePath(graph: LineageGraphLike, path: string): string[] {
  const p = path.replace(/\\/g, "/");
  const hit = (q: string) => q === p || (p.endsWith("/") && q.startsWith(p));
  return graph.nodes.filter(n => n.evidence.some(e => e.locator && hit(e.locator.path))).map(n => n.id);
}

export const LINEAGE_DIRECTIONS = ["upstream", "downstream", "both"] as const;
export type LineageDirection = (typeof LINEAGE_DIRECTIONS)[number];
/** Data domain by default (lineage-core EDGEDOM1); `orchestrates` is control and opt-in via params. */
export const DEFAULT_LINEAGE_EDGE_KINDS: readonly LineageEdgeKind[] = ["reads", "writes", "derives"];

/** View params (catalog data; overridable per view). */
export interface LineageParams {
  readonly direction?: LineageDirection;
  readonly depth?: number;
  readonly maxNodes?: number;
  readonly edgeKinds?: readonly LineageEdgeKind[];
}
export const LINEAGE_DEFAULTS = { direction: "both" as LineageDirection, depth: 3, maxNodes: 300 };

/** view-spi `projectGraph` signature (structural; NAVSVC1 passes the vendored one with HOP_PROJECTION). */
export type GraphProjector = (graph: unknown, projection: unknown, preset: unknown, state?: { zoom?: string }) =>
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly errors?: unknown };
export interface LineageProjection {
  readonly project: GraphProjector;
  /** Base projection (HOP_PROJECTION); its filter is narrowed to the neighbourhood. */
  readonly projection: { readonly filter: Readonly<Record<string, unknown>> } & Readonly<Record<string, unknown>>;
  readonly preset: unknown;
  readonly zoom?: string;
}

export interface LineageNeighbour {
  readonly id: string; readonly name: string; readonly kind: string;
  /** Hops from the Location (0 = the Location's own nodes). */
  readonly distance: number;
  readonly side: "focus" | "upstream" | "downstream";
  readonly origin: NavOrigin;
}

export interface LineageResult {
  readonly graph: {
    readonly focusIds: readonly string[];
    readonly nodes: readonly LineageNeighbour[];
    readonly edges: readonly { readonly id: string; readonly kind: LineageEdgeKind; readonly fromId: string; readonly toId: string; readonly origin: NavOrigin }[];
    /** view-spi `datapass.graph-view/1` when a projector was supplied and accepted the input. */
    readonly view: unknown | null;
  } | null;
  readonly holes: readonly { reason: string }[];
  readonly origin: NavOrigin;
  readonly truncated: boolean;
}

const clampInt = (v: unknown, def: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : def;

/** Bounded breadth-first neighbourhood of `location` in data-flow direction(s). */
export function collectLineage(graph: LineageGraphLike | null | undefined, location: NavLocation, locator: LineageLocator,
  params: LineageParams = {}, opts: { projection?: LineageProjection; originMap?: Readonly<Record<LineageOrigin, NavOrigin>> } = {}): LineageResult {
  const holes: { reason: string }[] = [];
  if (!graph || graph.schema !== LINEAGE_GRAPH_SCHEMA) {
    return { graph: null, holes: [{ reason: "No lineage graph for this project yet (run an analysis)." }], origin: "static", truncated: false };
  }
  const originOf = (o: LineageOrigin) => (opts.originMap ?? LINEAGE_TO_NAV_ORIGIN)[o] ?? "static";
  const direction = LINEAGE_DIRECTIONS.includes(params.direction as LineageDirection) ? params.direction! : LINEAGE_DEFAULTS.direction;
  const depth = clampInt(params.depth, LINEAGE_DEFAULTS.depth, 0, 20);
  const maxNodes = clampInt(params.maxNodes, LINEAGE_DEFAULTS.maxNodes, 1, 5000);
  const kinds = new Set<string>(params.edgeKinds?.length ? params.edgeKinds : DEFAULT_LINEAGE_EDGE_KINDS);

  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const focus = [...new Set(locator.nodesAt(location, graph))].filter(id => byId.has(id)).sort();
  if (!focus.length) {
    return { graph: null, holes: [{ reason: "No lineage node is known for this location." }], origin: "static", truncated: false };
  }
  // Fields follow their dataset: a field edge counts for the dataset it belongs to.
  const top = (id: string) => { let n = byId.get(id); const seen = new Set<string>(); while (n?.parentId && byId.has(n.parentId) && !seen.has(n.id)) { seen.add(n.id); n = byId.get(n.parentId); } return n?.id ?? id; };
  const edges = graph.edges.filter(e => kinds.has(e.kind) && byId.has(e.fromId) && byId.has(e.toId));
  const out = new Map<string, LineageEdgeLike[]>(); const inc = new Map<string, LineageEdgeLike[]>();
  for (const e of edges) {
    const f = top(e.fromId), t = top(e.toId);
    if (f === t) continue;
    (out.get(f) ?? out.set(f, []).get(f)!).push(e); (inc.get(t) ?? inc.set(t, []).get(t)!).push(e);
  }

  const dist = new Map<string, { d: number; side: LineageNeighbour["side"] }>();
  const focusTop = [...new Set(focus.map(top))].sort();
  for (const id of focusTop) dist.set(id, { d: 0, side: "focus" });
  let truncated = false;
  const walk = (side: "upstream" | "downstream") => {
    let frontier = focusTop;
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const es = (side === "downstream" ? out.get(id) : inc.get(id)) ?? [];
        for (const e of es) {
          const other = side === "downstream" ? top(e.toId) : top(e.fromId);
          if (dist.has(other)) continue;
          if (dist.size >= maxNodes) { truncated = true; return; }
          dist.set(other, { d, side }); next.push(other);
        }
      }
      next.sort(); frontier = next;
    }
    if (frontier.some(id => ((side === "downstream" ? out.get(id) : inc.get(id)) ?? []).some(e => !dist.has(side === "downstream" ? top(e.toId) : top(e.fromId))))) truncated = true;
  };
  if (direction !== "downstream") walk("upstream");
  if (direction !== "upstream") walk("downstream");
  if (truncated) holes.push({ reason: `Lineage cut at ${depth} hops / ${maxNodes} nodes; widen the view parameters to see more.` });

  const nodes: LineageNeighbour[] = [...dist].map(([id, { d, side }]) => {
    const n = byId.get(id)!;
    return { id, name: n.name, kind: n.kind, distance: d, side, origin: originOf(n.origin) };
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const keptEdges = edges.filter(e => dist.has(top(e.fromId)) && dist.has(top(e.toId)) && top(e.fromId) !== top(e.toId))
    .map(e => ({ id: e.id, kind: e.kind, fromId: top(e.fromId), toId: top(e.toId), origin: originOf(e.origin) }));
  if (!keptEdges.length) holes.push({ reason: "No data flow is known in or out of this location yet." });

  let view: unknown | null = null;
  if (opts.projection) {
    const p = opts.projection;
    const includeIds = [...dist.keys()].sort();
    const projection = { ...p.projection, filter: { ...p.projection.filter, includeIds, excludeIds: [] } };
    const r = p.project(graph, projection, p.preset, p.zoom ? { zoom: p.zoom } : {});
    if (r.ok) view = r.value; else holes.push({ reason: "The lineage view could not be projected; showing the raw neighbourhood." });
  }
  const origin = weakestOrigin([...nodes.map(n => n.origin), ...keptEdges.map(e => e.origin)]);
  return { graph: { focusIds: focusTop, nodes, edges: keptEdges, view }, holes, origin, truncated };
}

/** Default `lineage` view (catalog data: title, params and preset are overridable via view overrides). */
export const LINEAGE_VIEW: ViewDef = {
  id: "lineage", title: "Lineage", layout: "graph", preset: "hop",
  bindings: [{ source: LINEAGE_SOURCE, params: { direction: LINEAGE_DEFAULTS.direction, depth: LINEAGE_DEFAULTS.depth, maxNodes: LINEAGE_DEFAULTS.maxNodes } }],
  description: "Where the data here comes from and where it goes, a few hops up and down.",
};
/** `*` rows: offered for every artifact kind at every level. */
export const LINEAGE_PACK: ViewCatalog["entries"] = NAV_LEVELS.map(level => ({ artifactKind: "*", level, views: [LINEAGE_VIEW] }));
