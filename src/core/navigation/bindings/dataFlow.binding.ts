/**
 * V4-NAV NAVLIN1 `data-flow` binding provider (NAVWIRE1 self-registration; TL ruling 1 Oct: NAVLIN1 owns it).
 * Thin adapter over the pure `collectDataFlow`; same context and locator as `lineage.binding.ts`.
 */
import { declaredRelations } from "./declaredRelations";
import { collectDataFlow, DATA_FLOW_SOURCE } from "./dataFlow";
import type { BindingGraph, BindingProvider, BindingResult, BindingRow } from "./index";
import { defaultLineageLocator, NO_LINEAGE_GRAPH, type LineageBindingContext } from "./lineage.binding";

export const dataFlowProvider: BindingProvider = {
  source: DATA_FLOW_SOURCE,
  provide(ctx: LineageBindingContext): BindingResult {
    if (!ctx.lineageGraph) return declaredRelations("data-flow", ctx, NO_LINEAGE_GRAPH);
    const r = collectDataFlow(ctx.lineageGraph, ctx.location, defaultLineageLocator);
    const rows: BindingRow[] = r.rows.map(x => ({ ...x, id: `${x.datasetId}:${x.access}:${x.byId}`, label: x.dataset, origin: x.origin }));
    // NAVFIX1 (review M2): the catalog's `data-flow` view is a graph, so the same flows also come as one (step → dataset written, dataset → step reading).
    const nodes = new Map<string, BindingGraph["nodes"][number]>();
    for (const x of r.rows) {
      nodes.set(x.datasetId, { id: x.datasetId, label: x.dataset, origin: x.origin, kind: "dataset" });
      if (!nodes.has(x.byId)) nodes.set(x.byId, { id: x.byId, label: x.by, origin: x.origin, kind: "task" });
    }
    const edges = r.rows.map(x => x.access === "write"
      ? { source: x.byId, target: x.datasetId, label: "writes", origin: x.origin }
      : { source: x.datasetId, target: x.byId, label: "reads", origin: x.origin });
    return { rows, graph: { nodes: [...nodes.values()], edges }, holes: r.holes, origin: r.origin };
  }
};

export default dataFlowProvider;
