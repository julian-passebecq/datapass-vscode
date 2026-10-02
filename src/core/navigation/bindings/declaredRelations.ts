/**
 * V4-NAV NAVDATA1 fallback for the NAVLIN1 `lineage` and `data-flow` providers (PM 31 ruling, 1 Oct): while the
 * BindingContext carries no lineage graph, both answer with the relations the project declares (manifest graph,
 * projected by the ProjectMap) around the current Location: every relation at the project, those touching the
 * subproject's components, an artifact's incoming and outgoing ones. `data-flow` keeps the data flows only.
 * Declared, not observed: § 34 origin "static". Steps and operations come from other bindings (typed holes here).
 */
import type { ProjectMap, RelationView } from "../../project/projectMap";
import type { NavLocation } from "../navTypes";
import type { BindingContext, BindingGraph, BindingResult, BindingRow } from "./index";

const ORIGIN = "static";

function relationsAt(map: ProjectMap, l: NavLocation): RelationView[] | string {
  switch (l.level) {
    case "project": return map.relations;
    case "subproject": {
      const sub = map.subprojects.find(s => s.id === l.nodeId);
      if (!sub) return `Unknown subproject "${l.nodeId}".`;
      const ids = new Set(sub.componentIds);
      return map.relations.filter(r => ids.has(r.source) || ids.has(r.target));
    }
    case "artifact": {
      const c = map.components.find(x => x.id === l.nodeId);
      if (!c) return `Unknown artifact "${l.nodeId}".`;
      return [...new Map([...c.incoming, ...c.outgoing].map(r => [r.id, r])).values()];
    }
    default: return `Relations stop at artifacts; "${l.level}" comes from the execution-unit binding.`;
  }
}

/** The declared relations for `lineage` / `data-flow` when no lineage graph is in the context. */
export function declaredRelations(source: "lineage" | "data-flow", ctx: BindingContext, noGraphReason: string): BindingResult {
  const { location, projectMap } = ctx;
  if (!projectMap) return { holes: [{ reason: `${noGraphReason} No DataPass project is open.`, kind: "no-project" }], origin: ORIGIN };
  const found = relationsAt(projectMap, location);
  if (typeof found === "string") return { holes: [{ reason: found, kind: "out-of-scope" }], origin: ORIGIN };
  const rels = source === "data-flow" ? found.filter(r => r.flow === "data") : found;
  const label = new Map(projectMap.components.map(c => [c.id, c.label]));
  const nodeIds = [...new Set(rels.flatMap(r => [r.source, r.target]))];
  const graph: BindingGraph = {
    nodes: nodeIds.map(id => ({ id, label: label.get(id) ?? id, origin: ORIGIN })),
    edges: rels.map(r => ({ source: r.source, target: r.target, label: r.relation, origin: ORIGIN }))
  };
  const rows: BindingRow[] = rels.map(r => ({ id: r.id, label: `${r.from} → ${r.to}`, origin: ORIGIN, relation: r.relation, flow: r.flow }));
  const holes = rows.length ? [] : [{ reason: source === "data-flow" ? "No data flow is declared here." : "No relation is declared here.", kind: "not-declared" }];
  return { rows, graph, holes, origin: ORIGIN };
}
