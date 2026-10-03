/**
 * V4-NAV NAVCHG1 built-in pack `changes`: the review views of one Git change, at project and artifact levels
 * (an artifact sees only its own files). Titles, order and visibility are catalog data, overridable by the
 * user's `datapass.view-overrides/1`. Pure.
 */
import type { ViewCatalog, ViewDef } from "../navTypes";
import { CHANGE_SUMMARY_SOURCE } from "../bindings/changeSummary.binding";

export const CHANGE_VIEWS: readonly ViewDef[] = [
  { id: "change-summary", title: "Change summary", layout: "detail-card", bindings: [{ source: CHANGE_SUMMARY_SOURCE, params: { part: "summary" } }],
    description: "The open change: counts by status and kind, and the AI's assumptions and expectations when it wrote them." },
  { id: "change-impact", title: "Change impact", layout: "graph", bindings: [{ source: CHANGE_SUMMARY_SOURCE, params: { part: "impact" } }],
    description: "New, modified and removed nodes of the open change, and what they reach downstream." },
  { id: "change-files", title: "Changed files", layout: "table", bindings: [{ source: CHANGE_SUMMARY_SOURCE, params: { part: "files" } }],
    description: "One row per changed file; open its diff read-only." }
];

export const CHANGES_PACK: ViewCatalog["entries"] = (["project", "artifact"] as const).map(level => ({ artifactKind: "*", level, views: CHANGE_VIEWS }));
export default CHANGES_PACK;
