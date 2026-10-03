/**
 * DAGUX1: where the Airflow DAG view lives and which way it is drawn — both settings
 * (`datapass.airflow.dagPlacement`, `datapass.airflow.dagLayout`). Pure (no `vscode`).
 */
export const DAG_PLACEMENTS = ["sidebar", "panel", "editor"] as const;
export type DagPlacement = typeof DAG_PLACEMENTS[number];

export const DAG_LAYOUTS = ["top-down", "left-right"] as const;
export type DagLayoutSetting = typeof DAG_LAYOUTS[number];

/** The view's drawing direction (V3-AIRFLOW's state field). */
export type DagDirection = "down" | "right";

export function placementOf(v: unknown): DagPlacement {
  return DAG_PLACEMENTS.includes(v as DagPlacement) ? v as DagPlacement : "sidebar";
}

/** The setting's layout; with no explicit setting, the direction chosen before DAGUX1 (kept in the global state). */
export function directionOf(setting: unknown, legacy?: unknown): DagDirection {
  if (setting === "left-right") return "right";
  if (setting === "top-down") return "down";
  return legacy === "right" ? "right" : "down";
}

export function layoutSettingOf(direction: DagDirection): DagLayoutSetting {
  return direction === "right" ? "left-right" : "top-down";
}

/** The toolbar toggle: the other layout. */
export function toggledLayout(direction: DagDirection): DagLayoutSetting {
  return layoutSettingOf(direction === "right" ? "down" : "right");
}

/** Plain-words names of the placements (Quick Pick, messages). */
export const PLACEMENT_LABELS: Record<DagPlacement, string> = {
  sidebar: "Secondary side bar",
  panel: "Bottom panel",
  editor: "Editor tab"
};
