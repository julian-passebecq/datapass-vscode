/**
 * V1.1.x-POLISH-3 (Julian's check of rc.1: "je tombe toujours sur IA"): a rail button unfolds the
 * view it names *alone*. Before, every button unfolded the whole right-side stack (AI first, then
 * Claude & Codex, Details, Airflow DAG), so the AI view was what he saw whichever button he pressed.
 *
 * VS Code gives extensions no API to collapse another view of a container, so the other views are
 * hidden by `when` clauses: one context key per view (`datapass.rail.hide.<view>`), plus
 * `datapass.rail.solo` while one view shows alone. "Expand" (rail button, or the solo view's title
 * button) brings the full panel back. Pure (no `vscode`).
 */

/** The views of the DataPass secondary side bar that the rail folds and unfolds. */
export const RAIL_PANEL_VIEWS = ["aiExchange", "agentPanel", "details", "airflowDag"] as const;
export type RailPanelView = typeof RAIL_PANEL_VIEWS[number];

export const SOLO_CONTEXT_KEY = "datapass.rail.solo";
export const soloHideKey = (view: RailPanelView): string => `datapass.rail.hide.${view}`;
/** What each panel view's `when` clause ends with (checked by the tests against package.json). */
export const soloWhenSuffix = (view: RailPanelView): string => ` && !${soloHideKey(view)}`;

/** The view a rail button unfolds alone ("expand" unfolds the full panel). */
export const RAIL_BUTTON_VIEW: Readonly<Record<string, RailPanelView>> = { details: "details", ai: "aiExchange", airflow: "airflowDag" };

/** The context keys for one view shown alone, or for the full panel (`solo` undefined). */
export function soloContext(solo?: RailPanelView): Record<string, boolean> {
  const keys: Record<string, boolean> = { [SOLO_CONTEXT_KEY]: solo !== undefined };
  for (const v of RAIL_PANEL_VIEWS) keys[soloHideKey(v)] = solo !== undefined && v !== solo;
  return keys;
}
