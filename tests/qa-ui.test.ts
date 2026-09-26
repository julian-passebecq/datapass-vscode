/** QA-4: UI journey parsing and the step outcomes → qa-report mapping (pure; no VS Code). */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseQaReport, QaFormatError } from "../src/qa/formats";
import { buildUiReport, journeyOutcome, parseStep, parseUiJourney, type RunInfo, type StepResult } from "../src/qa/ui/journey";

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);
const run: RunInfo = {
  purpose: "client", runId: "20260927-0930-doc-pipeline-lab",
  datapass: { version: "0.26.0", sha256: SHA }, vscode: { version: "1.105.0" }, os: { platform: "win32", release: "10.0.26200", arch: "x64" },
  clients: [{ id: "doc-pipeline-lab", title: "Doc Pipeline Lab", bridge: { folder: "doc-pipeline", remote: "https://github.com/example-org/doc-pipeline", commit: COMMIT }, repositories: [] }]
};
const journeyJson = (steps: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format: "datapass.ui-journey", version: 1, id: "UI02", title: "t", features: ["architecture"], steps, ...extra });
const at = new Date("2026-09-27T09:30:00Z");
const report = (steps: unknown[], results: StepResult[], blocked?: string) =>
  parseQaReport(JSON.stringify(buildUiReport({ run, journey: parseUiJourney(journeyJson(steps), "j.json"), results, startedAt: at, finishedAt: new Date(at.getTime() + 90_000), driver: "playwright-core 1.63.0", blocked }))) as any;

test("the smoke journey fixture parses into typed steps", () => {
  const j = parseUiJourney(fs.readFileSync(path.join("tests", "fixtures", "qa", "ui", "smoke-doc-pipeline.json")), "smoke");
  assert.deepEqual(j.steps.map(s => s.kind), ["openView", "expect", "screenshot"]);
  assert.equal(j.client, "doc-pipeline-lab");
});

test("each step kind parses; an expect without timeout gets the default", () => {
  assert.deepEqual(parseStep({ run: "DataPass: Open the Workbench" }), { kind: "run", label: "DataPass: Open the Workbench" });
  assert.deepEqual(parseStep({ openView: "Project" }), { kind: "openView", name: "Project" });
  assert.deepEqual(parseStep({ click: "Save", role: "button" }), { kind: "click", text: "Save", role: "button" });
  assert.deepEqual(parseStep({ expect: "Ready" }), { kind: "expect", text: "Ready", timeoutMs: 15_000 });
  assert.deepEqual(parseStep({ press: "Control+Shift+P" }), { kind: "press", key: "Control+Shift+P" });
  assert.deepEqual(parseStep({ screenshot: "after-save" }), { kind: "screenshot", name: "after-save" });
});

test("negatives: unknown step, missing selector, two actions, bad role, key or field become invalid steps", () => {
  const problem = (s: unknown) => { const p = parseStep(s); assert.equal(p.kind, "invalid", JSON.stringify(s)); return (p as { problem: string }).problem; };
  assert.match(problem({ teleport: "x" }), /unknown step \(teleport\)/);
  assert.match(problem({}), /unknown step \(empty\)/);
  assert.match(problem({ click: "" }), /missing selector/);
  assert.match(problem({ expect: "   " }), /missing selector/);
  assert.match(problem({ openView: 3 }), /missing selector/);
  assert.match(problem({ screenshot: "Bad Name" }), /missing selector: screenshot needs a name/);
  assert.match(problem({ click: "a", expect: "b" }), /one action per step/);
  assert.match(problem({ click: "a", role: "iframe" }), /role must be one of/);
  assert.match(problem({ press: "rm -rf" }), /press takes a key/);
  assert.match(problem({ expect: "a", timeoutMs: 5 }), /timeoutMs/);
  assert.match(problem({ run: "a", role: "button" }), /unknown field\(s\) role/);
  assert.match(problem("click"), /must be an object/);
});

test("a bad header refuses the file; a test-journey is named as the wrong format", () => {
  assert.throws(() => parseUiJourney(journeyJson([]), "j.json"), (e: unknown) => e instanceof QaFormatError && /\$\.steps must be a list of 1 to 40/.test(e.message));
  assert.throws(() => parseUiJourney(journeyJson([{ expect: "a" }], { id: "ui-2" }), "j.json"), QaFormatError);
  assert.throws(() => parseUiJourney(journeyJson([{ expect: "a" }], { features: ["teleport"] }), "j.json"), QaFormatError);
  assert.throws(() => parseUiJourney(journeyJson([{ expect: "a" }], { extra: 1 }), "j.json"), QaFormatError);
  assert.throws(() => parseUiJourney(JSON.stringify({ format: "datapass.test-journey" }), "j.json"), /a ui-journey lists UI steps/);
});

test("all steps passing: reached, with coverage, screens and the qa-ui agent (a valid qa-report)", () => {
  const r = report([{ expect: "Document pipeline" }, { screenshot: "view" }], [{ status: "PASS" }, { status: "PASS", screen: "screens/UI02-view.png" }]);
  assert.equal(r.journeys[0].outcome, "reached");
  assert.equal(r.journeys[0].minutes, 2);
  assert.deepEqual(r.journeys[0].expected, [{ text: "\"Document pipeline\" is shown", met: true }]);
  assert.deepEqual(r.journeys[0].screens, ["screens/UI02-view.png"]);
  assert.deepEqual(r.coverage, { listed: ["architecture"], reached: ["architecture"] });
  assert.deepEqual(r.agent, { tool: "qa-ui", model: "playwright-core 1.63.0", host: "playwright" });
  assert.deepEqual(r.findings, []);
});

test("an unknown step is NOT_RUN, never PASS: the journey is only partly reached", () => {
  const r = report([{ expect: "a" }, { teleport: "x" }], [{ status: "PASS" }, { status: "NOT_RUN", detail: "unknown step" }]);
  assert.equal(r.journeys[0].outcome, "partly");
  assert.match(r.journeys[0].path[1], /^2\. unrecognised step .*teleport.* — NOT_RUN/);
  assert.deepEqual(r.coverage.reached, []);
  // Missing results (the runner stopped) count as NOT_RUN too.
  assert.equal(journeyOutcome([{ status: "PASS" }, { status: "NOT_RUN" }]), "partly");
  assert.equal(journeyOutcome([]), "partly");
});

test("a failed step: not-reached, a major finding with its screen; later steps NOT_RUN, expectations unclear", () => {
  const r = report([{ expect: "a" }, { expect: "b" }], [{ status: "FAIL", detail: "\"a\" not shown within 15000 ms", screen: "screens/UI02-fail-step-1.png" }, { status: "NOT_RUN", detail: "an earlier step failed" }]);
  assert.equal(r.journeys[0].outcome, "not-reached");
  assert.deepEqual(r.journeys[0].expected.map((e: { met: unknown }) => e.met), [false, "unclear"]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, "major");
  assert.equal(r.findings[0].area, "architecture");
  assert.deepEqual(r.findings[0].screens, ["screens/UI02-fail-step-1.png"]);
});

test("VS Code that cannot be launched: blocked, with a blocker finding", () => {
  const r = report([{ expect: "a" }], [], "spawn Code.exe ENOENT");
  assert.equal(r.journeys[0].outcome, "blocked");
  assert.equal(r.findings[0].severity, "blocker");
  assert.match(r.findings[0].actual, /ENOENT/);
  assert.equal(r.journeys[0].path[0], "1. expect \"a\" — NOT_RUN");
});

test("a Codex report still validates with the widened agent field; a mixed agent does not", () => {
  const good = report([{ expect: "a" }], [{ status: "PASS" }]);
  parseQaReport(JSON.stringify({ ...good, agent: { tool: "codex", model: "gpt-5", host: "app" } }));
  assert.throws(() => parseQaReport(JSON.stringify({ ...good, agent: { tool: "codex", model: "gpt-5", host: "playwright" } })), QaFormatError);
});
