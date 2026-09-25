/**
 * 0.20 desktop flows for work orders (pass AI-2): real VS Code, real Git, a stub `claude` and a stub
 * gh, offline. The machine opt-in and the project type; an order written from the Agent tab (files,
 * marker, attachments, a clean clone); a terminal launch after the modal, with the arguments the
 * stub agent logs; the result checked by its receipt; PRs found by the planned branch; Needs you
 * rule 8; a refused result; the desktop-app hand-off (prompt copied, app opened, nothing run); the
 * Work orders view and the Details timeline; the entry points; a proposed file imported through the
 * review; the PR's DataPass files checked; the summary published (work-log.json and the private
 * log); the base-moved check; a work project.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import type { LoadedOrder } from "../../src/work/workOrders";
import { MARKER_RE, parseWorkOrder } from "../../src/core/workOrders/format";
import { parseWorkLog } from "../../src/core/workOrders/workLog";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
interface Env { ghStub: string; claudeStub: string; hub: string; pipeline: string; logRepo: string; other: string; projects: string }
const env = (): Env => JSON.parse(process.env.DATAPASS_IT_V20 ?? "{}");
const cfg = () => vscode.workspace.getConfiguration("datapass");
const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const stubMode = (mode: string) => fs.writeFileSync(env().claudeStub + ".json", JSON.stringify({ mode, ghStub: env().ghStub }, null, 2));
const stubCalls = (): Array<{ args: string[]; cwd: string; order: string | null }> =>
  fs.existsSync(env().claudeStub + ".log") ? fs.readFileSync(env().claudeStub + ".log", "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : [];
const same = (a: string, b: string) => fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();

export function registerWorkOrderFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const F = ["v20-work-orders"];
  const ids: Record<string, string> = {};
  const order = (id: string): LoadedOrder => { const o = api().workOrders.list().find(x => x.id === id); assert.ok(o, `order ${id} listed`); return o!; };
  const write = async (draft: Record<string, unknown>, token?: string): Promise<string> => {
    const replies = await api().aiExchange.send({ type: "wo.write", draft, launch: false, token });
    const done = replies.find(r => r.type === "wo.done") as { id?: string; error?: string } | undefined;
    assert.ok(done?.id, `the order was written: ${JSON.stringify(replies)}`);
    return done!.id!;
  };
  const launchTerminal = async (id: string) => {
    const ui = await withUi([{ button: "Launch" }], () => run("datapass.workOrders.launch", id));
    return ui;
  };
  const untilResult = (id: string, state: "valid" | "refused" = "valid") =>
    waitFor(`the result of ${id}`, async () => { await api().workOrders.reload(); const o = order(id); return o.result.state === state ? o : undefined; }, 45000);

  test("0.20: work orders stay off until the machine setting is on; the Agent tab says why", async () => {
    await cfg().update("git.ghPath", env().ghStub, vscode.ConfigurationTarget.Global);
    await cfg().update("ai.claude.path", env().claudeStub, vscode.ConfigurationTarget.Global);
    await cfg().update("ai.defaultTool", "claude-terminal", vscode.ConfigurationTarget.Global);
    await run("datapass.refreshProject");
    let s = await api().workOrders.aiState();
    assert.equal(s.agent?.verdict.allowed, false);
    assert.equal(s.agent?.verdict.fix, "machine-setting");
    const refused = await api().aiExchange.send({ type: "wo.write", draft: { kind: "change", goal: "x", components: ["extract"] } });
    assert.match(String(refused[0]?.error), /off on this computer/);
    await cfg().update("ai.workOrders.enabled", true, vscode.ConfigurationTarget.Global);
    s = await waitFor("the Agent tab allows orders", async () => { const x = await api().workOrders.aiState(); return x.agent?.verdict.allowed ? x : undefined; });
    assert.deepEqual([s.agent!.projectType.type, s.agent!.projectType.source], ["dev", "project.json"]);
    assert.equal(s.agent!.defaults.merge, "agent-when-green", "dev: the agent merges on green CI");
    assert.deepEqual(s.agent!.repos.map(r => [r.key, r.usable]), [[".", true], ["pipeline", true], ["lab", false], ["infra", false]]);
    assert.ok(s.manual, "the Manual tab has its state");
    record("agentTab", { verdict: s.agent!.verdict, projectType: s.agent!.projectType, repos: s.agent!.repos.map(r => `${r.key}:${r.note}`) });
  }, F);

  test("0.20: an order written from the Agent tab — order.json, order.md with the marker first, attachments, state; the clone stays clean", async () => {
    const id = await write({ kind: "change", goal: "Split long PDFs into page batches.\nRetry a failed batch once.", subproject: "papers", components: ["extract"], choice: "claude-terminal", effort: "high" });
    ids.first = id;
    const o = order(id);
    const folder = o.folder.fsPath;
    const json = parseWorkOrder(fs.readFileSync(path.join(folder, "order.json"), "utf8"), id);
    assert.equal(json.title, "Split long PDFs into page batches.");
    assert.deepEqual(json.repositories.map(r => [r.ref, r.access, r.branch ?? "-"]), [["pipeline", "change", `dp/${id}`], ["coordination", "change", `dp/${id}`]], "the code repository first: the agent starts there");
    assert.equal(json.repositories[0]!.base!.commit, git(env().pipeline, "rev-parse", "origin/main"));
    assert.equal(json.project.type, "dev");
    assert.equal(json.policy.merge, "agent-when-green");
    assert.match(json.agent.sessionId ?? "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(json.context.conventions, [{ repoRef: "coordination", path: "AGENTS.md" }]);
    const md = fs.readFileSync(path.join(folder, "order.md"), "utf8");
    assert.equal(MARKER_RE.exec(md.split("\n")[0]!)?.[1], id);
    assert.ok(md.includes(`Receipt ${json.receipt}`));
    for (const f of ["attachments/result-format.md", "attachments/preparation-pack-extract.md", "attachments/schemas/datapass-graph.schema.json", "attachments/schemas/datapass-work-order-result.schema.json", "state.json"]) {
      assert.ok(fs.existsSync(path.join(folder, ...f.split("/"))), `${f} written`);
    }
    assert.equal(o.state?.status, "written");
    assert.match(o.state?.digest ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(git(env().hub, "status", "--porcelain"), "", "orders live in .datapass/local, which Git ignores");
    record("orderFiles", fs.readdirSync(folder));
  }, F);

  test("0.20: a terminal launch after the modal — the agent's arguments, the result checked by its receipt, PRs found by the planned branch", async () => {
    const id = ids.first!;
    const ui = await launchTerminal(id);
    const modal = ui.prompts.find(p => p.modal)!;
    assert.match(modal.text ?? "", /Launch Claude Code · terminal for "Split long PDFs/);
    assert.match(modal.text ?? "", /merges its pull requests itself when CI is green \(dev project\)/);
    assert.match(modal.text ?? "", /will not deploy/);
    const o = await untilResult(id);
    assert.equal(o.state?.status, "reported");
    const call = stubCalls().find(c => c.order === id)!;
    assert.ok(call, "the stub agent ran with DATAPASS_WORK_ORDER");
    const json = o.order!;
    assert.deepEqual(call.args.slice(0, 6), ["--session-id", json.agent.sessionId, "--name", call.args[3], "--effort", "high"]);
    assert.ok(call.args[3]!.startsWith(id));
    assert.ok(call.args.includes("--add-dir") && same(call.args[call.args.indexOf("--add-dir") + 1]!, env().hub));
    assert.equal(MARKER_RE.exec(call.args[call.args.length - 1]!)?.[1], id);
    assert.ok(same(call.cwd, env().pipeline), "the first repository to change is the working folder");
    assert.match(git(env().pipeline, "ls-remote", "origin", `dp/${id}`), /refs\/heads\/dp\//);
    await api().git.refresh(true);
    const withPrs = await waitFor("the PRs found by branch", async () => { await api().workOrders.reload(); const x = order(id); return x.outputs.every(y => y.access === "read" || y.state === "open") ? x : undefined; }, 30000);
    assert.deepEqual(withPrs.outputs.map(x => [x.ref, x.state, x.pr?.ci ?? "-"]), [["pipeline", "open", "passing"], ["coordination", "open", "passing"]]);
    assert.deepEqual(withPrs.outputs.map(x => x.pr?.url), ["https://github.com/example-org/research-pipeline/pull/101", "https://github.com/example-org/research-library/pull/100"]);
    assert.deepEqual(withPrs.summary!.needs, ["1 question from the agent"], "the agent merges on green in a dev project: no review asked");
    assert.equal(withPrs.state?.seen.pullRequests.length, 2, "state.json keeps what DataPass saw (display only)");
    assert.equal(api().git.observation().needsYou.filter(n => n.kind === "work-order-no-pr").length, 0);
    record("launch", { args: call.args.map(a => a.replace(/[A-Za-z]:\\[^ ]*/g, "<path>")), outputs: withPrs.summary!.outputs.map(x => x.ref + ":" + x.state), next: withPrs.summary!.next });
  }, F);

  test("0.20: Needs you rule 8 for a result naming no PR; a result for another revision is refused", async () => {
    stubMode("no-pr");
    const id = await write({ kind: "change", goal: "Add a retry counter.", components: ["extract"], choice: "claude-terminal" });
    ids.noPr = id;
    await launchTerminal(id);
    await untilResult(id);
    await api().git.refresh(true);
    const item = await waitFor("rule 8 in the Git view", () => api().git.observation().needsYou.find(n => n.kind === "work-order-no-pr" && n.order === id));
    assert.equal(item.rank, 8);
    assert.equal(item.action, "open-work-order");
    const rows = await api().git.renderTree();
    assert.ok(rows.some(r => r.command === "datapass.workOrders.show" && JSON.stringify(r.commandArgs) === JSON.stringify([id])), "the Git view routes to the order");
    stubMode("wrong-receipt");
    const bad = await write({ kind: "change", goal: "Another try.", components: ["extract"], choice: "claude-terminal" });
    await launchTerminal(bad);
    const refused = await untilResult(bad, "refused");
    assert.equal(refused.result.state === "refused" && refused.result.why, "other-order");
    assert.ok(refused.summary!.needs.some(n => n.startsWith("result refused")));
    assert.equal(refused.state?.status, "launched", "a refused result never reports the order");
    stubMode("good");
    ids.refused = bad;
  }, F);

  test("0.20: the desktop-app hand-off copies the marker prompt and opens the app; nothing runs here", async () => {
    const id = await write({ kind: "change", goal: "Document the extraction settings.", components: ["extract"], choice: "claude-desktop" });
    const before = stubCalls().length;
    const ui = await withUi([{ button: "Copy the prompt and open the app" }, { dismiss: true }], () => run("datapass.workOrders.launch", id));
    const o = order(id);
    assert.equal(MARKER_RE.exec(ui.clipboard)?.[1], id);
    assert.ok(ui.clipboard.endsWith("order.md and follow it."));
    assert.deepEqual(ui.opened, ["claude://code/new"], "the Claude app's own new-session route");
    assert.equal(o.state?.status, "launched");
    assert.deepEqual(o.state?.launches.map(l => [l.tool, l.surface, l.how]), [["claude-code", "desktop", "copied"]]);
    assert.equal(o.order!.agent.sessionId, undefined, "no session id for the app");
    assert.equal(stubCalls().length, before, "no process started");
    ids.desktop = id;
  }, F);

  test("0.20: the Work orders view and Details — select an order, its component follows, the timeline", async () => {
    const id = ids.first!;
    await run("datapass.workOrders.show", id);
    await waitFor("the order selected", () => api().workOrders.selected() === id);
    assert.equal(api().selection().component, "extract");
    const wb = await waitFor("the Workbench's work orders", () => api().workbenchState().workOrders);
    assert.equal(wb.selected, id);
    assert.ok(wb.orders.length >= 4);
    const row = wb.orders.find(o => o.id === id)!;
    assert.deepEqual(row.timeline.map(t => t.what).slice(0, 3), ["written · change · 2 repositories to change", "launched · Claude Code · terminal", "result: done (the agent says)"]);
    assert.ok(row.canResume);
    assert.equal(row.changesCoordination, true);
    assert.ok(!JSON.stringify(wb).includes(env().hub.replace(/\\/g, "\\\\")), "no local path reaches the webview");
    await run("datapass.workOrders.select");
    assert.equal(api().workOrders.selected(), undefined);
    record("workOrdersView", wb.orders.map(o => `${o.short} ${o.status} ${o.outputs.map(x => x.text).join(" | ")}`));
  }, F);

  test("0.20: entry points prefill the Agent tab — a board card, a failing PR (its branch as base, its checks attached), a follow-up", async () => {
    await run("datapass.workOrders.newFromCard", "bug-3");
    let p = api().workOrders.lastPrefill()!;
    assert.equal(p.visible.kind, "fix-card");
    assert.equal(p.visible.boardCard, "bug-3");
    assert.deepEqual(p.visible.boardMoves, [{ card: "bug-3", to: "review" }]);
    const cardOrder = await write({ ...p.visible, choice: "claude-terminal" }, p.token);
    ids.card = cardOrder;
    assert.ok(fs.existsSync(path.join(order(cardOrder).folder.fsPath, "attachments", "board-card-bug-3.md")));
    await launchTerminal(cardOrder);
    await untilResult(cardOrder);

    await run("datapass.workOrders.newFromFailingPr", "pipeline", 38);
    p = api().workOrders.lastPrefill()!;
    assert.deepEqual(p.draft.baseBranches, { pipeline: "claude/fix-lint" });
    assert.equal(p.draft.extra?.[0]?.name, "failing-pr-38.md");
    const failing = await api().aiExchange.send({ type: "wo.write", draft: { ...p.visible, choice: "claude-terminal" }, launch: false, token: p.token });
    assert.match(String(failing[0]?.error), /origin\/claude\/fix-lint is not known here/, "a PR branch that was never fetched cannot be a base");

    await run("datapass.workOrders.followUp", ids.first);
    p = api().workOrders.lastPrefill()!;
    assert.equal(p.draft.followsUp, ids.first);
    assert.match(String(p.visible.goal), /Answers to your questions:\n1\. Is the stub enough\?/);
    const follow = await write({ ...p.visible, goal: `${p.visible.goal}yes`, choice: "claude-desktop" }, p.token);
    const f = order(follow);
    assert.equal(f.order!.links.followsUp, ids.first);
    assert.ok(f.order!.context.attachments.some(a => a.startsWith("attachments/previous-order-")));
  }, F);

  test("0.20: the PR's DataPass files are checked from the branch; a proposed file goes through the review", async () => {
    await withUi([], () => run("datapass.workOrders.checkPrFiles", ids.card));
    const id = await write({ kind: "datapass-files", goal: "Fill the project sheet with the PDF volumes.", choice: "claude-terminal", expectedFiles: [{ kind: "sheet", via: "import" }] });
    const plan = order(id).order!;
    assert.equal(plan.expected.pullRequests, "none", "import only: no pull request");
    assert.deepEqual(plan.repositories.map(r => [r.ref, r.access]), [["coordination", "read"]], "every repository is read");
    await launchTerminal(id);
    const o = await untilResult(id);
    assert.deepEqual(o.outputs.filter(x => x.access === "change"), []);
    assert.deepEqual(o.proposed, ["sheet"]);
    assert.equal(fs.existsSync(path.join(env().hub, ".datapass", "sheet.json")), false);
    const ui = await withUi([{ button: "Create the file" }, { dismiss: true }], () => run("datapass.workOrders.importProposed", id, "sheet"));
    assert.ok(ui.prompts.some(x => x.modal && /Write the AI's project sheet/.test(x.text ?? "")));
    assert.ok(fs.existsSync(path.join(env().hub, ".datapass", "sheet.json")));
    await api().workOrders.reload();
    assert.deepEqual(order(id).state?.imported?.map(x => x.kind), ["sheet"]);
    ids.sheet = id;
  }, F);

  test("0.20: the summary is published — work-log.json without goal text or paths, the private log after gh says private; done", async () => {
    await cfg().update("ai.workLog.privateRepository", env().logRepo, vscode.ConfigurationTarget.Global);
    const ui = await withUi([{ button: "Publish" }, { dismiss: true }], () => run("datapass.workOrders.publishSummary"));
    assert.match(ui.prompts.find(p => p.modal)?.text ?? "", /Private log: .*work-logs/);
    const text = fs.readFileSync(path.join(env().hub, ".datapass", "work-log.json"), "utf8");
    const log = parseWorkLog(text);
    assert.equal(log.project.type, "dev");
    assert.ok(log.entries.length >= 6);
    assert.ok(!text.includes("Split long PDFs into page batches.\nRetry"), "no goal text");
    assert.ok(!/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(text), "no local path");
    assert.ok(!text.includes(order(ids.first!).order!.receipt), "no receipt");
    const first = log.entries.find(e => e.id === ids.first)!;
    assert.deepEqual(first.repositories.map(r => r.pullRequests?.map(p => p.number)), [[101], [100]]);
    const priv = parseWorkLog(fs.readFileSync(path.join(env().logRepo, "work-logs", "research-library.json"), "utf8"));
    assert.equal(priv.entries.length, log.entries.length);
    const ghCalls = fs.readFileSync(env().ghStub + ".log", "utf8");
    assert.ok(ghCalls.includes('"repo","view","example-org/work-log-private"'));
    await withUi([{ dismiss: true }], () => run("datapass.workOrders.markDone", ids.first));
    await api().workOrders.reload();
    assert.equal(order(ids.first!).state?.status, "done");
    assert.equal(order(ids.first!).state?.published?.privateLog, true);
    record("workLog", { entries: log.entries.length, first });
  }, F);

  test("0.20: the base moved on origin — the launch asks for a new revision instead", async () => {
    const id = await write({ kind: "change", goal: "Rename the README title.", choice: "claude-terminal", repos: { ".": "change", pipeline: "skip" } });
    fs.writeFileSync(path.join(env().other, "CHANGELOG.md"), "moved\n");
    git(env().other, "add", "-A");
    git(env().other, "-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "-q", "-m", "moved");
    git(env().other, "push", "-q", "origin", "HEAD:main");
    const before = stubCalls().length;
    const ui = await withUi([{ dismiss: true }], () => run("datapass.workOrders.launch", id));
    assert.ok(ui.prompts.some(p => /base of work order .* moved/.test(p.text ?? "")));
    await api().workOrders.reload();
    assert.equal(order(id).state?.launches.length, 0);
    assert.equal(stubCalls().length, before);
  }, F);

  test("0.20: a work project needs modules.workOrders: true (the machine setting per project wins)", async () => {
    await cfg().update("ai.projectTypes", { "research-library": "work" }, vscode.ConfigurationTarget.Global);
    const s = await waitFor("the work type", async () => { const x = await api().workOrders.aiState(); return x.agent?.projectType.type === "work" ? x : undefined; });
    assert.equal(s.agent!.verdict.allowed, false);
    assert.equal(s.agent!.verdict.fix, "project-module");
    assert.equal(s.agent!.projectType.source, "this computer's setting");
    await assert.rejects(() => withUi([], () => run("datapass.workOrders.launch", ids.desktop), { allowErrors: false }), /needs modules\.workOrders: true/);
    await cfg().update("ai.projectTypes", undefined, vscode.ConfigurationTarget.Global);
    await cfg().update("ai.workOrders.enabled", undefined, vscode.ConfigurationTarget.Global);
  }, F);
}
