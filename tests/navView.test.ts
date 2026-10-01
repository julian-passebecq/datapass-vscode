import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackRender, navViewHtml, navViewTitle, parseNavViewMessage, surfaceCommand } from "../src/views/navViewHtml";
import { bindingProvider, bindingSources, resolveBindings } from "../src/core/navigation/bindings";
import type { ViewDef } from "../src/core/navigation/navTypes";
import type { ProjectMap } from "../src/core/project/projectMap";

const table: ViewDef = { id: "map", title: "Map", layout: "table", bindings: [{ source: "project-map" }] };

const map = {
  project: { id: "p", title: "Demo", schemaVersion: 2 },
  subprojects: [{ id: "ingest", title: "Ingest", componentIds: ["nb1"], health: "ok", summary: { components: 1 }, nextStep: "none" }],
  components: [{ id: "nb1", label: "Load <raw>", kind: "notebook", headline: "ready", nextStep: "run", incoming: [], outgoing: [] }]
} as unknown as ProjectMap;

test("title follows the configured format", () => {
  assert.equal(navViewTitle("{location} · {view} {n}/{N}", "Ingest", table, 1, 3), "Ingest · Map 2/3");
  assert.equal(navViewTitle("{view}", "x", undefined, 0, 0), "");
});

test("messages off the protocol are dropped", () => {
  assert.deepEqual(parseNavViewMessage({ type: "nav", command: { type: "left" } }), { type: "nav", command: { type: "left" } });
  assert.deepEqual(parseNavViewMessage({ type: "nav", command: { type: "down", childId: "nb1" } }), { type: "nav", command: { type: "down", childId: "nb1" } });
  assert.deepEqual(parseNavViewMessage({ type: "select", nodeId: "nb1" }), { type: "select", nodeId: "nb1" });
  assert.deepEqual(parseNavViewMessage({ type: "nav", command: { type: "go", location: { level: "artifact", nodeId: "nb1", artifactKind: "spark-notebook" } } })?.type, "nav");
  for (const bad of [null, "x", { type: "run" }, { type: "nav", command: { type: "exec" } }, { type: "nav", command: { type: "down", childId: 5 } },
    { type: "nav", command: { type: "go", location: { level: "galaxy", nodeId: "a", artifactKind: "x" } } }, { type: "select", nodeId: "" },
    { type: "nav", command: { type: "view", viewId: "x".repeat(600) } }]) {
    assert.equal(parseNavViewMessage(bad), undefined, JSON.stringify(bad));
  }
});

test("surface views map to DataPass commands only", () => {
  const surface: ViewDef = { id: "wb", title: "Diagram", layout: "surface", bindings: [], surface: "workbench" };
  assert.equal(surfaceCommand(surface, { workbench: "datapass.openWorkbench" }), "datapass.openWorkbench");
  assert.equal(surfaceCommand(surface, { workbench: "workbench.action.terminal.sendSequence" }), undefined);
  assert.equal(surfaceCommand(surface, {}), undefined);
  assert.equal(surfaceCommand(table, { workbench: "datapass.openWorkbench" }), undefined);
});

test("project-map binding answers by level, holes otherwise", () => {
  assert.ok(bindingSources().includes("project-map"));
  const p = bindingProvider("project-map")!;
  assert.deepEqual(p.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" }, projectMap: map }).rows?.map(r => r.id), ["ingest"]);
  assert.deepEqual(p.provide({ location: { level: "subproject", nodeId: "ingest", artifactKind: "subproject" }, projectMap: map }).rows?.map(r => r.id), ["nb1"]);
  const art = p.provide({ location: { level: "artifact", nodeId: "nb1", artifactKind: "spark-notebook" }, projectMap: map });
  assert.equal(art.cards?.at(0)?.title, "Load <raw>");
  assert.ok(art.cards!.at(0)!.fields.every(f => f.origin === "static"));
  assert.equal(p.provide({ location: { level: "step", nodeId: "s", artifactKind: "spark-notebook" }, projectMap: map }).holes.length, 1);
  assert.equal(p.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" } }).holes.length, 1);
});

test("unknown binding source is a hole, not a guess", () => {
  const view: ViewDef = { id: "v", title: "V", layout: "table", bindings: [{ source: "lineage" }] };
  const [d] = resolveBindings(view, { location: { level: "project", nodeId: "p", artifactKind: "project" }, projectMap: map });
  assert.equal(d?.result.holes.length, 1);
});

test("fallback rendering escapes data and the page carries the nonce CSP", () => {
  const data = resolveBindings(table, { location: { level: "subproject", nodeId: "ingest", artifactKind: "subproject" }, projectMap: map });
  const body = fallbackRender(table, data);
  assert.ok(body.includes("Load &lt;raw&gt;") && !body.includes("<raw>"));
  const html = navViewHtml({ cspSource: "vscode-resource:", nonce: "N1", title: "A <b>", body, canUp: true, canDown: false, viewCount: 1 });
  assert.ok(html.includes("script-src 'nonce-N1'") && html.includes("A &lt;b&gt;"));
  assert.ok(/data-nav="down"[^>]*disabled/.test(html) && /data-nav="left"[^>]*disabled/.test(html));
});
