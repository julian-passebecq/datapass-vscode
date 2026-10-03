/**
 * XGAP1: an app/AI-exchange result may carry an optional `gaps[]` block (Common exchange-gaps/1 shape); a
 * candidate's gaps become "AI flagged: …" Next-steps rows with origin ai-proposed, placed at their Location
 * (project root when unplaced). Requests cannot flag gaps; a quarantined answer flags nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildAppRequest, assessAppResult } from "../src/core/exchange/appExchange";
import { EXCHANGE_GAP_REASONS, MAX_EXCHANGE_GAPS, type ExchangeGap } from "../src/core/exchange/exchangeGaps";
import { validateEnvelope } from "../src/core/contracts/validate";
import { sha256Bytes } from "../src/core/model/ids";
import { collectNextSteps, NEXT_STEP_KINDS, type NextStepsLocator } from "../src/core/navigation/bindings/nextSteps";
import { NEXT_STEP_SOURCES } from "../src/core/navigation/bindings/nextStepSources";
import { AI_GAP_LABELS, AI_GAP_SOURCE_ID, aiGapItems } from "../src/core/navigation/bindings/aiGapSteps";
import type { NavLocation } from "../src/core/navigation/navTypes";

const H = sha256Bytes("fixture");
const T = "2026-10-01T10:00:00Z";
const base = { scopeRevision: "r1", manifestHash: H, repositories: [{ repoRef: "app", revision: "abc123", workingTreeHash: H }] };
const request = () => buildAppRequest({
  id: "req-1", projectRef: "sample-retail", scopeRef: "analytics", base, classification: "internal",
  createdAt: T, sources: [], appRef: "sample-ai", operation: "describe", inputRefs: ["orders-snapshot"]
});
const gap = (over: Partial<ExchangeGap> = {}): ExchangeGap =>
  ({ location: "notebooks/load_orders.py#L10-24", question: "Which table does TABLE resolve to?", reason: "missing-source", ...over });
function resultFor(bytes: Uint8Array, gaps?: unknown) {
  const res = JSON.parse(new TextDecoder().decode(bytes));
  res.id = "res-1";
  Object.assign(res.payload, { direction: "result", resultState: "partial", executionEvidenceRef: null, requestHash: sha256Bytes(bytes), ...(gaps === undefined ? {} : { gaps }) });
  return res;
}
const assess = (res: unknown, bytes: Uint8Array, supplied = new Map<string, Uint8Array>()) =>
  assessAppResult(bytes, JSON.stringify(res), supplied, T);

test("reasons mirror Common exchange-gaps/1", () => {
  assert.deepEqual([...EXCHANGE_GAP_REASONS], ["missing-source", "ambiguous", "out-of-scope"]);
});

test("a candidate result's gaps are parsed with their answer; absent block = none", () => {
  const rq = request();
  const a = assess(resultFor(rq.bytes, [gap(), gap({ location: "models/orders.sql", question: "Is it incremental?", reason: "ambiguous" })]), rq.bytes);
  assert.equal(a.status, "candidate", a.reasons.join("; "));
  assert.deepEqual(a.gaps.map(g => [g.reason, g.answerRef, g.appRef]), [["missing-source", "res-1", "sample-ai"], ["ambiguous", "res-1", "sample-ai"]]);
  const none = assess(resultFor(rq.bytes), rq.bytes);
  assert.equal(none.status, "candidate");
  assert.deepEqual(none.gaps, []);
});

test("bad gap blocks are quarantined, never guessed; a quarantined answer flags nothing", () => {
  const rq = request();
  for (const bad of [[gap({ reason: "resolved" as never })], [gap({ question: "" })], [gap({ location: " padded " })], [{ ...gap(), extra: 1 }],
    [gap(), gap({ reason: "ambiguous" })], Array.from({ length: MAX_EXCHANGE_GAPS + 1 }, (_, i) => gap({ question: `q${i}` }))]) {
    const a = assess(resultFor(rq.bytes, bad), rq.bytes);
    assert.equal(a.status, "quarantined", JSON.stringify(bad).slice(0, 80));
    assert.deepEqual(a.gaps, []);
  }
  const extraFile = assess(resultFor(rq.bytes, [gap()]), rq.bytes, new Map([["stray", new Uint8Array([1])]]));
  assert.equal(extraFile.status, "quarantined");
  assert.deepEqual(extraFile.gaps, []);
});

test("a request cannot flag gaps", () => {
  const env = structuredClone(request().envelope) as unknown as { payload: Record<string, unknown> };
  env.payload.gaps = [gap()];
  assert.throws(() => validateEnvelope(env), /Only a result can flag gaps/);
});

const root: NavLocation = { level: "project", nodeId: "p", artifactKind: "project" };
const nb: NavLocation = { level: "artifact", nodeId: "nb", artifactKind: "notebook" };
const locator: NextStepsLocator = { root, component: () => null, subproject: () => null };
const facts = (gaps: ExchangeGap[]) => ({ gaps: gaps.map(g => ({ ...g, answerRef: "res-1", appRef: "sample-ai" })), locate: (l: string) => (l.startsWith("notebooks/") ? nb : null) });

test("gaps feed Next steps as 'AI flagged: …', origin ai-proposed, at their Location", () => {
  assert.ok(NEXT_STEP_KINDS.includes("ai-gap"));
  assert.ok(NEXT_STEP_SOURCES.some(s => s.id === AI_GAP_SOURCE_ID), "registered");
  const r = collectNextSteps({ aiGaps: facts([gap(), gap({ location: "elsewhere/x.yml", question: "Who owns it?", reason: "out-of-scope" })]) }, locator);
  assert.equal(r.total, 2);
  assert.ok(r.rows.every(row => row.kind === "ai-gap" && row.origin === "ai-proposed" && row.severity === "info"));
  const placed = r.rows.find(row => row.location.nodeId === "nb")!;
  assert.equal(placed.text, `${AI_GAP_LABELS.prefix} Which table does TABLE resolve to? (${AI_GAP_LABELS.reasons["missing-source"]})`);
  const unplaced = r.rows.find(row => row.location.nodeId === "p")!;
  assert.match(unplaced.text, /^AI flagged: Who owns it\? \(outside what was sent\) · elsewhere\/x\.yml$/);
  assert.equal(r.countByLocation.get("artifact:nb"), 1);
  // Scoped to the notebook Location, only its gap remains.
  assert.equal(collectNextSteps({ aiGaps: facts([gap(), gap({ location: "elsewhere/x.yml" })]) }, locator, { scope: nb }).total, 1);
});

test("labels are data; no facts = no rows; sources can be replaced", () => {
  const items = aiGapItems({ ...facts([gap({ reason: "ambiguous" })]), labels: { prefix: "IA :", reasons: { ambiguous: "ambigu" } } });
  assert.equal(items[0]!.text, "IA : Which table does TABLE resolve to? (ambigu)");
  assert.equal(collectNextSteps({}, locator).total, 0);
  assert.equal(collectNextSteps({ aiGaps: facts([gap()]) }, locator, { sources: [] }).total, 0);
  // Same gap twice from two answers: one row.
  assert.equal(collectNextSteps({ aiGaps: { gaps: [...facts([gap()]).gaps, { ...gap(), answerRef: "res-2", appRef: "sample-ai" }] } }, locator).total, 1);
});
