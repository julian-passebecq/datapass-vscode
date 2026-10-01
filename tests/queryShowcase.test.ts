/**
 * V5 PEDA3: query showcase cards — the interview-value score is pure and documented, cards cite the project
 * (span, lineage tables, technique ids) and show typed holes instead of invented context or samples, the top 5
 * of a fixture project is deterministic, and a project with no facts gets general cards marked datapass-guidance.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { complexityFactor, FLOOR, lineageDegrees, rarityFactor, scoreQueries, showcaseBinding, showcaseCard, topQueries, type QueryFact } from "../src/core/pedagogy/queryShowcase/showcase";
import { detectFromSqlTrees, EMPTY_SHAPE, SQL_TECHNIQUES, type StaticSqlNode } from "../src/core/pedagogy/queryShowcase/techniques";
import { factsFromSqlTrees, factsFromUnderstanding } from "../src/core/pedagogy/queryShowcase/facts";
import type { UnderstandingDoc } from "../src/core/understanding/contract";

const q = (id: string, techniques: string[], read: string[], written: string[], shape: Partial<typeof EMPTY_SHAPE> = {}): QueryFact => ({
  id, repositoryKey: "repo", path: `sql/${id}.sql`, span: { startLine: 1, endLine: 10 }, language: "sql", title: id,
  techniques, shape: { ...EMPTY_SHAPE, statements: 1, ...shape }, tablesRead: read, tablesWritten: written, origin: "static"
});

const FIXTURE: QueryFact[] = [
  q("stg_orders", ["sql.join"], ["raw.orders", "raw.customers"], ["stg.orders"], { joins: 1 }),
  q("stg_payments", [], ["raw.payments"], ["stg.payments"]),
  q("int_order_payments", ["sql.join", "sql.aggregate", "card.sql-technique.cte"], ["stg.orders", "stg.payments"], ["int.order_payments"], { joins: 1, aggregates: 1, ctes: 2 }),
  q("dim_customer_scd2", ["card.sql-technique.merge", "sql.scd2"], ["stg.orders"], ["dim.customer"], { statements: 2 }),
  q("fct_revenue", ["card.spark-sql.window-functions", "sql.qualify", "card.sql-technique.cte"], ["int.order_payments", "dim.customer"], ["mart.revenue"], { windows: 2, ctes: 1 }),
  q("rpt_rollup", ["sql.rollup-cube", "sql.aggregate"], ["mart.revenue"], ["rpt.revenue_rollup"], { aggregates: 1 }),
  q("adhoc_lookup", ["sql.join"], ["dim.customer"], [], { joins: 1 }),
  q("org_tree", ["sql.recursive-cte", "card.sql-technique.cte"], ["raw.employees"], ["dim.org"], { ctes: 1 })
];

test("score: factors are pure, bounded and documented", () => {
  assert.equal(rarityFactor([]), FLOOR);
  assert.ok(rarityFactor(["sql.recursive-cte"]) > rarityFactor(["sql.join"]));
  assert.ok(Math.abs(rarityFactor(["card.spark-sql.window-functions", "sql.qualify"]) - (1 - 0.45 * 0.3)) < 1e-9);
  assert.equal(complexityFactor(EMPTY_SHAPE, []), FLOOR);
  assert.ok(complexityFactor({ ...EMPTY_SHAPE, windows: 3, ctes: 4 }, ["card.spark-sql.window-functions"]) <= 1);
  assert.ok(complexityFactor({ ...EMPTY_SHAPE, joins: 3 }, []) > complexityFactor({ ...EMPTY_SHAPE, joins: 1 }, []));
  for (const s of scoreQueries(FIXTURE)) {
    assert.ok(s.score > 0 && s.score <= 1, s.fact.id);
    assert.ok(Math.abs(s.score - s.rarity * s.complexity * s.centrality) < 1e-12);
  }
  for (const t of SQL_TECHNIQUES) assert.ok(t.rarity >= 0 && t.rarity <= 1, t.id);
});

test("score: lineage centrality counts other queries upstream and downstream (table names case-insensitive)", () => {
  const d = lineageDegrees([q("a", [], [], ["T"]), q("b", [], ["t"], ["u"]), q("c", [], ["U"], [])]);
  assert.deepEqual([...d], [["a", 1], ["b", 2], ["c", 1]]);
});

test("fixture project: top 5 is deterministic and ranked by interview value", () => {
  const top = topQueries(FIXTURE, 5).map(s => s.fact.id);
  assert.deepEqual(top, topQueries([...FIXTURE].reverse(), 5).map(s => s.fact.id), "order of facts does not matter");
  assert.equal(top.length, 5);
  assert.equal(top[0], "fct_revenue");
  assert.ok(!top.includes("stg_payments"), "a plain copy is not worth showing");
  const scores = topQueries(FIXTURE, 8).map(s => s.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.deepEqual(top, ["fct_revenue", "dim_customer_scd2", "int_order_payments", "rpt_rollup", "org_tree"]);
});

test("card: cites the project and shows typed holes, never invented context or samples", () => {
  const [s] = scoreQueries([FIXTURE[4]!]);
  const { card, holes } = showcaseCard(s!, { facts: FIXTURE });
  const field = (k: string) => card.fields.find(f => f.label === `showcase.${k}`)!.value as { value: unknown; origin: string };
  assert.equal(field("query").value, "repo/sql/fct_revenue.sql:1-10");
  assert.equal(field("tables").value, "int.order_payments (read), dim.customer (read), mart.revenue (write)");
  assert.equal(field("techniques").value, "sql.qualify, card.spark-sql.window-functions, card.sql-technique.cte");
  assert.equal(field("context").value, null);
  assert.equal(field("sample").value, null);
  assert.deepEqual(holes.map(h => h.kind).sort(), ["missing-rationale", "missing-sample"]);
  assert.equal(field("tip").origin, "datapass-guidance");

  const filled = showcaseCard(s!, { facts: FIXTURE,
    context: new Map([["fct_revenue", { text: "Monthly revenue for finance", origin: "decision-rationale" as const }]]),
    samples: new Map([["fct_revenue", { columns: ["month", "revenue"], rowCount: 12, origin: "xray-sample" as const }]]) });
  assert.equal(filled.holes.length, 0);
  assert.deepEqual(filled.card.fields.find(f => f.label === "showcase.sample")!.value, { value: "month, revenue (12 rows)", origin: "xray-sample" });
  assert.deepEqual(filled.card.fields.find(f => f.label === "showcase.context")!.value, { value: "Monthly revenue for finance", origin: "decision-rationale" });

  const bare = showcaseCard(scoreQueries([FIXTURE[1]!])[0]!, { facts: [FIXTURE[1]!] });
  assert.ok(bare.holes.some(h => h.kind === "missing-technique"));
});

test("binding: no facts → general cards marked datapass-guidance with a missing-facts hole", () => {
  const b = showcaseBinding({ facts: [] }, 3);
  assert.equal(b.origin, "datapass-guidance");
  assert.equal(b.cards!.length, 3);
  assert.ok(b.cards!.every(c => c.origin === "datapass-guidance" && !c.nodeId));
  assert.equal(b.holes[0]!.kind, "missing-facts");
  const p = showcaseBinding({ facts: FIXTURE }, 5);
  assert.equal(p.cards!.length, 5);
  assert.ok(p.cards!.every(c => c.nodeId));
});

const n = (type: string, args: Record<string, StaticSqlNode[]> = {}, value?: string | boolean): StaticSqlNode => ({ type, args: new Map(Object.entries(args)), ...(value !== undefined ? { value } : {}) });

test("techniques: detected from SQLGlot node types and flags only", () => {
  const tree = n("Select", {
    with: [n("With", { recursive: [n("Boolean", {}, true)], expressions: [n("CTE"), n("CTE")] })],
    joins: [n("Join", { kind: [n("Var", {}, "anti")] }), n("Join", { side: [n("Var", {}, "full")] })],
    expressions: [n("Window", { this: [n("Sum")] }), n("Window", { this: [n("RowNumber")] })],
    having: [n("Having")],
    qualify: [n("Qualify")],
    group: [n("Group", { expressions: [n("Rollup")] })]
  });
  const { techniques, shape } = detectFromSqlTrees([tree, n("Merge")]);
  assert.deepEqual(techniques, ["card.spark-sql.window-functions", "card.sql-technique.anti-join", "card.sql-technique.cte", "card.sql-technique.having", "card.sql-technique.merge", "card.sql-technique.row-number", "sql.aggregate", "sql.full-outer-join", "sql.join", "sql.qualify", "sql.recursive-cte", "sql.rollup-cube"]);
  assert.deepEqual(shape, { joins: 2, ctes: 2, subqueries: 0, windows: 2, aggregates: 1, setOps: 0, statements: 2 });
  const f = factsFromSqlTrees({ repositoryKey: "r", path: "a/b.sql", span: { startLine: 3, endLine: 9 }, dialect: "spark", trees: [tree], tablesRead: ["x", "x"], tablesWritten: ["y"] });
  assert.equal(f.language, "spark-sql");
  assert.deepEqual(f.tablesRead, ["x"]);
  assert.equal(f.origin, "static");
});

test("facts: a Hop bridge explanation becomes an ai-proposed fact with its summary as context", () => {
  const doc = { format: "datapass.understanding", version: 1, title: "Orders enrichment", summary: "Joins orders to customers",
    target: { repository: "repo", path: "jobs/enrich.py", sha256: "0".repeat(64), language: "pyspark" },
    steps: [
      { id: "s1", title: "read", kind: "read", lines: [4, 6], inputs: ["raw.orders"], provenance: "declared" },
      { id: "s2", title: "join", kind: "join", lines: [8, 12], provenance: "declared" },
      { id: "s3", title: "write", kind: "write", lines: [14, 15], outputs: ["silver.orders"], provenance: "declared" }],
    joins: [{ id: "j1", step: "s2", left: "orders", right: "customers", type: "left", keys: [["cid", "id"]], provenance: "declared" }]
  } as UnderstandingDoc;
  const got = factsFromUnderstanding("repo", doc)!;
  assert.deepEqual(got.fact.span, { startLine: 4, endLine: 15 });
  assert.equal(got.fact.origin, "ai-proposed");
  assert.deepEqual(got.fact.tablesRead, ["raw.orders"]);
  assert.deepEqual(got.fact.tablesWritten, ["silver.orders"]);
  assert.deepEqual(got.context, { text: "Joins orders to customers", origin: "ai-proposed" });
  assert.equal(factsFromUnderstanding("repo", { ...doc, target: { ...doc.target, language: "bicep" } }), undefined);
});
