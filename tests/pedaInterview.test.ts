/**
 * V5 PEDA2: interview prep — ranking is pure (uses × blast radius, unused notions dropped, deterministic ties, cut to
 * maxNotions clamped 10–20), each notion gets 2–3 card questions + where + why (record) or a typed hole, the spine
 * resolves to the project's nodes (root + hole when none), the three built-in tours are deterministic on a fixture
 * project and follow go/TOUR-PEDA-contract.md § 4, `project:` refs never invent text, and model answers come back
 * only through the manual exchange, stamped ai-proposed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import type { ProjectFact } from "../src/core/peda-cards/bind";
import { CARD_ENTRIES } from "../src/core/peda-cards/cardTypes";
import type { ProjectMap } from "../src/core/project/projectMap";
import type { NavLocation } from "../src/core/navigation/navTypes";
import { clampMaxNotions, prepNotion, rankNotions } from "../src/core/peda-interview/rank";
import { locateInMap, spineNodesFromMap, spineStops, rootOf, WHOLE_PICTURE_STEP_IDS } from "../src/core/peda-interview/spine";
import { interviewPrep } from "../src/core/peda-interview/prep";
import { resolveProjectRef } from "../src/core/peda-interview/projectTopics";
import { BUILTIN_TOUR_IDS } from "../src/core/peda-interview/builtinTours";
import { modelAnswersRequest, readModelAnswers, MODEL_ANSWERS_ANSWER_FORMAT } from "../src/core/peda-interview/modelAnswers";
import type { TourStep } from "../src/core/peda-interview/tourShape";

const at = (path: string, startLine: number, endLine: number, repositoryKey = "repo") => ({ repositoryKey, path, startLine, endLine });
const fact = (signal: string, path: string, s: number, e: number, extra: Partial<ProjectFact> = {}): ProjectFact => ({ signal, at: at(path, s, e), origin: "static", ...extra });

const FACTS: ProjectFact[] = [
  fact("concept:concept.sql.cte", "sql/stg_orders.sql", 1, 20),
  fact("concept:concept.sql.cte", "sql/fct_revenue.sql", 3, 9),
  fact("concept:concept.sql.cte", "sql/fct_revenue.sql", 12, 30),
  fact("concept:concept.sql.anti-join-nulls", "sql/churned.sql", 4, 8),
  fact("concept:concept.spark-perf.join-strategy", "jobs/enrich.py", 10, 12),
  fact("concept:concept.spark-perf.join-strategy", "jobs/enrich.py", 40, 41),
  fact("partitioning", "sql/fct_revenue.sql", 1, 2, { option: "by-filter-column" }),
  fact("retries", "dags/daily.py", 5, 6, { option: "unknown-option" }) // not one of the card's options: ignored
];

const RATIONALE = {
  decisionPoint: "concept.layout.partition-key", subjects: [{ kind: "path", id: "sql/fct_revenue.sql" }],
  choice: { option: "by-filter-column", summary: "Partition revenue by order date" }, problemSolved: "Daily revenue reporting for finance",
  why: [{ constraint: "volume", driver: "Most queries filter on order_date", rule: null, evidence: [{ path: "sql/fct_revenue.sql", startLine: 1, endLine: 2, cell: null, excerpt: null }] }],
  how: { mechanism: "PARTITIONED BY", evidence: [] },
  alternatives: [{ option: "none", label: "No partitioning", whenBetter: "small tables", costRisk: "full scans", whyNotHere: "the table grows daily" }],
  tradeoffs: [], revisitWhen: [], confidence: "medium", origin: "owner-stated", openQuestions: [], acceptedFindings: []
} as unknown as DecisionRationale;

const MAP = {
  project: { id: "shop", title: "Shop analytics", description: "Revenue and churn for the web shop", schemaVersion: 1 },
  subprojects: [{ id: "sp", title: "Reporting", objective: "Daily revenue by channel", componentIds: ["c.ingest", "c.lake", "c.sql", "c.jobs", "c.dag"] }],
  components: [
    { id: "c.ingest", label: "Ingest orders", kind: "notebook", incoming: [], outgoing: [1], artifacts: { repoKey: "repo", root: "ingest" }, providerId: "databricks" },
    { id: "c.lake", label: "Lakehouse", kind: "dataset", incoming: [1, 2], outgoing: [1], providerId: "databricks" },
    { id: "c.sql", label: "Revenue models", kind: "script", incoming: [1], outgoing: [], artifacts: { repoKey: "repo", root: "sql" } },
    { id: "c.jobs", label: "Spark jobs", kind: "script", incoming: [], outgoing: [], artifacts: { repoKey: "repo", root: "jobs" } },
    { id: "c.dag", label: "Daily DAG", kind: "workflow", incoming: [], outgoing: [1, 2], artifacts: { repoKey: "repo", root: "dags" }, provider: { label: "Airflow" } }
  ]
} as unknown as ProjectMap;

const viewAt = (l: NavLocation) => `view.${l.level}`;

function inputs(extra: Partial<Parameters<typeof interviewPrep>[0]> = {}) {
  return { entries: CARD_ENTRIES, facts: FACTS, rationales: [RATIONALE], repositoryKey: "repo", map: MAP, root: rootOf(MAP),
    spineNodes: spineNodesFromMap(MAP), locate: locateInMap(MAP), viewAt,
    queries: [{ title: "fct_revenue", location: locateInMap(MAP)(at("sql/fct_revenue.sql", 1, 1))! }], ...extra };
}

test("rank: uses × blast radius, unused notions dropped, ties deterministic", () => {
  const ranked = rankNotions({ entries: CARD_ENTRIES, facts: FACTS, rationales: [RATIONALE], repositoryKey: "repo" });
  assert.deepEqual(ranked.map(n => [n.ref, n.uses, n.blast, n.score]), [
    ["concept:concept.sql.cte", 3, 2, 6],
    ["decision:concept.layout.partition-key", 2, 1, 2],
    ["concept:concept.spark-perf.join-strategy", 2, 1, 2],
    ["concept:concept.sql.anti-join-nulls", 1, 1, 1]
  ].sort((a, b) => (b[3] as number) - (a[3] as number) || (b[2] as number) - (a[2] as number) || String(a[0]).localeCompare(String(b[0]))));
  assert.ok(!ranked.some(n => n.ref === "decision:concept.architecture.retry-policy"), "a fact with an unknown option is not a use");
  assert.deepEqual(rankNotions({ entries: CARD_ENTRIES, facts: [...FACTS].reverse(), rationales: [RATIONALE], repositoryKey: "repo" }).map(n => n.ref), ranked.map(n => n.ref));
  assert.equal(rankNotions({ entries: CARD_ENTRIES, facts: FACTS }, 2).length, 2);
  assert.equal(rankNotions({ entries: CARD_ENTRIES, facts: [] }).length, 0);
  // the most focused span first
  assert.deepEqual(ranked[0]!.spans[0], at("sql/fct_revenue.sql", 3, 9));
  // a second repository widens the blast radius
  const two = rankNotions({ entries: CARD_ENTRIES, facts: [...FACTS, { ...FACTS[3]!, at: at("sql/churned.sql", 1, 2, "other") }] });
  assert.equal(two.find(n => n.ref === "concept:concept.sql.anti-join-nulls")!.blast, 3);
});

test("rank: maxNotions is clamped 10–20, default 15", () => {
  assert.deepEqual([clampMaxNotions(undefined), clampMaxNotions(3), clampMaxNotions(12.4), clampMaxNotions(99), clampMaxNotions("x")], [15, 10, 12, 20, 15]);
});

test("prep: 2–3 card questions, where, why from a record or a typed hole", () => {
  const ranked = rankNotions({ entries: CARD_ENTRIES, facts: FACTS, rationales: [RATIONALE], repositoryKey: "repo" });
  const cte = prepNotion(ranked.find(n => n.ref === "concept:concept.sql.cte")!);
  assert.ok(cte.questions.length >= 2 && cte.questions.length <= 3);
  assert.equal(cte.step, "change");
  assert.equal(cte.where.length, 3);
  assert.equal(cte.why, null);
  assert.ok(cte.holes.some(h => h.kind === "missing-rationale"));
  const part = prepNotion(ranked.find(n => n.ref === "decision:concept.layout.partition-key")!);
  assert.equal(part.step, "live");
  assert.equal(part.why?.origin, "owner-stated");
  assert.match(part.why!.text, /order_date/);
  assert.match(part.alternative!.text, /^No partitioning: the table grows daily/);
  assert.deepEqual(part.holes, []);
});

test("spine: best node per step, project root + hole when none", () => {
  const stops = spineStops(spineNodesFromMap(MAP), rootOf(MAP));
  assert.deepEqual(stops.map(s => [s.step, s.location.nodeId, s.hole]), [
    ["arrive", "c.ingest", false], ["live", "c.lake", false], ["change", "c.sql", false], ["run", "c.dag", false], ["trust", "shop", true]
  ]);
  assert.equal(locateInMap(MAP)(at("sql/x/y.sql", 1, 1))?.nodeId, "c.sql");
  assert.equal(locateInMap(MAP)(at("elsewhere.sql", 1, 1)), null);
});

test("tours: three built-ins, deterministic, contract § 4 shape", () => {
  const a = interviewPrep(inputs()), b = interviewPrep(inputs({ facts: [...FACTS].reverse() }));
  assert.deepEqual(a.tours, b.tours);
  assert.equal(a.tours.schema, "datapass.tour/1");
  assert.deepEqual(a.tours.tours.map(t => [t.id, t.mode]), [[BUILTIN_TOUR_IDS.wholePicture, "general"], [BUILTIN_TOUR_IDS.learning, "learning"], [BUILTIN_TOUR_IDS.interview, "interview"]]);
  const all = (steps: readonly TourStep[]): TourStep[] => steps.flatMap(s => [s, ...all(s.substeps ?? [])]);
  for (const t of a.tours.tours) {
    const ids = all(t.steps).map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, `${t.id}: step ids unique`);
    for (const s of all(t.steps)) { assert.equal(s.origin, "datapass-guidance"); assert.match(s.explanationRef, /^[a-z][a-z0-9-]*:\S{1,240}$/); assert.ok(s.viewId); }
  }
  const [whole, learning, interview] = a.tours.tours;
  assert.deepEqual(whole!.steps.map(s => [s.id, s.explanationRef, s.section]), WHOLE_PICTURE_STEP_IDS.map(id => [id, `project:whole-picture.${id}`, "whole-picture"]));
  // learning: concept cards then decision cards under their step, card on its project span's node
  const change = learning!.steps.find(s => s.id === "change")!;
  assert.deepEqual(change.substeps!.map(s => [s.explanationRef, s.section, s.location.nodeId]), [
    ["concept:concept.spark-perf.join-strategy", "concept-cards", "c.jobs"],
    ["concept:concept.sql.cte", "concept-cards", "c.sql"],
    ["concept:concept.sql.anti-join-nulls", "concept-cards", "c.sql"],
    ["decision:concept.modelling.scd-choice", "decision-cards", "c.sql"]
  ]);
  assert.ok(learning!.steps.every(s => !s.substeps?.some(x => x.section === "ask-yourself")), "learning has no prompts");
  // interview: explain-project, the 5 spine steps with ranked notions, then queries worth showing
  assert.deepEqual(interview!.steps.map(s => s.id), ["explain-project", ...WHOLE_PICTURE_STEP_IDS, "queries-worth-showing"]);
  assert.deepEqual(interview!.steps[0]!.substeps!.map(s => s.explanationRef), ["project:objectives", "project:volumetry", "project:platforms"]);
  assert.deepEqual(interview!.steps.find(s => s.id === "change")!.substeps!.map(s => s.explanationRef),
    ["concept:concept.sql.cte", "concept:concept.spark-perf.join-strategy", "concept:concept.sql.anti-join-nulls"]);
  assert.deepEqual(interview!.steps.find(s => s.id === "live")!.substeps!.map(s => s.explanationRef), ["decision:concept.layout.partition-key"]);
  const q = interview!.steps.at(-1)!;
  assert.deepEqual([q.section, q.substeps!.map(s => [s.explanationRef, s.location.nodeId])], ["query-showcase", [["showcase:here", "c.sql"]]]);
  // settings: learning/interview modes off; ask-yourself off excludes the section
  assert.deepEqual(interviewPrep(inputs({ settings: { learning: false, interview: false } })).tours.tours.map(t => t.id), [BUILTIN_TOUR_IDS.wholePicture]);
  assert.deepEqual(interviewPrep(inputs({ settings: { askYourself: false } })).tours.tours.find(t => t.mode === "interview")!.generation, { exclude: ["ask-yourself"] });
});

test("project refs: facts only, typed holes, never invented", () => {
  const { brief } = interviewPrep(inputs());
  assert.deepEqual(resolveProjectRef("project:objectives", brief)!.lines.map(l => [l.text, l.origin]),
    [["Reporting: Daily revenue by channel", "declared"], ["Daily revenue reporting for finance", "owner-stated"]]);
  assert.deepEqual(resolveProjectRef("project:platforms", brief)!.lines.map(l => l.text), ["Airflow", "databricks"]);
  assert.equal(resolveProjectRef("project:volumetry", brief)!.holes[0]!.kind, "missing-volumetry");
  assert.ok(resolveProjectRef("project:explain", brief)!.holes.some(h => h.kind === "missing-volumetry"));
  assert.equal(resolveProjectRef("project:whole-picture.trust", brief)!.holes[0]!.kind, "missing-spine-node");
  assert.equal(resolveProjectRef("project:whole-picture.run", brief)!.lines[0]!.text, "Daily DAG");
  assert.equal(resolveProjectRef("project:nope", brief)!.holes[0]!.kind, "explanation-not-found");
  assert.equal(resolveProjectRef("concept:x", brief), undefined);
  const empty = interviewPrep({ ...inputs(), map: undefined, rationales: [], queries: [] }).brief;
  assert.equal(resolveProjectRef("project:objectives", empty)!.lines.length, 0);
  assert.equal(resolveProjectRef("project:queries-worth-showing", empty)!.holes[0]!.kind, "missing-facts");
});

test("model answers: manual exchange, paths not code, answers ai-proposed, unasked dropped", () => {
  const { preps } = interviewPrep(inputs());
  const req = modelAnswersRequest(preps, { exclude: ["sample-output"] });
  assert.match(req.text, /Request digest: [0-9a-f]{64}/);
  assert.match(req.text, /sql\/fct_revenue\.sql:3-9/);
  assert.match(req.text, /"exclude"/);
  const q = preps[0]!.questions[0]!;
  const answer = "```json\n" + JSON.stringify({ format: MODEL_ANSWERS_ANSWER_FORMAT, request: req.digest, origin: "observed", answers: [
    { ref: preps[0]!.ref, question: q, answer: "  A CTE names a step.  " },
    { ref: preps[0]!.ref, question: "Not asked?", answer: "x" },
    { ref: "concept:unknown", question: q, answer: "y" }
  ] }) + "\n```";
  const read = readModelAnswers(answer, req);
  assert.ok(read.ok);
  assert.deepEqual(read.answers, [{ ref: preps[0]!.ref, question: q, answer: "A CTE names a step.", origin: "ai-proposed" }]);
  assert.equal(read.dropped, 2);
  const other = readModelAnswers(JSON.stringify({ format: MODEL_ANSWERS_ANSWER_FORMAT, request: "f".repeat(64), answers: [] }), req);
  assert.equal(other.ok, false);
  assert.equal(readModelAnswers("no json", req).ok, false);
});
