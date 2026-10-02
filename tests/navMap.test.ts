/** V4-NAV NAVMAP1: mini-map variants with "you are here" and the shared navigation palette. */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import type { NavLadder, NavLocation } from "../src/core/navigation/navTypes";
import { NAV_HERE_DEFAULT, NAV_PALETTE_DEFAULT, NAV_PALETTE_PRESETS, navColor, readNavPalette } from "../src/core/navigation/navPalette";
import { buildNavMap, NAV_MAP_VARIANTS, navMapCommand, navPath, readNavMapVariant, renderNavMap } from "../src/webview/navMap";

const L = (level: NavLocation["level"], nodeId: string, artifactKind = "other"): NavLocation => ({ level, nodeId, artifactKind });
const ROOT = L("project", "p", "project");
const TREE: Record<string, NavLocation[]> = {
  p: [L("subproject", "p/ingest", "subproject"), L("subproject", "p/gold", "subproject")],
  "p/ingest": [L("artifact", "p/ingest/load.ipynb", "spark-notebook"), L("artifact", "p/ingest/raw.sql", "sql-script")],
  "p/gold": [L("artifact", "p/gold/dim.sql", "sql-script")],
  "p/ingest/load.ipynb": [L("step", "p/ingest/load.ipynb#cell3")],
  "p/ingest/load.ipynb#cell3": [L("operation", "p/ingest/load.ipynb#cell3:join")]
};
const PARENT = new Map<string, NavLocation>();
for (const [p, cs] of Object.entries(TREE)) for (const c of cs) PARENT.set(c.nodeId, p === "p" ? ROOT : Object.values(TREE).flat().find(x => x.nodeId === p)!);
const ladder: NavLadder = { root: () => ROOT, parent: l => PARENT.get(l.nodeId) ?? null, children: l => TREE[l.nodeId] ?? [] };
const OP = L("operation", "p/ingest/load.ipynb#cell3:join");

test("navPath walks up to the root and survives a cycle", () => {
  assert.deepEqual(navPath(OP, ladder).map(l => l.level), ["project", "subproject", "artifact", "step", "operation"]);
  const loop: NavLadder = { root: () => ROOT, parent: l => l, children: () => [] };
  assert.equal(navPath(ROOT, loop).length, 1);
});

test("architecture-tb: the Location's artifact ringed 'here', its ancestors ringed, other nodes not", () => {
  const m = buildNavMap("architecture-tb", OP, ladder, { "p/ingest/load.ipynb": "Load notebook" })!;
  const ring = (id: string) => m.nodes.find(n => n.location?.nodeId === id)?.ring;
  assert.equal(ring("p/ingest/load.ipynb"), "here");
  assert.equal(ring("p/ingest"), "ancestor");
  assert.equal(ring("p"), "ancestor");
  assert.equal(ring("p/gold"), null);
  assert.equal(m.nodes.filter(n => n.ring === "here").length, 1);
  assert.ok(m.nodes.some(n => n.label === "Load notebook"));
  // TB: sub-projects side by side, artifacts below their sub-project.
  const ingest = m.nodes.find(n => n.location?.nodeId === "p/ingest")!, gold = m.nodes.find(n => n.location?.nodeId === "p/gold")!;
  const load = m.nodes.find(n => n.location?.nodeId === "p/ingest/load.ipynb")!;
  assert.equal(ingest.y, gold.y); assert.ok(gold.x > ingest.x); assert.equal(load.x, ingest.x); assert.ok(load.y > ingest.y);
});

test("architecture-lr is the transposed layout", () => {
  const m = buildNavMap("architecture-lr", OP, ladder)!;
  const ingest = m.nodes.find(n => n.location?.nodeId === "p/ingest")!, gold = m.nodes.find(n => n.location?.nodeId === "p/gold")!;
  const load = m.nodes.find(n => n.location?.nodeId === "p/ingest/load.ipynb")!;
  assert.equal(ingest.x, gold.x); assert.ok(gold.y > ingest.y); assert.equal(load.y, ingest.y); assert.ok(load.x > ingest.x);
  assert.ok(m.nodes.every(n => n.x + n.w <= m.width && n.y + n.h <= m.height));
});

test("a long list is capped with '+N more' but the current path is always shown", () => {
  const many = Array.from({ length: 20 }, (_, i) => L("artifact", `p/gold/t${i}.sql`, "sql-script"));
  const big: NavLadder = { ...ladder, children: l => l.nodeId === "p/gold" ? many : ladder.children(l), parent: l => l.nodeId.startsWith("p/gold/") ? TREE.p![1]! : ladder.parent(l) };
  const m = buildNavMap("architecture-tb", many[17]!, big, {}, { maxChildren: 5, labels: { more: "+{n} autres" } })!;
  assert.equal(m.nodes.find(n => n.location?.nodeId === "p/gold/t17.sql")?.ring, "here");
  assert.ok(m.nodes.some(n => n.location === null && n.label === "+15 autres"));
});

test("ladder: five levels, current level 'here', labels are data", () => {
  const step = L("step", "p/ingest/load.ipynb#cell3");
  const m = buildNavMap("ladder", step, ladder, {}, { labels: { levels: { step: "Étape" } as never } })!;
  assert.equal(m.nodes.length, 5);
  assert.deepEqual(m.nodes.map(n => n.ring), ["ancestor", "ancestor", "ancestor", "here", null]);
  assert.match(m.nodes[3]!.label, /^Étape: load.ipynb#cell3$/);
  assert.match(m.nodes[4]!.label, /^Operation: —$/);
});

test("off draws nothing; unknown setting falls back to architecture-tb", () => {
  assert.equal(buildNavMap("off", OP, ladder), null);
  assert.equal(renderNavMap(null), "");
  assert.equal(readNavMapVariant("nope"), "architecture-tb");
  for (const v of NAV_MAP_VARIANTS) assert.equal(readNavMapVariant(v), v);
});

test("render: red ring, escaped labels, clickable nodes only; click re-validated on the host", () => {
  const m = buildNavMap("architecture-tb", OP, ladder, { "p/gold": "<b>Gold</b>" })!;
  const svg = renderNavMap(m);
  assert.ok(svg.includes(`stroke="${NAV_HERE_DEFAULT}" stroke-width="2.5"`));
  assert.ok(!svg.includes("<b>") && svg.includes("&lt;b&gt;"));
  assert.equal((svg.match(/data-nav-node=/g) ?? []).length, m.nodes.filter(n => n.location).length);
  const gold = m.nodes.find(n => n.location?.nodeId === "p/gold")!;
  assert.deepEqual(navMapCommand(m, gold.id), { type: "go", location: gold.location });
  assert.equal(navMapCommand(m, "forged"), null);
  assert.equal(navMapCommand(m, 42), null);
});

test("palette: deterministic per id, theme tokens by default, settings override and are validated", () => {
  assert.equal(navColor("orders"), navColor("orders"));
  assert.ok(NAV_PALETTE_PRESETS.charts.includes(navColor("orders")));
  const spread = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(id => navColor(id)));
  assert.ok(spread.size >= 3, "ids spread over the palette");
  const p = readNavPalette(k => ({ palette: "custom", paletteColors: ["#112233", "bad"], paletteAssign: { orders: "#ABCDEF", x: "red" }, hereColor: "#ff0000" } as Record<string, unknown>)[k]);
  assert.deepEqual(p.colors, ["#112233"]);
  assert.equal(navColor("orders", p), "#abcdef");
  assert.equal(navColor("other", p), "#112233");
  assert.equal(p.here, "#ff0000");
  assert.equal(readNavPalette(k => k === "palette" ? "custom" : undefined).preset, "charts", "empty custom falls back");
  assert.equal(readNavPalette(k => k === "palette" ? "overlay" : undefined).colors, NAV_PALETTE_PRESETS.overlay);
  assert.equal(NAV_PALETTE_DEFAULT.here, NAV_HERE_DEFAULT);
});

test("package.json contributes the mini-map and palette settings with the same values", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const props = pkg.contributes.configuration.properties;
  assert.deepEqual(props["datapass.navigator.miniMap"].enum, [...NAV_MAP_VARIANTS]);
  assert.deepEqual(props["datapass.navigator.palette"].enum, ["charts", "overlay", "custom"]);
});
