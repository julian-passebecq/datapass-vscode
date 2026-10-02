/**
 * NAVAIX1: AI-written explanations of a navigation Location — work order text, file name, validation (decision-rationale
 * consume rules), the AI-proposed badge and the stale mark.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  aiExplainSection, explainLabels, explainOrderDraft, explainPathOf, readExplanation, safeNodeId, sourceSha256, NAV_EXPLANATION_SCHEMA_ID
} from "../src/core/navigation/context/aiExplain";

const loc = { level: "artifact", nodeId: "repo:etl/notebooks/silver orders.py", artifactKind: "spark-notebook" };
const code = "df = spark.read.table('bronze.orders')\r\ndf.write.saveAsTable('silver.orders')\r\n";
const hash = sourceSha256(code);

const rationale = (over: Record<string, unknown> = {}) => ({
  id: "silver-orders-merge", decisionPoint: "load.incremental", scale: null, domain: null,
  subjects: [{ kind: "path", id: "etl/notebooks/silver orders.py" }],
  choice: { option: null, summary: "Full overwrite of silver.orders each run." },
  problemSolved: "Reports need a clean daily orders table.",
  why: [{ constraint: "volume", driver: "Under 1 GB a day", rule: null, evidence: [] }],
  how: { mechanism: "saveAsTable overwrite", evidence: [] },
  alternatives: [{ option: null, label: "MERGE on order id", whenBetter: "Above 50 GB/day", costRisk: "More code", whyNotHere: "Volume is small" }],
  tradeoffs: ["Reprocesses everything"], revisitWhen: [], confidence: "medium", origin: "ai-proposed", openQuestions: ["Is history needed?"], acceptedFindings: [],
  ...over
});
const fileOf = (rationales: unknown[], sha = hash) => JSON.stringify({
  schema: NAV_EXPLANATION_SCHEMA_ID, location: loc, origin: "ai-proposed",
  source: { revision: "abc123", files: [{ path: "etl/notebooks/silver orders.py", sha256: sha }] }, writtenAt: "2026-10-01T02:00:00Z",
  rationale: { schema: "datapass.decision-rationale/1", project: "p", author: "Claude", rationales }
});

test("safe node id: portable, stable, collision-free", () => {
  const a = safeNodeId(loc.nodeId);
  assert.match(a, /^[A-Za-z0-9._-]+$/);
  assert.equal(a, safeNodeId(loc.nodeId));
  assert.notEqual(safeNodeId("a/b"), safeNodeId("a_b"));
  assert.match(safeNodeId("../../x"), /^x-/);
  assert.equal(explainPathOf(loc.nodeId), `.datapass/explain/${a}.json`);
});

test("work order: names the file, the sources with their hash, the rationale rules; never static-inferred", () => {
  const d = explainOrderDraft({ location: loc, title: "silver orders", sources: [{ path: "etl/notebooks/silver orders.py", sha256: hash }], asks: ["Say why incremental or full."] });
  assert.equal(d.kind, "prepare-files");
  assert.equal(d.title, "Explain silver orders for DataPass");
  assert.ok(d.goal.includes(explainPathOf(loc.nodeId)));
  assert.ok(d.goal.includes(hash));
  assert.ok(d.goal.includes("Say why incremental or full."));
  assert.ok(d.goal.includes("Never claim static-inferred"));
  assert.ok(d.note.includes(explainPathOf(loc.nodeId)));
});

test("labels come from settings; bad values fall back", () => {
  const l = explainLabels({ badge: "Proposé par l'IA", stale: 3, missing: " " });
  assert.equal(l.badge, "Proposé par l'IA");
  assert.equal(l.stale, explainLabels(undefined).stale);
  assert.equal(l.missing, explainLabels(null).missing);
});

test("no file: a hole that offers ask-ai", () => {
  const s = aiExplainSection({ location: loc, title: "silver orders", raw: null, current: new Map() });
  assert.equal(s.cards.length, 0);
  assert.deepEqual(s.holes, [{ reason: "No AI explanation yet for silver orders", fill: "ask-ai" }]);
});

test("valid file: AI-proposed cards, fresh while the source is unchanged", () => {
  const s = aiExplainSection({ location: loc, raw: fileOf([rationale()]), current: new Map([["etl/notebooks/silver orders.py", sourceSha256(code.replace(/\r\n/g, "\n"))]]) });
  assert.equal(s.origin, "ai-proposed");
  assert.equal(s.cards.length, 1);
  assert.equal(s.cards[0]!.badge, "AI-proposed");
  assert.equal(s.cards[0]!.stale, null);
  assert.equal(s.cards[0]!.alternatives[0]!.label, "MERGE on order id");
});

test("source changed: the cards are marked stale", () => {
  const s = aiExplainSection({ location: loc, raw: fileOf([rationale()]), current: new Map([["etl/notebooks/silver orders.py", sourceSha256(code + "# edit\n")]]) });
  assert.match(s.cards[0]!.stale ?? "", /silver orders\.py changed/);
});

test("refusals: wrong node, wrong origin, owner/static claims, credentials, bad JSON", () => {
  assert.equal(readExplanation("{", loc).ok, false);
  assert.equal(readExplanation(fileOf([rationale()]).replace(loc.nodeId, "other"), loc).ok, false);
  const r = readExplanation(fileOf([rationale({ origin: "owner-stated" }), rationale({ id: "b", origin: "static-inferred" })]), loc);
  assert.equal(r.ok, false);
  const leak = readExplanation(fileOf([rationale({ problemSolved: "Uses postgres://u:p@host/db" })]), loc);
  assert.equal(leak.ok, false);
  const s = aiExplainSection({ location: loc, raw: fileOf([rationale({ alternatives: [] })]), current: new Map() });
  assert.equal(s.cards.length, 0);
  assert.equal(s.holes[0]!.fill, "ask-ai");
});

test("one bad rationale is dropped and listed, the rest is shown", () => {
  const r = readExplanation(fileOf([rationale(), rationale({ id: "bad", why: [] })]), loc);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.file.rationales.length, 1);
  assert.deepEqual(r.rejected, ["bad"]);
  const s = aiExplainSection({ location: loc, raw: fileOf([rationale(), rationale({ id: "bad", why: [] })]), current: new Map() });
  assert.equal(s.holes.length, 1);
});

test("source paths in the file are vetted", () => {
  const raw = JSON.parse(fileOf([rationale()]));
  raw.source.files.push({ path: "../../etc/passwd", sha256: hash }, { path: "C:/x.py", sha256: hash });
  const r = readExplanation(raw, loc);
  assert.ok(r.ok && r.file.sources.length === 1);
});
