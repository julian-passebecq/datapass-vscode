/**
 * V1-UI-POLISH: the architecture diagram's look (provider colour + icon, file-type colour, one clear state).
 * Diagram only: the mapping reads the model, it never changes a format or a schema.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { PROVIDERS } from "../src/core/project/providers";
import { diagramState, fileColor, fileExtension, FAMILY_COLORS, iconOf, providerLook, STATES, type DiagramState } from "../src/webview/diagramLook";
import { DIAGRAM_ICONS } from "../src/webview/diagramIcons";

test("known providers get their family colour and a bundled icon", () => {
  assert.equal(providerLook("azure-storage").family, "azure");
  assert.equal(providerLook("azure-functions").color, FAMILY_COLORS.azure!.color);
  assert.equal(providerLook("azure-data-factory").family, "azure");
  assert.equal(providerLook("fabric", "lakehouse").family, "fabric");
  assert.equal(providerLook("fabric", "lakehouse").icon, "co:table");
  assert.equal(providerLook("fabric", "notebook").icon, "co:notebook");
  assert.equal(providerLook("fabric", "pipeline").icon, "co:git-merge");
  assert.equal(providerLook("powerbi").family, "powerbi");
  assert.equal(providerLook("databricks", "notebook").icon, "si:databricks", "a brand mark stays the brand mark");
  assert.equal(providerLook("python").icon, "si:python");
  assert.equal(providerLook("sql").family, "sql");
  assert.equal(providerLook("github-actions").family, "git");
  for (const p of PROVIDERS) {
    const look = providerLook(p.id);
    assert.ok(DIAGRAM_ICONS[look.icon], `${p.id}: icon ${look.icon} is bundled`);
    assert.ok(FAMILY_COLORS[look.family], `${p.id}: family ${look.family} has a colour`);
  }
});

test("unknown providers fall back to the neutral look; an unknown Azure service stays Azure", () => {
  assert.deepEqual(providerLook(undefined), { family: "neutral", label: "Unknown", color: FAMILY_COLORS.neutral!.color, icon: "co:question" });
  assert.equal(providerLook("something-new").family, "neutral");
  assert.equal(providerLook("other").family, "neutral");
  assert.equal(providerLook("azure-event-hubs").family, "azure");
  assert.equal(providerLook("azure-event-hubs").icon, "co:azure");
  assert.equal(providerLook("unknown", "database").icon, "co:database", "the kind still gives a shape");
  assert.equal(iconOf("nope"), DIAGRAM_ICONS["co:question"]);
});

test("file types use VS Code's default (Seti) colours; unknown → grey", () => {
  assert.equal(fileExtension("notebooks/run.ipynb"), "ipynb");
  assert.equal(fileExtension("src/"), undefined);
  assert.equal(fileExtension("data/**"), undefined);
  assert.equal(fileExtension("Makefile"), undefined);
  assert.equal(fileExtension(".env"), "env");
  assert.equal(fileColor("a.py"), "#519aba");
  assert.equal(fileColor("a.JSON"), "#cbcb41");
  assert.equal(fileColor("a.ipynb"), "#e37933");
  assert.equal(fileColor("a.yaml"), fileColor("b.yml"));
  assert.equal(fileColor("a.pdf"), "#cc3e44");
  assert.equal(fileColor("a.sql"), "#f55385");
  assert.equal(fileColor("a.csv"), "#8dc149");
  assert.equal(fileColor("a.parquet"), fileColor(undefined));
});

test("health maps to exactly one of the five states", () => {
  const cases: Array<[Parameters<typeof diagramState>[0], DiagramState]> = [
    [{ health: "ok" }, "available"],
    [{ health: "attention" }, "prepared"],
    [{ health: "planned" }, "prepared"],
    [{ health: "blocked" }, "blocked"],
    [{ health: "info" }, "choice"],
    [{ health: "info", availability: "restricted" }, "unverified"],
    [{ health: "attention", availability: "unbound" }, "unverified"],
    [{ health: "attention", repoState: "unverified" }, "unverified"],
    [{ health: "ok", previewOnly: true }, "choice"],
    [{ ghost: true }, "choice"],
    [{ health: "something-else" }, "unverified"]
  ];
  for (const [input, want] of cases) assert.equal(diagramState(input), want, JSON.stringify(input));
});

test("a state colour is never a provider colour, and every state has its own symbol", () => {
  const providerColors = new Set(Object.values(FAMILY_COLORS).map(f => f.color.toLowerCase()));
  for (const [k, s] of Object.entries(STATES)) {
    assert.ok(!providerColors.has(s.color.toLowerCase()), `${k} uses a provider colour`);
    assert.match(s.color, /^var\(--/, `${k} follows the theme`);
  }
  const symbols = Object.values(STATES).map(s => s.symbol);
  assert.equal(new Set(symbols).size, symbols.length);
  // The state colours of VS Code's default light and dark themes (and the CSS fallbacks) stay visibly apart
  // from every provider colour: at least 45 in RGB distance.
  const stateHex = ["#3fb950", "#73c991", "#388a34", "#d29922", "#cca700", "#bf8803", "#f85149", "#e51400", "#b180d7", "#652d90", "#8b949e", "#9d9d9d", "#616161"];
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const [fam, { color }] of Object.entries(FAMILY_COLORS)) for (const st of stateHex) {
    const [a, b] = [rgb(color), rgb(st)];
    const dist = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    assert.ok(dist >= 45, `${fam} ${color} is too close to state colour ${st} (${Math.round(dist)})`);
  }
});

test("bundled icons stay small and never point to the network", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "webview", "diagramIcons.ts"), "utf8");
  assert.ok(Buffer.byteLength(src) <= 60 * 1024, `diagramIcons.ts is ${Buffer.byteLength(src)} bytes`);
  assert.doesNotMatch(src.replace(/\/\*\*[\s\S]*?\*\//, ""), /https?:/);
  for (const [id, i] of Object.entries(DIAGRAM_ICONS)) assert.match(i.d, /^[Mm][\d\s.,\-MmLlHhVvCcSsQqTtAaZze]+$/, `${id} is plain path data`);
});
