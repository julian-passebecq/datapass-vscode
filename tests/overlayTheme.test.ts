/**
 * V3-THEME: the DataPass overlay palette (own hues, readable in light, dark and high contrast), the overlay
 * switch (no state mark at all when off), the Project tree's neutral icons, the Microsoft-style diagram
 * themes and the code font preset.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { contrastRatio, DIAGRAM_THEMES, FAMILY_COLORS, OVERLAY_HUES, OVERLAY_PALETTE, OVERLAY_ROLES, overlayCss, overlayOverrides, overlayTone, STATES, diagramThemeCss } from "../src/webview/diagramLook";
import { DIAGRAM_SETTING_DEFAULTS, overlayMarks, readDiagramSettings } from "../src/views/diagramSettings";
import { workbenchHtml } from "../src/views/workbenchHtml";
import { readTreeLook, stateIcon, TREE_LOOK_DEFAULTS, treeIconColor } from "../src/views/treeColors";
import { codeFontLabel, parseCodeFontSize } from "../src/core/experience/codeFont";

// Editor, side bar and panel backgrounds of VS Code's Light+/Light Modern and Dark+/Dark Modern themes, plus
// the Microsoft diagram surfaces; high contrast is pure black / white.
const LIGHT_BG = ["#ffffff", "#f3f3f3", "#f8f8f8", DIAGRAM_THEMES.light.canvas, DIAGRAM_THEMES.light.node];
const DARK_BG = ["#1e1e1e", "#1f1f1f", "#252526", "#181818", DIAGRAM_THEMES.dark.canvas, DIAGRAM_THEMES.dark.node];

test("overlay colours: ≥ 3:1 as graphics and ≥ 4.5:1 as text on every light, dark and high-contrast background", () => {
  const check = (kind: "light" | "dark" | "hc-light" | "hc-dark", bgs: string[]) => {
    const tone = OVERLAY_PALETTE[overlayTone(kind)];
    for (const hue of OVERLAY_HUES) for (const bg of bgs) {
      const r = contrastRatio(tone[hue], bg);
      assert.ok(r >= 3, `${kind} ${hue} ${tone[hue]} on ${bg}: ${r.toFixed(2)} < 3 (graphics)`);
      assert.ok(r >= 4.5, `${kind} ${hue} ${tone[hue]} on ${bg}: ${r.toFixed(2)} < 4.5 (the symbols are text)`);
    }
  };
  check("light", LIGHT_BG); check("dark", DARK_BG); check("hc-light", ["#ffffff"]); check("hc-dark", ["#000000"]);
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(0), "21");
});

test("overlay colours are DataPass's own: never a provider colour, never VS Code's pass / warning / error colour", () => {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const dist = (a: string, b: string) => { const [x, y] = [rgb(a), rgb(b)]; return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!); };
  const vscodeStates = ["#73c991", "#388a34", "#cca700", "#bf8803", "#f14c4c", "#e51400", "#3794ff", "#1a85ff", "#89d185"];
  const providers = Object.values(FAMILY_COLORS).map(f => f.color);
  for (const t of ["light", "dark"] as const) for (const hue of OVERLAY_HUES) {
    if (hue === "muted") continue;
    const c = OVERLAY_PALETTE[t][hue];
    for (const v of vscodeStates) assert.ok(dist(c, v) >= 30, `${t} ${hue} ${c} too close to VS Code's ${v}`);
    for (const p of providers) assert.ok(dist(c, p) >= 30, `${t} ${hue} ${c} too close to provider ${p}`);
  }
  // Every diagram state colour is an overlay hue.
  for (const [k, s] of Object.entries(STATES)) assert.match(s.color, /^var\(--dp-(blue|violet|green|orange|rose|muted)\)$/, k);
});

test("overlay CSS: the palette per theme kind, the roles drawn thin, the icons smaller, the switch hides every mark", () => {
  const css = overlayCss();
  for (const hue of OVERLAY_HUES) { assert.ok(css.includes(`--dp-${hue}: ${OVERLAY_PALETTE.dark[hue]}`)); assert.ok(css.includes(`--dp-${hue}: ${OVERLAY_PALETTE.light[hue]}`)); }
  assert.match(css, /body\.vscode-light, body\.vscode-high-contrast-light/);
  const html = workbenchHtml({ cspSource: "x", nonce: "n", scriptUri: "s", mode: "full", title: "t" });
  for (const [st, hue] of Object.entries(OVERLAY_ROLES.dp)) assert.match(html, new RegExp(`\\.node\\.dp-${st} \\{ border-left: 2px \\w+ var\\(--dp-${hue}\\)`), `band ${st}`);
  for (const [st, hue] of Object.entries(OVERLAY_ROLES.capability)) assert.ok(html.includes(`.node.st-${st} { --st: var(--dp-${hue}); }`), `edge ${st}`);
  for (const [st, hue] of Object.entries(OVERLAY_ROLES.step)) assert.ok(html.includes(`.step-${st} { --step: var(--dp-${hue}); }`), `step ${st}`);
  assert.match(html, /\.picon \{ width: 12px; height: 12px;/, "provider icons ~15 % smaller (14 → 12 px)");
  assert.match(html, /body\.no-overlay \.node \.stsym, body\.no-overlay \.stepline, body\.no-overlay \.dot\[class\*="h-"\], body\.no-overlay \.lgdp, body\.no-overlay \.lgst, body\.no-overlay \.lgstep \{ display: none !important; \}/);
  assert.ok(!/--dp-[a-z]+: var\(--vscode-(testing|problems|editorError|editorWarning)/.test(html), "the overlay never borrows VS Code's state colours");
});

test("overlay off: no state mark is drawn (band, edge, symbols, bottom line, tooltip), whatever the per-level switches", () => {
  const on = readDiagramSettings(() => true, () => undefined);
  assert.deepEqual(overlayMarks({ ...on, legendPosition: "bottom-left", theme: "microsoft" }, true), { band: true, edge: true, stepLine: true, symbols: true, tooltip: true });
  const off = readDiagramSettings(k => k === "legendPosition" ? "bottom-left" : true, k => k === "enabled" ? false : undefined);
  assert.equal(off.overlay, false);
  assert.deepEqual(overlayMarks(off, true), { band: false, edge: false, stepLine: false, symbols: false, tooltip: false });
  assert.equal(overlayMarks(DIAGRAM_SETTING_DEFAULTS, false).stepLine, false, "no recorded results: no bottom line");
  assert.equal(readDiagramSettings(() => undefined, k => k === "enabled" ? "no" : undefined).overlay, true, "a wrong type falls back to on");
});

test("overlay colour overrides: only #rrggbb for known hues", () => {
  assert.deepEqual(overlayOverrides({ blue: "#00AAFF", violet: "purple", green: "#123", pink: "#ffffff", rose: 3 }), { blue: "#00aaff" });
  assert.deepEqual(overlayOverrides(undefined), {});
  assert.deepEqual(overlayOverrides("#ffffff"), {});
  assert.deepEqual(readDiagramSettings(() => undefined, k => k === "colors" ? { orange: "#ff8800" } : undefined).overlayColors, { orange: "#ff8800" });
});

test("diagram themes: Microsoft light and dark surfaces, readable text, high contrast keeps VS Code's colours", () => {
  for (const t of ["light", "dark"] as const) {
    const d = DIAGRAM_THEMES[t];
    assert.ok(contrastRatio(d.text, d.node) >= 7, `${t} text on node`);
    assert.ok(contrastRatio(d.subtle, d.node) >= 4.5, `${t} subtle text on node`);
    assert.ok(contrastRatio(d.edge, d.canvas) >= 3, `${t} links on canvas`);
  }
  const css = diagramThemeCss();
  assert.match(css, /body\.dg-microsoft:not\(\.vscode-high-contrast\):not\(\.vscode-high-contrast-light\)/);
  assert.ok(css.includes(`--dg-node: ${DIAGRAM_THEMES.light.node}`) && css.includes(`--dg-node: ${DIAGRAM_THEMES.dark.node}`));
  assert.equal(readDiagramSettings(() => undefined).theme, "microsoft");
  assert.equal(readDiagramSettings(k => k === "theme" ? "vscode" : undefined).theme, "vscode");
  assert.equal(readDiagramSettings(k => k === "theme" ? "neon" : undefined).theme, "microsoft");
});

test("Project tree: neutral icons by default, colour only for attention; coloured icons restorable; overlay off drops state icons", () => {
  assert.deepEqual(TREE_LOOK_DEFAULTS, { coloredIcons: false, overlay: true });
  const look = readTreeLook(() => undefined, () => undefined);
  assert.deepEqual(look, TREE_LOOK_DEFAULTS);
  for (const calm of ["testing.iconPassed", "disabledForeground", "problemsInfoIcon.foreground", "charts.yellow", undefined]) assert.equal(treeIconColor(calm, look), undefined, `${calm} → neutral`);
  assert.equal(treeIconColor("problemsErrorIcon.foreground", look), "problemsErrorIcon.foreground");
  assert.equal(treeIconColor("problemsWarningIcon.foreground", look), "problemsWarningIcon.foreground");
  const colored = readTreeLook(() => true, () => undefined);
  assert.equal(treeIconColor("testing.iconPassed", colored), "testing.iconPassed");
  assert.deepEqual(stateIcon(["pass", "testing.iconPassed"], "file", look), ["pass", undefined]);
  assert.deepEqual(stateIcon(["close", "problemsErrorIcon.foreground"], "file", look), ["close", "problemsErrorIcon.foreground"]);
  const off = readTreeLook(() => true, () => false);
  assert.deepEqual(stateIcon(["close", "problemsErrorIcon.foreground"], "file", off), ["file"], "overlay off: plain icon, no colour");
  // package.json: the settings exist with these defaults.
  const props = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).contributes.configuration.properties;
  assert.equal(props["datapass.tree.coloredIcons"].default, false);
  assert.equal(props["datapass.overlay.enabled"].default, true);
  assert.equal(props["datapass.diagram.theme"].default, "microsoft");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "views", "projectTree.ts"), "utf8");
  assert.doesNotMatch(src, /new vscode\.ThemeColor\(\(HEALTH_ICON/, "component icons no longer always take the health colour");
});

test("code font preset: sizes checked, labels plain, command declared", () => {
  assert.deepEqual(parseCodeFontSize("12"), { size: 12 });
  assert.deepEqual(parseCodeFontSize(" 12,5 "), { size: 12.5 });
  assert.ok("error" in parseCodeFontSize(""));
  assert.ok("error" in parseCodeFontSize("abc"));
  assert.ok("error" in parseCodeFontSize("4"));
  assert.ok("error" in parseCodeFontSize("12.3"));
  assert.equal(codeFontLabel(12, 12), "12 px — smaller (current)");
  assert.equal(codeFontLabel(14, 12), "14 px — VS Code's default");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(pkg.contributes.commands.some((c: { command: string; title: string }) => c.command === "datapass.setCodeFontSize" && c.title === "DataPass: Set Code Font Size…"));
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "work", "codeFontCommand.ts"), "utf8");
  assert.match(src, /modal: true/, "asks before writing");
  assert.match(src, /ConfigurationTarget\.Workspace/, "workspace scope");
});
