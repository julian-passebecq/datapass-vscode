/**
 * NAVCTX2: Context sections process step, why/alternatives, patterns. Synthetic, generic data.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolveProcessStep } from "../src/core/navigation/context/processStep";
import { resolveWhy, type RationaleInput } from "../src/core/navigation/context/why";
import { resolvePatterns, type ConceptInput } from "../src/core/navigation/context/patterns";
import type { NavLocation } from "../src/core/navigation/navTypes";

const nb: NavLocation = { level: "artifact", nodeId: "node:sales_nb", artifactKind: "spark-notebook" };

const rationale = (id: string, origin: RationaleInput["origin"], subjects: RationaleInput["subjects"], decisionPoint: string | null = "concept.spark-perf.join"): RationaleInput => ({
  id, decisionPoint, subjects, origin, confidence: "medium", problemSolved: "large join",
  choice: { option: "broadcast", summary: "broadcast the small dimension" },
  why: [{ constraint: "volume", driver: "dimension < 10 MB" }],
  alternatives: [{ option: "sort-merge", label: "Sort-merge", whenBetter: "both sides large", costRisk: "shuffle", whyNotHere: "dimension is small" }],
  tradeoffs: ["driver memory"]
});

const concept = (id: string, domain: string, scale: string, detectors: string[] = []): ConceptInput => ({
  id, domain, scale, detectors, title: id, concept: "plain explanation", decisionPoint: id, signals: ["s"],
  options: [{ id: "broadcast", title: "Broadcast", rightWhen: ["small"], wrongWhen: ["big"], cost: "memory", risk: "OOM" }]
});

test("process step: furthest step with a proving fact is current; missing steps are holes", () => {
  const r = resolveProcessStep(nb, [
    { kind: "source.notebook", origin: "static" },
    { kind: "deploy.pipeline", origin: "static" },
    { kind: "detectorish", origin: "static" }
  ]);
  assert.equal(r.current, "deploy");
  assert.deepEqual(r.cards.filter(c => c.reached).map(c => c.step), ["understand", "deploy"]);
  assert.equal(r.cards.find(c => c.current)?.title, "Deploy");
  assert.ok(r.holes.some(h => h.reason.startsWith("Observe") && h.fill === "run-observe"));
});

test("process step: no fact = one hole, null step; labels are data", () => {
  const r = resolveProcessStep(nb, [], undefined, { steps: { understand: "U", design: "D", build: "B", deploy: "P", observe: "O", optimize: "Z" }, missing: "{step}?", none: "nothing" });
  assert.equal(r.current, null);
  assert.deepEqual(r.holes, [{ reason: "nothing", fill: "scan" }]);
});

test("why: node and path subjects match, owner-stated first, origin carried", () => {
  const rs = [
    rationale("r-ai", "ai-proposed", [{ kind: "lineage-node", id: "node:sales_nb" }]),
    rationale("r-owner", "owner-stated", [{ kind: "path", id: "notebooks/" }]),
    rationale("r-other", "owner-stated", [{ kind: "lineage-node", id: "node:other" }])
  ];
  const r = resolveWhy(nb, rs, { paths: ["notebooks\\sales.ipynb"] });
  assert.deepEqual(r.cards.map(c => c.rationaleId), ["r-owner", "r-ai"]);
  assert.equal(r.origin, "owner-stated");
  assert.equal(r.cards[0]?.alternatives[0]?.whyNotHere, "dimension is small");
  assert.equal(r.holes.length, 0);
});

test("why: no rationale = ask-the-AI hole, never invented text", () => {
  const r = resolveWhy(nb, [rationale("r", "owner-stated", [{ kind: "path", id: "notebooks2" }])], { paths: ["notebooks/x.ipynb"] });
  assert.equal(r.cards.length, 0);
  assert.deepEqual(r.holes, [{ reason: "No rationale yet for node:sales_nb: ask the AI", fill: "ask-ai" }]);
});

test("patterns: fact > detector > artifact kind; chosen option from rationale; level scales filter", () => {
  const cs = [
    concept("concept.spark-perf.join", "spark-perf", "medium"),
    concept("concept.layout.partitioning", "layout", "medium", ["small-files"]),
    concept("concept.cost.capacity", "cost", "macro"),
    concept("concept.query-perf.index", "query-perf", "micro", []),
    concept("concept.spark-perf.named", "spark-perf", "macro")
  ];
  const facts = [
    { kind: "concept:concept.spark-perf.named", origin: "ai-confirmed" as const },
    { kind: "detector:small-files", origin: "static" as const }
  ];
  const r = resolvePatterns(nb, facts, cs, { rationales: [rationale("r", "owner-stated", [])] });
  assert.deepEqual(r.cards.map(c => [c.conceptId, c.matchedBy]), [
    ["concept.spark-perf.named", "fact"], ["concept.layout.partitioning", "detector"], ["concept.spark-perf.join", "artifact-kind"]
  ]);
  assert.equal(r.cards[2]?.chosenOption, "broadcast");
  assert.equal(r.cards[2]?.origin, "theoretical");
  assert.equal(r.origin, "ai-confirmed");
  const op = resolvePatterns({ ...nb, level: "operation" }, [], [concept("concept.spark-perf.macro", "spark-perf", "macro")]);
  assert.equal(op.cards.length, 0);
  assert.equal(op.holes[0]?.fill, "add-catalogue-entry");
});

test("patterns: maxTheoretical caps only artifact-kind matches", () => {
  const cs = [concept("concept.spark-perf.a", "spark-perf", "medium"), concept("concept.spark-perf.b", "spark-perf", "medium", ["d"])];
  const r = resolvePatterns(nb, [{ kind: "detector:d", origin: "static" }], cs, { maxTheoretical: 0 });
  assert.deepEqual(r.cards.map(c => c.conceptId), ["concept.spark-perf.b"]);
});
