/**
 * Desktop flows for environment readiness (manifest v4 localEnv / identifiers), in real VS Code
 * on a real Git repository. Fixture v4-cloudflare: a Cloudflare-backed project whose .env holds
 * recognizable fake secrets, Mongoku and DiagramCloud switched off (although mapped / present).
 *
 * Acceptance: the expected env files and variable names and which are missing show at once,
 * without any value; Copy CLOUDFLARE_ACCOUNT_ID and Open .env are one click; disabled optional
 * modules show only "optional module disabled"; every output (tree, Workbench state, snapshot,
 * AI context, preparation pack, report, notifications) holds names and states only.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test } from "./harness";
import { withUi } from "./ui";

export const FAKE_SECRET = "DPFAKESECRET_7f3a9c1e5b2d_do_not_leak";
export const FAKE_UNDECLARED = "DPFAKE_UNDECLARED_VALUE_4410";
const SECRETS = [FAKE_SECRET, FAKE_UNDECLARED, "UNDECLARED_PRIVATE_NAME"];

const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const at = (rel: string) => vscode.Uri.joinPath(root(), ...rel.split("/"));
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const noSecret = (what: string, text: string) => { for (const s of SECRETS) assert.ok(!text.includes(s), `${what} leaked ${s}`); };

export function registerReadinessFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  type Row = Awaited<ReturnType<DataPassTestApi["renderProjectTree"]>>[number];
  const row = (rows: Row[], id: string) => rows.find(r => r.id === id);

  test("readiness: the Project tree shows the expected env files and variable names, which are missing, and no value", async () => {
    await run("datapass.refreshProject");
    const rows = await api().renderProjectTree();
    noSecret("Project tree", JSON.stringify(rows));
    assert.equal(row(rows, "env")?.label, "Local environment");
    assert.match(row(rows, "env:file::.env")?.description ?? "", /^found · 3 expected name\(s\)$/);
    assert.equal(row(rows, "env:file::.env.local")?.description, "optional · not present");
    assert.match(row(rows, "env:key:CLOUDFLARE_ACCOUNT_ID")?.description ?? "", /^set in \.env · non-secret id$/);
    assert.match(row(rows, "env:key:CLOUDFLARE_API_TOKEN")?.description ?? "", /^set in \.env · secret · vault$/);
    assert.match(row(rows, "env:key:MONGODB_URI")?.description ?? "", /^empty in \.env · secret · vault$/);
    assert.match(row(rows, "env:key:R2_SECRET_ACCESS_KEY")?.description ?? "", /^missing · secret · vault$/);
    assert.equal(row(rows, "env:id:cf-account")?.label, "Cloudflare account ID");
    const r = api().readiness();
    assert.equal(r.files.find(f => f.path === ".env")?.git, "ignored", "Git ignores .env in the fixture");
    assert.deepEqual(r.checks.filter(c => c.area === "environment").map(c => `${c.severity}:${c.id}`).sort(),
      ["info:env.file.optional::.env.local", "warning:env.key.empty:MONGODB_URI", "warning:env.key.missing:R2_SECRET_ACCESS_KEY"]);
    record("readinessTree", rows.filter(x => /^(env|readiness|companion|check)/.test(x.id ?? "")).map(x => `${x.label} — ${x.description ?? ""}`));
  }, ["v4-cloudflare"]);

  test("readiness: Mongoku and DiagramCloud switched off show only \"optional module disabled\"", async () => {
    const rows = await api().renderProjectTree();
    assert.equal(row(rows, "companion:mongoku")?.description, "optional module disabled");
    assert.equal(row(rows, "companion:diagramcloud")?.description, "optional module disabled");
    const r = api().readiness();
    assert.equal(r.checks.filter(c => c.area === "companion").length, 0, "no warning, error or note for a disabled module");
    assert.ok(!r.checks.some(c => /mongoku|diagramcloud/i.test(`${c.message} ${c.nextStep ?? ""}`)));
    // Nothing else from them either: no Links section, no Mongoku rows in the Work view.
    const work = await api().renderWorkTree();
    assert.ok(!work.some(w => /mongoku|diagramcloud/i.test(`${w.id} ${w.label}`)), JSON.stringify(work.map(w => w.label)));
    assert.equal(api().companions().mongoku, undefined);
  }, ["v4-cloudflare"]);

  test("readiness: Copy CLOUDFLARE_ACCOUNT_ID is one click (the tree row's own command) and copies the name only", async () => {
    const rows = await api().renderProjectTree();
    const key = row(rows, "env:key:CLOUDFLARE_ACCOUNT_ID")!;
    assert.equal(key.command, "datapass.env.copyKeyName");
    const ui = await withUi([], () => run(key.command!, ...(key.commandArgs ?? [])));
    assert.equal(ui.clipboard, "CLOUDFLARE_ACCOUNT_ID");
    assert.match(ui.notices.join(" "), /non-secret id "Cloudflare account ID"/);
    const token = await withUi([], () => run("datapass.env.copyKeyName", "CLOUDFLARE_API_TOKEN"));
    assert.equal(token.clipboard, "CLOUDFLARE_API_TOKEN");
    assert.match(token.notices.join(" "), /local vault \(Power Ops\)/);
    noSecret("notifications", [...ui.notices, ...token.notices].join(" "));
    const refused = await withUi([], () => run("datapass.env.copyKeyName", "NOT_DECLARED"), { allowErrors: true });
    assert.match(refused.errors.join(" "), /not declared/);
    assert.equal(refused.clipboard, "");
  }, ["v4-cloudflare"]);

  test("readiness: Open .env is one click and opens the file in the editor", async () => {
    const rows = await api().renderProjectTree();
    const file = row(rows, "env:file::.env")!;
    assert.equal(file.command, "datapass.env.openFile");
    await withUi([], () => run(file.command!, ...(file.commandArgs ?? [])));
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, at(".env").fsPath);
    await run("workbench.action.closeAllEditors");
    const refused = await withUi([], () => run("datapass.env.openFile", ":../outside/.env"), { allowErrors: true });
    assert.match(refused.errors.join(" "), /not declared/);
  }, ["v4-cloudflare"]);

  test("readiness: Copy identifier and Copy project ID copy only what the manifest declares as non-secret", async () => {
    const ident = await withUi([], () => run("datapass.env.copyIdentifier", "cf-account"));
    assert.equal(ident.clipboard, "0123456789abcdef0123456789abcdef");
    const project = await withUi([], () => run("datapass.copyProjectId"));
    assert.equal(project.clipboard, "edge-shop");
  }, ["v4-cloudflare"]);

  test("readiness: Open Power Ops starts the program from the user setting with no argument", async () => {
    const launched: string[] = [];
    api().setAppLauncher(async exe => { launched.push(exe); });
    const config = vscode.workspace.getConfiguration("datapass");
    try {
      await config.update("powerOps.path", at("tools/PowerOps.exe").fsPath, vscode.ConfigurationTarget.Global);
      await withUi([], () => run("datapass.openPowerOps"));
      assert.deepEqual(launched, [at("tools/PowerOps.exe").fsPath]);
      // Not set: DataPass asks where it is; cancelling starts nothing.
      await config.update("powerOps.path", undefined, vscode.ConfigurationTarget.Global);
      await withUi([{ dismiss: true }], () => run("datapass.openPowerOps"));
      assert.equal(launched.length, 1);
    } finally {
      api().setAppLauncher(undefined);
      await config.update("powerOps.path", undefined, vscode.ConfigurationTarget.Global);
    }
  }, ["v4-cloudflare"]);

  test("readiness: the environment snapshot, AI context, preparation pack and report hold names and states only", async () => {
    const snap = await withUi([], () => run("datapass.copyEnvironmentSnapshot"));
    noSecret("environment snapshot", snap.clipboard);
    const doc = JSON.parse(snap.clipboard);
    assert.deepEqual(doc.environment.keys.map((k: { name: string; state: string }) => `${k.name}:${k.state}`), ["CLOUDFLARE_ACCOUNT_ID:set", "CLOUDFLARE_API_TOKEN:set", "MONGODB_URI:empty", "R2_SECRET_ACCESS_KEY:missing"]);
    assert.deepEqual(doc.environment.companions, [{ module: "mongoku", state: "disabled" }, { module: "diagramcloud", state: "disabled" }]);
    assert.ok(!snap.clipboard.includes("0123456789abcdef0123456789abcdef"), "the snapshot carries names and states only");

    const ctx = await withUi([{ pick: "current-task" }, { button: "Copy" }], () => run("datapass.copyAiContext"));
    noSecret("AI context", ctx.clipboard);
    assert.match(ctx.clipboard, /## Local environment \(names and states only\)/);
    assert.match(ctx.clipboard, /`R2_SECRET_ACCESS_KEY`: missing · secret, kept in my local vault/);

    const pack = await withUi([{ button: "Copy" }], () => run("datapass.preparationPack", { question: "explain" }));
    noSecret("preparation pack", pack.clipboard);
    assert.match(pack.clipboard, /`CLOUDFLARE_API_TOKEN`: set in \.env · secret, kept in my local vault/);

    await withUi([], () => run("datapass.readinessReport"));
    const report = vscode.window.activeTextEditor?.document.getText() ?? "";
    noSecret("readiness report", report);
    assert.match(report, /# Readiness — Edge shop/);
    assert.match(report, /Mongoku: optional module disabled/);
    await run("workbench.action.closeAllEditors");

    noSecret("Workbench state", JSON.stringify(api().workbenchState()));
    assert.deepEqual(api().workbenchState().readiness?.keys.map(k => k.name), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "MONGODB_URI", "R2_SECRET_ACCESS_KEY"]);
    record("readinessSnapshot", doc.environment);
  }, ["v4-cloudflare"]);

  test("readiness: a missing env file is created with names and empty values only, never blanking a name set elsewhere", async () => {
    const ui = await withUi([{ button: "Create file" }], () => run("datapass.env.openFile", ":.env.local"));
    assert.match(ui.prompts.find(p => p.modal)?.text ?? "", /Git ignores this file/);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(at(".env.local")));
    noSecret(".env.local", text);
    assert.match(text, /^# CLOUDFLARE_API_TOKEN is already set in \.env$/m);
    assert.match(text, /^MONGODB_URI=$/m);
    assert.match(text, /^R2_SECRET_ACCESS_KEY=$/m);
    const r = api().readiness();
    assert.equal(r.files.find(f => f.path === ".env.local")?.state, "found");
    assert.equal(r.keys.find(k => k.name === "CLOUDFLARE_API_TOKEN")?.state, "set", "not blanked by the new file");
    assert.equal(r.keys.find(k => k.name === "R2_SECRET_ACCESS_KEY")?.state, "empty");
    await run("workbench.action.closeAllEditors");
    await vscode.workspace.fs.delete(at(".env.local"));
  }, ["v4-cloudflare"]);

  // ------------------------------------------------------------ broken: refusals

  test("readiness commands refuse an invalid manifest and copy nothing", async () => {
    const ui = await withUi([], async () => {
      await run("datapass.env.openFile", ":.env");
      await run("datapass.env.copyIdentifier", "x");
      await run("datapass.copyProjectId");
      await run("datapass.env.copyKeyName", "X");
    }, { allowErrors: true });
    assert.equal(ui.errors.length, 4, ui.errors.join(" / "));
    assert.ok(ui.errors.slice(0, 3).every(e => /valid .*project\.json/i.test(e)), ui.errors.join(" / "));
    assert.equal(ui.clipboard, "");
  }, ["broken"]);
}
