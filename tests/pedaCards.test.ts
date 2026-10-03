/**
 * V5 PEDA1b: pedagogy cards cite the project's code — a concept card takes the most focused matching span (pure,
 * deterministic), falls back to its generic example marked datapass-guidance; a decision card shows the option the
 * project took (decision-rationale record first, then facts) or turns its `ask` into a class-A owner question.
 * Settings switch concept / decision cards; tour refs `concept:` / `decision:` resolve or stay unknown.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readRationaleDocument, type DecisionRationale } from "@juliandatapass-group/decision-rationale";
import { bindConcept, bindDecision, cardByRef, cardsForArtifact, cardsForConcepts, conceptCardView, decisionCardView, type ProjectFact } from "../src/core/peda-cards/bind";
import { CARD_ENTRIES, CardCatalogError, parseCardCatalog } from "../src/core/peda-cards/cardTypes";
import { blankComments, factsFromCode, factsFromUnderstanding } from "../src/core/peda-cards/facts";
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

// V5HOLE9 (V5 acceptance row 10): the card catalog is data (resources/pedagogy/cards.json), generic, checked on load;
// concept spans come from the catalog's code signals on the file text; decision records name the option and alternatives.
const SHOP = "tests/fixtures/v5/shop";
const shopFile = "dbt/models/staging/stg_orders.sql";
const shopText = readFileSync(`${SHOP}/${shopFile}`, "utf8");
const shopRecords = readRationaleDocument(JSON.parse(readFileSync(`${SHOP}/.datapass/decisions/rationale.json`, "utf8"))).accepted;

test("catalog: the cards are data, generic, and every concept card has a question, an example and takeaways", () => {
  const raw = readFileSync("resources/pedagogy/cards.json", "utf8");
  assert.doesNotMatch(raw, /foil/i, "no client content in the built-in cards");
  assert.deepEqual(parseCardCatalog(JSON.parse(raw)).map(e => e.id), CARD_ENTRIES.map(e => e.id));
  const concepts = CARD_ENTRIES.filter(e => e.card);
  assert.ok(concepts.length >= 5);
  for (const e of concepts) {
    assert.ok(e.card!.question && e.card!.codeExample.text && e.card!.takeaways.length, e.id);
    assert.ok(e.card!.codeSignals?.length, `${e.id}: a concept card says how the code shows it`);
  }
  assert.equal(new Set(CARD_ENTRIES.map(e => e.id)).size, CARD_ENTRIES.length);
});

test("catalog: a malformed document is refused, not half-loaded", () => {
  const good = JSON.parse(readFileSync("resources/pedagogy/cards.json", "utf8"));
  const bad = (mutate: (d: any) => void) => { const d = structuredClone(good); mutate(d); return () => parseCardCatalog(d); };
  assert.throws(bad(d => { d.schema = "x"; }), CardCatalogError);
  assert.throws(bad(d => { d.entries.push(d.entries[0]); }), /duplicate id/);
  assert.throws(bad(d => { d.entries[0].card.family = "nope"; }), /unknown concept family/);
  assert.throws(bad(d => { d.entries[0].card.codeSignals = ["("]; }), /bad codeSignal/);
  assert.throws(bad(d => { d.entries.find((e: any) => e.decisionCard).decisionCard.options = ["none", "other"]; }), /two ids/);
  assert.throws(bad(d => { d.entries.find((e: any) => e.decisionCard).decisionCard.ask.constraint = "mood"; }), /known constraint/);
  assert.throws(bad(d => { d.entries.find((e: any) => e.decisionCard?.concepts).decisionCard.concepts = ["concept.layout.partition-key"]; }), /not a concept card/);
});

test("facts: catalog code signals give static spans per line; comments never count", () => {
  const facts = factsFromCode("", shopFile, shopText, CARD_ENTRIES);
  assert.deepEqual(facts.map(f => [f.signal, f.at.startLine, f.origin]), [["concept:concept.sql.cte", 2, "static"], ["concept:concept.sql.row-number-dedup", 12, "static"]]);
  assert.deepEqual(factsFromCode("", "a.sql", "-- row_number() over (x)\n/* merge into t\n*/ select 1", CARD_ENTRIES), []);
  assert.deepEqual(factsFromCode("", "a.py", "# broadcast(x)\ndf.join(broadcast(small), 'id')", CARD_ENTRIES).map(f => [f.signal, f.at.startLine]), [["concept:concept.spark-perf.join-strategy", 2]]);
  assert.equal(blankComments("a /* b\nc */ d"), "a     \n     d", "line structure kept");
});

test("V5-10 shop: the concept card cites the file and line, the decision card shows the option taken and the alternative", () => {
  const facts = factsFromCode("", shopFile, shopText, CARD_ENTRIES);
  const data = cardsForArtifact({ entries: CARD_ENTRIES, facts, rationales: shopRecords, repositoryKey: "" }, "", shopFile);
  const card = (id: string) => data.cards!.find(c => c.id === id)!;
  const text = (id: string, label: string) => String((card(id).fields.find(f => f.label === label)!.value as { value: string }).value);
  assert.equal(text("concept:concept.sql.row-number-dedup", "pedagogy.excerpt"), `${shopFile}:12-12`);
  assert.equal(card("concept:concept.sql.row-number-dedup").origin, "static");
  const d = "decision:concept.modelling.dedup-strategy";
  assert.equal(text(d, "pedagogy.projectChoice"), `Keep the latest row per key (row-number-latest) @ ${shopFile}:12-12`);
  assert.equal(text(d, "pedagogy.alternatives"), "MERGE into a silver Delta table");
  assert.equal(card(d).origin, "owner-stated");
  assert.equal(card("concept:concept.sql.merge-upsert").origin, "datapass-guidance", "the other option, explained generically");
  assert.ok(!data.holes!.some(h => h.reason.startsWith("concept.modelling.dedup-strategy")), "the record answers the decision: no owner question");
});

test("V5-10-HOLE shop-bare: no record → class-A owner question, the spanless concept is the datapass-guidance card", () => {
  const facts = factsFromCode("", shopFile, shopText, CARD_ENTRIES);
  const data = cardsForArtifact({ entries: CARD_ENTRIES, facts, rationales: [], repositoryKey: "" }, "", shopFile);
  const dedup = data.cards!.find(c => c.id === "decision:concept.modelling.dedup-strategy")!;
  assert.ok(dedup.fields.some(f => f.label === "pedagogy.ownerQuestion"));
  assert.ok(!dedup.fields.some(f => f.label === "pedagogy.projectChoice"), "never a guessed answer");
  assert.ok(data.holes!.some(h => h.kind === "owner-question" && h.reason.startsWith("concept.modelling.dedup-strategy: class A")));
  assert.equal(data.cards!.find(c => c.id === "concept:concept.sql.merge-upsert")?.origin, "datapass-guidance");
  assert.doesNotMatch(JSON.stringify(data.cards), /row-number-latest/);
});

test("decision cards naming concepts open only for a file that uses one of them", () => {
  const data = cardsForArtifact({ entries: CARD_ENTRIES, facts: [uses("concept.sql.cte", "a.sql", 1, 4)], repositoryKey: "repo" }, "repo", "a.sql");
  assert.ok(!data.cards!.some(c => c.id === "decision:concept.modelling.dedup-strategy"));
  assert.ok(!data.cards!.some(c => c.id === "concept:concept.sql.merge-upsert"));
});
