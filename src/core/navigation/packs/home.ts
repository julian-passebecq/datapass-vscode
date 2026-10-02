/**
 * V4-NAV NAVHOME1 view pack `home`: the project-level dashboard views. Titles and the tile set are
 * data (catalog entries, user overrides, setting `datapass.nav.dashboardTiles`), never hard-coded in a renderer.
 */
import type { ViewCatalog, ViewDef } from "../navTypes";
import { DEFAULT_DASHBOARD_TILES, PROJECT_HEALTH_SOURCE } from "../bindings/projectHealth";

export const HOME_PACK_VIEWS: readonly ViewDef[] = [
  { id: "dashboard", title: "Dashboard", layout: "metrics", bindings: [{ source: PROJECT_HEALTH_SOURCE, params: { part: "metrics" } }],
    metrics: DEFAULT_DASHBOARD_TILES, description: "Project health at one glance; a tile opens the filtered view." },
  { id: "recent-changes", title: "Recent changes", layout: "table", bindings: [{ source: PROJECT_HEALTH_SOURCE, params: { part: "recent" } }],
    description: "Latest local commits per repository (read-only git log, bounded)." },
  { id: "awaiting-you", title: "Awaiting you", layout: "table", bindings: [{ source: PROJECT_HEALTH_SOURCE, params: { part: "awaiting" } }],
    description: "Review items, approvals and board items assigned to the local git user." }
];

export const HOME_PACK: ViewCatalog["entries"] = [{ artifactKind: "project", level: "project", views: HOME_PACK_VIEWS }];
