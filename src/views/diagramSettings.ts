/**
 * V1-UI-POLISH: the architecture diagram's reading levels, each one switchable (settings
 * `datapass.diagram.*`, read live: a change re-renders the diagram without a reload). Pure (no `vscode`).
 */
import { overlayOverrides, type OverlayHue } from "../webview/overlayPalette";

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
  /** V3-THEME: "microsoft" = Fluent light/dark surfaces following the theme kind; "vscode" = the theme's own colours. */
  theme: DiagramTheme;
  /** V3-THEME: `datapass.overlay.enabled` — false hides every DataPass state mark (band, edge, line, symbols, dots). */
  overlay: boolean;
  /** V3-THEME: `datapass.overlay.colors` — valid `#rrggbb` overrides of the overlay hues. */
  overlayColors: Partial<Record<OverlayHue, string>>;
}

export const DIAGRAM_THEMES_SETTING = ["microsoft", "vscode"] as const;
export type DiagramTheme = typeof DIAGRAM_THEMES_SETTING[number];

export const DIAGRAM_SETTING_DEFAULTS: Readonly<DiagramSettings> = { stateBand: true, capabilityEdge: true, clientStepLine: true, legend: true, legendPosition: "bottom-left", theme: "microsoft", overlay: true, overlayColors: {} };

/** Which DataPass state marks the diagram draws: none at all when the overlay is off (V3-THEME). */
export function overlayMarks(ds: DiagramSettings, hasRecordedResults: boolean): { band: boolean; edge: boolean; stepLine: boolean; symbols: boolean; tooltip: boolean } {
  const on = ds.overlay;
  return { band: on && ds.stateBand, edge: on && ds.capabilityEdge, stepLine: on && ds.clientStepLine && hasRecordedResults, symbols: on && ds.capabilityEdge, tooltip: on };
}

/** Reads the settings through `get` (the `datapass.diagram` section) and `overlay` (the `datapass.overlay` section); a wrong type or value falls back to the default. */
export function readDiagramSettings(get: (key: string) => unknown, overlay: (key: "enabled" | "colors") => unknown = () => undefined): DiagramSettings {
  const bool = (k: "stateBand" | "capabilityEdge" | "clientStepLine" | "legend") => { const v = get(k); return typeof v === "boolean" ? v : DIAGRAM_SETTING_DEFAULTS[k]; };
  const pos = get("legendPosition");
  const theme = get("theme");
  const enabled = overlay("enabled");
  return {
    theme: (DIAGRAM_THEMES_SETTING as readonly unknown[]).includes(theme) ? theme as DiagramTheme : DIAGRAM_SETTING_DEFAULTS.theme,
    overlay: typeof enabled === "boolean" ? enabled : true,
    overlayColors: overlayOverrides(overlay("colors")),
    stateBand: bool("stateBand"), capabilityEdge: bool("capabilityEdge"), clientStepLine: bool("clientStepLine"), legend: bool("legend"),
    legendPosition: (LEGEND_POSITIONS as readonly unknown[]).includes(pos) ? pos as LegendPosition : DIAGRAM_SETTING_DEFAULTS.legendPosition
  };
}
