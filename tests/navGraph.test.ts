/**
 * V4-NAV NAVREN2: the `graph` layout kind draws a view-spi GraphView with the diagram layout and look — lanes for
 * groups, edges as SVG paths styled from the preset, the Location node selected, select on click, down on
 * double-click, a legend, and a typed hole (never a guess) for an off-shape DTO.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { NavLocation, ViewDef } from "../src/core/navigation/navTypes";
import type { BindingData, VNode } from "../src/webview/views/model";
import { graphModel, isGraphView, styleColor, type GraphViewLike } from "../src/webview/views/layouts/graph";

const all = (n: VNode): VNode[] => [n, ...(n.children ?? []).flatMap(all)];
const byCls = (n: VNode, cls: string) => all(n).filter(x => x.cls?.split(" ").includes(cls));
const view: ViewDef = { id: "lineage", title: "Lineage", layout: "graph", bindings: [{ source: "lineage" }] };
const loc: NavLocation = { level: "artifact", nodeId: "tbl:sales", artifactKind: "spark-notebook" };
const ns = { shape: "rounded", color: "lineage.dataset", border: "solid", icon: null };
const es = { line: "solid", color: "#336699", width: 2, arrow: "target" };
const gv: GraphViewLike = {
  schema: "datapass.graph-view/1",
  groups: [{ id: "group:bronze", label: "Bronze", memberCount: 1, collapsed: false, color: "#aa5500" }],
  nodes: [
    { id: "n:raw", kind: "dataset", label: "raw", groupId: "group:bronze", origin: "static", certain: true, memberIds: ["tbl:raw"], style: ns },
    { id: "n:job", kind: "job", label: "nb_sales", groupId: null, origin: "static", certain: true, memberIds: ["nb:sales"], style: ns },
    { id: "n:sales", kind: "dataset", label: "sales", groupId: null, origin: "ai-proposed", certain: false, memberIds: ["tbl:sales"], style: ns }],
  edges: [
    { id: "e1", fromId: "n:raw", toId: "n:job", kinds: ["reads"], origin: "static", certain: true, volumetry: { label: "1.2 M rows/day" }, style: es },
    { id: "e2", fromId: "n:job", toId: "n:sales", kinds: ["writes"], origin: "ai-proposed", certain: false, volumetry: null, style: { ...es, line: "dotted" } }],
  legend: [{ label: "Dataset", target: "node", ruleId: "ds", nodeStyle: ns, edgeStyle: null }]
};
const draw = (data: BindingData[]) => graphModel({ view, data, labels: { "origin.static": "static", "view.noGraph": "No graph" }, location: loc });

test("graph: nodes, lanes, SVG edges with preset style, legend", () => {
  const out = draw([{ source: "lineage", origin: "static", holes: [], graph: gv }]);
  const nodes = byCls(out, "nv-graph-node");
  assert.equal(nodes.length, 3);
  assert.deepEqual(byCls(out, "lane").map(l => l.children?.[0]?.text), ["Bronze", "graph.ungrouped"]);
  const svg = all(out).find(n => n.tag === "svg")!;
  const paths = all(svg).filter(n => n.attrs?.["data-edge-id"]);
  assert.equal(paths.length, 2);
  assert.equal(paths[0]!.attrs!.stroke, "#336699");
  assert.match(paths[0]!.children![0]!.text!, /raw → nb_sales · reads · static · 1\.2 M rows\/day/);
  assert.equal(paths[1]!.attrs!["stroke-dasharray"], "6 4", "uncertain edge is dashed");
  assert.equal(byCls(out, "nv-legend")[0]!.children!.length, 1);
});

test("graph: Location node selected, click selects, double-click goes down", () => {
  const out = draw([{ source: "lineage", origin: "static", holes: [], graph: gv }]);
  const cur = byCls(out, "nv-current");
  assert.equal(cur.length, 1);
  assert.equal(cur[0]!.attrs!["data-node-id"], "n:sales");
  assert.equal(cur[0]!.attrs!["aria-current"], "location");
  const job = byCls(out, "nv-graph-node").find(n => n.attrs!["data-node-id"] === "n:job")!;
  assert.deepEqual(job.on, { action: "select", nodeId: "n:job" });
  assert.equal(job.attrs!["data-nav-dblclick"], "n:job");
  assert.match(job.attrs!.style!, /--nv-accent:var\(--vscode-charts-/);
});

test("graph: off-shape DTO is a typed hole, no graph is an empty note", () => {
  const bad = draw([{ source: "lineage", origin: "static", holes: [], graph: { schema: "datapass.graph-view/1", nodes: "x" } }]);
  assert.equal(byCls(bad, "nv-hole")[0]!.attrs!["data-hole-kind"], "graph-invalid");
  assert.equal(byCls(draw([]), "nv-empty")[0]!.text, "No graph");
  assert.equal(isGraphView(gv), true);
});

test("styleColor: hex as is, token as theme variable with fallback", () => {
  assert.equal(styleColor("#123456", "x"), "#123456");
  assert.equal(styleColor("lineage.dataset", "red"), "var(--nv-color-lineage-dataset, red)");
});

test("the renderer registers the graph kind and the shell CSS carries its look", async () => {
  const { registeredLayouts } = await import("../src/webview/views/renderer");
  const { navViewCss } = await import("../src/views/viewHtml");
  assert.ok(registeredLayouts().includes("graph"));
  assert.match(navViewCss(), /\.nv-graph \.node/);
});
