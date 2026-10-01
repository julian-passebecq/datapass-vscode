/**
 * V5 PEDA1b: pedagogy cards cite the project's code — a concept card takes the most focused matching span (pure,
 * deterministic), falls back to its generic example marked datapass-guidance; a decision card shows the option the
 * project took (decision-rationale record first, then facts) or turns its `ask` into a class-A owner question.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import { bindConcept, bindDecision, cardsForArtifact, cardsForConcepts, conceptCardView, decisionCardView, type ProjectFact } from "../src/core/pedagogy/projectCards/bind";
import { PEDAGOGY_CARDS } from "../src/core/pedagogy/projectCards/catalogStub";
import { factsFromUnderstanding } from "../src/core/pedagogy/projectCards/facts";
import type { UnderstandingDoc } from "../src/core/understanding/contract";

const card = (id: string) => PEDAGOGY_CARDS.find(c => c.id === id)!;
const at = (path: string, startLine: number, endLine: number) => ({ repositoryKey: "repo", path, startLine, endLine });
const tech = (id: string, path: string, s: number, e: number): ProjectFact => ({ signal: `technique:${id}`, at: at(path, s, e), origin: "static" });

test("concept: the most focused matching span wins, deterministically", () => {
  const facts = [tech("card.sql-technique.cte", "b.sql", 1, 40), tech("card.sql-technique.cte", "c.sql", 5, 9), tech("card.sql-technique.cte", "a.sql", 10, 14), tech("card.sql-technique.merge", "a.sql", 1, 2)];
  const b = bindConcept(card("card.sql-technique.cte"), facts);
  assert.deepEqual(b.excerpt, { source: "project", at: at("a.sql", 10, 14), origin: "static", others: 2 });
  assert.deepEqual(bindConcept(card("card.sql-technique.cte"), [...facts].reverse()).excerpt, b.excerpt);
  const v = conceptCardView(b);
  assert.equal(v.nodeId, "repo/a.sql");
  assert.deepEqual(v.fields.find(f => f.label === "pedagogy.excerpt")!.value, { value: "repo/a.sql:10-14", origin: "static" });
  assert.ok(!v.fields.some(f => f.label === "pedagogy.example"), "the project span replaces the generic example");
});

test("concept: no span → the generic example, marked datapass-guidance", () => {
  const b = bindConcept(card("card.sql-technique.anti-join"), [tech("card.sql-technique.cte", "a.sql", 1, 2)]);
  assert.equal(b.excerpt.source, "guidance");
  assert.equal(b.excerpt.origin, "datapass-guidance");
  const v = conceptCardView(b);
  assert.equal(v.origin, "datapass-guidance");
  assert.equal(v.nodeId, undefined);
  assert.match(String((v.fields.find(f => f.label === "pedagogy.example")!.value as { value: string }).value), /NOT EXISTS/);
});

const rationale = (decisionPoint: string, option: string | null): DecisionRationale => ({
  decisionPoint, choice: { option, summary: "Partitioned by event_date" }, origin: "owner-stated", subjects: [{ kind: "path", id: "models/events.sql" }],
  why: [{ constraint: "volume", driver: "daily filter", rule: null, evidence: [{ path: "models/events.sql", startLine: 3, endLine: 5, cell: null, excerpt: null }] }]
} as unknown as DecisionRationale);

test("decision: a decision-rationale record wins and says where", () => {
  const d = card("decision.storage-decisions.partition-or-not");
  const b = bindDecision(d, [{ signal: "partitioning", at: at("x.sql", 1, 1), origin: "static", option: 0 }], [rationale(d.id, "partition")], "repo");
  assert.equal(b.ask, undefined);
  assert.deepEqual(b.taken, [{ option: "partition", summary: "Partitioned by event_date", at: at("models/events.sql", 3, 5), origin: "owner-stated" }]);
});

test("decision: else facts show the option(s) taken, each with a jump", () => {
  const d = card("decision.storage-decisions.partition-or-not");
  const facts: ProjectFact[] = [
    { signal: "partitioning", at: at("b.sql", 1, 3), origin: "static", option: 1, detail: "PARTITIONED BY (event_date)" },
    { signal: "partitioning", at: at("a.sql", 1, 3), origin: "static", option: 1 },
    { signal: "partitioning", at: at("c.sql", 2, 2), origin: "static", option: 0 }];
  const b = bindDecision(d, facts);
  assert.deepEqual(b.taken.map(t => [t.option, t.at?.path]), [["No partitioning", "c.sql"], ["Partition by the main filter column", "a.sql"]]);
  const v = decisionCardView(b);
  assert.equal(v.holes.length, 0);
  assert.equal(v.card.fields.filter(f => f.label === "pedagogy.projectChoice").length, 2);
});

test("decision: no record, no fact → class-A owner question, never a guessed answer", () => {
  const d = card("decision.recovery-change.retry-or-stop");
  const b = bindDecision(d, [{ signal: "partitioning", at: at("a.sql", 1, 1), origin: "static", option: 1 }]);
  assert.deepEqual(b.taken, []);
  assert.equal(b.ask?.class, "A");
  assert.equal(b.ask?.text, d.decisionCard!.ask.text);
  const v = decisionCardView(b);
  assert.ok(!v.card.fields.some(f => f.label === "pedagogy.projectChoice"));
  assert.deepEqual(v.holes.map(h => h.kind), ["owner-question"]);
  assert.equal(v.card.origin, "datapass-guidance");
});

test("entry points: artifact level keeps this file's cards; principle cards keep the fallback", () => {
  const inputs = { cards: PEDAGOGY_CARDS, facts: [tech("card.sql-technique.cte", "a.sql", 1, 4), tech("card.sql-technique.merge", "b.sql", 1, 4)], repositoryKey: "repo" };
  const a = cardsForArtifact(inputs, "repo", "a.sql");
  assert.ok(a.cards!.some(c => c.id === "pedagogy:card.sql-technique.cte"));
  assert.ok(!a.cards!.some(c => c.id === "pedagogy:card.sql-technique.merge"));
  assert.ok(a.cards!.some(c => c.id === "pedagogy:decision.recovery-change.retry-or-stop"), "open decisions of a file with facts are listed");
  assert.equal(a.origin, "static");
  const p = cardsForConcepts(inputs, ["card.sql-technique.anti-join", "card.sql-technique.merge"]);
  assert.deepEqual(p.cards!.map(c => [c.id, c.origin]), [["pedagogy:card.sql-technique.anti-join", "datapass-guidance"], ["pedagogy:card.sql-technique.merge", "static"]]);
});

test("facts: a Hop bridge explanation yields ai-proposed technique facts at step spans", () => {
  const doc = { format: "datapass.understanding", version: 1, title: "t", summary: "s",
    target: { repository: "repo", path: "q.sql", sha256: "0".repeat(64), language: "sql" },
    steps: [{ id: "s1", title: "Latest row per customer (ROW_NUMBER over)", kind: "transform", lines: [3, 8], provenance: "declared" },
      { id: "s2", title: "Customers without orders", kind: "join", lines: [10, 14], provenance: "declared" }],
    joins: [{ id: "j", step: "s2", left: "c", right: "o", type: "anti", keys: [["id", "cid"]], provenance: "declared" }] } as UnderstandingDoc;
  const facts = factsFromUnderstanding("repo", doc);
  assert.deepEqual(facts.map(f => [f.signal, f.at.startLine, f.origin]).sort(), [
    ["technique:card.spark-sql.window-functions", 3, "ai-proposed"], ["technique:card.sql-technique.anti-join", 10, "ai-proposed"]]);
});
