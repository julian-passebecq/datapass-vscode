import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_QUICK_ICONS, NAV_BUTTONS, NAVIGATOR_VIEW_IDS, navigatorHtml, navigatorLocation, navigatorModel, otherLocation, parseNavigatorMessage, quickIcons
} from "../src/views/navigatorHtml";
import type { NavState, ViewDef } from "../src/core/navigation/navTypes";
import { PALETTE_TIERS } from "../src/core/experience/palette";
import { SURFACES } from "../src/core/experience/surfaces";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const loc = (level: "project" | "artifact", nodeId: string) => ({ level, nodeId, artifactKind: level === "project" ? "project" : "sql-script" });
const view = (id: string): ViewDef => ({ id, title: id.toUpperCase(), layout: "graph", bindings: [] });
const state = (over: Partial<NavState> = {}): NavState => ({ location: loc("artifact", "a1"), viewId: "v2", back: [], forward: [], ...over });

test("placement: right by default, left only when asked; flip goes to the other side", () => {
  assert.equal(navigatorLocation(undefined), "right");
  assert.equal(navigatorLocation("bottom"), "right");
  assert.equal(navigatorLocation("left"), "left");
  assert.equal(otherLocation("right"), "left");
  assert.equal(otherLocation("left"), "right");
});

test("package.json: two view ids, one per side, gated by the setting and the hidden-view key", () => {
  const right = pkg.contributes.views["datapass-details"];
  assert.equal(right[0].id, NAVIGATOR_VIEW_IDS.right, "first view of the secondary side bar");
  assert.match(right[0].when, /config\.datapass\.navigator\.location != left/);
  assert.match(right[0].when, /!datapass\.hidden\.view\.navigator/);
  assert.doesNotMatch(right[0].when, /datapass\.rail/, "works with rail mode on or off");
  assert.ok(pkg.contributes.viewsContainers.activitybar.some((c: { id: string }) => c.id === "datapass-navigator"));
  const left = pkg.contributes.views["datapass-navigator"];
  assert.equal(left[0].id, NAVIGATOR_VIEW_IDS.left);
  assert.match(left[0].when, /config\.datapass\.navigator\.location == left/);
  const setting = pkg.contributes.configuration.properties["datapass.navigator.location"];
  assert.deepEqual(setting.enum, ["right", "left"]);
  assert.equal(setting.default, "right");
  assert.deepEqual(pkg.contributes.configuration.properties["datapass.navigator.quickIcons"].default, [...DEFAULT_QUICK_ICONS]);
});

test("move command is classified in the palette and the surface exists", () => {
  assert.equal(PALETTE_TIERS.get("datapass.nav.moveNavigator"), "palette.full");
  assert.ok(SURFACES.some(s => s.id === "view.navigator" && s.viewId === NAVIGATOR_VIEW_IDS.right));
  assert.ok(pkg.contributes.commands.some((c: { command: string }) => c.command === "datapass.nav.moveNavigator"));
});

test("quick icons: known rail ids only, no duplicates, default when unset", () => {
  assert.deepEqual(quickIcons(undefined), [...DEFAULT_QUICK_ICONS]);
  assert.ok(!DEFAULT_QUICK_ICONS.includes("expand"));
  assert.deepEqual(quickIcons(["git", "nope", "git", 3, "ai"]), ["git", "ai"]);
  assert.deepEqual(quickIcons([]), []);
});

test("model: breadcrumb, buttons enabled from the state, views with the current one", () => {
  const m = navigatorModel({ state: state({ back: [loc("project", "p")] }), views: [view("v1"), view("v2")], trail: [loc("project", "p"), loc("artifact", "a1")],
    label: l => `#${l.nodeId}`, quick: ["git"] });
  assert.deepEqual(m.breadcrumb.map(c => c.text), ["#p", "#a1"]);
  const on = Object.fromEntries(m.buttons.map(b => [b.id, b.enabled]));
  assert.deepEqual(on, { home: true, back: true, forward: false, up: true, down: true, left: true, right: true });
  assert.deepEqual(m.views.map(v => [v.id, v.current]), [["v1", false], ["v2", true]]);
  assert.deepEqual(m.quick.map(q => q.id), ["git"]);
  assert.equal(m.buttons.length, NAV_BUTTONS.length);
});

test("model: no state = nothing enabled, one view = no left/right, at project = no up", () => {
  const none = navigatorModel({ state: null, views: [], quick: [] });
  assert.ok(none.buttons.every(b => !b.enabled));
  assert.deepEqual(none.breadcrumb, []);
  const m = navigatorModel({ state: state({ location: loc("project", "p") }), views: [view("v1")], quick: [] });
  const on = Object.fromEntries(m.buttons.map(b => [b.id, b.enabled]));
  assert.equal(on.up, false);
  assert.equal(on.left, false);
  assert.equal(m.breadcrumb[0]?.text, "Project p");
});

test("messages: only known shapes pass, untrusted values are dropped", () => {
  assert.deepEqual(parseNavigatorMessage({ type: "nav", command: { type: "up", extra: 1 } }), { type: "nav", command: { type: "up" } });
  assert.deepEqual(parseNavigatorMessage({ type: "nav", command: { type: "view", viewId: "v1" } }), { type: "nav", command: { type: "view", viewId: "v1" } });
  assert.deepEqual(parseNavigatorMessage({ type: "nav", command: { type: "down", childId: 5 } }), { type: "nav", command: { type: "down" } });
  assert.equal(parseNavigatorMessage({ type: "nav", command: { type: "view" } }), undefined);
  assert.equal(parseNavigatorMessage({ type: "nav", command: { type: "go", location: { level: "galaxy", nodeId: "x", artifactKind: "k" } } }), undefined);
  assert.ok(parseNavigatorMessage({ type: "nav", command: { type: "go", location: loc("artifact", "a") } }));
  assert.equal(parseNavigatorMessage({ type: "nav", command: { type: "exec" } }), undefined);
  assert.equal(parseNavigatorMessage({ type: "quick", id: "rm -rf" }), undefined);
  assert.deepEqual(parseNavigatorMessage({ type: "quick", id: "git" }), { type: "quick", id: "git" });
  assert.equal(parseNavigatorMessage({ type: "select", nodeId: "x".repeat(600) }), undefined);
  assert.equal(parseNavigatorMessage(null), undefined);
});

test("html: CSP with nonce, the two slots, no hard-coded labels", () => {
  const h = navigatorHtml("vscode-resource:", "N0NCE");
  assert.match(h, /script-src 'nonce-N0NCE'/);
  assert.match(h, /<div id="minimap"><\/div>/);
  assert.match(h, /<div id="tours"><\/div>/);
  for (const b of NAV_BUTTONS) assert.ok(!h.includes(b.title), `${b.id} label comes from data`);
});
