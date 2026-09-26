/**
 * QA-2 desktop flows: the Codex tests section of the Work orders view (handoff/v3/12 §4.5), in real
 * VS Code, offline, on the work-order fixture. A fixture test repository (the client config and two
 * journeys) and a fixture audit clone beside it (two runs) → the section lists the journeys and the
 * newest report; the section is hidden in Standard; *Hand to Codex* writes a qa-run order and hands
 * it to a stub launcher (the Codex app is never opened); a report and a result written as Codex would
 * close the order through the receipt check. Nothing is written in the project's repositories.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { parseWorkOrder } from "../../src/core/workOrders/format";
import { record, test, waitFor } from "./harness";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const cfg = () => vscode.workspace.getConfiguration("datapass");
const G = vscode.ConfigurationTarget.Global;
const write = (file: string, doc: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof doc === "string" ? doc : JSON.stringify(doc, null, 2)); };

const AUDIT = "https://github.com/example-org/datapass-codex-test";
const config = {
  format: "datapass.codex-tests", version: 1, purpose: "client",
  client: { id: "doc-pipeline-lab", title: "Doc Pipeline Lab (fictional)" },
  datapass: { version: "0.26.0" },
  workspace: {
    bridge: { remote: "https://github.com/example-org/doc-pipeline", folder: "doc-pipeline" },
    repositories: [{ remote: "https://github.com/example-org/doc-processing", folder: "doc-processing" }]
  },
  journeys: ["journeys/J01-open-my-project.json", "journeys/J02-choose-a-variant.json"],
  report: { remote: AUDIT, folder: "reports" },
  limits: { runMinutes: 60, journeyMinutes: 20 }
};
const journey = (id: string, title: string, features: string[]) => ({
  format: "datapass.test-journey", version: 1, id, kind: "client", title, goal: `${title}, as the client.`,
  expected: [`${title}: done`], features
});
const report = (runId: string, version: string, outcomes: string[], severities: string[] = []) => ({
  format: "datapass.qa-report", version: 1, purpose: "client", runId,
  datapass: { version, sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
  vscode: { version: "1.105.0" }, os: { platform: "win32", release: "10.0.26200", arch: "x64" },
  clients: [{ id: "doc-pipeline-lab", title: "Doc Pipeline Lab (fictional)", bridge: { folder: "doc-pipeline", remote: "https://github.com/example-org/doc-pipeline", commit: "1".repeat(40) }, repositories: [] }],
  agent: { tool: "codex", model: "stub", host: "app" },
  finishedAt: "2026-09-27T10:05:00Z",
  journeys: outcomes.map((outcome, i) => ({ id: `J0${i + 1}`, outcome, minutes: 5, path: ["Looked"], expected: [] })),
  findings: severities.map((severity, i) => ({ id: `F${i + 1}`, journey: "J01", severity, area: "architecture", title: "Stub finding", steps: ["Open"], expected: "x", actual: "y" })),
  answers: [],
  coverage: { listed: ["onboarding", "architecture", "variants"], reached: ["onboarding", "architecture"] }
});

export function registerCodexTestsFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const F = ["v20-work-orders"];
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dp-qa2-"));
  const auto = path.join(base, "doc-pipeline-auto");
  const audit = path.join(base, "datapass-codex-test");
  let before: { preset?: string; orders?: unknown; repo?: unknown; status: string } = { status: "" };
  let runRoot = "";
  const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: api().project().root!.fsPath, encoding: "utf8" });
  const mode = async (id: string) => { await run("datapass.experience.switchMode", id); await waitFor(`mode ${id}`, () => api().experience.current().preset === id); };

  test("QA-2: the Codex tests section lists the journeys and the newest report of the audit clone", async () => {
    before = { preset: api().experience.current().preset, orders: cfg().inspect("ai.workOrders.enabled")?.globalValue, repo: cfg().inspect("codexTests.autoRepository")?.globalValue, status: status() };
    write(path.join(auto, "datapass-codex-tests.json"), config);
    write(path.join(auto, "journeys", "J01-open-my-project.json"), journey("J01", "Open my project", ["onboarding", "architecture"]));
    write(path.join(auto, "journeys", "J02-choose-a-variant.json"), journey("J02", "Choose a variant", ["variants", "costs"]));
    write(path.join(audit, "reports", "client", "20260920-0800-doc-pipeline-lab", "report.json"), report("20260920-0800-doc-pipeline-lab", "0.25.0", ["blocked", "blocked"]));
    write(path.join(audit, "reports", "client", "20260927-0930-doc-pipeline-lab", "report.json"), report("20260927-0930-doc-pipeline-lab", "0.26.0", ["reached", "partly"], ["blocker", "major", "minor"]));

    await mode("datapass");
    const empty = await api().codexTests.reload();
    assert.equal(empty.configured, false, "nothing is read before the machine setting is set");
    assert.equal(api().workbenchState().codexTests?.configured, false, "the section shows how to start");

    await cfg().update("ai.workOrders.enabled", true, G);
    await cfg().update("codexTests.autoRepository", auto, G);
    const s = await waitFor("the test repository is read", async () => { const v = await api().codexTests.reload(); return v.journeys.length === 2 ? v : undefined; });
    assert.equal(s.error, undefined);
    assert.equal(s.title, "Doc Pipeline Lab (fictional)");
    assert.equal(s.version, "0.26.0");
    assert.deepEqual(s.journeys.map(j => [j.id, j.features.join(",")]), [["J01", "onboarding,architecture"], ["J02", "variants,costs"]]);
    assert.equal(s.lastReport?.runId, "20260927-0930-doc-pipeline-lab", "the newest run");
    assert.deepEqual([s.lastReport?.outcomes.reached, s.lastReport?.outcomes.partly, s.lastReport?.blockers, s.lastReport?.majors], [1, 1, 1, 1]);
    assert.deepEqual(s.lastReport?.coverage, { reached: 2, listed: 3 });
    assert.equal(s.canHand, true, s.why);
    const wb = await waitFor("the Workbench state carries the section", () => api().workbenchState().codexTests?.journeys.length === 2 ? api().workbenchState().codexTests : undefined);
    assert.equal(wb.lastReport?.version, "0.26.0");
    record("codexTests", { journeys: s.journeys.map(j => j.id), lastReport: s.lastReport?.runId });
  }, F);

  test("QA-2: the section is hidden in Standard (and Vanilla), shown in DataPass and Advanced", async () => {
    await mode("standard");
    assert.equal(api().workbenchState().codexTests, undefined);
    await mode("vanilla");
    assert.equal(api().workbenchState().codexTests, undefined);
    await mode("advanced");
    assert.equal(api().workbenchState().codexTests?.journeys.length, 2);
    await mode("datapass");
    assert.equal(api().workbenchState().codexTests?.journeys.length, 2);
  }, F);

  test("QA-2: Hand to Codex writes a qa-run order and hands it to the (stubbed) launcher", async () => {
    const launched: string[] = [];
    const o = await api().codexTests.handToCodex(launched);
    assert.deepEqual(launched, [o.id], "the launcher got exactly the new order");
    const order = parseWorkOrder(fs.readFileSync(path.join(o.folder.fsPath, "order.json")), o.id);
    assert.equal(order.kind, "qa-run");
    assert.equal(order.agent.tool, "codex");
    assert.equal(order.agent.surface, "desktop");
    assert.equal(order.expected.pullRequests, "none");
    assert.deepEqual(order.repositories.map(r => [r.ref, r.access]), [["tests", "read"]]);
    assert.equal(order.qa?.version, "0.26.0");
    assert.match(order.qa!.runId, /^\d{8}-\d{4}-doc-pipeline-lab$/);
    assert.equal(order.qa?.report.folder, `reports/client/${order.qa!.runId}`);
    runRoot = order.qa!.runRoot;
    assert.ok(runRoot.startsWith(path.join(os.tmpdir(), "datapass-qa")), runRoot);
    const md = fs.readFileSync(path.join(o.folder.fsPath, "order.md"), "utf8");
    assert.match(md, new RegExp(`Codex tests ${order.qa!.runId}`));
    assert.match(md, /- J01 — Open my project \[onboarding, architecture\]/);
    assert.match(md, /the Codex desktop app/);
    assert.match(md, /VSIX is the user's own build/);
    assert.ok(fs.existsSync(path.join(o.folder.fsPath, "attachments", "result-format.md")));
    const toml = fs.readFileSync(path.join(runRoot, ".codex", "config.toml"), "utf8");
    assert.match(toml, /sandbox_mode = "workspace-write"/);
    assert.ok(toml.includes(`'${o.folder.fsPath}'`), "the order folder is writable for the report and the result");
    const s = await api().codexTests.reload();
    assert.deepEqual(s.runs.map(r => [r.id, r.receipt]), [[o.id, "waiting"]]);
    assert.equal(status(), before.status, "the project's repository is unchanged (orders live under .datapass/local)");
  }, F);

  test("QA-2: the receipt — a report for another run is refused; the matching one closes the order with its PR", async () => {
    const o = api().workOrders.list().find(x => x.order?.kind === "qa-run")!;
    const order = o.order!;
    const result = (summary: string) => write(path.join(o.folder.fsPath, "result.json"), { format: "datapass.work-order-result", version: "1", orderId: order.id, receipt: order.receipt, status: "done", summary });
    write(path.join(o.folder.fsPath, "report.json"), report("20260101-0000-doc-pipeline-lab", order.qa!.version, ["reached", "reached"]));
    result("Walked J01 and J02 (stub).");
    await api().workOrders.reload();
    const refused = await waitFor("the other run is refused", async () => (await api().codexTests.reload()).runs.find(r => r.id === o.id && r.receipt === "refused"));
    assert.match(refused.message ?? "", /is for run 20260101-0000-doc-pipeline-lab/);
    assert.notEqual(api().workOrders.list().find(x => x.id === o.id)?.state?.status, "done");

    write(path.join(o.folder.fsPath, "report.json"), report(order.qa!.runId, order.qa!.version, ["reached", "partly"]));
    result(`Report pushed: ${AUDIT}/pull/12`);
    await api().workOrders.reload();
    const ok = await waitFor("the matching report closes the order", async () => { await api().workOrders.reload(); const r = (await api().codexTests.reload()).runs.find(x => x.id === o.id); return r?.receipt === "matches" && r.status === "done" ? r : undefined; });
    assert.equal(ok.pr, `${AUDIT}/pull/12`);
    const closed = api().workOrders.list().find(x => x.id === o.id)?.state?.closed;
    assert.equal(closed?.how, "done");
    assert.match(closed?.note ?? "", /pull\/12/);
  }, F);

  test("QA-2: cleanup (settings, mode, fixture folders)", async () => {
    await cfg().update("codexTests.autoRepository", before.repo, G);
    await cfg().update("ai.workOrders.enabled", before.orders, G);
    if (before.preset) await mode(before.preset);
    for (const d of [base, runRoot]) if (d) fs.rmSync(d, { recursive: true, force: true });
    assert.equal((await api().codexTests.reload()).configured, Boolean(before.repo));
  }, F);
}
