/**
 * V4-NAV NAVMAP1: one deterministic colour per node / table id, shared by the mini-map, the code-steps and the graph
 * kinds. Pure (no `vscode`). Colours are CSS values built on theme tokens (`var(--vscode-charts-*)` or the DataPass
 * overlay `var(--dp-*)`), so they follow light, dark and high-contrast themes; the preset and per-id assignments are
 * settings (`datapass.navigator.palette`, `.paletteColors`, `.paletteAssign`, `.hereColor`), never hard-coded in a view.
 */

const CHART_FALLBACK: Record<string, string> = { blue: "#1a85ff", orange: "#d18616", green: "#388a34", purple: "#652d90", yellow: "#bf8803", red: "#e51400" };

/** Built-in presets: theme tokens with a fallback for hosts that do not define them. */
export const NAV_PALETTE_PRESETS: Readonly<Record<"charts" | "overlay", readonly string[]>> = {
  charts: ["blue", "orange", "green", "purple", "yellow", "red"].map(c => `var(--vscode-charts-${c}, ${CHART_FALLBACK[c]})`),
  overlay: ["blue", "violet", "green", "orange", "rose", "muted"].map(h => `var(--dp-${h})`)
};
export type NavPalettePreset = keyof typeof NAV_PALETTE_PRESETS | "custom";
export const NAV_PALETTE_PRESET_IDS: readonly NavPalettePreset[] = ["charts", "overlay", "custom"];

/** The "you are here" ring: red by default (Julian), overridable. */
export const NAV_HERE_DEFAULT = "var(--vscode-charts-red, #e51400)";

export interface NavPalette {
  readonly preset: NavPalettePreset;
  readonly colors: readonly string[];
  /** Pinned colours for given ids (`#rrggbb`), checked before the hash. */
  readonly assign: Readonly<Record<string, string>>;
  readonly here: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hexes = (raw: unknown): string[] => Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && HEX.test(v)).map(v => v.toLowerCase()) : [];

/** Reads the palette settings (`get` = the `datapass.navigator` section); invalid values fall back to the defaults. */
export function readNavPalette(get: (key: "palette" | "paletteColors" | "paletteAssign" | "hereColor") => unknown): NavPalette {
  const p = get("palette");
  const custom = hexes(get("paletteColors"));
  let preset: NavPalettePreset = typeof p === "string" && (NAV_PALETTE_PRESET_IDS as readonly string[]).includes(p) ? p as NavPalettePreset : "charts";
  if (preset === "custom" && custom.length === 0) preset = "charts";
  const colors = preset === "custom" ? custom : NAV_PALETTE_PRESETS[preset];
  const assign: Record<string, string> = {};
  const a = get("paletteAssign");
  if (a && typeof a === "object" && !Array.isArray(a)) {
    for (const [id, v] of Object.entries(a as Record<string, unknown>)) if (typeof v === "string" && HEX.test(v)) assign[id] = v.toLowerCase();
  }
  const h = get("hereColor");
  return { preset, colors, assign, here: typeof h === "string" && HEX.test(h) ? h.toLowerCase() : NAV_HERE_DEFAULT };
}

export const NAV_PALETTE_DEFAULT: NavPalette = readNavPalette(() => undefined);

/** FNV-1a 32-bit: stable across sessions, hosts and platforms. */
export function navHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The colour of a node / table id: its pinned colour, else a stable pick from the preset. */
export function navColor(id: string, palette: NavPalette = NAV_PALETTE_DEFAULT): string {
  return palette.assign[id] ?? palette.colors[navHash(id) % palette.colors.length]!;
}
