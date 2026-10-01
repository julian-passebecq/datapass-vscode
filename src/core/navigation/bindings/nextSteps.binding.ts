/**
 * V4-NAV NAVTODO1 `next-steps` binding provider (NAVWIRE1 self-registration): a thin adapter over the pure
 * `collectNextSteps`. It reads the project map from the BindingContext and scopes the rows to the Location's
 * subtree (project ladder). Readiness, board and missing evidence are not in the BindingContext yet: they are
 * a typed hole until NAVDATA1 extends the context, never guessed.
 */
import { componentLocation, projectLadder, projectLocation, subprojectLocation } from "../projectLadder";
import type { BindingProvider, BindingResult, BindingRow } from "./index";
import { collectNextSteps, locationKey, NEXT_STEPS_SOURCE } from "./nextSteps";

export const nextStepsProvider: BindingProvider = {
  source: NEXT_STEPS_SOURCE,
  provide({ location, projectMap }): BindingResult {
    if (!projectMap) return { holes: [{ reason: "No DataPass project is open." }], origin: "static" };
    const root = projectLocation(projectMap);
    const r = collectNextSteps({ map: projectMap }, { root, component: componentLocation, subproject: subprojectLocation },
      { scope: location, ladder: projectLadder(() => projectMap) });
    const rows: BindingRow[] = r.rows.map((row, i) => ({
      id: `${locationKey(row.location)}#${i}`, label: row.text, origin: row.origin,
      kind: row.kind, severity: row.severity, step: row.step, location: row.location, ...(row.viewId ? { viewId: row.viewId } : {})
    }));
    const holes = [
      ...r.holes,
      { reason: "Readiness, board and evidence items are not in the binding context yet." },
      ...(r.truncated ? [{ reason: `Showing ${r.rows.length} of ${r.total} items.` }] : [])
    ];
    return { rows, holes, origin: r.origin };
  }
};

export default nextStepsProvider;
