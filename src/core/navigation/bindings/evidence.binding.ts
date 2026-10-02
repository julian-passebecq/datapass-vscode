/**
 * V4-NAV NAVDATA1 `evidence` binding: what DataPass knows about the current place, from existing project facts
 * (ProjectMap: declaration, readiness checklist, operations and their last recorded result, problems).
 * Declared facts are "static"; a recorded operation result is "observed". Nothing is run to get them.
 * Steps and operations inside an artifact come from other bindings (hole here).
 */
import type { ComponentView, ProjectMap } from "../../project/projectMap";
import type { BindingCard, BindingOrigin, BindingProvider, BindingResult, BindingRow } from "./index";

const ORIGIN = "static";

type Field = BindingCard["fields"][number];
const field = (label: string, value: string | number | undefined, origin: BindingOrigin = ORIGIN): Field[] =>
  value === undefined || value === "" ? [] : [{ label, value: String(value), origin }];

function artifactEvidence(c: ComponentView): BindingResult {
  const ready = c.checklist.filter(x => x.state === "done").length;
  const fields: Field[] = [
    ...field("Kind", c.kind), ...field("Status", c.status), ...field("Classification", c.classification),
    ...field("Owner", c.owner), ...field("Repository", c.repoKey), ...field("Health", c.headline),
    ...field("Checklist", c.checklist.length ? `${ready}/${c.checklist.length}` : undefined),
    ...field("Operations", c.operations.length || undefined), ...field("Next step", c.nextStep)
  ];
  const rows: BindingRow[] = [
    ...c.checklist.map(x => ({ id: x.key, label: x.label, origin: ORIGIN, type: "checklist", state: x.state })),
    ...c.operations.map(o => ({ id: o.key, label: o.label, origin: o.lastResult ? "observed" : ORIGIN, type: "operation",
      state: o.lastResult ? `${o.lastResult.result}${o.lastResult.stale ? " (stale)" : ""}` : o.result.status })),
    ...c.problems.map((p, i) => ({ id: `${c.id}#problem-${i}`, label: p, origin: ORIGIN, type: "problem", state: "open" }))
  ];
  return { cards: [{ title: c.label, fields }], rows, holes: [], origin: ORIGIN };
}

export const evidenceProvider: BindingProvider = {
  source: "evidence",
  provide({ location, projectMap }): BindingResult {
    if (!projectMap) return { holes: [{ reason: "No DataPass project is open.", kind: "no-project" }], origin: ORIGIN };
    const map: ProjectMap = projectMap;
    switch (location.level) {
      case "project": {
        const fields = [...field("Subprojects", map.subprojects.length), ...field("Components", map.components.length),
          ...field("Problems", map.problems.length)];
        return { cards: [{ title: map.project?.title ?? location.nodeId, fields }], holes: [], origin: ORIGIN };
      }
      case "subproject": {
        const s = map.subprojects.find(x => x.id === location.nodeId);
        if (!s) return { holes: [{ reason: `Unknown subproject "${location.nodeId}".`, kind: "out-of-scope" }], origin: ORIGIN };
        const fields = [...field("Objective", s.objective), ...field("Components", s.summary.components),
          ...field("Files", `${s.summary.filesFound}/${s.summary.filesExpected}`), ...field("Operations ready", `${s.summary.opsReady}/${s.summary.opsTotal}`),
          ...field("Health", s.health), ...field("Next step", s.nextStep)];
        return { cards: [{ title: s.title, fields }], holes: [], origin: ORIGIN };
      }
      case "artifact": {
        const c = map.components.find(x => x.id === location.nodeId);
        return c ? artifactEvidence(c) : { holes: [{ reason: `Unknown artifact "${location.nodeId}".`, kind: "out-of-scope" }], origin: ORIGIN };
      }
      default:
        return { holes: [{ reason: `Evidence below artifacts ("${location.level}") comes with the execution-unit binding.`, kind: "out-of-scope" }], origin: ORIGIN };
    }
  }
};

export default evidenceProvider;
