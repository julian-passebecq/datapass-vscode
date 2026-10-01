/**
 * V4-NAV NAVLIN1 `data-flow` binding provider (NAVWIRE1 self-registration; TL ruling 1 Oct: NAVLIN1 owns it).
 * Thin adapter over the pure `collectDataFlow`; same context and locator as `lineage.binding.ts`.
 */
import { collectDataFlow, DATA_FLOW_SOURCE } from "./dataFlow";
import type { BindingProvider, BindingResult, BindingRow } from "./index";
import { defaultLineageLocator, NO_LINEAGE_GRAPH, type LineageBindingContext } from "./lineage.binding";

export const dataFlowProvider: BindingProvider = {
  source: DATA_FLOW_SOURCE,
  provide(ctx: LineageBindingContext): BindingResult {
    if (!ctx.lineageGraph) return { holes: [{ reason: NO_LINEAGE_GRAPH }], origin: "static" };
    const r = collectDataFlow(ctx.lineageGraph, ctx.location, defaultLineageLocator);
    const rows: BindingRow[] = r.rows.map(x => ({ ...x, id: `${x.datasetId}:${x.access}:${x.byId}`, label: x.dataset, origin: x.origin }));
    return { rows, holes: r.holes, origin: r.origin };
  }
};

export default dataFlowProvider;
