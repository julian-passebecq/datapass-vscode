/**
 * V5 PQSAMP1: the code-steps data sample. Source 1 = Data X-Ray sample of a picked local file (observed),
 * source 2 = the AI exchange answer (always ai-proposed), else a typed hole; X-Ray wins over the AI.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STEP_SAMPLE_LABELS, readAiSampleAnswer, readXraySample, resolveStepSample, SAMPLE_MAX_ROWS, sampleCaption,
  STEP_SAMPLE_ANSWER_FORMAT, stepSampleRequest, XRAY_SAMPLE_FORMAT
} from "../src/core/exchange/stepSample";
import { codeStepsModel, DEFAULT_CODE_STEPS_LABELS, SAMPLE_VIEW_ROWS, stepSubjectOf, withSamples, type CodeStepsInput } from "../src/webview/views/layouts/codeSteps";

const xrayRaw = { format: XRAY_SAMPLE_FORMAT, file: "orders.csv", engine: "DuckDB 1.3.0", columns: ["id", "amount"], rows: [[1, 10], [2, null]], truncated: false };
const step = { id: "nn", label: "Remove nulls", kind: "filter", tables: [{ id: "orders", role: "in" }], params: [{ name: "amount", value: "not null" }] };

test("source 1: an X-Ray sample is read, bounded and observed; malformed values are refused", () => {
  const s = readXraySample(xrayRaw)!;
  assert.equal(s.state, "sample");
  assert.ok(s.state === "sample" && s.source === "xray" && s.origin === "observed");
  assert.equal(sampleCaption(s), "Sample of orders.csv (DuckDB 1.3.0)");
  assert.equal(readXraySample({ ...xrayRaw, format: "other" }), undefined);
  assert.equal(readXraySample({ ...xrayRaw, rows: [[{ nested: 1 }]] }), undefined);
  assert.equal(readXraySample(null), undefined);
  const big = readXraySample({ ...xrayRaw, rows: Array.from({ length: SAMPLE_MAX_ROWS + 5 }, (_, i) => [i, i]) })!;
  assert.ok(big.state === "sample" && big.rows.length === SAMPLE_MAX_ROWS && big.truncated);
});

test("source 2: the request carries no data; the pasted answer is always ai-proposed and must match the step", () => {
  const req = stepSampleRequest(step);
  assert.match(req.text, /"stepId": "nn"/);
  assert.match(req.text, /Request digest: [0-9a-f]{64}/);
  assert.equal(stepSampleRequest(step).digest, req.digest, "stable digest");
  const answer = (over: object = {}) => "Here you go:\n```json\n" + JSON.stringify({ format: STEP_SAMPLE_ANSWER_FORMAT, stepId: "nn", request: req.digest, columns: ["id", "amount"], rows: [[1, 10]], origin: "observed", ...over }) + "\n```";
  const ok = readAiSampleAnswer(answer(), { stepId: "nn", digest: req.digest });
  assert.ok(ok.ok && ok.sample.state === "sample" && ok.sample.origin === "ai-proposed", "a claimed observed origin is not believed");
  assert.equal(sampleCaption(ok.ok ? ok.sample : { state: "hole", reason: "" }), DEFAULT_STEP_SAMPLE_LABELS.aiCaption);
  const wrongStep = readAiSampleAnswer(answer({ stepId: "other" }), { stepId: "nn", digest: req.digest });
  assert.ok(!wrongStep.ok && /step other/.test(wrongStep.reason));
  assert.ok(!readAiSampleAnswer(answer({ request: "f".repeat(64) }), { stepId: "nn", digest: req.digest }).ok);
  assert.ok(!readAiSampleAnswer("no json here", { stepId: "nn", digest: req.digest }).ok);
  assert.ok(!readAiSampleAnswer(answer({ format: "x" }), { stepId: "nn", digest: req.digest }).ok);
});

test("X-Ray first, then the AI, else a typed hole", () => {
  const xray = readXraySample(xrayRaw)!;
  const req = stepSampleRequest(step);
  const ai = readAiSampleAnswer(JSON.stringify({ format: STEP_SAMPLE_ANSWER_FORMAT, stepId: "nn", columns: ["a"], rows: [["x"]] }), { stepId: "nn", digest: req.digest });
  assert.ok(ai.ok);
  assert.equal(resolveStepSample({ xray, ai: ai.sample }), xray);
  assert.equal(resolveStepSample({ ai: ai.sample }), ai.sample);
  assert.deepEqual(resolveStepSample({}), { state: "hole", reason: DEFAULT_STEP_SAMPLE_LABELS.hole });
  const failed = { state: "hole", reason: "Data X-Ray could not sample the file" } as const;
  assert.equal(resolveStepSample({ xray: failed, ai: ai.sample }), ai.sample);
  assert.equal(resolveStepSample({ xray: failed }), failed);
});

test("code-steps rows carry the sample slot: table with origin badge, AI marked, hole otherwise; labels are data", () => {
  const xray = readXraySample({ ...xrayRaw, rows: Array.from({ length: SAMPLE_VIEW_ROWS + 3 }, (_, i) => [i, i]) })!;
  const ai = readAiSampleAnswer(JSON.stringify({ format: STEP_SAMPLE_ANSWER_FORMAT, stepId: "b", columns: ["a"], rows: [[null]] }), { stepId: "b", digest: "d" });
  assert.ok(ai.ok);
  const input: CodeStepsInput = {
    steps: [
      { id: "a", kind: "read", label: "A", origin: "static", tables: [], params: [], sample: xray },
      { id: "b", kind: "filter", label: "B", origin: "static", tables: [], params: [], sample: ai.sample },
      { id: "c", kind: "write", label: "C", origin: "static", tables: [], params: [] }
    ], holes: [], origin: "static"
  };
  const [a, b, c] = codeStepsModel(input).rows;
  assert.ok(a!.sample.kind === "table" && !a!.sample.aiProposed && a!.sample.origin === "observed");
  assert.ok(a!.sample.kind === "table" && a!.sample.rows.length === SAMPLE_VIEW_ROWS && a!.sample.more === `3 ${DEFAULT_STEP_SAMPLE_LABELS.truncated}`);
  assert.ok(b!.sample.kind === "table" && b!.sample.aiProposed && b!.sample.origin === "ai-proposed" && b!.sample.rows[0]![0] === "");
  assert.deepEqual(c!.sample, { kind: "hole", reason: DEFAULT_STEP_SAMPLE_LABELS.hole });
  const labels = { ...DEFAULT_CODE_STEPS_LABELS, sampleLabels: { ...DEFAULT_STEP_SAMPLE_LABELS, hole: "Pas d'échantillon" } };
  assert.deepEqual(codeStepsModel(input, { labels }).rows[2]!.sample, { kind: "hole", reason: "Pas d'échantillon" });
  // V5HOLE18: no step selected = every slot shows; a selected step shows only its own (stepping back updates it).
  assert.deepEqual(codeStepsModel(input).rows.map(r => r.showSample), [true, true, true]);
  const picked = codeStepsModel({ ...input, selected: "b" }).rows;
  assert.deepEqual(picked.map(r => [r.selected, r.showSample]), [[false, false], [true, true], [false, false]]);
  assert.deepEqual(codeStepsModel({ ...input, selected: "gone" }).rows.map(r => r.showSample), [true, true, true]);
});

test("wiring: withSamples reads the store per step id; stepSubjectOf gives the command its subject", () => {
  const input: CodeStepsInput = {
    steps: [
      { id: "a", kind: "read", label: "Read orders", origin: "static", tables: [{ id: "orders", role: "in" }], params: [{ name: "path", value: "orders.csv", origin: "static" }] },
      { id: "b", kind: "filter", label: "Remove nulls", origin: "static", tables: [], params: [] }
    ],
    holes: [], origin: "static"
  };
  const sample = readXraySample(xrayRaw)!;
  const wired = withSamples(input, id => id === "a" ? sample : undefined);
  assert.equal(wired.steps[0]!.sample, sample);
  assert.equal(wired.steps[1]!.sample, undefined);
  assert.equal(input.steps[0]!.sample, undefined, "the input is not mutated");
  const rows = codeStepsModel(wired).rows;
  assert.equal(rows[0]!.sample.kind, "table");
  assert.equal(rows[1]!.sample.kind, "hole");
  assert.deepEqual(stepSubjectOf(input, "a"), { id: "a", label: "Read orders", kind: "read", tables: [{ id: "orders", role: "in" }], params: [{ name: "path", value: "orders.csv" }] });
  assert.equal(stepSubjectOf(input, "zz"), undefined);
});
