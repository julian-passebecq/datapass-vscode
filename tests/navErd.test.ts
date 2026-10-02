import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schemaErd, SQL_SYNTAX_FACTS, SEMANTIC_RELATIONSHIPS_FACT } from "../src/core/navigation/bindings/schemaErd";
import { erdModel, type VNode } from "../src/webview/views/layouts/erd.layout";
import { ERD_PACK } from "../src/core/navigation/packs/erd";

// Real SQLGlot 30.19.0 dump (tests/fixtures/naverd1/gen_fixture.py).
const facts = JSON.parse(readFileSync("tests/fixtures/naverd1/erd-sql-facts.json", "utf8"));
const walk = (n: VNode, f: (n: VNode) => void): void => { f(n); for (const c of n.children ?? []) walk(c, f); };
const find = (n: VNode, p: (n: VNode) => boolean): VNode[] => { const out: VNode[] = []; walk(n, x => { if (p(x)) out.push(x); }); return out; };

test("schema-erd: tables, columns, types and declared keys from SQL facts", () => {
  const d = schemaErd({ sqlFacts: [facts] });
  const t = new Map(d.graph.tables.map(x => [x.name, x]));
  assert.deepEqual([...t.keys()].sort(), ["dbo.customer", "dbo.orders", "dbo.payment", "dbo.region"]);
  const cust = t.get("dbo.customer")!;
  assert.deepEqual(cust.columns!.map(c => [c.name, c.type, c.pk, c.fk]), [["id", "INT", true, false], ["name", "NVARCHAR(100)", false, false], ["region_id", "INT", false, true]]);
  assert.equal(t.get("dbo.region")!.columns!.find(c => c.name === "region_id")!.pk, true, "table-level PRIMARY KEY");
  assert.equal(t.get("dbo.orders")!.columns!.find(c => c.name === "amount")!.type, "DECIMAL(10, 2)");
  const declared = d.graph.edges.filter(e => e.declared);
  assert.equal(declared.length, 2, "inline REFERENCES + table FOREIGN KEY deduped; ALTER ADD CONSTRAINT kept");
  const o2c = declared.find(e => e.from === "table:dbo.orders")!;
  assert.deepEqual([o2c.to, o2c.fromColumns, o2c.toColumns, o2c.cardinality, o2c.origin], ["table:dbo.customer", ["customer_id"], ["id"], "many-to-one", "static"]);
  assert.equal(declared.find(e => e.from === "table:dbo.customer")!.name, "fk_region");
});

test("schema-erd: joins are theoretical edges, unknown tables are holes, never guesses", () => {
  const d = schemaErd({ sqlFacts: [facts] });
  const inferred = d.graph.edges.filter(e => !e.declared);
  assert.equal(inferred.length, 1, "orders⋈customer covered by the FK; only payment⋈orders stays inferred");
  assert.deepEqual([inferred[0]!.from, inferred[0]!.to, inferred[0]!.origin, inferred[0]!.cardinality], ["table:dbo.payment", "table:dbo.orders", "theoretical", null]);
  const pay = d.graph.tables.find(t => t.name === "dbo.payment")!;
  assert.equal(pay.origin, "theoretical");
  assert.deepEqual(pay.columns!.map(c => [c.name, c.type, c.origin]), [["order_ref", null, "theoretical"]]);
  assert.ok(!d.holes.some(h => h.kind === "missing-keys"));
});

test("schema-erd: typed holes for missing, invalid and parse-error facts", () => {
  assert.deepEqual(schemaErd({}).holes.map(h => [h.kind, h.field]), [["missing-fact", SQL_SYNTAX_FACTS]]);
  assert.equal(schemaErd({ sqlFacts: [{ schema: "nope" }] }).holes[0]!.kind, "invalid-fact");
  const pe = { ...facts, kind: "parse-error", diagnostics: [{ line: 1, column: 1, description: "x" }] };
  delete (pe as Record<string, unknown>).statements;
  assert.equal(schemaErd({ sqlFacts: [pe] }).holes[0]!.kind, "parse-error");
  const pbi = schemaErd({ artifactKind: "powerbi" });
  assert.deepEqual(pbi.holes.map(h => h.field), [SEMANTIC_RELATIONSHIPS_FACT]);
});

test("schema-erd: semantic relationships when the host supplies them", () => {
  const d = schemaErd({ artifactKind: "powerbi", semanticRelationships: [{ fromTable: "Sales", fromColumn: "CustomerKey", toTable: "Customer", toColumn: "CustomerKey", cardinality: "many-to-one" }] });
  assert.deepEqual(d.holes.filter(h => h.kind === "missing-fact"), []);
  assert.equal(d.graph.edges[0]!.cardinality, "many-to-one");
  assert.equal(d.graph.edges[0]!.declared, true);
});

test("erd layout: boxes, PK/FK markers, solid vs dashed theoretical edges, select + down", () => {
  const data = [schemaErd({ sqlFacts: [facts] })];
  const labels = { "erd.pk": "PK", "erd.fk": "FK", "origin.theoretical": "theoretical", "erd.cardinality.many-to-one": "N:1" };
  const v = erdModel({ view: { id: "erd", title: "ERD" }, data, labels, color: id => `c(${id})` });
  const boxes = find(v, n => n.cls?.startsWith("nv-erd-table") ?? false);
  assert.equal(boxes.length, 4);
  const cust = boxes.find(b => b.attrs?.["data-node-id"] === "table:dbo.customer")!;
  assert.deepEqual(cust.on, { action: "select", nodeId: "table:dbo.customer" });
  assert.equal(cust.attrs!["data-nav-dblclick"], "down");
  assert.match(cust.attrs!.style!, /--nv-node-color:c\(table:dbo\.customer\)/);
  assert.ok(find(cust, n => n.text === "PK").length === 1 && find(cust, n => n.text === "FK").length === 1);
  const paths = find(v, n => n.tag === "path");
  assert.equal(paths.length, 3);
  assert.equal(paths.filter(p => p.attrs?.["stroke-dasharray"]).length, 1);
  assert.equal(find(v, n => n.cls === "nv-erd-edge-label" && n.text === "theoretical").length, 1);
  assert.equal(find(v, n => n.cls === "nv-erd-card" && n.text === "N:1").length, 2);
  // Referenced tables sit left of the tables that point to them.
  const x = (id: string) => Number(/left:(\d+)px/.exec(boxes.find(b => b.attrs?.["data-node-id"] === id)!.attrs!.style!)![1]);
  assert.ok(x("table:dbo.region") < x("table:dbo.customer") && x("table:dbo.customer") < x("table:dbo.orders"));
});

test("erd layout: bounded tables with a 'more' hole; empty state", () => {
  const tables = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, name: `t${i}`, kind: "table" as const, columns: [], origin: "static" as const }));
  const v = erdModel({ view: { id: "erd", title: "ERD" }, data: [{ source: "schema-erd", origin: "static", holes: [], graph: { kind: "erd", tables, edges: [] } }], labels: {}, maxTables: 3 });
  assert.equal(find(v, n => n.cls?.startsWith("nv-erd-table") ?? false).length, 3);
  assert.equal(find(v, n => n.attrs?.["data-hole-kind"] === "more").length, 1);
  const e = erdModel({ view: { id: "erd", title: "ERD" }, data: [], labels: { "erd.noTables": "none" } });
  assert.equal(find(e, n => n.text === "none").length, 1);
});

test("erd pack: ERD view for sql-script, dbt-model, powerbi and the subproject level", () => {
  assert.deepEqual(ERD_PACK.map(e => `${e.artifactKind}@${e.level}`), ["sql-script@artifact", "dbt-model@artifact", "powerbi@artifact", "subproject@subproject"]);
  assert.ok(ERD_PACK.every(e => e.views[0]!.layout === "erd" && e.views[0]!.bindings[0]!.source === "schema-erd"));
});

test("NAVWIRE1 adapters: schema-erd binding registered (missing-fact hole without facts), erd layout and pack self-registered", async () => {
  const { bindingProvider } = await import("../src/core/navigation/bindings");
  const p = bindingProvider("schema-erd");
  assert.ok(p, "schema-erd provider registered via *.binding.ts");
  const r = p!.provide({ location: { level: "artifact", nodeId: "a.sql", artifactKind: "sql-script" } });
  assert.ok(r.holes.some(h => /SQL syntax facts/.test(h.reason)));
  assert.equal((r.graph as unknown as { kind: string }).kind, "erd");
  const { LAYOUTS } = await import("../out/gen/layouts");
  assert.ok(LAYOUTS.some(l => l.kind === "erd"));
  const { PACKS } = await import("../out/gen/packs");
  for (const e of ERD_PACK) assert.ok(PACKS.includes(e as (typeof PACKS)[number]));
});
