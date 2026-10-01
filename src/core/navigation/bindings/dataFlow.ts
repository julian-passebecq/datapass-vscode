/**
 * V4-NAV NAVLIN1 binding `data-flow`: where data flows, when and by which process, as a table
 * (dataset · read/written by · process/job · schedule · origin), from the one lineage graph. Project
 * level = every dataset; a lower Location = the datasets its own nodes read or write (or are). An
 * unknown process or schedule stays empty and is listed as a hole, never guessed. Pure.
 */
import { NAV_LEVELS, type NavLocation, type ViewCatalog, type ViewDef } from "../navTypes";
import type { NavOrigin } from "./origin";
import {
  LINEAGE_GRAPH_SCHEMA, LINEAGE_TO_NAV_ORIGIN, weakestOrigin,
  type LineageEdgeLike, type LineageGraphLike, type LineageLocator, type LineageNodeLike, type LineageOrigin,
} from "./lineage";

export const DATA_FLOW_SOURCE = "data-flow";
export const MAX_DATA_FLOW_ROWS = 1000;
/** Node kinds that hold data (rows are keyed on them). */
export const DATA_NODE_KINDS: readonly string[] = ["dataset", "topic", "api-endpoint"];
/** Node kinds that can be the process running a read / write. */
export const PROCESS_NODE_KINDS: readonly string[] = ["job", "dbt-model", "ml-model"];

export interface DataFlowRow {
  readonly datasetId: string;
  readonly dataset: string;
  readonly access: "read" | "write";
  /** The step/task/model that reads or writes. */
  readonly byId: string;
  readonly by: string;
  /** The job/process it belongs to; null = unknown (hole). */
  readonly processId: string | null;
  readonly process: string | null;
  /** Cron or ISO 8601 duration from the edge volumetry; null = unknown (hole). */
  readonly schedule: string | null;
  readonly scheduleOrigin: NavOrigin | null;
  readonly origin: NavOrigin;
}

export interface DataFlowResult {
  readonly rows: readonly DataFlowRow[];
  readonly holes: readonly { reason: string }[];
  readonly origin: NavOrigin;
  readonly total: number;
  readonly truncated: boolean;
}

const BASIS_ORIGIN: Readonly<Record<"observed" | "theoretical" | "ai-proposed", NavOrigin>> = { observed: "observed", theoretical: "theoretical", "ai-proposed": "ai-proposed" };

export function collectDataFlow(graph: LineageGraphLike | null | undefined, location: NavLocation, locator: LineageLocator,
  opts: { max?: number; originMap?: Readonly<Record<LineageOrigin, NavOrigin>> } = {}): DataFlowResult {
  if (!graph || graph.schema !== LINEAGE_GRAPH_SCHEMA) {
    return { rows: [], holes: [{ reason: "No lineage graph for this project yet (run an analysis)." }], origin: "static", total: 0, truncated: false };
  }
  const originOf = (o: LineageOrigin) => (opts.originMap ?? LINEAGE_TO_NAV_ORIGIN)[o] ?? "static";
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const top = (n: LineageNodeLike) => { const seen = new Set<string>(); while (n.parentId && byId.has(n.parentId) && !seen.has(n.id)) { seen.add(n.id); n = byId.get(n.parentId)!; } return n; };
  const isData = (n: LineageNodeLike) => DATA_NODE_KINDS.includes(n.kind);

  // Process of a node: itself when it is a process kind, else the job that orchestrates it, else a process ancestor.
  const orchestrator = new Map<string, string>();
  for (const e of graph.edges) if (e.kind === "orchestrates" && byId.has(e.fromId) && PROCESS_NODE_KINDS.includes(byId.get(e.fromId)!.kind) && !orchestrator.has(e.toId)) orchestrator.set(e.toId, e.fromId);
  const processOf = (n: LineageNodeLike): LineageNodeLike | null => {
    const seen = new Set<string>();
    for (let c: LineageNodeLike | undefined = n; c && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : undefined) {
      seen.add(c.id);
      if (PROCESS_NODE_KINDS.includes(c.kind)) return c;
      const o = orchestrator.get(c.id); if (o) return byId.get(o)!;
    }
    return null;
  };

  const flow = graph.edges.filter((e): e is LineageEdgeLike & { kind: "reads" | "writes" } => (e.kind === "reads" || e.kind === "writes") && byId.has(e.fromId) && byId.has(e.toId));
  const isProject = location.level === "project";
  let scope: Set<string> | null = null;
  if (!isProject) {
    const own = new Set(locator.nodesAt(location, graph).filter(id => byId.has(id)));
    if (!own.size) return { rows: [], holes: [{ reason: "No lineage node is known for this location." }], origin: "static", total: 0, truncated: false };
    scope = new Set<string>();
    for (const id of own) { const t = top(byId.get(id)!); if (isData(t)) scope.add(t.id); }
    for (const e of flow) {
      const [dataId, actorId] = e.kind === "reads" ? [e.fromId, e.toId] : [e.toId, e.fromId];
      if (own.has(actorId) || own.has(dataId)) { const t = top(byId.get(dataId)!); if (isData(t)) scope.add(t.id); }
    }
  }

  const rows: DataFlowRow[] = []; const seen = new Set<string>();
  for (const e of flow) {
    const access = e.kind === "reads" ? "read" : "write";
    const data = top(byId.get(access === "read" ? e.fromId : e.toId)!);
    const actor = top(byId.get(access === "read" ? e.toId : e.fromId)!);
    if (!isData(data) || isData(actor) || (scope && !scope.has(data.id))) continue;
    const key = `${data.id}|${access}|${actor.id}`;
    if (seen.has(key)) continue; seen.add(key);
    const proc = processOf(actor);
    const freq = e.volumetry?.frequency ?? null;
    rows.push({
      datasetId: data.id, dataset: data.name, access, byId: actor.id, by: actor.name,
      processId: proc?.id ?? null, process: proc?.name ?? null,
      schedule: freq, scheduleOrigin: freq && e.volumetry ? BASIS_ORIGIN[e.volumetry.basis] : null,
      origin: originOf(e.origin),
    });
  }
  rows.sort((a, b) => a.dataset.localeCompare(b.dataset) || (a.access === b.access ? 0 : a.access === "write" ? -1 : 1) || a.by.localeCompare(b.by) || a.byId.localeCompare(b.byId));

  const holes: { reason: string }[] = [];
  if (!rows.length) holes.push({ reason: "No dataset is read or written here yet, as far as DataPass knows." });
  const noProc = rows.filter(r => !r.processId).length, noSched = rows.filter(r => !r.schedule).length;
  if (noProc) holes.push({ reason: `${noProc} flow(s) with an unknown process or job.` });
  if (noSched) holes.push({ reason: `${noSched} flow(s) with an unknown schedule.` });
  const max = Math.max(1, opts.max ?? MAX_DATA_FLOW_ROWS);
  const truncated = rows.length > max;
  if (truncated) holes.push({ reason: `Showing ${max} of ${rows.length} flows.` });
  return { rows: rows.slice(0, max), holes, origin: weakestOrigin(rows.map(r => r.origin)), total: rows.length, truncated };
}

/** Default `data-flow` view (catalog data; titles and columns overridable). */
export const DATA_FLOW_VIEW: ViewDef = {
  id: "data-flow", title: "Data flow", layout: "table",
  bindings: [{ source: DATA_FLOW_SOURCE, params: { columns: ["dataset", "access", "by", "process", "schedule", "origin"] } }],
  description: "Which datasets are read or written here, by which process, and when.",
};
/** Default column labels (data; a setting may replace any of them). */
export const DATA_FLOW_LABELS: Readonly<Record<string, string>> = {
  dataset: "Dataset", access: "Read / written", by: "By", process: "Process / job", schedule: "Schedule", origin: "Origin",
  read: "read by", write: "written by", unknown: "unknown",
};
export const DATA_FLOW_PACK: ViewCatalog["entries"] = NAV_LEVELS.map(level => ({ artifactKind: "*", level, views: [DATA_FLOW_VIEW] }));
