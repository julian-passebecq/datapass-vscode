/**
 * V5 OTEL2 bindings `endpoints` and `endpoint-trace` (AC-V4): the V4-API endpoints of a Location as found
 * statically (lineage `api-endpoint` nodes emitted by analyzers-api) joined with replayed OpenTelemetry
 * observations (OTEL1 replay reader → OTELSPI1 mapping → ObservedRun with `binding: { kind: "endpoint", id }`),
 * and the span tree of one replayed trace. Pure (no `vscode`): the host supplies the lineage graph, the
 * Location → node mapping and the replay batches it read from local files. No live collector, no network:
 * no replay batch means static only, with a hole note.
 *
 * Replay types are the structural subset of project-contracts `ObservedRun` / `ObservationBatch` (OTELSPI1
 * `provider: "otel"`) read here, typed locally until REPIN5 re-pins Common; a real batch satisfies them as-is.
 * Trace node states: `pass` = a span bound to a static endpoint, `replay` = a span only the replay knows
 * (unbound route, internal call), `clipped` = cut by the capture window or orphaned (parent not captured),
 * `pruned` = spans elided by the depth / width limits. A failed span keeps its state and sets `failed`.
 */
import { NAV_LEVELS, type NavLocation, type ViewCatalog, type ViewDef } from "../navTypes";
import type { LineageGraphLike, LineageLocator } from "./lineage";
import { LINEAGE_TO_NAV_ORIGIN } from "./lineage";
import type { NavHole, NavOrigin } from "./origin";

export const ENDPOINTS_SOURCE = "endpoints";
export const ENDPOINT_TRACE_SOURCE = "endpoint-trace";
export const API_ENDPOINT_KIND = "api-endpoint";

// ---- replay input (structural subset of OTELSPI1 ObservedRun / ObservationBatch) ----

export interface OtelSpanNative {
  readonly traceId: string; readonly spanId: string; readonly parentSpanId: string | null;
  readonly spanName: string; readonly httpStatus: number | null; readonly clipped: boolean;
}
export interface ReplayRunLike {
  readonly kind: "run";
  readonly provider: string;
  readonly binding: "unbound" | { readonly kind: string; readonly id: string };
  readonly subject: { readonly displayName?: string | null; readonly container?: string | null };
  readonly native: Readonly<Record<string, unknown>>;
  readonly runId: string; readonly jobType: string;
  readonly status: string;
  readonly startedAt: string | null; readonly endedAt: string | null; readonly durationMs: number | null;
  readonly failureReason: string | null;
}
export interface ReplayBatchLike {
  readonly id: string;
  readonly origin: string;
  readonly dataClass: string;
  readonly capturedAt?: string;
  readonly observations: readonly { readonly kind: string }[];
}
/** Evidence origins that mark a batch as synthetic (project-contracts SYNTHETIC_EVIDENCE_ORIGINS; data). */
export const SYNTHETIC_ORIGINS: readonly string[] = ["simulated-engine", "synthetic-data", "fixture"];

const isRun = (o: { readonly kind: string }): o is ReplayRunLike => o.kind === "run" && "native" in o && "binding" in o;
const spanOf = (r: ReplayRunLike): OtelSpanNative | null => {
  const n = r.native;
  return typeof n.traceId === "string" && typeof n.spanId === "string"
    ? { traceId: n.traceId, spanId: n.spanId, parentSpanId: typeof n.parentSpanId === "string" ? n.parentSpanId : null,
      spanName: typeof n.spanName === "string" ? n.spanName : r.jobType, httpStatus: typeof n.httpStatus === "number" ? n.httpStatus : null,
      clipped: n.clipped === true }
    : null;
};
const boundId = (r: ReplayRunLike): string | null => (r.binding !== "unbound" && r.binding.kind === "endpoint" ? r.binding.id : null);

// ---- static endpoints ----

export interface StaticEndpoint {
  readonly id: string;
  /** lineage node name: `<service> <METHOD> <route>` (analyzers-api `GraphSink.endpoint`). */
  readonly name: string;
  readonly service: string | null; readonly method: string | null; readonly route: string | null;
  readonly path: string | null;
  readonly origin: NavOrigin;
}
const METHOD_RE = /^(.*?)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|QUERY|MUTATION|SUBSCRIPTION)\s+(.+)$/;
export function staticEndpoints(graph: LineageGraphLike, ids?: ReadonlySet<string>): StaticEndpoint[] {
  return graph.nodes.filter(n => n.kind === API_ENDPOINT_KIND && (!ids || ids.has(n.id))).map(n => {
    const m = METHOD_RE.exec(n.name);
    const loc = n.evidence.find(e => e.locator)?.locator ?? null;
    return { id: n.id, name: n.name, service: m?.[1] ?? null, method: m?.[2] ?? null, route: m?.[3] ?? null,
      path: loc ? loc.path : null, origin: LINEAGE_TO_NAV_ORIGIN[n.origin] };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ---- join ----

export interface EndpointStats {
  readonly requests: number; readonly errors: number; readonly errorRate: number | null;
  readonly p50Ms: number | null; readonly p95Ms: number | null; readonly maxMs: number | null;
  readonly clipped: number;
  /** Trace IDs seen for this endpoint (sorted, capped by `maxTraces`). */
  readonly traceIds: readonly string[];
}
export interface EndpointRow {
  /** Endpoint node ID, or the replay route display name for an `observed-only` row. */
  readonly id: string;
  readonly name: string;
  /** `static` = no replay data; `observed` = static and replayed; `observed-only` = replayed, no static endpoint here. */
  readonly state: "static" | "observed" | "observed-only";
  readonly static: StaticEndpoint | null;
  readonly replay: EndpointStats | null;
  readonly origin: NavOrigin;
  readonly synthetic: boolean;
}
export interface EndpointParams {
  /** Show replayed routes bound to no static endpoint of this Location (default true at project level only). */
  readonly includeUnbound?: boolean;
  readonly maxTraces?: number;
}
export const ENDPOINT_DEFAULTS = { maxTraces: 20 };
export interface EndpointResult {
  readonly rows: readonly EndpointRow[];
  readonly holes: readonly NavHole[];
  /** Replay batch IDs used (the provenance shown under the table). */
  readonly batches: readonly string[];
  readonly synthetic: boolean;
}

/** Nearest-rank percentile of a sorted array. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null;
}

function stats(runs: readonly ReplayRunLike[], maxTraces: number): EndpointStats {
  const spans = runs.filter(r => spanOf(r));
  const durations = spans.map(r => r.durationMs).filter((d): d is number => typeof d === "number").sort((a, b) => a - b);
  const errors = spans.filter(r => r.status === "failed").length;
  const traceIds = [...new Set(spans.map(r => spanOf(r)!.traceId))].sort().slice(0, maxTraces);
  return {
    requests: spans.length, errors, errorRate: spans.length ? errors / spans.length : null,
    p50Ms: percentile(durations, 50), p95Ms: percentile(durations, 95), maxMs: durations[durations.length - 1] ?? null,
    clipped: spans.filter(r => spanOf(r)!.clipped).length, traceIds,
  };
}

/** Joins the static endpoints of a Location with the replayed runs (only spans: metric samples carry no latency). */
export function joinEndpoints(endpoints: readonly StaticEndpoint[], batches: readonly ReplayBatchLike[], params: EndpointParams = {}): EndpointResult {
  const maxTraces = params.maxTraces ?? ENDPOINT_DEFAULTS.maxTraces;
  const holes: NavHole[] = [];
  const synthetic = batches.some(b => SYNTHETIC_ORIGINS.includes(b.origin) || b.dataClass === "synthetic");
  const runs = batches.flatMap(b => b.observations.filter(isRun)).filter(r => r.provider === "otel" && spanOf(r));
  if (!batches.length) holes.push({ reason: "No replayed traces: endpoints are shown statically only. Load an OpenTelemetry replay file to see latency and errors." });
  else if (!runs.length) holes.push({ reason: "The replay files hold no request spans: endpoints are shown statically only." });

  const byEndpoint = new Map<string, ReplayRunLike[]>();
  const unbound = new Map<string, ReplayRunLike[]>();
  const known = new Set(endpoints.map(e => e.id));
  for (const r of runs) {
    const id = boundId(r);
    if (id && known.has(id)) (byEndpoint.get(id) ?? byEndpoint.set(id, []).get(id)!).push(r);
    else if (!id) {
      const key = r.subject.displayName || r.jobType;
      (unbound.get(key) ?? unbound.set(key, []).get(key)!).push(r);
    }
  }
  const rows: EndpointRow[] = endpoints.map(e => {
    const hit = byEndpoint.get(e.id);
    return hit
      ? { id: e.id, name: e.name, state: "observed" as const, static: e, replay: stats(hit, maxTraces), origin: "observed" as const, synthetic }
      : { id: e.id, name: e.name, state: "static" as const, static: e, replay: null, origin: e.origin, synthetic: false };
  });
  if (params.includeUnbound) {
    for (const [name, rs] of [...unbound].sort((a, b) => a[0].localeCompare(b[0])))
      rows.push({ id: `replay:${name}`, name, state: "observed-only", static: null, replay: stats(rs, maxTraces), origin: "observed", synthetic });
    if (unbound.size) holes.push({ reason: `${unbound.size} replayed route(s) match no static endpoint: the API spec or routes may be missing from the scan.` });
  }
  if (!endpoints.length) holes.push({ reason: "No API endpoint was found statically at this location." });
  return { rows, holes, batches: batches.map(b => b.id).sort(), synthetic };
}

/** Binding `endpoints`: static endpoints at the Location (lineage locator) joined with the replay batches. */
export function collectEndpoints(location: NavLocation, graph: LineageGraphLike | null, locator: LineageLocator | null,
  batches: readonly ReplayBatchLike[], params: EndpointParams = {}): EndpointResult {
  if (!graph) return { rows: [], holes: [{ reason: "No lineage graph yet: run a scan to find the API endpoints.", location }], batches: [], synthetic: false };
  const topLevel = location.level === "project";
  const ids = topLevel || !locator ? undefined : new Set(locator.nodesAt(location, graph));
  return joinEndpoints(staticEndpoints(graph, ids), batches, { includeUnbound: topLevel, ...params });
}

// ---- trace tree ----

export const TRACE_NODE_STATES = ["pass", "replay", "clipped", "pruned"] as const;
export type TraceNodeState = (typeof TRACE_NODE_STATES)[number];
export interface TraceNode {
  readonly id: string;
  readonly label: string;
  readonly state: TraceNodeState;
  readonly failed: boolean;
  readonly endpointId: string | null;
  readonly durationMs: number | null;
  readonly httpStatus: number | null;
  /** For a `pruned` node: how many spans it stands for. */
  readonly prunedCount: number;
  readonly children: readonly TraceNode[];
}
export interface TraceParams { readonly traceId?: string; readonly maxDepth?: number; readonly maxChildren?: number; readonly maxNodes?: number }
export const TRACE_DEFAULTS = { maxDepth: 8, maxChildren: 25, maxNodes: 300 };
export interface TraceResult {
  readonly traceId: string | null;
  readonly roots: readonly TraceNode[];
  readonly holes: readonly NavHole[];
  readonly origin: NavOrigin;
  readonly synthetic: boolean;
  readonly truncated: boolean;
}

/** Node style per state, in view-spi `NodeStyle` shape (data: a host or user preset may replace it). */
export const TRACE_NODE_STYLES: Readonly<Record<TraceNodeState, { shape: "rounded" | "rectangle"; color: string; border: "solid" | "dashed" | "dotted"; icon: string | null }>> = {
  pass: { shape: "rounded", color: "charts.green", border: "solid", icon: "pass" },
  replay: { shape: "rounded", color: "charts.blue", border: "dashed", icon: "debug-rerun" },
  clipped: { shape: "rounded", color: "charts.yellow", border: "dotted", icon: "scissors" },
  pruned: { shape: "rectangle", color: "disabledForeground", border: "dotted", icon: "ellipsis" },
};

const subtreeSize = (id: string, kids: ReadonlyMap<string, readonly ReplayRunLike[]>): number =>
  1 + (kids.get(id) ?? []).reduce((n, c) => n + subtreeSize(spanOf(c)!.spanId, kids), 0);

/** Builds the span tree of one trace from the replayed runs (spans sorted by start time, then span ID). */
export function buildTraceTree(runs: readonly ReplayRunLike[], traceId: string, endpointIds: ReadonlySet<string>, params: TraceParams = {}):
  { roots: TraceNode[]; truncated: boolean } {
  const maxDepth = params.maxDepth ?? TRACE_DEFAULTS.maxDepth;
  const maxChildren = params.maxChildren ?? TRACE_DEFAULTS.maxChildren;
  let budget = params.maxNodes ?? TRACE_DEFAULTS.maxNodes;
  const spans = runs.filter(r => spanOf(r)?.traceId === traceId)
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "") || spanOf(a)!.spanId.localeCompare(spanOf(b)!.spanId));
  const ids = new Set(spans.map(r => spanOf(r)!.spanId));
  const kids = new Map<string, ReplayRunLike[]>();
  const roots: ReplayRunLike[] = [];
  for (const r of spans) {
    const parent = spanOf(r)!.parentSpanId;
    if (parent && ids.has(parent)) (kids.get(parent) ?? kids.set(parent, []).get(parent)!).push(r);
    else roots.push(r);
  }
  let truncated = false;
  const pruned = (at: string, count: number): TraceNode => {
    truncated = true;
    return { id: `${at}#pruned`, label: `+${count} span${count === 1 ? "" : "s"}`, state: "pruned", failed: false, endpointId: null, durationMs: null, httpStatus: null, prunedCount: count, children: [] };
  };
  const visit = (r: ReplayRunLike, depth: number, orphan: boolean): TraceNode => {
    budget--;
    const s = spanOf(r)!;
    const endpointId = boundId(r);
    const state: TraceNodeState = s.clipped || orphan ? "clipped" : endpointId && endpointIds.has(endpointId) ? "pass" : "replay";
    const all = kids.get(s.spanId) ?? [];
    const children: TraceNode[] = [];
    if (all.length && depth + 1 >= maxDepth) children.push(pruned(s.spanId, all.reduce((n, c) => n + subtreeSize(spanOf(c)!.spanId, kids), 0)));
    else {
      let i = 0;
      for (; i < all.length && i < maxChildren && budget > 0; i++) children.push(visit(all[i]!, depth + 1, false));
      const rest = all.slice(i);
      if (rest.length) children.push(pruned(s.spanId, rest.reduce((n, c) => n + subtreeSize(spanOf(c)!.spanId, kids), 0)));
    }
    return { id: s.spanId, label: r.subject.displayName || s.spanName, state, failed: r.status === "failed", endpointId,
      durationMs: r.durationMs, httpStatus: s.httpStatus, prunedCount: 0, children };
  };
  const out: TraceNode[] = [];
  let i = 0;
  for (; i < roots.length && budget > 0; i++) out.push(visit(roots[i]!, 0, spanOf(roots[i]!)!.parentSpanId !== null));
  if (i < roots.length) out.push(pruned(traceId, roots.slice(i).reduce((n, r) => n + subtreeSize(spanOf(r)!.spanId, kids), 0)));
  return { roots: out, truncated };
}

/** Binding `endpoint-trace`: one replayed trace through the Location's endpoints (the slowest one unless `traceId` is given). */
export function collectEndpointTrace(location: NavLocation, graph: LineageGraphLike | null, locator: LineageLocator | null,
  batches: readonly ReplayBatchLike[], params: TraceParams = {}): TraceResult {
  const empty = (reason: string): TraceResult => ({ traceId: null, roots: [], holes: [{ reason, location }], origin: "static", synthetic: false, truncated: false });
  const runs = batches.flatMap(b => b.observations.filter(isRun)).filter(r => r.provider === "otel" && spanOf(r));
  if (!runs.length) return empty("No replayed traces: load an OpenTelemetry replay file to see a trace tree.");
  const allIds = graph ? new Set(staticEndpoints(graph).map(e => e.id)) : new Set<string>();
  const here = location.level === "project" || !graph || !locator ? allIds : new Set(staticEndpoints(graph, new Set(locator.nodesAt(location, graph))).map(e => e.id));
  let traceId = params.traceId ?? null;
  if (!traceId) {
    const candidates = runs.filter(r => location.level === "project" || (boundId(r) !== null && here.has(boundId(r)!)));
    const slowest = [...candidates].sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1) || a.runId.localeCompare(b.runId))[0];
    if (!slowest) return empty("No replayed trace reaches an endpoint at this location.");
    traceId = spanOf(slowest)!.traceId;
  }
  const { roots, truncated } = buildTraceTree(runs, traceId, allIds, params);
  if (!roots.length) return empty(`Trace ${traceId} is not in the replay files.`);
  const holes: NavHole[] = [];
  if (!graph) holes.push({ reason: "No lineage graph yet: spans cannot be matched to static endpoints, all show as replay." });
  const synthetic = batches.some(b => SYNTHETIC_ORIGINS.includes(b.origin) || b.dataClass === "synthetic");
  return { traceId, roots, holes, origin: "observed", synthetic, truncated };
}

// ---- catalog ----

/** Default views (catalog data: titles, params and presets are overridable via view overrides). */
export const ENDPOINTS_VIEW: ViewDef = {
  id: "endpoints", title: "Endpoints", layout: "table",
  bindings: [{ source: ENDPOINTS_SOURCE, params: { maxTraces: ENDPOINT_DEFAULTS.maxTraces } }],
  metrics: ["requests", "errorRate", "p50Ms", "p95Ms"],
  description: "API endpoints found in the code, with latency and errors when a trace replay is loaded.",
};
export const ENDPOINT_TRACE_VIEW: ViewDef = {
  id: "endpoint-trace", title: "Trace", layout: "graph",
  bindings: [{ source: ENDPOINT_TRACE_SOURCE, params: { maxDepth: TRACE_DEFAULTS.maxDepth, maxChildren: TRACE_DEFAULTS.maxChildren, maxNodes: TRACE_DEFAULTS.maxNodes } }],
  description: "One replayed request as a span tree: matched endpoints, replay-only calls, clipped and pruned spans.",
};
/** `*` rows at every level: an artifact with no endpoint gets the "none found" hole, never a guess. */
export const ENDPOINTS_PACK: ViewCatalog["entries"] = NAV_LEVELS.map(level => ({ artifactKind: "*", level, views: [ENDPOINTS_VIEW, ENDPOINT_TRACE_VIEW] }));
