/**
 * V4-NAV `project-map` binding: the static project map at the current Location — the project's
 * subprojects, a subproject's components, an artifact's card. Static only (§ 34 origin "static");
 * finer levels (step, operation) belong to other providers and come back as holes.
 */
import type { BindingProvider, BindingResult, BindingRow } from "./index";

const ORIGIN = "static";

export const projectMapProvider: BindingProvider = {
  source: "project-map",
  provide({ location, projectMap }): BindingResult {
    if (!projectMap) return { holes: [{ reason: "No DataPass project is open." }], origin: ORIGIN };
    switch (location.level) {
      case "project": {
        const rows: BindingRow[] = projectMap.subprojects.map(s => ({
          id: s.id, label: s.title, origin: ORIGIN, health: s.health, components: s.summary.components, nextStep: s.nextStep
        }));
        return { rows, holes: rows.length ? [] : [{ reason: "The project declares no subproject." }], origin: ORIGIN };
      }
      case "subproject": {
        const sub = projectMap.subprojects.find(s => s.id === location.nodeId);
        if (!sub) return { holes: [{ reason: `Unknown subproject "${location.nodeId}".` }], origin: ORIGIN };
        const ids = new Set(sub.componentIds);
        const rows: BindingRow[] = projectMap.components.filter(c => ids.has(c.id)).map(c => ({
          id: c.id, label: c.label, origin: ORIGIN, kind: c.kind, health: c.health, nextStep: c.nextStep
        }));
        return { rows, holes: rows.length ? [] : [{ reason: `"${sub.title}" has no component.` }], origin: ORIGIN };
      }
      case "artifact": {
        const c = projectMap.components.find(x => x.id === location.nodeId);
        if (!c) return { holes: [{ reason: `Unknown artifact "${location.nodeId}".` }], origin: ORIGIN };
        const fields = [
          { label: "Kind", value: c.kind },
          ...(c.description ? [{ label: "Description", value: c.description }] : []),
          ...(c.repoKey ? [{ label: "Repository", value: c.repoKey }] : []),
          ...(c.owner ? [{ label: "Owner", value: c.owner }] : []),
          { label: "Health", value: c.headline },
          { label: "Next step", value: c.nextStep }
        ].map(f => ({ ...f, origin: ORIGIN }));
        const rows: BindingRow[] = [...c.incoming, ...c.outgoing].map(r => ({ id: r.id, label: `${r.from} → ${r.to}`, origin: ORIGIN, relation: r.relation, flow: r.flow }));
        return { cards: [{ title: c.label, fields }], rows, holes: [], origin: ORIGIN };
      }
      default:
        return { holes: [{ reason: `The project map stops at artifacts; "${location.level}" comes from another binding.` }], origin: ORIGIN };
    }
  }
};

export default projectMapProvider;
