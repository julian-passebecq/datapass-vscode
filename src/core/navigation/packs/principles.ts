/**
 * V4-NAV NAVPRIN1 view pack: 'Principles' (detail-card list, project level) and 'Principles here' (artifact level,
 * cards filtered to the artifact). Each Location link dispatches `go`. Titles and descriptions are data:
 * user view overrides rename or hide them.
 */
import type { NavCommand, NavLocation, ViewCatalog, ViewDef } from "../navTypes";
import { PRINCIPLES_SOURCE } from "../bindings/principles";

export const PRINCIPLES_VIEW_ID = "principles";
export const PRINCIPLES_HERE_VIEW_ID = "principles-here";

export const PRINCIPLES_VIEW: ViewDef = {
  id: PRINCIPLES_VIEW_ID,
  title: "Principles",
  layout: "detail-card",
  bindings: [{ source: PRINCIPLES_SOURCE, params: { scope: "project" } }],
  description: "Data-engineering principles (DataPass guidance) and where this project applies or breaks them.",
};

export const PRINCIPLES_HERE_VIEW: ViewDef = {
  id: PRINCIPLES_HERE_VIEW_ID,
  title: "Principles here",
  layout: "detail-card",
  bindings: [{ source: PRINCIPLES_SOURCE, params: { scope: "location" } }],
  description: "The principles (DataPass guidance) this artifact applies or breaks.",
};

export const PRINCIPLES_PACK: ViewCatalog["entries"] = [
  { artifactKind: "*", level: "project", views: [PRINCIPLES_VIEW] },
  { artifactKind: "*", level: "artifact", views: [PRINCIPLES_HERE_VIEW] },
];

/** A Location link on a card. */
export function principleLinkCommand(location: NavLocation): NavCommand {
  return { type: "go", location };
}
