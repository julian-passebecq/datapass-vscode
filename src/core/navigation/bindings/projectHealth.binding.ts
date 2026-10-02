/**
 * V4-NAV NAVHOME1 `project-health` binding provider (NAVWIRE1 self-registration): a thin adapter over the pure
 * `projectHealth`. `params.part` picks the dashboard part: `metrics` (tiles), `recent` (git log) or `awaiting`.
 * Only the project map is in the BindingContext today; drift, pull requests, board, approvals, git user and the
 * recent git log come with NAVDATA1 (`healthFacts`). Until then their tiles are "unknown" with typed holes.
 */
import type { BindingContext, BindingMetric, BindingProvider, BindingResult, BindingRow } from "./index";
import { isDashboardLocation, PROJECT_HEALTH_SOURCE, projectHealth, type ProjectHealthFacts } from "./projectHealth";

/** The context a dashboard-aware host passes (NAVDATA1 adds `healthFacts` to BindingContext). */
export type ProjectHealthBindingContext = BindingContext & {
  readonly healthFacts?: Omit<ProjectHealthFacts, "map">;
  /** `datapass.nav.dashboardTiles`. */
  readonly dashboardTiles?: readonly string[];
};

export const projectHealthProvider: BindingProvider = {
  source: PROJECT_HEALTH_SOURCE,
  provide(ctx: ProjectHealthBindingContext): BindingResult {
    if (!isDashboardLocation(ctx.location)) return { holes: [{ reason: "The project dashboard is shown at the project level only." }], origin: "static" };
    const r = projectHealth({ ...(ctx.healthFacts ?? {}), ...(ctx.projectMap ? { map: ctx.projectMap } : {}) },
      ctx.dashboardTiles ? { tiles: ctx.dashboardTiles } : {});
    switch (ctx.params?.part) {
      case "recent": {
        const rows: BindingRow[] = r.recent.map(c => ({ ...c, id: `${c.repoKey}:${c.sha}`, label: c.subject }));
        return { rows, holes: r.holes.filter(h => h.reason.startsWith("recent")), origin: r.origin };
      }
      case "awaiting": {
        const rows: BindingRow[] = r.awaiting.map(a => ({ ...a, id: `${a.kind}:${a.id}`, label: a.text }));
        return { rows, holes: r.holes.filter(h => h.reason.startsWith("reviews")), origin: r.origin };
      }
      default: {
        const metrics: BindingMetric[] = r.metrics.map(t => ({ ...t, label: t.title }));
        return { metrics, holes: r.holes, origin: r.origin };
      }
    }
  }
};

export default projectHealthProvider;
