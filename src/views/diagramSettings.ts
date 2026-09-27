/**
 * V1-UI-POLISH: the architecture diagram's reading levels, each one switchable (settings
 * `datapass.diagram.*`, read live: a change re-renders the diagram without a reload). Pure (no `vscode`).
 */
export const LEGEND_POSITIONS = ["bottom-left", "bottom-right", "top-left", "top-right", "hidden"] as const;
export type LegendPosition = typeof LEGEND_POSITIONS[number];

export interface DiagramSettings {
  /** Left band: DataPass state (an operation ready, none ready, no operation). */
  stateBand: boolean;
  /** Top edge: capability state (available, prepared/planned, choice only, unverified, blocked). */
  capabilityEdge: boolean;
  /** Bottom line: client step state, only where recorded results exist. */
  clientStepLine: boolean;
  legend: boolean;
  legendPosition: LegendPosition;
}

export const DIAGRAM_SETTING_DEFAULTS: Readonly<DiagramSettings> = { stateBand: true, capabilityEdge: true, clientStepLine: true, legend: true, legendPosition: "bottom-left" };

/** Reads the settings through `get` (the `datapass.diagram` section); a wrong type or value falls back to the default. */
export function readDiagramSettings(get: (key: keyof DiagramSettings) => unknown): DiagramSettings {
  const bool = (k: "stateBand" | "capabilityEdge" | "clientStepLine" | "legend") => { const v = get(k); return typeof v === "boolean" ? v : DIAGRAM_SETTING_DEFAULTS[k]; };
  const pos = get("legendPosition");
  return {
    stateBand: bool("stateBand"), capabilityEdge: bool("capabilityEdge"), clientStepLine: bool("clientStepLine"), legend: bool("legend"),
    legendPosition: (LEGEND_POSITIONS as readonly unknown[]).includes(pos) ? pos as LegendPosition : DIAGRAM_SETTING_DEFAULTS.legendPosition
  };
}
