/**
 * V4-NAV NAVFIX1 regression (review 2 Oct, H1/H2/M3): on the research fixture project, every view the host's real
 * catalog (base + packs) offers resolves to something that can draw it — a registered layout, a surface the default
 * `datapass.navView.surfaces` setting maps, and binding payloads that pass that layout's validator (a graph is a
 * valid view-spi `datapass.graph-view/1`). No `graph-invalid` / `layout-unregistered` hole.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { buildProjectMap } from "../src/core/project/projectMap";
import { NavigationService } from "../src/core/navigation/navigationService";
import { projectLadder } from "../src/core/navigation/projectLadder";
import { builtinCatalog } from "../src/core/navigation/viewPacks";
import { resolveBindings } from "../src/core/navigation/bindings";
import { navViewMessages } from "../src/views/navViewData";
import { surfaceCommand } from "../src/views/navViewHtml";
import { parseHostMessage, type VNode } from "../src/webview/views/model";
import { registeredLayouts, screenModel } from "../src/webview/views/renderer";
import { isGraphView } from "../src/webview/views/layouts/graph";
import { inputA } from "./fixtures/v3/research";

const BROKEN = new Set(["graph-invalid", "layout-unregistered", "metrics-invalid", "steps-invalid"]);
const walk = (n: VNode): VNode[] => [n, ...(n.children ?? []).flatMap(walk)];
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const configs: { properties?: Record<string, { default?: unknown }> }[] = [pkg.contributes.configuration].flat();
const surfaces = configs.map(c => c.properties?.["datapass.navView.surfaces"]?.default).find(Boolean) as Record<string, unknown>;

test("every offered nav view resolves to a registered layout, a mapped surface and valid payloads", () => {
  const catalog = builtinCatalog();
  const layouts = new Set(registeredLayouts());
  for (const e of catalog.entries) for (const v of e.views) {
    assert.ok(layouts.has(v.layout), `${e.artifactKind}/${e.level}/${v.id}: layout "${v.layout}" is registered`);
    if (v.layout === "surface") assert.ok(surfaceCommand(v, surfaces), `${e.level}/${v.id}: surface "${v.surface}" maps to a command by default`);
  }

  const map = buildProjectMap(inputA());
  const nav = new NavigationService(projectLadder(() => map), catalog);
  let graphs = 0;
  for (const level of ["project", "subproject", "artifact"] as const) {
    if (level !== "project") nav.dispatch({ type: "down", childId: nav.ladder.children(nav.state.location).find(c => c.level === level)!.nodeId });
    for (const view of nav.views()) {
      const state = { ...nav.state, viewId: view.id };
      const bound = view.layout === "surface" ? [] : resolveBindings(view, { location: state.location, projectMap: map });
      const [ns, vd] = navViewMessages({ state, views: nav.views(), labels: {}, bound }).map(parseHostMessage);
      assert.ok(ns && vd && vd.type === "view-data", `${level}/${view.id}: messages pass the webview parser`);
      for (const d of vd.data) if (d.graph !== undefined) {
        graphs++;
        assert.ok(isGraphView(d.graph), `${level}/${view.id}/${d.source}: graph passes the graph layout's validator`);
      }
      const holes = walk(screenModel({ state, views: nav.views(), labels: {}, data: vd.data }))
        .map(n => n.attrs?.["data-hole-kind"]).filter((k): k is string => !!k && BROKEN.has(k));
      assert.deepEqual(holes, [], `${level}/${view.id}: no broken-view hole`);
    }
  }
  assert.ok(graphs > 0, "the fixture draws at least one graph (lineage / data-flow)");
});
