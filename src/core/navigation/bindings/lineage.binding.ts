/**
 * V4-NAV NAVLIN1 `lineage` binding provider (NAVWIRE1 self-registration; TL ruling 1 Oct:
 * NAVLIN1 owns `lineage` and `data-flow`; data-flow is dataFlow.binding.ts). Thin adapters over the pure `collectLineage` / `collectDataFlow`. The lineage
 * graph is not in the BindingContext yet: until NAVDATA1 adds `lineageGraph` to it, both fall back to the
 * relations the project declares (declaredRelations.ts, PM 31 ruling), or a typed hole, never a guess. Locator: the project = every node; below it, the nodes whose evidence sits at the nodeId path.
 */
import type { GraphView } from "@juliandatapass-group/view-spi";
import type { BindingContext, BindingProvider, BindingResult } from "./index";
import { declaredRelations } from "./declaredRelations";
import { DEFAULT_STYLE_PRESET, HOP_PROJECTION, projectGraph } from "@juliandatapass-group/view-spi";
import { collectLineage, LINEAGE_SOURCE, nodesByEvidencePath, type LineageGraphLike, type LineageLocator, type LineageParams, type LineageProjection } from "./lineage";

/** The context a lineage-aware host passes (NAVDATA1 adds `lineageGraph` to BindingContext). */
export type LineageBindingContext = BindingContext & { readonly lineageGraph?: LineageGraphLike | null };

export const defaultLineageLocator: LineageLocator = {
  nodesAt: (l, g) => (l.level === "project" ? g.nodes.map(n => n.id) : nodesByEvidencePath(g, l.nodeId))
};

/** NAVFIX1 (review H1): project the neighbourhood into a view-spi graph view, the shape the `graph` layout draws. */
export const LINEAGE_PROJECTION = { project: projectGraph, projection: HOP_PROJECTION, preset: DEFAULT_STYLE_PRESET } as unknown as LineageProjection;

export const NO_LINEAGE_GRAPH = "No lineage graph in the binding context yet (run an analysis).";

export const lineageProvider: BindingProvider = {
  source: LINEAGE_SOURCE,
  provide(ctx: LineageBindingContext): BindingResult {
    if (!ctx.lineageGraph) return declaredRelations("lineage", ctx, NO_LINEAGE_GRAPH);
    const r = collectLineage(ctx.lineageGraph, ctx.location, defaultLineageLocator, (ctx.params ?? {}) as LineageParams, { projection: LINEAGE_PROJECTION });
    if (!r.graph) return { holes: r.holes, origin: r.origin };
    return {
      // The projected view when view-spi accepted it; else the raw neighbourhood (the host converts it, graphView.ts).
      graph: (r.graph.view as GraphView | null) ?? {
        nodes: r.graph.nodes.map(n => ({ id: n.id, label: n.name, origin: n.origin })),
        edges: r.graph.edges.map(e => ({ source: e.fromId, target: e.toId, label: e.kind, origin: e.origin }))
      },
      holes: r.holes,
      origin: r.origin
    };
  }
};

export default lineageProvider;
