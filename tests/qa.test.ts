/**
 * QA-1: the Codex test mode formats (handoff/v3/12 §4.1–4.4 with ARCHI's addendum) — the config
 * (`datapass.codex-tests`, purpose app | client), the journeys (`datapass.test-journey`), the report
 * (`datapass.qa-report`) and qa:prepare's `run.json`. Valid fixtures parse; every negative the
 * package names is refused with a readable reason; the emitted schemas agree with the parsers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";
import {
  FEATURES, QaFormatError, SCREEN_PATTERN, parseCodexTests, parseQaReport, parseQaRun, parseTestJourney, reportFolder, runIdOf
} from "../src/qa/formats";

const fixture = (rel: string) => readFileSync(`tests/fixtures/qa/${rel}`, "utf8");
const json = (rel: string) => JSON.parse(fixture(rel)) as Record<string, any>;
const text = (doc: unknown) => JSON.stringify(doc);
const client = () => json("client/datapass-codex-tests.json");
const app = () => json("app/datapass-codex-tests.json");
const journey = () => json("client/journeys/J01-open-my-project.json");
const report = () => json("report.json");

/** The parser refuses the document, and one reason matches. */
function refused(parse: () => unknown, reason: RegExp): void {
  assert.throws(parse, (e: unknown) => {
    assert.ok(e instanceof QaFormatError, `QaFormatError expected, got ${String(e)}`);
    assert.ok(e.issues.some(i => reason.test(i)), `no reason matches ${reason}: ${e.issues.join(" | ")}`);
    return true;
  });
}

test("the client and app configurations parse into the same workspace list", () => {
  const c = parseCodexTests(fixture("client/datapass-codex-tests.json"));
  assert.equal(c.purpose, "client");
  assert.deepEqual(c.workspaces.map(w => [w.client.id, w.bridge.folder, w.repositories.map(r => r.folder)]), [["doc-pipeline-lab", "doc-pipeline", ["doc-orchestration", "doc-processing"]]]);
  assert.equal(c.journeys.length, 2);
  const a = parseCodexTests(fixture("app/datapass-codex-tests.json"));
  assert.equal(a.purpose, "app");
  assert.deepEqual(a.workspaces.map(w => w.client.id), ["doc-pipeline-lab", "codex-wind-lab"]);
  assert.equal(a.workspaces[0]!.bridge.path, "examples/v3/doc-pipeline");
  assert.equal(runIdOf(a, new Date("2026-09-27T09:05:00Z")), "20260927-0905-app");
  assert.equal(runIdOf(c, new Date("2026-09-27T09:05:00Z")), "20260927-0905-doc-pipeline-lab");
  assert.equal(reportFolder(a, "20260927-0905-app"), "reports/app/20260927-0905-app");
  assert.equal(reportFolder(c, "x"), "reports/client/x");
});

test("config negatives: bad purpose, missing workspaces for app, path escape, http remote, absolute paths, oversized", () => {
  refused(() => parseCodexTests(text({ ...client(), purpose: "both" })), /purpose must be "app" or "client"/);
  const noWorkspaces = app(); delete noWorkspaces.workspaces;
  refused(() => parseCodexTests(text(noWorkspaces)), /\$\.workspaces is required/);
  refused(() => parseCodexTests(text({ ...app(), workspaces: [] })), /\$\.workspaces must have at least 1 items/);
  // A client configuration with the app shape is refused too (no silent mix).
  refused(() => parseCodexTests(text({ ...client(), workspaces: app().workspaces })), /\$\.workspaces is not an allowed property/);
  const escape = client(); escape.workspace.repositories[0].folder = "../outside";
  refused(() => parseCodexTests(text(escape)), /repositories\[0\]\.folder must match/);
  const absolute = client(); absolute.workspace.bridge.folder = "C:/runs/bridge";
  refused(() => parseCodexTests(text(absolute)), /bridge\.folder must match/);
  const http = client(); http.workspace.bridge.remote = "http://github.com/example-org/doc-pipeline";
  refused(() => parseCodexTests(text(http)), /bridge\.remote must match/);
  const creds = client(); creds.workspace.bridge.remote = "https://user:token@github.com/example-org/doc-pipeline";
  refused(() => parseCodexTests(text(creds)), /bridge\.remote must match/);
  refused(() => parseCodexTests(text({ ...client(), journeys: ["../journeys/J01.json"] })), /journeys\[0\] must match/);
  refused(() => parseCodexTests(text({ ...client(), datapass: { version: "0.26.0", vsix: "C:/Users/me/datapass.vsix" } })), /datapass\.vsix must match/);
  refused(() => parseCodexTests(text({ ...client(), datapass: { version: "0.26.0", vsix: "build/datapass.zip" } })), /must end in \.vsix/);
  refused(() => parseCodexTests(text({ ...client(), client: { id: "doc-pipeline-lab", title: "x".repeat(121) } })), /client\.title must have at most 120/);
  const pathEscape = app(); pathEscape.workspaces[0].bridge.path = "../../elsewhere";
  refused(() => parseCodexTests(text(pathEscape)), /bridge\.path must match/);
  const clientNesting = app(); clientNesting.workspaces[0] = { client: { id: "x", title: "X" }, bridge: clientNesting.workspaces[0].bridge, repositories: [] };
  refused(() => parseCodexTests(text(clientNesting)), /workspaces\[0\]\.id is required|workspaces\[0\]\.client is not an allowed property/);
  const twoExamples = app(); twoExamples.workspaces[1].bridge = { ...twoExamples.workspaces[0].bridge, path: "examples/v3/codex-wind" };
  assert.equal(parseCodexTests(text(twoExamples)).workspaces[1]!.bridge.folder, "datapass-vscode", "one clone, two examples");
  const dupFolder = client(); dupFolder.workspace.repositories[1].folder = "doc-orchestration";
  refused(() => parseCodexTests(text(dupFolder)), /is also used by/);
  const twoRemotes = app(); twoRemotes.workspaces[1].repositories[0] = { remote: "https://github.com/other/x", folder: "doc-processing" };
  refused(() => parseCodexTests(text(twoRemotes)), /declared with two different remotes/);
  refused(() => parseCodexTests(text({ ...client(), version: 2 })), /version must be 1/);
  refused(() => parseCodexTests(text({ ...client(), format: "datapass.auto-tests" })), /format must be "datapass\.codex-tests"/);
  refused(() => parseCodexTests("{ \"format\": \"datapass.codex-tests\", \"format\": 1 }"), /not valid JSON/);
  refused(() => parseCodexTests(" ".repeat(300 * 1024) + "{}"), /not valid JSON/);
});

test("journey negatives: unknown feature tag, bad kind, bad mode, empty expectations, oversized goal", () => {
  assert.equal(parseTestJourney(fixture("client/journeys/J01-open-my-project.json"), "J01.json").id, "J01");
  assert.equal(parseTestJourney(fixture("app/journeys/A01-install-and-first-open.json"), "A01.json").questions?.length, 2);
  refused(() => parseTestJourney(text({ ...journey(), features: ["architecture", "teleport"] }), "J01.json"), /unknown feature tag\(s\) "teleport"/);
  refused(() => parseTestJourney(text({ ...journey(), kind: "customer" }), "J01.json"), /\$\.kind must be one of "app", "client"/);
  refused(() => parseTestJourney(text({ ...journey(), setup: { mode: "Expert" } }), "J01.json"), /setup\.mode must be one of/);
  refused(() => parseTestJourney(text({ ...journey(), expected: [] }), "J01.json"), /expected must have at least 1 items/);
  refused(() => parseTestJourney(text({ ...journey(), goal: "g".repeat(1001) }), "J01.json"), /goal must have at most 1000/);
  refused(() => parseTestJourney(text({ ...journey(), id: "j01" }), "J01.json"), /\$\.id must match/);
  refused(() => parseTestJourney(text({ ...journey(), run: "rm -rf /" }), "J01.json"), /\$\.run is not an allowed property/);
  refused(() => parseTestJourney(text({ ...journey(), features: ["git", "git"] }), "J01.json"), /lists a tag twice/);
});

test("report negatives: bad outcome, bad severity, unknown area, bad confidence, oversized observed text, coverage", () => {
  const r = parseQaReport(fixture("report.json"));
  assert.equal(r.journeys[1]!.outcome, "partly");
  const badOutcome = report(); badOutcome.journeys[0].outcome = "done";
  refused(() => parseQaReport(text(badOutcome)), /journeys\[0\]\.outcome must be one of/);
  const badMet = report(); badMet.journeys[0].expected[0].met = "yes";
  refused(() => parseQaReport(text(badMet)), /met must be one of true, false, "unclear"/);
  const badSeverity = report(); badSeverity.findings[0].severity = "critical";
  refused(() => parseQaReport(text(badSeverity)), /findings\[0\]\.severity must be one of/);
  const badArea = report(); badArea.findings[0].area = "everything";
  refused(() => parseQaReport(text(badArea)), /findings\[0\]\.area must be one of/);
  const badConfidence = report(); badConfidence.answers[0].confidence = "sure";
  refused(() => parseQaReport(text(badConfidence)), /answers\[0\]\.confidence must be one of/);
  const long = report(); long.findings[0].actual = "a".repeat(1001);
  refused(() => parseQaReport(text(long)), /findings\[0\]\.actual must have at most 1000/);
  const escape = report(); escape.journeys[0].screens = ["../../secrets.png"];
  refused(() => parseQaReport(text(escape)), /screens\[0\] must match/);
  refused(() => parseQaReport(text({ ...report(), purpose: "audit" })), /\$\.purpose must be one of/);
  const coverage = report(); coverage.coverage.reached.push("git");
  refused(() => parseQaReport(text(coverage)), /coverage\.reached "git" is not in coverage\.listed/);
  const dup = report(); dup.findings.push({ ...dup.findings[0] });
  refused(() => parseQaReport(text(dup)), /same id/);
  refused(() => parseQaReport(text({ ...report(), agent: { tool: "claude", model: "x", host: "app" } })), /agent\.tool must equal "codex"/);
  refused(() => parseQaReport(text({ ...report(), agent: { tool: "codex", model: "x", host: "terminal" } })), /agent\.host must equal "app"/);
  const badScreen = report(); badScreen.journeys[0].screens = ["shots/one.png"];
  refused(() => parseQaReport(text(badScreen)), /screens\[0\] must match/);
  const answerScreens = report(); answerScreens.answers[0].screens = ["screens/J01-architecture.png"];
  assert.equal(parseQaReport(text(answerScreens)).purpose, "client");
});

test("run.json: what qa:prepare writes has a closed shape", () => {
  const run = {
    format: "datapass.qa-run", version: 1, runId: "20260927-0930-doc-pipeline-lab", purpose: "client", createdAt: "2026-09-27T09:30:00.000Z",
    datapass: { version: "0.26.0", sha256: "a".repeat(64), vsix: "datapass-vscode-0.26.0.vsix", extension: "julian-passebecq.datapass-vscode" },
    vscode: { version: "1.105.0" }, os: { platform: "win32", release: "10.0.26200", arch: "x64" }, host: "codex-desktop",
    profile: { userDataDir: ".vscode-user", extensionsDir: ".vscode-ext" },
    preconditions: ["A visible, unlocked foreground desktop"], knownLeaks: ["~/.vscode-shared"],
    screenshots: { folder: "screens", pattern: SCREEN_PATTERN, command: "screencapture -x <file>" },
    clients: [{ id: "doc-pipeline-lab", title: "Doc Pipeline Lab", workspaceFile: "doc-pipeline-lab.code-workspace",
      bridge: { folder: "doc-pipeline", remote: "https://github.com/example-org/doc-pipeline", commit: "1".repeat(40) }, repositories: [], launch: "code --user-data-dir x" }],
    journeys: [{ id: "J01", kind: "client", title: "Open", file: "journeys/J01.json", features: ["onboarding"] }]
  };
  assert.equal(parseQaRun(text(run)).runId, run.runId);
  refused(() => parseQaRun(text({ ...run, profile: { userDataDir: "/home/me/.vscode", extensionsDir: ".vscode-ext" } })), /profile\.userDataDir must equal/);
  refused(() => parseQaRun(text({ ...run, clients: [] })), /clients must have at least 1 items/);
  refused(() => parseQaRun(text({ ...run, host: "codex-exec" })), /\$\.host must equal "codex-desktop"/);
  refused(() => parseQaRun(text({ ...run, preconditions: [] })), /preconditions must have at least 1 items/);
  assert.equal(parseQaRun(text({ ...run, datapass: { ...run.datapass, commit: "c78f01f" } })).runId, run.runId);
  refused(() => parseQaRun(text({ ...run, datapass: { ...run.datapass, commit: "v0.26.0" } })), /datapass\.commit must match/);
});

test("the emitted schemas are committed and agree with the parsers (Ajv)", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const files = emittedSchemaFiles();
  const cases: Array<[string, string, Array<Record<string, any>>, Array<Record<string, any>>]> = [
    ["schemas/datapass-codex-tests.schema.json", "config", [client(), app()], [{ ...client(), purpose: "both" }, (() => { const a = app(); delete a.workspaces; return a; })(), (() => { const c = client(); c.workspace.bridge.remote = "http://x.example/r"; return c; })()]],
    ["schemas/datapass-test-journey.schema.json", "journey", [journey(), json("app/journeys/A01-install-and-first-open.json")], [{ ...journey(), features: ["teleport"] }, { ...journey(), kind: "customer" }]],
    ["schemas/datapass-qa-report.schema.json", "report", [report()], [(() => { const r = report(); r.journeys[0].outcome = "done"; return r; })()]]
  ];
  for (const [file, what, good, bad] of cases) {
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), files[file], `${file} is up to date (npm run schemas)`);
    const validate = ajv.compile(files[file] as object);
    for (const doc of good) assert.ok(validate(doc), `${what} valid: ${JSON.stringify(validate.errors)}`);
    for (const doc of bad) assert.ok(!validate(doc), `${what} refused by the schema too`);
  }
  // The feature list is closed and has no duplicates (common/testing/FEATURES.md copies it).
  assert.equal(new Set(FEATURES).size, FEATURES.length);
});
