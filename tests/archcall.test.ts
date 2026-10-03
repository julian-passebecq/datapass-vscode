/**
 * ARCHCALL1 (TL-7): architect-review/1 request per trigger, suggestions never fire below their threshold,
 * the answer import is checked against the request and lands in Context › Why & alternatives as ai-proposed.
 * Synthetic, generic data.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS, buildRequest, checkAnswer, extractJson, questionFor, renderForAi, reviewRationales,
  suggestBeforeDone, suggestForChange, suggestForCheckRuns, suggestForChecklistDone, checklistComponent, citedFiles, verifyCitations,
  type ArchitectReviewRequest, type RequestLocation
} from "../src/core/archcall/review";
import { resolveWhy, whyProvider } from "../src/core/navigation/context/why";
import { buildSections, DEFAULT_CONTEXT_TABS } from "../src/core/navigation/context";

const loc = (nodeId: string): RequestLocation => ({ level: "artifact", nodeId, artifactKind: "other" });
const change = (n: number) => ({ ref: "main...abc", baseSha: "a".repeat(40), headSha: "b".repeat(40), componentIds: Array.from({ length: n }, (_, i) => `c${i}`) });

test("archcall: suggestions only above their thresholds, never when switched off", () => {
  assert.equal(suggestForChange(change(5), loc), undefined, "5 components is not > 5");
  const big = suggestForChange(change(6), loc)!;
  assert.equal(big.trigger.kind, "large-change");
  assert.equal(big.subjects.length, 6);
  assert.equal(suggestForChange(change(9), loc, { ...DEFAULT_SETTINGS, suggestions: false }), undefined);
  assert.equal(suggestForCheckRuns("npm test", [{ ref: "r1", failed: true }, { ref: "r2", failed: false }], loc("c1")), undefined, "not in a row");
  const fail = suggestForCheckRuns("npm test", [{ ref: "r0", failed: false }, { ref: "r1", failed: true }, { ref: "r2", failed: true }], loc("c1"))!;
  assert.deepEqual(fail.trigger, { kind: "repeated-failure", checkId: "npm test", consecutiveFailures: 2, threshold: 2 });
  assert.deepEqual(fail.evidence.map(e => e.ref), ["r1", "r2"]);
  assert.equal(suggestBeforeDone("readiness:m2", []), undefined);
  assert.match(suggestBeforeDone("readiness:m2", [loc("c1")])!.message, /readiness:m2/);
});

test("archcall: request builder per trigger is stable and refuses unmet triggers", () => {
  const suggestions = [suggestForChange(change(7), loc)!, suggestForCheckRuns("ci/lint", [{ ref: "p1", failed: true }, { ref: "p2", failed: true }], loc("c1"))!, suggestBeforeDone("m1", [loc("c1"), loc("c2")])!];
  for (const s of suggestions) {
    const q = questionFor(s.trigger, s.subjects);
    assert.ok(!/\{\w+\}/.test(q), `placeholders filled: ${q}`);
    const r = buildRequest(s, q);
    assert.equal(r.schema, "datapass.architect-review-request/1");
    assert.equal(r.protocol, "architect-review/1");
    assert.match(r.requestId, /^datapass:architect-review:[0-9a-f]{64}$/);
    assert.equal(buildRequest(s, q).requestId, r.requestId);
    assert.notEqual(buildRequest(s, `${q} (edited)`).requestId, r.requestId);
    const text = renderForAi(r);
    assert.ok(text.includes(r.requestId) && text.includes("datapass.architect-review-answer/1"));
  }
  const s = suggestions[0]!;
  assert.throws(() => buildRequest({ ...s, trigger: { ...(s.trigger as { kind: "large-change" } & typeof s.trigger), componentCount: 5, threshold: 5 } as typeof s.trigger }, "q"), /not large enough/);
  assert.throws(() => buildRequest({ ...s, evidence: [] }, "q"), /needs a mr-diff/);
  assert.throws(() => buildRequest({ ...s, subjects: [] }, "q"), /at least one subject/);
  // Titles and questions come from settings (labels), not from the code.
  const labels = { ...DEFAULT_SETTINGS.labels, questions: { ...DEFAULT_SETTINGS.labels.questions, "before-done": "Custom {milestone}" } };
  assert.equal(questionFor(suggestions[2]!.trigger, suggestions[2]!.subjects, labels), "Custom m1");
});

const answerFor = (r: ArchitectReviewRequest, over: Record<string, unknown> = {}) => ({
  schema: "datapass.architect-review-answer/1", protocol: "architect-review/1", requestId: r.requestId, origin: "ai-proposed",
  findings: [{ severity: "risk", subjectNodeIds: ["c1"], summary: "Two writers on one table", detail: "Both jobs write sales.orders.", evidenceRefIds: ["milestone"] }],
  recommendation: { summary: "Keep one writer per table", alternatives: [{ title: "Merge the jobs", tradeoff: "One longer job" }] },
  model: "any", responder: "manual", ...over
});

test("archcall: import is checked against the request and marks origin ai-proposed in Why & alternatives", () => {
  const r = buildRequest(suggestBeforeDone("m1", [loc("c1"), loc("c2")])!, "Review before done");
  const pasted = `Here is my review:\n\`\`\`json\n${JSON.stringify(answerFor(r))}\n\`\`\`\nThanks`;
  const answer = checkAnswer(r, extractJson(pasted));
  assert.equal(answer.origin, "ai-proposed");
  assert.throws(() => checkAnswer(r, answerFor(r, { origin: "owner-stated" })), /always ai-proposed/);
  assert.throws(() => checkAnswer(r, answerFor(r, { requestId: "datapass:architect-review:" + "f".repeat(64) })), /another request/);
  assert.throws(() => checkAnswer(r, answerFor(r, { findings: [{ ...answerFor(r).findings[0], subjectNodeIds: ["elsewhere"] }] })), /subject that was not sent/);
  assert.throws(() => checkAnswer(r, answerFor(r, { findings: [{ ...answerFor(r).findings[0], evidenceRefIds: ["x"] }] })), /evidence that was not sent/);
  assert.throws(() => checkAnswer(r, answerFor(r, { approved: true })), /unknown field/);

  const rationales = reviewRationales([{ request: r, answer, at: "t" }, { request: r, answer: null, at: "t" }]);
  assert.equal(rationales.length, 1, "a request without an answer shows nothing");
  const why = resolveWhy(loc("c2"), rationales);
  assert.equal(why.cards.length, 1);
  assert.equal(why.cards[0]!.origin, "ai-proposed");
  assert.equal(why.origin, "ai-proposed");
  assert.equal(why.cards[0]!.choice.summary, "Keep one writer per table");
  assert.deepEqual(why.cards[0]!.alternatives.map(a => a.label), ["Merge the jobs"]);
  assert.equal(resolveWhy(loc("c9"), rationales).cards.length, 0, "only on the request's subjects");
});

test("archcall: a readiness checklist item becoming done offers the before-done review (once, reversible)", () => {
  const subjects = [loc("c1")];
  const s = suggestForChecklistDone({ key: "scope-a/ready", state: "done", previous: "todo", title: "Ready to ship" }, subjects)!;
  assert.deepEqual(s.trigger, { kind: "before-done", milestoneId: "scope-a/ready" });
  assert.match(s.message, /Ready to ship/);
  assert.equal(buildRequest(s, questionFor(s.trigger, s.subjects)).trigger.kind, "before-done");
  assert.equal(suggestForChecklistDone({ key: "scope-a/ready", state: "done" }, subjects)?.trigger.kind, "before-done", "first time done");
  assert.equal(suggestForChecklistDone({ key: "scope-a/ready", state: "done", previous: "done" }, subjects), undefined, "already done");
  assert.equal(suggestForChecklistDone({ key: "scope-a/ready", state: "todo", previous: "done" }, subjects), undefined, "undoing is not offered");
  assert.equal(suggestForChecklistDone({ key: "scope-a/ready", state: "done", previous: "todo" }, subjects, { ...DEFAULT_SETTINGS, suggestions: false }), undefined);
  assert.equal(checklistComponent("component:orders-job/tested"), "orders-job");
  assert.equal(checklistComponent("scope-a/ready"), undefined);
});

test("archcall: the readiness trigger is wired to the checklist (offer() has a caller)", () => {
  const src = readFileSync(join(__dirname, "..", "src", "views", "archcall", "architectReview.ts"), "utf8");
  assert.match(src, /onDidSetChecklist\(/);
  assert.match(src, /void offer\(suggestForChecklistDone\(/);
  const session = readFileSync(join(__dirname, "..", "src", "work", "session.ts"), "utf8");
  assert.match(session, /checklistEmitter\.fire\(\{ key, state, previous \}\)/);
});

test("archcall hole: an answer citing a file that is not in the project is flagged unverified", async () => {
  assert.deepEqual(citedFiles("See `jobs/load_orders.sql:12` and notebooks\\clean.ipynb; table sales.orders is fine. Also C:\\x\\y.py and ../up.py."),
    ["jobs/load_orders.sql", "notebooks/clean.ipynb", "C:/x/y.py", "../up.py"]);
  assert.deepEqual(citedFiles("orders.sql", []), [], "extensions are settings");
  const r = buildRequest(suggestBeforeDone("m1", [loc("c1")])!, "Review before done");
  const files = new Set(["jobs/load_orders.sql"]);
  const exists = async (p: string) => files.has(p);
  const answer = checkAnswer(r, answerFor(r, {
    findings: [
      { severity: "risk", subjectNodeIds: ["c1"], summary: "Writer in jobs/load_orders.sql", detail: "ok", evidenceRefIds: [] },
      { severity: "warning", subjectNodeIds: ["c1"], summary: "Also jobs/ghost.sql", detail: "and /etc/abs.py", evidenceRefIds: [] }
    ],
    recommendation: { summary: "Move it to lib/new_helper.py", alternatives: [] }
  }));
  const unverified = await verifyCitations(answer, exists);
  assert.deepEqual(unverified, [{ finding: 1, files: ["jobs/ghost.sql", "/etc/abs.py"] }, { finding: -1, files: ["lib/new_helper.py"] }]);
  const [card] = reviewRationales([{ request: r, answer, at: "t", unverified }]);
  assert.equal(card!.origin, "ai-proposed");
  assert.equal(card!.confidence, "unverified");
  assert.match(card!.openQuestions![0]!, /^Unverified: .*jobs\/ghost\.sql, \/etc\/abs\.py, lib\/new_helper\.py/);
  const custom = { ...DEFAULT_SETTINGS.labels, unverified: "à vérifier", unverifiedFiles: "Cite {files}" };
  assert.equal(reviewRationales([{ request: r, answer, at: "t", unverified }], custom)[0]!.confidence, "à vérifier", "label is data");
  const clean = checkAnswer(r, answerFor(r));
  assert.deepEqual(await verifyCitations(clean, exists), []);
  assert.equal(reviewRationales([{ request: r, answer: clean, at: "t", unverified: [] }])[0]!.confidence, "unrated");
});

test("archcall: Context › Why & alternatives shows imported answers (ai-proposed, unverified flag) through whyProvider", async () => {
  const r = buildRequest(suggestBeforeDone("m1", [loc("c1")])!, "Review before done");
  const answer = checkAnswer(r, answerFor(r));
  const reviews = [{ request: r, answer, at: "t", unverified: [{ finding: 0, files: ["jobs/ghost.sql"] }] }];
  const provider = whyProvider(() => reviewRationales(reviews));
  const tabs = DEFAULT_CONTEXT_TABS.filter(t => t.id === "why");
  const [here] = await buildSections({ location: { level: "artifact", nodeId: "c1", artifactKind: "other" } }, tabs, () => provider);
  assert.equal(here!.title, "Why & alternatives");
  assert.equal(here!.origin, "ai-proposed");
  assert.deepEqual(here!.holes, []);
  assert.match(here!.body, /Keep one writer per table/);
  assert.match(here!.body, /Origin: ai-proposed · Confidence: unverified/);
  assert.match(here!.body, /Unverified: .*jobs\/ghost\.sql/);
  assert.match(here!.body, /Merge the jobs/);
  const [elsewhere] = await buildSections({ location: { level: "artifact", nodeId: "c9", artifactKind: "other" } }, tabs, () => provider);
  assert.equal(elsewhere!.body, "");
  assert.match(elsewhere!.holes[0]!.reason, /No rationale yet for c9/);
  const [none] = await buildSections({ location: null }, tabs, () => provider);
  assert.equal(none!.holes.length, 1, "no location is a hole, never a guess");
  const src = readFileSync(join(__dirname, "..", "src", "views", "archcall", "architectReview.ts"), "utf8");
  assert.match(src, /registerContextProvider\(whyProvider\(rationales\)\)/, "rationales() has a caller: the why tab");
  assert.match(src, /notifyContextChanged\(\)/, "an import refreshes the Context view");
});
