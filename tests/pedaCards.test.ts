/**
 * V5 PEDA1b: pedagogy cards cite the project's code — a concept card takes the most focused matching span (pure,
 * deterministic), falls back to its generic example marked datapass-guidance; a decision card shows the option the
 * project took (decision-rationale record first, then facts) or turns its `ask` into a class-A owner question.
 * Settings switch concept / decision cards; tour refs `concept:` / `decision:` resolve or stay unknown.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import { bindConcept, bindDecision, cardByRef, cardsForArtifact, cardsForConcepts, conceptCardView, decisionCardView, type ProjectFact } from "../src/core/peda-cards/bind";
import { CARD_ENTRIES } from "../src/core/peda-cards/cardTypes";
import { factsFromUnderstanding } from "../src/core/peda-cards/facts";
import type { UnderstandingDoc } from "../src/core/understanding/contract";

const entry = (id: string) => CARD_ENTRIES.find(c => c.id === id)!;
const at = (path: string, startLine: number, endLine: number) => ({ repositoryKey: "repo", path, startLine, endLine });
const uses = (id: string, path: string, s: number, e: number): ProjectFact => ({ signal: `concept:${id}`, at: at(path, s, e), origin: "static" });

test("concept: the most focused matching span wins, deterministically", () => {
  const facts = [uses("concept.sql.cte", "b.sql", 1, 40), uses("concept.sql.cte", "c.sql", 5, 9), uses("concept.sql.cte", "a.sql", 10, 14), uses("concept.sql.anti-join-nulls", "a.sql", 1, 2)];
  const b = bindConcept(entry("concept.sql.cte"), facts);
  assert.deepEqual(b.excerpt, { source: "project", at: at("a.sql", 10, 14), origin: "static", others: 2 });
  assert.deepEqual(bindConcept(entry("concept.sql.cte"), [...facts].reverse()).excerpt, b.excerpt);
  const v = conceptCardView(b);
  assert.equal(v.id, "concept:concept.sql.cte");
  assert.equal(v.nodeId, "repo/a.sql");
  assert.deepEqual(v.fields.find(f => f.label === "pedagogy.excerpt")!.value, { value: "repo/a.sql:10-14", origin: "static" });
  assert.ok(!v.fields.some(f => f.label === "pedagogy.example"), "the project span replaces the generic example");
});

test("concept: no span → the generic example, marked datapass-guidance", () => {
  const b = bindConcept(entry("concept.sql.anti-join-nulls"), [uses("concept.sql.cte", "a.sql", 1, 2)]);
  assert.equal(b.excerpt.source, "guidance");
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
  const e = entry("concept.layout.partition-key");
  const b = bindDecision(e, [{ signal: "partitioning", at: at("x.sql", 1, 1), origin: "static", option: "none" }], [rationale(e.id, "by-filter-column")], "repo");
  assert.equal(b.ask, undefined);
  assert.deepEqual(b.taken, [{ option: "by-filter-column", label: "Partition by the main filter column", summary: "Partitioned by event_date", at: at("models/events.sql", 3, 5), origin: "owner-stated" }]);
});

test("decision: else facts show the option(s) taken (option ids), each with a jump", () => {
  const e = entry("concept.layout.partition-key");
  const facts: ProjectFact[] = [
    { signal: "partitioning", at: at("b.sql", 1, 3), origin: "static", option: "by-filter-column", detail: "PARTITIONED BY (event_date)" },
    { signal: "partitioning", at: at("a.sql", 1, 3), origin: "static", option: "by-filter-column" },
    { signal: "partitioning", at: at("c.sql", 2, 2), origin: "static", option: "none" },
    { signal: "partitioning", at: at("d.sql", 1, 1), origin: "static", option: "not-an-option" }];
  const b = bindDecision(e, facts);
  assert.deepEqual(b.taken.map(t => [t.option, t.at?.path]), [["none", "c.sql"], ["by-filter-column", "a.sql"]]);
  const v = decisionCardView(b);
  assert.equal(v.holes.length, 0);
  assert.equal(v.card.id, "decision:concept.layout.partition-key");
  assert.equal(v.card.fields.filter(f => f.label === "pedagogy.projectChoice").length, 2);
});

test("decision: no record, no fact → class-A owner question, never a guessed answer", () => {
  const e = entry("concept.architecture.retry-policy");
  const b = bindDecision(e, [{ signal: "partitioning", at: at("a.sql", 1, 1), origin: "static", option: "none" }]);
  assert.deepEqual(b.taken, []);
  assert.equal(b.ask?.class, "A");
  assert.equal(b.ask?.text, e.decisionCard!.ask.text);
  const v = decisionCardView(b);
  assert.ok(!v.card.fields.some(f => f.label === "pedagogy.projectChoice"));
  assert.deepEqual(v.holes.map(h => h.kind), ["owner-question"]);
  assert.equal(v.card.origin, "datapass-guidance");
});

test("entry points and settings: artifact level, principle cards, tour refs", () => {
  const inputs = { entries: CARD_ENTRIES, facts: [uses("concept.sql.cte", "a.sql", 1, 4), uses("concept.spark-perf.join-strategy", "b.py", 1, 4)], repositoryKey: "repo" };
  const a = cardsForArtifact(inputs, "repo", "a.sql");
  const ids = a.cards!.map(c => c.id);
  assert.ok(ids.includes("concept:concept.sql.cte"));
  assert.ok(!ids.includes("concept:concept.spark-perf.join-strategy"));
  assert.ok(ids.includes("decision:concept.architecture.retry-policy"), "open decisions of a file with facts are listed");
  assert.equal(a.origin, "static");
  const off = cardsForArtifact({ ...inputs, settings: { conceptCards: true, decisionCards: false } }, "repo", "a.sql");
  assert.ok(off.cards!.every(c => c.id.startsWith("concept:")));
  const p = cardsForConcepts(inputs, ["concept.sql.anti-join-nulls", "concept.sql.cte"]);
  assert.deepEqual(p.cards!.map(c => [c.id, c.origin]), [["concept:concept.sql.cte", "static"], ["concept:concept.sql.anti-join-nulls", "datapass-guidance"]]);
  assert.equal(cardByRef(inputs, "decision:concept.layout.partition-key")?.card.id, "decision:concept.layout.partition-key");
  assert.equal(cardByRef(inputs, "concept:concept.layout.partition-key"), undefined, "a decision-only entry has no concept card");
  assert.equal(cardByRef(inputs, "concept:concept.nope"), undefined);
  assert.equal(cardByRef({ ...inputs, settings: { conceptCards: false, decisionCards: true } }, "concept:concept.sql.cte"), undefined);
});

test("facts: a Hop bridge explanation yields ai-proposed concept facts at step spans", () => {
  const doc = { format: "datapass.understanding", version: 1, title: "t", summary: "s",
    target: { repository: "repo", path: "q.py", sha256: "0".repeat(64), language: "pyspark" },
    steps: [{ id: "s1", title: "Broadcast the country lookup", kind: "join", lines: [3, 8], provenance: "declared" },
      { id: "s2", title: "Customers without orders", kind: "join", lines: [10, 14], provenance: "declared" }],
    joins: [{ id: "j", step: "s2", left: "c", right: "o", type: "anti", keys: [["id", "cid"]], provenance: "declared" }] } as UnderstandingDoc;
  assert.deepEqual(factsFromUnderstanding("repo", doc).map(f => [f.signal, f.at.startLine, f.origin]).sort(), [
    ["concept:concept.spark-perf.join-strategy", 3, "ai-proposed"], ["concept:concept.sql.anti-join-nulls", 10, "ai-proposed"]]);
});
