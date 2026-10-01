/**
 * V4-NAV NAVREN1: the one view renderer, pure part — host messages are validated, the shell and the table,
 * detail-card and surface layouts turn binding data into a node tree with an origin badge on every value and
 * typed holes with their reason; labels come from the host, unknown layouts show a typed hole.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { NavState, ViewDef } from "../src/core/navigation/navStub";
import { parseHostMessage, type BindingData, type VNode } from "../src/webview/views/model";
import { navDownCommand, registeredLayouts, registerLayout, screenModel, SVG_NS, toDom } from "../src/webview/views/renderer";
import { viewHtml } from "../src/views/viewHtml";

const state: NavState = { location: { level: "artifact", nodeId: "nb_sales", artifactKind: "spark-notebook" }, viewId: "cols", back: [], forward: [] };
const views: ViewDef[] = [
  { id: "cols", title: "Columns", layout: "table", bindings: [{ source: "sql-shape" }] },
  { id: "card", title: "Detail", layout: "detail-card", bindings: [{ source: "evidence" }] },
  { id: "dag", title: "Diagram", layout: "surface", surface: "workbench.diagram", bindings: [] }];
const labels = { "origin.static": "static", "origin.observed": "observed", "column.name": "Name", "surface.open": "Open" };

const all = (n: VNode): VNode[] => [n, ...(n.children ?? []).flatMap(all)];
const byCls = (n: VNode, cls: string) => all(n).filter(x => x.cls?.split(" ").includes(cls));
const texts = (n: VNode) => all(n).map(x => x.text).filter(Boolean);

test("built-in layouts registered", () => {
  for (const k of ["detail-card", "surface", "table"]) assert.ok(registeredLayouts().includes(k), k); // other kinds register in their own files
});

test("table: rows, origin badge per value (cell origin wins), typed holes, selectable rows", () => {
  const data: BindingData[] = [{ source: "sql-shape", origin: "static", columns: ["name", "type"],
    rows: [{ nodeId: "col:a", cells: { name: "a", type: { value: "int", origin: "observed" } } }, { cells: { name: "b" } }],
    holes: [{ reason: "no schema for table x", kind: "missing-schema", field: "x" }] }];
  const m = screenModel({ state, views, labels, data });
  const badges = byCls(m, "nv-origin").map(b => b.text);
  assert.deepEqual(badges, ["static", "observed", "static"]);
  assert.ok(texts(m).includes("Name"), "column label from host labels");
  const sel = all(m).filter(n => n.on?.action === "select");
  assert.equal(sel.length, 1);
  assert.equal(sel[0]!.attrs?.tabindex, "0");
  const hole = byCls(m, "nv-hole")[0]!;
  assert.equal(hole.attrs?.["data-hole-kind"], "missing-schema");
  assert.ok(texts(hole).includes("no schema for table x"));
  const tabs = all(m).filter(n => n.attrs?.["data-view-id"]);
  assert.deepEqual(tabs.map(t => t.attrs?.["aria-selected"]), ["true", "false", "false"]);
});

test("detail-card: fields with origin; empty data says so; loading before data", () => {
  const s = { ...state, viewId: "card" };
  const data: BindingData[] = [{ source: "evidence", origin: "static", holes: [],
    cards: [{ id: "c1", title: "nb_sales", origin: "observed", fields: [{ label: "rows", value: 120 }, { label: "owner", value: null }] }] }];
  const m = screenModel({ state: s, views, labels, data });
  assert.deepEqual(byCls(m, "nv-origin").map(b => b.text), ["observed", "observed"]);
  assert.ok(texts(m).includes("120"));
  assert.ok(texts(screenModel({ state: s, views, labels, data: [] })).includes("view.noCards"));
  assert.equal(byCls(screenModel({ state: s, views, labels, data: null }), "nv-loading").length, 1);
});

test("surface: open button asks the host; missing surface is a typed hole", () => {
  const m = screenModel({ state: { ...state, viewId: "dag" }, views, labels, data: null });
  const btn = all(m).find(n => n.on?.action === "open-surface")!;
  assert.deepEqual(btn.on, { action: "open-surface", surface: "workbench.diagram" });
  const noSurf = screenModel({ state: { ...state, viewId: "x" }, views: [{ id: "x", title: "X", layout: "surface", bindings: [] }], labels, data: [] });
  assert.equal(byCls(noSurf, "nv-hole")[0]!.attrs?.["data-hole-kind"], "no-surface");
});

test("unregistered layout kind is a typed hole; registering one draws it", () => {
  const v: ViewDef[] = [{ id: "m", title: "M", layout: "metrics", bindings: [] }];
  const s = { ...state, viewId: "m" };
  assert.equal(byCls(screenModel({ state: s, views: v, labels, data: [] }), "nv-hole")[0]!.attrs?.["data-hole-kind"], "layout-unregistered");
  registerLayout("metrics", () => ({ tag: "div", cls: "metrics-ok" }));
  assert.equal(byCls(screenModel({ state: s, views: v, labels, data: [] }), "metrics-ok").length, 1);
});

test("host messages: valid ones parse, off-shape ones are dropped, labels keep strings only", () => {
  const ok = parseHostMessage({ type: "nav-state", state, views, labels: { a: "A", b: 3 } });
  assert.equal(ok?.type, "nav-state");
  assert.deepEqual(ok?.type === "nav-state" && ok.labels, { a: "A" });
  assert.equal(parseHostMessage({ type: "nav-state", state: { location: {} }, views }), null);
  assert.equal(parseHostMessage({ type: "view-data", viewId: "cols", data: [{ source: "s", origin: "static", holes: [{}] }] }), null);
  assert.equal(parseHostMessage({ type: "view-data", viewId: "cols", data: [{ source: "s", origin: "static", holes: [], rows: [{ cells: {} }] }] })?.type, "view-data");
  assert.equal(parseHostMessage("<script>"), null);
  assert.equal(parseHostMessage({ type: "eval" }), null);
});

test("toDom: svg subtree created with createElementNS; data-nav-dblclick maps to nav down", () => {
  const made: { tag: string; ns: string | null }[] = [];
  const el = () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, set textContent(_: string) {} });
  const doc = { createElement: (tag: string) => (made.push({ tag, ns: null }), el()),
    createElementNS: (ns: string, tag: string) => (made.push({ tag, ns }), el()) } as unknown as Document;
  toDom({ tag: "div", children: [{ tag: "svg", children: [{ tag: "g", children: [{ tag: "rect", attrs: { "data-nav-dblclick": "t1" } }] }] }] }, doc, () => {});
  assert.deepEqual(made.map(m => [m.tag, m.ns]), [["div", null], ["svg", SVG_NS], ["g", SVG_NS], ["rect", SVG_NS]]);
  assert.deepEqual(navDownCommand("t1"), { type: "down", childId: "t1" });
  assert.deepEqual(navDownCommand(""), { type: "down" });
});

test("html shell: nonce script, strict CSP, escaped title, mount point", () => {
  const html = viewHtml({ cspSource: "vscode-resource:", nonce: "N1", scriptUri: "dist/navView.js", title: "<x>Nav" });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-N1'/);
  assert.match(html, /<title>xNav<\/title>/);
  assert.match(html, /id="nav-root"/);
});
