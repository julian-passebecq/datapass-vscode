/**
 * V5 PEDA3: query showcase cards — the SQL technique tagger is pure (comments and strings ignored), the
 * interview-value score is pure and documented, cards cite the project (span, lineage tables, technique ids) and
 * show typed holes instead of invented context or samples, the top 5 of a fixture project is deterministic, and a
 * project with no facts gets general cards marked datapass-guidance.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { showcaseBinding, showcaseCard } from "../src/core/peda-showcase/assemble";
import { complexityFactor, FLOOR, lineageDegrees, rarityFactor, scoreQueries, topQueries, type QueryFact } from "../src/core/peda-showcase/score";
import { EMPTY_SHAPE, queryShape, SQL_TECHNIQUE_IDS, tagSqlTechniques, TECHNIQUE_WEIGHTS } from "../src/core/peda-showcase/techniques";
import { factsFromUnderstanding } from "../src/core/peda-showcase/facts";
import type { UnderstandingDoc } from "../src/core/understanding/contract";

const q = (id: string, techniques: string[], read: string[], written: string[], shape: Partial<typeof EMPTY_SHAPE> = {}): QueryFact => ({
  id, repositoryKey: "repo", path: `sql/${id}.sql`, span: { startLine: 1, endLine: 10 }, language: "sql", title: id,
  techniques, shape: { ...EMPTY_SHAPE, statements: 1, ...shape }, tablesRead: read, tablesWritten: written, origin: "static"
});

const FIXTURE: QueryFact[] = [
  q("stg_orders", [], ["raw.orders", "raw.customers"], ["stg.orders"], { joins: 1 }),
  q("stg_payments", [], ["raw.payments"], ["stg.payments"]),
  q("int_order_payments", ["cte", "having"], ["stg.orders", "stg.payments"], ["int.order_payments"], { joins: 1, aggregates: 1, ctes: 2 }),
  q("dim_customer", ["merge", "row-number-rank"], ["stg.orders"], ["dim.customer"], { statements: 2, windows: 1 }),
  q("fct_revenue", ["cte", "lag-lead", "date-trunc"], ["int.order_payments", "dim.customer"], ["mart.revenue"], { windows: 2, ctes: 1 }),
  q("rpt_pivot", ["pivot"], ["mart.revenue"], ["rpt.revenue_by_month"], { aggregates: 1 }),
  q("adhoc_lookup", [], ["dim.customer"], [], { joins: 1 }),
  q("churned", ["anti-join", "count-distinct"], ["raw.customers"], ["rpt.churned"], { subqueries: 1 })
];

test("tagger: token match on stripped text, comments and strings ignored", () => {
  const sql = `-- MERGE INTO is mentioned in a comment only
WITH paid AS (SELECT * FROM orders WHERE note <> 'pivot(x)'),
     ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY ts) rn, LAG(amount) OVER (ORDER BY ts) prev FROM paid)
SELECT DATE_TRUNC('month', ts) m, COUNT(DISTINCT id) FROM ranked r
WHERE NOT EXISTS (SELECT 1 FROM refunds f WHERE f.id = r.id)
GROUP BY 1 HAVING COUNT(*) > 1 /* pivot ( */`;
  assert.deepEqual(tagSqlTechniques(sql), ["cte", "row-number-rank", "lag-lead", "date-trunc", "having", "count-distinct", "anti-join"]);
  assert.deepEqual(tagSqlTechniques("SELECT * FROM emp e JOIN emp m ON e.mgr = m.id"), ["self-join"]);
  assert.deepEqual(tagSqlTechniques("MERGE INTO dim t USING stg s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1"), ["merge"]);
  assert.deepEqual(tagSqlTechniques("SELECT * INTO #tmp FROM a JOIN b ON a.id = b.id"), [], "T-SQL #temp is not a comment");
  assert.deepEqual(tagSqlTechniques("df.groupBy('m').pivot('k').sum('v')  # .merge( in a comment", true), ["pivot"]);
  const s = queryShape("WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a JOIN b ON 1=1 UNION SELECT x FROM (SELECT 1) GROUP BY x");
  assert.deepEqual(s, { joins: 1, ctes: 2, subqueries: 1, windows: 0, aggregates: 1, setOps: 1, statements: 1 });
  assert.deepEqual(TECHNIQUE_WEIGHTS.map(t => t.id), [...SQL_TECHNIQUE_IDS]);
});

test("score: factors are pure, bounded and documented", () => {
  assert.equal(rarityFactor([]), FLOOR);
  assert.ok(rarityFactor(["pivot"]) > rarityFactor(["having"]));
  assert.ok(Math.abs(rarityFactor(["lag-lead", "merge"]) - (1 - 0.45 * 0.4)) < 1e-9);
  assert.equal(complexityFactor(EMPTY_SHAPE, []), FLOOR);
  assert.ok(complexityFactor({ ...EMPTY_SHAPE, windows: 3, ctes: 4 }, ["lag-lead"]) <= 1);
  assert.ok(complexityFactor({ ...EMPTY_SHAPE, joins: 3 }, []) > complexityFactor({ ...EMPTY_SHAPE, joins: 1 }, []));
  for (const s of scoreQueries(FIXTURE)) {
    assert.ok(s.score > 0 && s.score <= 1, s.fact.id);
    assert.ok(Math.abs(s.score - s.rarity * s.complexity * s.centrality) < 1e-12);
  }
});

test("score: lineage centrality counts other queries upstream and downstream (table names case-insensitive)", () => {
  const d = lineageDegrees([q("a", [], [], ["T"]), q("b", [], ["t"], ["u"]), q("c", [], ["U"], [])]);
  assert.deepEqual([...d], [["a", 1], ["b", 2], ["c", 1]]);
});

test("fixture project: top 5 is deterministic and ranked by interview value", () => {
  const top = topQueries(FIXTURE, 5).map(s => s.fact.id);
  assert.deepEqual(top, topQueries([...FIXTURE].reverse(), 5).map(s => s.fact.id), "order of facts does not matter");
  assert.equal(top[0], "fct_revenue");
  assert.ok(!top.includes("stg_payments"), "a plain copy is not worth showing");
  const scores = topQueries(FIXTURE, 8).map(s => s.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(top.length, 5);
});

test("card: cites the project and shows typed holes, never invented context or samples", () => {
  const [s] = scoreQueries([FIXTURE[4]!]);
  const { card, holes } = showcaseCard(s!, { facts: FIXTURE });
  const field = (k: string) => card.fields.find(f => f.label === `showcase.${k}`)!.value as { value: unknown; origin: string };
  assert.equal(field("query").value, "repo/sql/fct_revenue.sql:1-10");
  assert.equal(field("tables").value, "int.order_payments (read), dim.customer (read), mart.revenue (write)");
  assert.equal(field("techniques").value, "lag-lead, cte, date-trunc");
  assert.equal(field("context").value, null);
  assert.equal(field("sample").value, null);
  assert.deepEqual(holes.map(h => h.kind).sort(), ["missing-rationale", "missing-sample"]);
  assert.equal(field("tip").origin, "datapass-guidance");

  const filled = showcaseCard(s!, { facts: FIXTURE,
    context: new Map([["fct_revenue", { text: "Monthly revenue for finance", origin: "decision-rationale" as const }]]),
    samples: new Map([["fct_revenue", { columns: ["month", "revenue"], rowCount: 12, origin: "xray-sample" as const }]]) });
  assert.equal(filled.holes.length, 0);
  assert.deepEqual(filled.card.fields.find(f => f.label === "showcase.sample")!.value, { value: "month, revenue (12 rows)", origin: "xray-sample" });

  const bare = showcaseCard(scoreQueries([FIXTURE[1]!])[0]!, { facts: [FIXTURE[1]!] });
  assert.ok(bare.holes.some(h => h.kind === "missing-technique"));
});

test("binding: no facts → general cards marked datapass-guidance with a missing-facts hole", () => {
  const b = showcaseBinding({ facts: [] }, 3);
  assert.equal(b.origin, "datapass-guidance");
  assert.equal(b.cards!.length, 3);
  assert.ok(b.cards!.every(c => c.origin === "datapass-guidance" && !c.nodeId));
  assert.equal(b.holes[0]!.kind, "missing-facts");
  assert.equal(showcaseBinding({ facts: FIXTURE }, 5).cards!.length, 5);
});

test("facts: a Hop bridge explanation + the code text → an ai-proposed fact tagged by the tagger", () => {
  const doc = { format: "datapass.understanding", version: 1, title: "Latest order", summary: "Keeps the latest order per customer",
    target: { repository: "repo", path: "q/latest.sql", sha256: "0".repeat(64), language: "sql" },
    steps: [
      { id: "s1", title: "read", kind: "read", lines: [2, 2], inputs: ["raw.orders"], provenance: "declared" },
      { id: "s2", title: "rank", kind: "transform", lines: [3, 3], provenance: "declared" },
      { id: "s3", title: "write", kind: "write", lines: [4, 4], outputs: ["silver.latest"], provenance: "declared" }]
  } as UnderstandingDoc;
  const code = "-- header\nSELECT * FROM raw.orders\nQUALIFY ROW_NUMBER() OVER (PARTITION BY cid ORDER BY ts DESC) = 1\n-- into silver.latest\nSELECT 'after span'";
  const got = factsFromUnderstanding("repo", doc, code)!;
  assert.deepEqual(got.fact.span, { startLine: 2, endLine: 4 });
  assert.deepEqual(got.fact.techniques, ["row-number-rank"]);
  assert.equal(got.fact.origin, "ai-proposed");
  assert.deepEqual([got.fact.tablesRead, got.fact.tablesWritten], [["raw.orders"], ["silver.latest"]]);
  assert.deepEqual(got.context, { text: "Keeps the latest order per customer", origin: "ai-proposed" });
  assert.deepEqual(factsFromUnderstanding("repo", doc)!.fact.techniques, [], "no code on this machine: no tags, never guessed");
  assert.equal(factsFromUnderstanding("repo", { ...doc, target: { ...doc.target, language: "bicep" } }), undefined);
});
