/**
 * V4-NAV NAVERD1 `schema-erd` binding provider (NAVWIRE1 self-registration): a thin adapter over the pure
 * `schemaErd`. SQL syntax facts and semantic relationships are not in the BindingContext yet: until NAVDATA1 adds
 * `sqlFacts` / `semanticRelationships`, `schemaErd` itself returns its typed `missing-fact` hole, never a guess.
 * The graph is the ERD graph (`kind: "erd"`, tables, keyed edges) that the `erd` layout reads, with the generic
 * BindingGraph fields (nodes, edge source/target) on the same objects so other layouts can still draw it.
 */
import type { BindingContext, BindingGraph, BindingProvider, BindingResult } from "./index";
import { SCHEMA_ERD_SOURCE, schemaErd, type SemanticRelationshipFact } from "./schemaErd";

/** The context an ERD-aware host passes (NAVDATA1 adds these facts to BindingContext). */
export type SchemaErdBindingContext = BindingContext & {
  readonly sqlFacts?: readonly unknown[];
  readonly semanticRelationships?: readonly SemanticRelationshipFact[];
};

export const schemaErdProvider: BindingProvider = {
  source: SCHEMA_ERD_SOURCE,
  provide(ctx: SchemaErdBindingContext): BindingResult {
    const kind = typeof ctx.params?.artifactKind === "string" ? ctx.params.artifactKind : ctx.location.artifactKind;
    const r = schemaErd({
      artifactKind: kind,
      ...(ctx.sqlFacts ? { sqlFacts: ctx.sqlFacts } : {}),
      ...(ctx.semanticRelationships ? { semanticRelationships: ctx.semanticRelationships } : {})
    });
    const graph: BindingGraph & typeof r.graph = {
      ...r.graph,
      nodes: r.graph.tables.map(t => ({ id: t.id, label: t.name, origin: t.origin })),
      edges: r.graph.edges.map(e => ({ ...e, source: e.from, target: e.to, ...(e.name ? { label: e.name } : {}) }))
    };
    return { graph, holes: r.holes, origin: r.origin };
  }
};

export default schemaErdProvider;
