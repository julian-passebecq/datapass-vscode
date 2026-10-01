/**
 * NAVREN2 stub of NAVMAP1's `core/navigation/navPalette.ts` (same FNV-1a pick and "here" default, so colours match
 * the mini-map once it lands). Delete this file and import from `core/navigation/navPalette` when NAVMAP1 merges.
 */
const CHART_FALLBACK: Record<string, string> = { blue: "#1a85ff", orange: "#d18616", green: "#388a34", purple: "#652d90", yellow: "#bf8803", red: "#e51400" };
const CHARTS = ["blue", "orange", "green", "purple", "yellow", "red"].map(c => `var(--vscode-charts-${c}, ${CHART_FALLBACK[c]})`);

/** The "you are here" ring: red by default (Julian), overridable once NAVMAP1's settings exist. */
export const NAV_HERE_DEFAULT = "var(--vscode-charts-red, #e51400)";

export function navColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return CHARTS[(h >>> 0) % CHARTS.length]!;
}
