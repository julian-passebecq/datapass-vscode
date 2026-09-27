/** V1-AUTO-2: the journey compiler (test-journey → ui-journey), the new UI primitives, qa-report runPaths/uxOpinion, the merged qa:ui report. Pure. */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseQaReport, parseTestJourney, QaFormatError } from "../src/qa/formats";
import { compileJourney, parseUiSteps, SWITCH_MODE_LABEL } from "../src/qa/ui/compile";
import { buildUiReport, mergeUiReports, parseStep, parseUiJourney, type RunInfo } from "../src/qa/ui/journey";
import { codexRunPrompt } from "../src/qa/codexPrompt";
import { parseCodexTests } from "../src/qa/formats";

const repo = process.cwd();
const journey = (extra: Record<string, unknown> = {}) => parseTestJourney(JSON.stringify({ format: "datapass.test-journey", version: 1, id: "J01", kind: "client", title: "Open", goal: "g", expected: ["e"], features: ["onboarding"], ...extra }), "J01.json");
const reason = (r: ReturnType<typeof compileJourney>) => { assert.equal(r.ok, false, JSON.stringify(r)); return (r as { reason: string }).reason; };

test("the new primitives parse; bad ones become invalid steps", () => {
  assert.deepEqual(parseStep({ type: "https://example.org/x" }), { kind: "type", text: "https://example.org/x" });
  assert.deepEqual(parseStep({ quickPick: "B - Docker" }), { kind: "quickPick", text: "B - Docker" });
  assert.deepEqual(parseStep({ expectAbsent: "FOIL" }), { kind: "expectAbsent", text: "FOIL", timeoutMs: 3_000 });
  assert.deepEqual(parseStep({ expectAbsent: "FOIL", timeoutMs: 5000 }), { kind: "expectAbsent", text: "FOIL", timeoutMs: 5000 });
  assert.deepEqual(parseStep({ wait: 2000 }), { kind: "wait", ms: 2000 });
  assert.deepEqual(parseStep({ commandPaletteSearch: "Mongoku" }), { kind: "commandPaletteSearch", query: "Mongoku" });
  assert.deepEqual(parseStep({ settingsSearch: "foil" }), { kind: "settingsSearch", query: "foil" });
  assert.deepEqual(parseStep({ openFile: ".datapass/graph.json" }), { kind: "openFile", path: ".datapass/graph.json" });
  assert.deepEqual(parseStep({ chooseFolder: "scratch" }), { kind: "chooseFolder", folder: "scratch" });
  for (const bad of [{ wait: 5 }, { wait: "1s" }, { openFile: "../secret" }, { openFile: "a/../b" }, { openFile: "C:/x" }, { chooseFolder: "C:\\Users" }, { expectAbsent: "x", timeoutMs: 1 }, { quickPick: "" }])
    assert.equal(parseStep(bad).kind, "invalid", JSON.stringify(bad));
});

test("a ui-journey launch: fixture needs its folder, a fixture folder needs open fixture", () => {
  const doc = (launch: unknown) => JSON.stringify({ format: "datapass.ui-journey", version: 1, id: "R02", title: "t", features: ["modes"], launch, steps: [{ expect: "a" }] });
  assert.deepEqual(parseUiJourney(doc({ trust: "restricted", open: "fixture", fixture: "doc-pipeline" }), "r").launch, { trust: "restricted", open: "fixture", fixture: "doc-pipeline" });
  assert.throws(() => parseUiJourney(doc({ open: "fixture" }), "r"), QaFormatError);
  assert.throws(() => parseUiJourney(doc({ fixture: "doc-pipeline" }), "r"), QaFormatError);
  assert.throws(() => parseUiJourney(doc({ open: "somewhere" }), "r"), QaFormatError);
});

test("compile: the journey's ui steps, the launch from setup, the mode as leading steps", () => {
  const r = compileJourney(journey({ setup: { client: "lab", mode: "DataPass", trust: "restricted", open: "fixture", fixture: "doc-pipeline", variant: "b-vm" }, ui: [{ run: "X" }, { expect: "Y" }] }), { file: "journeys/J01.json" });
  assert.ok(r.ok);
  const doc = parseUiJourney(JSON.stringify(r.journey), "J01.json");
  assert.deepEqual(doc.launch, { trust: "restricted", open: "fixture", fixture: "doc-pipeline" });
  assert.equal(doc.client, "lab");
  assert.equal(doc.from, "journeys/J01.json");
  assert.deepEqual(doc.steps.slice(0, 2), [{ kind: "run", label: SWITCH_MODE_LABEL }, { kind: "quickPick", text: "DataPass" }]);
  assert.deepEqual(doc.steps.slice(-2).map(s => s.kind), ["run", "expect"]);
  assert.equal(r.stepsFrom, "journey");
  assert.ok(r.notes.some(n => /variant b-vm/.test(n)));
});

test("compile: the vendor proposal is used only when the journey has no ui; the journey's own ui wins", () => {
  const vendor = { id: "J01", ui: [{ expect: "from DataPass" }] };
  const fromVendor = compileJourney(journey(), { vendor });
  assert.ok(fromVendor.ok && fromVendor.stepsFrom === "vendor");
  const own = compileJourney(journey({ ui: [{ expect: "own" }] }), { vendor });
  assert.ok(own.ok && own.stepsFrom === "journey" && JSON.stringify(own.journey).includes("own"));
  assert.ok(compileJourney(journey({ ui: [{ expect: "own" }] }), { vendor: { id: "J01", notAutomatable: "x" } }).ok, "the journey's own steps win over DataPass's 'not automatable'");
});

test("compile: what cannot be compiled is 'not automatable' with its reason, never a journey that passes", () => {
  assert.match(reason(compileJourney(journey())), /not automatable: the journey has no ui steps/);
  assert.match(reason(compileJourney(journey({ notAutomatable: "runs a terminal" }))), /^not automatable: runs a terminal$/);
  assert.match(reason(compileJourney(journey(), { vendor: { id: "J01", notAutomatable: "needs the clipboard" } })), /needs the clipboard/);
  assert.match(reason(compileJourney(journey(), { vendor: { id: "J01", ui: [{ teleport: "x" }, { expect: "a" }] } })), /vendor ui step 1: unknown step/);
  assert.match(reason(compileJourney(journey({ ui: [{ run: "X" }, { screenshot: "s" }] }))), /check nothing/);
  assert.match(reason(compileJourney(journey({ ui: [{ chooseFolder: "scratch" }, { expect: "a" }] }))), /needs setup.open "empty"/);
  assert.match(reason(compileJourney(journey({ setup: { mode: "Vanilla" }, ui: Array.from({ length: 39 }, () => ({ expect: "a" })) }))), /more than 40/);
});

test("a test-journey's ui is checked step by step; ui and notAutomatable exclude each other; old journeys still read", () => {
  assert.throws(() => journey({ ui: [{ expect: "a" }, { teleport: "b" }] }), (e: unknown) => e instanceof QaFormatError && /\$\.ui\[1\] .*teleport.* is not a UI step/.test(e.message));
  assert.throws(() => journey({ ui: [] }), /\$\.ui must be a list of 1 to 40/);
  assert.throws(() => journey({ ui: [{ expect: "a" }], notAutomatable: "x" }), /exclude each other/);
  assert.doesNotThrow(() => journey({ ui: [{ openFile: ".datapass/graph.json" }, { expectAbsent: "x", timeoutMs: 2000 }] }));
  assert.doesNotThrow(() => parseTestJourney(fs.readFileSync(path.join(repo, "tests", "fixtures", "qa", "client", "journeys", "J01-open-my-project.json")), "J01"));
});

test("DataPass's own steps compile: every release journey R01–R05, and the proposal for the Codex Wind Lab client", () => {
  const dir = path.join(repo, "qa", "rc", "journeys");
  for (const f of fs.readdirSync(dir)) {
    const r = compileJourney(parseTestJourney(fs.readFileSync(path.join(dir, f)), f), { file: f });
    assert.ok(r.ok, `${f}: ${JSON.stringify(r)}`);
    assert.ok(parseUiJourney(JSON.stringify(r.journey), f).steps.every(s => s.kind !== "invalid"));
  }
  const steps = parseUiSteps(fs.readFileSync(path.join(repo, "qa", "ui", "codex-wind-lab.json")), "codex-wind-lab.json");
  assert.equal(steps.client, "codex-wind-lab");
  assert.deepEqual(steps.journeys.map(j => j.id), ["J01", "J02", "J03", "J04", "J05", "J06", "J07", "J08", "J09", "J10", "J11", "J12"]);
  for (const e of steps.journeys) {
    const r = compileJourney(journey({ id: e.id, setup: { mode: "Standard" } }), { vendor: e });
    if (e.notAutomatable) assert.ok(!r.ok);
    else assert.ok(r.ok, `${e.id}: ${JSON.stringify(r)}`);
  }
});

test("a datapass.ui-steps file is strict", () => {
  const f = (d: unknown) => () => parseUiSteps(JSON.stringify(d), "s.json");
  const base = { format: "datapass.ui-steps", version: 1, client: "lab" };
  assert.throws(f({ ...base, journeys: [{ id: "J01" }] }), /exactly one of ui or notAutomatable/);
  assert.throws(f({ ...base, journeys: [{ id: "J01", ui: [], notAutomatable: "x" }] }), /exactly one/);
  assert.throws(f({ ...base, journeys: [{ id: "J01", ui: [] }, { id: "J01", ui: [] }] }), /appears twice/);
  assert.throws(f({ ...base, journeys: [{ id: "j1", ui: [] }] }), /journey id/);
  assert.throws(f({ ...base, extra: 1, journeys: [] }), /unknown field/);
  assert.throws(f({ ...base, format: "datapass.ui-journey", journeys: [] }), /format must be/);
});

const SHA = "a".repeat(64);
const run: RunInfo = {
  purpose: "client", runId: "20260927-0930-codex-wind-lab",
  datapass: { version: "1.0.0-rc.2", sha256: SHA }, vscode: { version: "1.139.1" }, os: { platform: "win32", release: "10.0.26200", arch: "x64" },
  clients: [{ id: "codex-wind-lab", title: "Codex Wind Lab", bridge: { folder: "bridge", remote: "https://github.com/example-org/bridge", commit: "b".repeat(40) }, repositories: [] }]
};
const at = new Date("2026-09-27T09:30:00Z");
const single = (id: string, pass: boolean) => {
  const j = parseUiJourney(JSON.stringify({ format: "datapass.ui-journey", version: 1, id, title: id, features: [id === "R01" ? "install" : "git"], steps: [{ expect: "a" }] }), "j");
  return buildUiReport({ run, journey: j, results: [pass ? { status: "PASS" } : { status: "FAIL", detail: "no" }], startedAt: at, finishedAt: at, driver: "playwright-core 1.63.0" });
};

test("qa:ui's merged report: every journey in order, not automatable = blocked with the reason, findings renumbered; it validates", () => {
  const merged = mergeUiReports(run, [single("R01", false), single("J06", false)], [{ id: "J11", title: "t", features: ["toolkit"], reason: "not automatable: runs a terminal" }], "playwright-core 1.63.0");
  const r = parseQaReport(JSON.stringify(merged)) as any;
  assert.deepEqual(r.journeys.map((j: { id: string; outcome: string }) => `${j.id}:${j.outcome}`), ["R01:not-reached", "J06:not-reached", "J11:blocked"]);
  assert.equal(r.journeys[2].path[0], "not automatable: runs a terminal");
  assert.deepEqual(r.findings.map((f: { id: string }) => f.id), ["F1", "F2"]);
  assert.deepEqual(r.coverage, { listed: ["git", "toolkit", "install"], reached: [] }); // FEATURES order
  assert.deepEqual(r.runPaths, { qaUi: "ran", computerUse: "not-run" });
});

test("qa-report runPaths and uxOpinion: additive, each opinion tied to a journey of the report and a screenshot", () => {
  const base = single("J06", true);
  parseQaReport(JSON.stringify(base)); // with runPaths
  const { runPaths: _drop, ...old } = base as Record<string, unknown>;
  parseQaReport(JSON.stringify(old)); // a report without the new fields still reads
  const ux = { id: "U1", kind: "confusing", journey: "J06", title: "Two DataPass views", detail: "Open View lists DataPass twice.", screens: ["screens/J06-views.png"] };
  parseQaReport(JSON.stringify({ ...base, runPaths: { qaUi: "ran", computerUse: "no-apps", note: "Computer Use saw no apps" }, uxOpinion: [ux] }));
  const bad = (extra: Record<string, unknown>) => assert.throws(() => parseQaReport(JSON.stringify({ ...base, ...extra })), QaFormatError, JSON.stringify(extra));
  bad({ uxOpinion: [{ ...ux, screens: [] }] });
  bad({ uxOpinion: [{ ...ux, kind: "ugly" }] });
  bad({ uxOpinion: [{ ...ux, journey: "J99" }] });
  bad({ uxOpinion: [ux, ux] });
  bad({ runPaths: { qaUi: "ran" } });
  bad({ runPaths: { qaUi: "maybe", computerUse: "ran" } });
});

test("the Codex prompt: qa:ui is the gate, Computer Use the mandatory exploratory pass, no-apps is not an abort", () => {
  const config = parseCodexTests(fs.readFileSync(path.join(repo, "tests", "fixtures", "qa", "client", "datapass-codex-tests.json")));
  const root = "C:\\Temp\\datapass-qa\\run";
  const md = codexRunPrompt({
    runRoot: root, runId: "20260927-0930-doc-pipeline-lab", config, datapass: { version: "1.0.0-rc.2", sha256: SHA, vsixPath: `${root}\\d.vsix` }, captureCommand: "capture <file>",
    journeys: [{ journey: journey(), source: "client", launch: "Code.exe x" }], platform: "win32",
    qaUi: { checkout: "D:\\PROJ\\datapass-vscode", journeysDir: `${root}\\ui-journeys`, reportDir: `${root}\\qa-ui\\20260927-0930-doc-pipeline-lab`, notAutomatable: [{ id: "J11", reason: "terminal" }] }
  });
  assert.ok(md.includes(`npm run qa:ui -- "${root}" "${root}\\ui-journeys"`));
  assert.match(md, /The gate: qa:ui/);
  assert.match(md, /The exploratory pass: Codex Computer Use\*\* \(mandatory, not the gate\)/);
  assert.match(md, /no visible application, treat it as a Computer Use \/ session infrastructure failure, not a DataPass failure: do not abort/);
  assert.match(md, /Not automatable \(your pass only\): J11/);
  assert.match(md, /runPaths.*uxOpinion/s);
  assert.match(md, /which paths ran/);
  assert.doesNotMatch(md, /if it is not visible, stop and say so/);
});
