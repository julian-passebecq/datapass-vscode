/**
 * V4-NAV NAVDATA1 reachability: on the research fixture project, walk the real ladder (project → subproject →
 * artifact) with the real NavigationService and default catalog, resolve every offered view's bindings, send them
 * through the host messages, parse them as the webview does and draw them with the renderer. Each view must
 * render something: rows, a card, a surface, or a typed hole — never a blank or a dropped message.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectMap } from "../src/core/project/projectMap";
import { NavigationService } from "../src/core/navigation/navigationService";
import { projectLadder } from "../src/core/navigation/projectLadder";
import { DEFAULT_VIEW_CATALOG, type ViewDef } from "../src/core/navigation/navTypes";
import { bindingProvider, bindingSources, resolveBindings, UNPROVIDED_SOURCES } from "../src/core/navigation/bindings";
import { navViewLabels, navViewMessages, toBindingData } from "../src/views/navViewData";
import { parseHostMessage, type VNode } from "../src/webview/views/model";
import { screenModel } from "../src/webview/views/renderer";
import { inputA } from "./fixtures/v3/research";

const map = buildProjectMap(inputA());
const walk = (n: VNode): VNode[] => [n, ...(n.children ?? []).flatMap(walk)];
const has = (n: VNode, cls: string) => walk(n).some(x => x.cls?.split(" ").includes(cls));

function draw(nav: NavigationService, view: ViewDef): VNode {
  const state = { ...nav.state, viewId: view.id };
  const bound = view.layout === "surface" ? [] : resolveBindings(view, { location: state.location, projectMap: map });
  const msgs = navViewMessages({ state, views: nav.views(), labels: {}, bound });
  const parsed = msgs.map(parseHostMessage);
  assert.ok(parsed.every(Boolean), `${state.location.level}/${view.id}: the webview drops no host message`);
  const ns = parsed[0]!, vd = parsed[1];
  assert.equal(ns.type, "nav-state");
  assert.ok(vd && vd.type === "view-data" && vd.viewId === view.id);
  return screenModel({ state, views: nav.views(), labels: {}, data: vd.type === "view-data" ? vd.data : null });
}

test("every catalog binding source has a provider or a declared typed hole", () => {
  const used = new Set(DEFAULT_VIEW_CATALOG.entries.flatMap(e => e.views.flatMap(v => v.bindings.map(b => b.source))));
  const missing = [...used].filter(s => !bindingSources().includes(s)).sort();
  assert.deepEqual(missing, [...UNPROVIDED_SOURCES].filter(s => used.has(s)).sort());
  for (const s of UNPROVIDED_SOURCES) assert.equal(bindingProvider(s), undefined, `${s} is provided: drop it from UNPROVIDED_SOURCES`);
  const [d] = toBindingData(resolveBindings({ id: "x", title: "X", layout: "detail-card", bindings: [{ source: "rationale" }] },
    { location: { level: "project", nodeId: "p", artifactKind: "project" }, projectMap: map }));
  assert.equal(d?.holes[0]?.kind, "binding-unavailable");
});

test("project → subproject → artifact: every offered view renders data, a surface or a typed hole", () => {
  const nav = new NavigationService(projectLadder(() => map));
  const seen: string[] = [];
  for (const level of ["project", "subproject", "artifact"] as const) {
    if (level !== "project") {
      const child = nav.ladder.children(nav.state.location).find(c => c.level === level);
      assert.ok(child, `the fixture has a ${level} under ${nav.state.location.nodeId}`);
      nav.dispatch({ type: "down", childId: child.nodeId });
    }
    assert.equal(nav.state.location.level, level);
    assert.ok(nav.views().length > 0, `${level} offers views`);
    for (const view of nav.views()) {
      const screen = draw(nav, view);
      const rendered = ["nv-table", "nv-card", "nv-hole", "nv-surface-open", "nv-layout-surface"].some(c => has(screen, c));
      assert.ok(rendered, `${level}/${view.id} renders something`);
      assert.ok(!has(screen, "nv-loading"), `${level}/${view.id} is not stuck loading`);
      seen.push(`${level}/${view.id}`);
    }
  }
  // The artifact's Detail view is a non-empty card from project facts.
  const detail = nav.views().find(v => v.layout === "detail-card")!;
  const card = walk(draw(nav, detail)).find(n => n.cls === "nv-card" || n.cls?.startsWith("nv-card "));
  assert.ok(card && walk(card).some(n => n.tag === "dd"), "artifact detail card has fields");
  assert.ok(seen.includes("artifact/detail") && seen.includes("project/lineage"));
});

test("a table view bound to lineage lists the declared relations with their origin", () => {
  const nav = new NavigationService(projectLadder(() => map));
  const table: ViewDef = { id: "relations", title: "Relations", layout: "table", bindings: [{ source: "lineage" }] };
  const bound = resolveBindings(table, { location: nav.state.location, projectMap: map });
  assert.ok((bound[0]?.result.rows?.length ?? 0) > 0, "the fixture declares relations");
  const screen = screenModel({ state: { ...nav.state, viewId: "relations" }, views: [table], labels: {}, data: toBindingData(bound) });
  assert.ok(walk(screen).filter(n => n.tag === "tr").length > 1, "table has rows");
  assert.ok(walk(screen).some(n => n.cls?.includes("nv-origin-static")));
});

test("labels come from the setting, strings only", () => {
  assert.deepEqual(navViewLabels({ "origin.static": "declared", bad: 3, arr: ["x"] }), { "origin.static": "declared" });
  assert.deepEqual(navViewLabels(null), {});
});

test("an observed operation result keeps its origin on the cell", () => {
  const [d] = toBindingData([{ source: "evidence", result: { origin: "static", holes: [],
    rows: [{ id: "op", label: "Run", origin: "observed", state: "passed" }, { id: "c", label: "Doc", origin: "static", state: "done" }] } }]);
  assert.deepEqual(d?.rows?.[0]?.cells.state, { value: "passed", origin: "observed" });
  assert.equal(d?.rows?.[1]?.cells.state, "done");
  assert.deepEqual(d?.columns, ["label", "state"]);
});
