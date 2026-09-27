/**
 * V3-THEME: the DataPass overlay palette, the Microsoft-style diagram surfaces and a WCAG contrast helper.
 * Pure and small (no icons), so the extension side (the webview HTML shell, the settings reader) can use it.
 */
// ------------------------------------------------------------------ V3-THEME: the DataPass overlay palette

/**
 * The DataPass overlay has its own hues, distinct from the provider colours (diagramLook.ts) and from VS Code's own
 * pass / warning / error colours: electric blue, violet, green, orange, and a rose for "blocked". They are
 * used ONLY for DataPass states (left band, top edge, bottom line and their symbols), never for a provider.
 * Two tones per hue: a deep one for light themes, a light fluorescent one for dark themes, each readable as
 * text (≥ 4.5:1) on the Microsoft light and dark backgrounds (tests/overlayTheme.test.ts).
 */
export const OVERLAY_HUES = ["blue", "violet", "green", "orange", "rose", "muted"] as const;
export type OverlayHue = typeof OVERLAY_HUES[number];
export type ThemeKind = "light" | "dark" | "hc-light" | "hc-dark";

export const OVERLAY_PALETTE: Record<"light" | "dark", Record<OverlayHue, string>> = {
  light: { blue: "#0047ff", violet: "#7a2be2", green: "#0b7a3e", orange: "#b04c00", rose: "#c4124f", muted: "#646c75" },
  dark: { blue: "#3fd0ff", violet: "#c9a2ff", green: "#5ee8a0", orange: "#ffae5c", rose: "#ff7aa3", muted: "#a0a8b2" }
};
/** High-contrast themes use the matching tone at full strength. */
export const overlayTone = (kind: ThemeKind): "light" | "dark" => kind === "light" || kind === "hc-light" ? "light" : "dark";

const HEX = /^#[0-9a-f]{6}$/i;
/** Keeps only valid `#rrggbb` overrides for known hues (setting `datapass.overlay.colors`). */
export function overlayOverrides(raw: unknown): Partial<Record<OverlayHue, string>> {
  const out: Partial<Record<OverlayHue, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const h of OVERLAY_HUES) { const v = (raw as Record<string, unknown>)[h]; if (typeof v === "string" && HEX.test(v)) out[h] = v.toLowerCase(); }
  return out;
}

/** CSS custom properties `--dp-<hue>` for every theme kind (body classes VS Code sets on a webview). */
export function overlayCss(): string {
  const vars = (t: "light" | "dark") => OVERLAY_HUES.map(h => `--dp-${h}: ${OVERLAY_PALETTE[t][h]};`).join(" ");
  return `body { ${vars("dark")} } body.vscode-light, body.vscode-high-contrast-light { ${vars("light")} }`;
}

// ------------------------------------------------------------------ V3-THEME: Microsoft-style diagram themes

/**
 * Diagram surfaces in the Fluent neutral palette used by the Azure portal, Data Factory and Fabric (light and
 * dark). Only surfaces, borders and text: provider colours stay the official ones. High contrast keeps VS
 * Code's own theme colours.
 */
export const DIAGRAM_THEMES: Record<"light" | "dark", { canvas: string; node: string; border: string; text: string; subtle: string; edge: string }> = {
  light: { canvas: "#faf9f8", node: "#ffffff", border: "#e1dfdd", text: "#323130", subtle: "#605e5c", edge: "#8a8886" },
  dark: { canvas: "#1b1a19", node: "#292827", border: "#484644", text: "#f3f2f1", subtle: "#c8c6c4", edge: "#979593" }
};

export function diagramThemeCss(): string {
  const vars = (t: "light" | "dark") => { const d = DIAGRAM_THEMES[t]; return `--dg-canvas: ${d.canvas}; --dg-node: ${d.node}; --dg-border: ${d.border}; --dg-text: ${d.text}; --dg-subtle: ${d.subtle}; --dg-edge: ${d.edge};`; };
  const on = "body.dg-microsoft:not(.vscode-high-contrast):not(.vscode-high-contrast-light)";
  return `${on} { ${vars("dark")} } ${on}.vscode-light { ${vars("light")} }`;
}

// ------------------------------------------------------------------ contrast (WCAG 2)

const lin = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
