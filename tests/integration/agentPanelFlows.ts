/**
 * 0.24 desktop flows (pass AI-3): the Claude & Codex panel and Claude Control's data in the Work
 * orders view, on the work-order fixture after its 0.20 flows. A stub Control server on 127.0.0.1
 * (started by the test), then off, then switched off; the quick links and their URL policy; a
 * conversation found for an order after /desktop (exact session id) and one by the marker; Open in
 * Claude through the extension only; the Codex app hand-off without a CLI (copy + open the app) and
 * with a stub CLI (`codex app <folder>`), and a Codex terminal launch. Offline; nothing is installed.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { MARKER_RE } from "../../src/core/workOrders/format";
import { OFF_MESSAGE } from "../../src/views/agentPanelState";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const cfg = () => vscode.workspace.getConfiguration("datapass");
const G = vscode.ConfigurationTarget.Global;

/** A stub `codex` that only logs its arguments and folder (it never does any work). */
function codexStub(): { file: string; calls: () => Array<{ args: string[]; cwd: string; order: string | null }> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-codex-"));
  const file = path.join(dir, "codex-stub.cjs");
  fs.writeFileSync(file, [
    "const fs = require('fs');",
    "fs.appendFileSync(__filename + '.log', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), order: process.env.DATAPASS_WORK_ORDER || null }) + '\\n');"
  ].join("\n"));
  return { file, calls: () => (fs.existsSync(file + ".log") ? fs.readFileSync(file + ".log", "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []) };
}

export function registerAgentPanelFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const F = ["v20-work-orders"];
  let server: http.Server | undefined;
  let base = "";
  const hits: string[] = [];
  let orders: Record<string, unknown[]> = {};

  const startControl = async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      const send = (body: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.url === "/api/health") return send({ ok: true });
      if (req.url === "/api/status") return send({ plan: { five_hour: 42, week: 61 } });
      if (req.url === "/api/project/research-library") return send({
        project: "research-library", info: { instructions: "PRIVATE" },
        todo: { "À faire par toi": [{ Date: "2026-09-25", "À faire": "Allow auto-merge on research-pipeline", "Durée": "1 min", _p: ["research-library"] }] },
        prs: [{ number: 12, title: "wo-k3f9", url: "https://github.com/example-org/research-library/pull/12" }],
        sessions: [
          { id: "local_needs", link: "claude://claude.ai/epitaxy/local_needs", title: "Fix bug-12 timeouts", status: "needs-you", tokens: 1200000, task: "PRIVATE TASK" },
          { id: "local_evil", link: "https://evil.example/steal", title: "Rogue link", status: "running" },
          { id: "local_idle", title: "Old", status: "idle" }
        ],
        alerts: [{ level: "urgent", text: "merge: PR #12 is green and not merged", link: "https://github.com/example-org/research-library/pull/12" }]
      });
      if (req.url?.startsWith("/api/project/")) return send({ error: "unknown project", projects: ["research-library", "other"] });
      if (req.url?.startsWith("/api/work-orders?ids=")) return send({ orders });
      res.writeHead(404); res.end("{}");
    });
    await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  test("0.24: Claude Control off — the panel says so, the Work orders view shows no conversation, nothing breaks", async () => {
    const probe = http.createServer();
    await new Promise<void>(r => probe.listen(0, "127.0.0.1", r));
    const closedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>(r => probe.close(() => r()));
    await cfg().update("control.url", `http://127.0.0.1:${closedPort}`, G);
    const s = await api().control.refresh();
    assert.equal(s.state, "off");
    const p = api().control.panel();
    assert.equal(p.control.message, OFF_MESSAGE);
    assert.deepEqual(p.projects, []);
    assert.equal(p.links.length, 5, "the quick links stay");
    const ui = await withUi([], () => api().control.panelSend({ type: "copyStart" }));
    assert.match(ui.clipboard, /python server\/server\.py/);
    const wb = await waitFor("the Work orders view says Control is off", () => api().workbenchState().workOrders?.control === "off" ? api().workbenchState().workOrders : undefined);
    assert.ok(wb.orders.every(o => !o.conversation));
  }, F);

  test("0.24: Control switched off sends no request; a non-loopback address is refused", async () => {
    await startControl();
    await cfg().update("control.enabled", false, G);
    await cfg().update("control.url", base, G);
    await api().control.refresh();
    const before = hits.length;
    assert.equal((await api().control.refresh()).state, "disabled");
    assert.equal(hits.length, before, "no request at all");
    await cfg().update("control.url", "http://example.com:7430", G);
    await cfg().update("control.enabled", undefined, G);
    const bad = await api().control.refresh();
    assert.equal(bad.state, "bad-url");
    assert.equal(hits.length, before, "nothing is sent to a non-loopback address");
    await cfg().update("control.url", base, G);
  }, F);

  test("0.24: Control on — plan, this project's live conversations, PRs, alerts and to-dos; links opened only through the extension", async () => {
    // The orders written by the 0.20 flows: the terminal one moved to the app with /desktop (same CLI session id), the app one found by its marker.
    const list = api().workOrders.list().filter(o => o.order && o.state?.launches.length);
    const term = list.find(o => o.order!.agent.surface === "terminal" && o.order!.agent.sessionId)!;
    const app = list.find(o => o.order!.agent.surface === "desktop")!;
    assert.ok(term && app, "the fixture has a terminal and an app launch");
    orders = {
      [term.id]: [{ tool: "claude", surface: "desktop", id: "local_moved", cli_id: term.order!.agent.sessionId, link: "claude://claude.ai/epitaxy/local_moved", status: "running", tokens: 1830000, last: "2026-09-25T18:52" }],
      [app.id]: [{ tool: "claude", surface: "desktop", id: "local_pasted", link: "https://evil.example/x", status: "needs-you", tokens: 640000 }]
    };
    const s = await api().control.refresh();
    assert.equal(s.state, "on");
    assert.ok(hits.some(h => h.startsWith("/api/work-orders?ids=") && h.includes(term.id)));
    const p = api().control.panel();
    assert.deepEqual(p.plan, { fiveHour: 42, week: 61 });
    assert.equal(p.projects[0]?.name, "research-library");
    assert.deepEqual(p.projects[0]!.conversations.map(c => [c.title, c.openable]), [["Fix bug-12 timeouts", true], ["Rogue link", false]]);
    assert.equal(p.projects[0]!.todo[0]?.what, "Allow auto-merge on research-pipeline");
    assert.equal(p.projects[0]!.alerts.length, 1);
    assert.ok(!JSON.stringify(p).includes("PRIVATE"), "instructions and task texts never reach the panel");

    const opened = await withUi([], async () => {
      await api().control.panelSend({ type: "open", key: p.projects[0]!.conversations[0]!.key });
      await api().control.panelSend({ type: "open", key: p.projects[0]!.conversations[1]!.key });
      await api().control.panelSend({ type: "open", key: "c:research-library:../../x" });
      await api().control.panelSend({ type: "openLink", index: 0 });
      await api().control.panelSend({ type: "openLink", index: 99 });
    });
    assert.deepEqual(opened.opened, ["claude://claude.ai/epitaxy/local_needs", "https://chatgpt.com/"], "only allowlisted links open");

    // The Work orders view: conversation, how it is linked, tokens.
    const wb = await waitFor("conversations in the Work orders view", () => { const w = api().workbenchState().workOrders; return w?.orders.find(o => o.id === term.id)?.conversation ? w : undefined; });
    assert.equal(wb.control, "on");
    const row = wb.orders.find(o => o.id === term.id)!;
    assert.equal(row.conversation!.linked, "desktop");
    assert.equal(row.conversation!.tokens, "1.8 M");
    assert.match(row.conversation!.text, /moved to the app with \/desktop/);
    const pasted = wb.orders.find(o => o.id === app.id)!;
    assert.equal(pasted.conversation!.linked, "marker");
    assert.equal(pasted.conversation!.openable, false, "a link outside claude://claude.ai/epitaxy/ is dropped");
    const ui = await withUi([], () => run("datapass.control.openConversation", term.id));
    assert.deepEqual(ui.opened, ["claude://claude.ai/epitaxy/local_moved"]);
    const refused = await withUi([], () => run("datapass.control.openConversation", app.id), { allowErrors: true });
    assert.deepEqual(refused.opened, []);
    assert.match(refused.errors.join(" "), /no conversation link/);
    record("controlPanel", { conversations: p.projects[0]!.conversations.length, orders: wb.orders.filter(o => o.conversation).map(o => `${o.short} ${o.conversation!.linked} ${o.conversation!.tokens ?? ""}`) });
  }, F);

  test("0.24: quick links follow the setting; links outside the policy are left out with a note", async () => {
    await cfg().update("ai.quickLinks", [{ label: "Docs", url: "https://code.visualstudio.com/docs" }, { label: "Bad", url: "javascript:alert(1)" }, { label: "Local", url: "http://localhost:3100/" }], G);
    await waitFor("the new links", () => api().control.panel().links.length === 2);
    const p = api().control.panel();
    assert.deepEqual(p.links.map(l => l.label), ["Docs", "Local"]);
    assert.equal(p.refused.length, 1);
    const ui = await withUi([], () => api().control.panelSend({ type: "openLink", index: 1 }));
    assert.deepEqual(ui.opened, ["http://localhost:3100/"]);
    await cfg().update("ai.quickLinks", undefined, G);
  }, F);

  test("0.24: Codex — the app hand-off copies the prompt and opens the ChatGPT app; with a Codex CLI it runs `codex app <folder>`; a terminal launch", async () => {
    const write = async (choice: string) => {
      const replies = await api().aiExchange.send({ type: "wo.write", draft: { kind: "change", goal: `Codex ${choice} check.`, components: ["extract"], choice }, launch: false });
      const done = replies.find(r => r.type === "wo.done") as { id?: string } | undefined;
      assert.ok(done?.id, JSON.stringify(replies));
      return done!.id!;
    };
    await cfg().update("ai.workOrders.enabled", true, G);
    await cfg().update("ai.codex.path", undefined, G);
    await run("datapass.refreshProject");
    const s0 = await api().workOrders.aiState();
    assert.equal(typeof s0.agent?.codex?.cli, "boolean", "the Agent tab knows which Codex route applies");
    const noCli = await write("codex-desktop");
    const ui = await withUi([{ button: "Copy the prompt and open the app" }, { dismiss: true }], () => run("datapass.workOrders.launch", noCli));
    assert.equal(MARKER_RE.exec(ui.clipboard)?.[1], noCli);
    if (!api().control.panel().codex.cli) assert.deepEqual(ui.opened, ["codex:"], "without a Codex CLI the ChatGPT app is brought to the front");

    const stub = codexStub();
    await cfg().update("ai.codex.path", stub.file, G);
    assert.equal(api().control.panel().codex.cli, true);
    const withCli = await write("codex-desktop");
    const ui2 = await withUi([{ button: "Copy the prompt and open the app" }, { dismiss: true }], () => run("datapass.workOrders.launch", withCli));
    assert.equal(MARKER_RE.exec(ui2.clipboard)?.[1], withCli);
    assert.deepEqual(ui2.opened, [], "the CLI opens the app itself");
    const appCall = await waitFor("codex app ran", () => stub.calls().find(c => c.args[0] === "app"));
    assert.equal(appCall.args.length, 2);
    assert.equal(appCall.order, withCli);
    assert.equal(path.resolve(appCall.args[1]!).toLowerCase(), path.resolve(appCall.cwd).toLowerCase(), "the folder is the order's working folder");

    const term = await write("codex-terminal");
    await withUi([{ button: "Launch" }], () => run("datapass.workOrders.launch", term));
    const call = await waitFor("codex ran in a terminal", () => stub.calls().find(c => c.order === term));
    assert.equal(call.args[0], "-C");
    assert.ok(call.args.includes("workspace-write") && call.args.includes("on-request"));
    assert.equal(MARKER_RE.exec(call.args[call.args.length - 1]!)?.[1], term);
    await cfg().update("ai.codex.path", undefined, G);
    await cfg().update("ai.workOrders.enabled", undefined, G);
    record("codexHandOff", { app: appCall.args[0], terminal: call.args.slice(0, 2) });
  }, F);

  test("0.24: cleanup — stop the stub Control server", async () => {
    await cfg().update("control.url", undefined, G);
    await new Promise<void>(r => (server ? server.close(() => r()) : r()));
    server = undefined;
  }, F);
}
