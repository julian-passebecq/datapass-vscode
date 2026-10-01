/**
 * V4-NAV NAVSVC1: the NavigationService (single source of truth) over the minimal project ladder.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectMap } from "../src/core/project/projectMap";
import { NavigationService, type NavChange } from "../src/core/navigation/navigationService";
import type { ViewCatalog } from "../src/core/navigation/navTypes";
import { componentLocation, locationLabel, locationOf, locationPath, projectLadder, selectionOf, subprojectLocation } from "../src/core/navigation/projectLadder";

function mapOf(subprojects: Record<string, string[]>): ProjectMap {
  return {
    project: { id: "demo", title: "Demo project", schemaVersion: 1 },
    subprojects: Object.entries(subprojects).map(([id, componentIds]) => ({ id, title: id.toUpperCase(), componentIds })),
    components: Object.values(subprojects).flat().map((id) => ({ id, label: `Component ${id}` }))
  } as unknown as ProjectMap;
}

const CATALOG: ViewCatalog = {
  schema: "datapass.view-catalog/1",
  entries: [
    { artifactKind: "*", level: "project", views: [{ id: "map", title: "Map", layout: "graph", bindings: [{ source: "project-map" }] }] },
    { artifactKind: "*", level: "subproject", views: [
      { id: "map", title: "Map", layout: "graph", bindings: [{ source: "project-map" }] },
      { id: "lineage", title: "Lineage", layout: "graph", bindings: [{ source: "lineage" }] }] },
    { artifactKind: "*", level: "artifact", views: [
      { id: "detail", title: "Detail", layout: "detail-card", bindings: [{ source: "evidence" }] },
      { id: "lineage", title: "Lineage", layout: "graph", bindings: [{ source: "lineage" }] }] }
  ]
};

test("nav: starts at the project root and walks the ladder down and up", () => {
  const map = mapOf({ ingest: ["a", "b"], serve: ["c"] });
  const nav = new NavigationService(projectLadder(() => map), CATALOG);
  assert.deepEqual(nav.state.location, { level: "project", nodeId: "demo", artifactKind: "project" });
  assert.equal(nav.canUp(), false);
  nav.dispatch({ type: "down" });
  assert.deepEqual(nav.state.location, subprojectLocation("ingest"));
  nav.dispatch({ type: "down", childId: "b" });
  assert.deepEqual(nav.state.location, componentLocation("b"));
  assert.equal(nav.canDown(), false);
  nav.dispatch({ type: "down" });
  assert.deepEqual(nav.state.location, componentLocation("b"), "down at a leaf is unchanged");
  nav.dispatch({ type: "up" });
  assert.deepEqual(nav.state.location, subprojectLocation("ingest"));
  nav.dispatch({ type: "home" });
  assert.equal(nav.state.location.level, "project");
});

test("nav: views cycle with left/right, keep their id across locations, and history goes back and forward", () => {
  const map = mapOf({ ingest: ["a"] });
  const nav = new NavigationService(projectLadder(() => map), CATALOG);
  nav.dispatch({ type: "go", location: subprojectLocation("ingest") });
  assert.equal(nav.state.viewId, "map");
  nav.dispatch({ type: "right" });
  assert.equal(nav.state.viewId, "lineage");
  nav.dispatch({ type: "right" });
  assert.equal(nav.state.viewId, "map", "right wraps");
  nav.dispatch({ type: "left" });
  nav.dispatch({ type: "down" });
  assert.equal(nav.state.viewId, "lineage", "the same view id when the new location offers it");
  nav.dispatch({ type: "back" });
  assert.deepEqual(nav.state.location, subprojectLocation("ingest"));
  nav.dispatch({ type: "forward" });
  assert.deepEqual(nav.state.location, componentLocation("a"));
  assert.deepEqual(nav.views().map((v) => v.id), ["detail", "lineage"]);
});

test("nav: listeners hear real changes only", () => {
  const map = mapOf({ ingest: ["a"] });
  const nav = new NavigationService(projectLadder(() => map), CATALOG);
  const heard: NavChange[] = [];
  const sub = nav.onDidChange((e) => heard.push(e));
  nav.dispatch({ type: "up" });
  nav.dispatch({ type: "go", location: nav.state.location });
  assert.equal(heard.length, 0);
  nav.dispatch({ type: "down" });
  assert.equal(heard.length, 1);
  assert.deepEqual(heard[0]!.command, { type: "down" });
  sub.dispose();
  nav.dispatch({ type: "up" });
  assert.equal(heard.length, 1);
});

test("nav: a reloaded project keeps the location when it still exists, else goes home and drops dead history", () => {
  let map = mapOf({ ingest: ["a"], serve: ["c"] });
  const nav = new NavigationService(projectLadder(() => map), CATALOG);
  nav.dispatch({ type: "go", location: componentLocation("a") });
  nav.dispatch({ type: "go", location: componentLocation("c") });
  map = mapOf({ ingest: ["a"], serve: ["c", "d"] });
  nav.setLadder(projectLadder(() => map));
  assert.deepEqual(nav.state.location, componentLocation("c"));
  map = mapOf({ ingest: ["a"] });
  nav.setLadder(projectLadder(() => map));
  assert.equal(nav.state.location.level, "project");
  assert.ok(nav.state.back.every((l) => l.nodeId !== "c"));
});

test("nav: user overrides reorder, hide and rename views", () => {
  const map = mapOf({ ingest: ["a"] });
  const nav = new NavigationService(projectLadder(() => map), CATALOG);
  nav.dispatch({ type: "go", location: componentLocation("a") });
  nav.setCatalog(CATALOG, { schema: "datapass.view-overrides/1", entries: [{ artifactKind: "other", level: "artifact", order: ["lineage"], titles: { lineage: "Upstream" } }] });
  assert.deepEqual(nav.views().map((v) => `${v.id}:${v.title}`), ["lineage:Upstream", "detail:Detail"]);
  assert.equal(nav.state.viewId, "detail", "the current view is kept when still offered");
});

test("ladder: labels, path and the session selection bridge", () => {
  const map = mapOf({ ingest: ["a"] });
  const ladder = projectLadder(() => map);
  const a = componentLocation("a");
  assert.deepEqual(locationPath(ladder, a).map((l) => locationLabel(map, l)), ["Demo project", "INGEST", "Component a"]);
  assert.deepEqual(selectionOf(a, ladder), { subproject: "ingest", component: "a" });
  assert.deepEqual(locationOf({ subproject: "ingest", component: "a" }, map), a);
  assert.deepEqual(locationOf({ component: "gone" }, map).level, "project", "an unknown selection falls back to the root");
});
