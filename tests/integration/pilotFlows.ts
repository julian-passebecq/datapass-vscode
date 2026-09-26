/**
 * 0.26 desktop flows for pilot stage 1 (AI-4a): real VS Code, real Git, offline, on the work-order
 * fixture after its 0.20 and 0.24 flows. Pilot off until the machine setting is on; a pilot order
 * written from the Pilot tab (guard rails in the order folder only); a Claude terminal launch in the
 * order folder with the pilot arguments; a stub agent that writes two requests and a result (it runs
 * no cloud CLI: nothing here calls Azure); the requests as Pilot cards; Run it (with a stub action
 * runner) and Not now answered in responses/; the guard rails edited → the launch is refused; the
 * Codex app refused; every repository's `git status` unchanged (acceptance test 7).
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { MARKER_RE, parseWorkOrder } from "../../src/core/workOrders/format";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
interface Env { hub: string; pipeline: string }
const env = (): Env => JSON.parse(process.env.DATAPASS_IT_V20 ?? "{}");
const cfg = () => vscode.workspace.getConfiguration("datapass");
const G = vscode.ConfigurationTarget.Global;
const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const same = (a: string, b: string) => fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();

/** A stub agent: logs how it was started, then writes two pilot requests and a result in its working folder. It runs nothing else. */
function pilotAgentStub(): { file: string; calls: () => Array<{ args: string[]; cwd: string; order: string | null }> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-pilot-"));
  const file = path.join(dir, "pilot-agent-stub.cjs");
  fs.writeFileSync(file, [
    "const fs = require('fs'); const path = require('path');",
    "fs.appendFileSync(__filename + '.log', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), order: process.env.DATAPASS_WORK_ORDER || null }) + '\\n');",
    "const o = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'order.json'), 'utf8'));",
    "fs.mkdirSync('requests', { recursive: true });",
    "const req = (n, environment) => fs.writeFileSync(path.join('requests', n + '.json'), JSON.stringify({ format: 'datapass.pilot-request', version: '1', orderId: o.id, receipt: o.receipt, n, action: { capability: 'generic.files.open', component: 'extract', environment }, why: 'Open the extract entry file before reading the logs.' }));",
    "req(1, 'dev'); req(2, 'prod');",
    "fs.writeFileSync('result.json', JSON.stringify({ format: 'datapass.work-order-result', version: '1', orderId: o.id, receipt: o.receipt, status: 'done', summary: 'Looked at dev read-only (stub).' }));"
  ].join("\n"));
  return { file, calls: () => (fs.existsSync(file + ".log") ? fs.readFileSync(file + ".log", "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []) };
}

export function registerPilotFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const F = ["v20-work-orders"];
  const ids: Record<string, string> = {};
  let before: Record<string, string> = {};
  let claudeBefore: unknown;
  const stub = pilotAgentStub();
  const repoStatus = () => Object.fromEntries([env().hub, env().pipeline].map(d => [d, git(d, "status", "--porcelain", "--untracked-files=all")]));
  const write = async (draft: Record<string, unknown>) => {
    const replies = await api().pilot.aiSend({ type: "pilot.write", draft, launch: false });
    return replies.find(r => r.type === "pilot.done") as { id?: string; error?: string } | undefined;
  };

  test("0.26: pilot mode stays off until its machine setting is on; the Pilot tab says why", async () => {
    before = repoStatus();
    claudeBefore = cfg().inspect("ai.claude.path")?.globalValue;
    await cfg().update("ai.workOrders.enabled", true, G);
    await cfg().update("pilot.enabled", undefined, G);
    await run("datapass.refreshProject");
    const s = await api().workOrders.aiState();
    assert.ok(s.pilot, "the Pilot tab has its state");
    assert.equal(s.pilot!.enabled, false);
    assert.equal(s.pilot!.fix, "pilot-setting");
    assert.ok(!(s.hiddenTabs ?? []).includes("agent"));
    const refused = await write({ goal: "Look at dev.", components: ["extract"], choice: "claude-terminal" });
    assert.match(String(refused?.error), /Pilot mode is off/);
    await cfg().update("pilot.enabled", true, G);
    const on = await waitFor("the Pilot tab allows orders", async () => { const x = await api().workOrders.aiState(); return x.pilot?.allowed ? x : undefined; });
    assert.equal(on.pilot!.choices.find(c => c.id === "codex-desktop")?.disabled !== undefined, true, "the Codex app is marked not qualified");
    const codexApp = await write({ goal: "Look at dev.", components: ["extract"], choice: "codex-desktop" });
    assert.match(String(codexApp?.error), /Codex app is not qualified/);
  }, F);

  test("0.26: a pilot order — guard rails only in the order folder, every repository read, permissions ask", async () => {
    await cfg().update("ai.claude.path", stub.file, G);
    const done = await write({ goal: "Which functions exist in dev, and did the last runs fail?", components: ["extract"], choice: "claude-terminal", effort: "medium", permissions: "usual" });
    assert.ok(done?.id, JSON.stringify(done));
    ids.pilot = done!.id!;
    const o = api().workOrders.list().find(x => x.id === ids.pilot)!;
    const folder = o.folder.fsPath;
    const json = parseWorkOrder(fs.readFileSync(path.join(folder, "order.json"), "utf8"), ids.pilot);
    assert.equal(json.kind, "pilot-read");
    assert.equal(json.agent.permissions, "ask", "a pilot order always asks, whatever the draft says");
    assert.ok(json.repositories.every(r => r.access === "read"));
    assert.deepEqual(json.pilot, { stage: 1, environment: "dev", clis: ["az", "func"] });
    for (const f of [".claude/settings.json", ".codex/config.toml", ".codex/rules/pilot.rules", "attachments/pilot-request-format.md"]) assert.ok(fs.existsSync(path.join(folder, ...f.split("/"))), `${f} written`);
    const settings = JSON.parse(fs.readFileSync(path.join(folder, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.permissions.defaultMode, "default");
    assert.deepEqual(settings.permissions.additionalDirectories.map((d: string) => path.basename(d)).sort(), json.repositories.map(r => path.basename(r.localPath)).sort());
    for (const d of [env().hub, env().pipeline]) {
      assert.ok(!fs.existsSync(path.join(d, ".codex")), `${d} has no .codex`);
      assert.ok(!fs.existsSync(path.join(d, ".claude", "settings.json")) || same(path.dirname(path.dirname(path.join(d, ".claude", "settings.json"))), folder), `${d} got no DataPass settings`);
    }
    assert.deepEqual(repoStatus(), before, "writing a pilot order changes no repository");
    const s = await api().workOrders.aiState();
    assert.ok(s.pilot!.orders.some(x => x.id === ids.pilot && x.canLaunch));
    assert.ok(!s.agent!.kinds.some(k => k.id === "pilot-read"), "pilot orders are written from the Pilot tab only");
  }, F);

  test("0.26: a Claude terminal launch — cwd is the order folder, --permission-mode default and --settings; requests become cards; Run it and Not now answer", async () => {
    const id = ids.pilot!;
    const folder = api().workOrders.list().find(x => x.id === id)!.folder.fsPath;
    const ui = await withUi([{ button: "Launch" }], () => run("datapass.workOrders.launch", id));
    const modal = ui.prompts.find(p => p.modal)!;
    assert.match(modal.text ?? "", /pilot order/);
    assert.match(modal.text ?? "", /read-only, dev only/);
    const call = await waitFor("the stub agent ran", () => stub.calls().find(c => c.order === id));
    assert.ok(same(call.cwd, folder), "the order folder is the working folder");
    assert.equal(call.args[call.args.indexOf("--permission-mode") + 1], "default");
    assert.ok(same(call.args[call.args.indexOf("--settings") + 1]!, path.join(folder, ".claude", "settings.json")));
    assert.equal(MARKER_RE.exec(call.args[call.args.length - 1]!)?.[1], id);
    for (const bad of ["bypassPermissions", "auto", "--dangerously-skip-permissions"]) assert.ok(!call.args.includes(bad));
    const cards = await waitFor("two pilot cards", async () => { const c = await api().pilot.reload(); return c.filter(x => x.orderId === id).length === 2 ? c : undefined; }, 30000);
    const c1 = cards.find(c => c.orderId === id && c.n === 1)!;
    const c2 = cards.find(c => c.orderId === id && c.n === 2)!;
    assert.equal(c1.state, "pending");
    assert.equal(c1.capability, "generic.files.open");
    assert.match(c1.why ?? "", /extract entry file/);
    assert.equal(c2.state, "refused");
    assert.match(c2.message ?? "", /dev only, not "prod"/);
    const s = await api().workOrders.aiState();
    assert.equal(s.pilot!.pending, 1, "the tab's badge counts pending requests");
    const ran: string[] = [];
    await api().pilot.run(id, 1, ran);
    assert.deepEqual(ran, ["datapass.openComponentEntry"], "Run it runs the capability's own DataPass action");
    const r1 = JSON.parse(fs.readFileSync(path.join(folder, "responses", "1.json"), "utf8"));
    assert.deepEqual([r1.format, r1.n, r1.outcome], ["datapass.pilot-response", 1, "done"]);
    await assert.rejects(api().pilot.run(id, 1, ran), /already answered/, "a request runs once");
    await api().pilot.aiSend({ type: "pilot.decline", orderId: id, n: 2 });
    const r2 = JSON.parse(fs.readFileSync(path.join(folder, "responses", "2.json"), "utf8"));
    assert.equal(r2.outcome, "declined");
    assert.match(r2.what, /Refused by DataPass/);
    const after = await api().pilot.reload();
    assert.deepEqual(after.filter(c => c.orderId === id).map(c => c.state), ["answered", "answered"]);
    record("pilotLaunch", { args: call.args.map(a => a.replace(/[A-Za-z]:\\[^ ]*/g, "<path>")), cards: after.filter(c => c.orderId === id).map(c => `${c.n}:${c.outcome}`) });
  }, F);

  test("0.26: guard rails edited after writing → the launch is refused; acceptance 7: no repository changed", async () => {
    const id = ids.pilot!;
    const folder = api().workOrders.list().find(x => x.id === id)!.folder.fsPath;
    const file = path.join(folder, ".claude", "settings.json");
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, original.replace('"defaultMode": "default"', '"defaultMode": "bypassPermissions"'));
    const count = stub.calls().length;
    const ui = await withUi([], () => run("datapass.workOrders.launch", id), { allowErrors: true });
    assert.ok(ui.errors.some(e => /differ from what DataPass wrote/.test(e)), JSON.stringify(ui.errors));
    assert.equal(stub.calls().length, count, "nothing was launched");
    fs.writeFileSync(file, original);
    assert.deepEqual(repoStatus(), before, "a pilot order writes only inside its folder (git status of every repository unchanged)");
    await cfg().update("pilot.enabled", undefined, G);
    await cfg().update("ai.claude.path", claudeBefore, G);
    await cfg().update("ai.workOrders.enabled", undefined, G);
  }, F);
}
