/**
 * Desktop flows for 0.18 (manifest v5): tools & versions, the ID map and connections, in real VS
 * Code on a real Git repository. Fixture v18-toolchain: the public "Sales BI" example (Fabric +
 * Power BI, fabric-cicd), non-FOIL, every id invented. The sign-in checks run through the Test-mode
 * runner seam with fake CLI output (a tenant account name and masked token prefixes included, so
 * the test can prove they never reach any output); the real `az`, `databricks` and `fab` are never
 * run. Tool probes are real, so CLI states are checked against this machine's own probes.
 *
 * Fixture v4-cloudflare: *Upgrade Project Manifest* moves a v4 manifest to v5 with a backup copy.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import type { CommandResult } from "../../src/core/toolchain/connections";
import { record, test } from "./harness";
import { withUi } from "./ui";
import { SALES_IDS } from "../fixtures/v3/salesBi";

const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const at = (rel: string) => vscode.Uri.joinPath(root(), ...rel.split("/"));
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const ACCOUNT = "sales.admin@contoso.example";
const MASKED = "eyJ0************************************";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const VALUES = Object.values(SALES_IDS);
const noLeak = (what: string, text: string, withValues = true) => {
  for (const s of [ACCOUNT, MASKED, "eyJ0", "Contoso Sales Subscription", ...(withValues ? VALUES : [])]) assert.ok(!text.includes(s), `${what} leaked ${s}`);
};

export function registerToolchainFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  type Row = Awaited<ReturnType<DataPassTestApi["renderProjectTree"]>>[number];
  const row = (rows: Row[], id: string) => rows.find(r => r.id === id);

  test("toolchain: the Project tree shows Tools & versions and Connections, states from this machine's probes, no value", async () => {
    await run("datapass.refreshProject");
    const rows = await api().renderProjectTree();
    noLeak("Project tree", JSON.stringify(rows));
    assert.equal(row(rows, "tools")?.label, "Tools & versions");
    assert.equal(row(rows, "connections")?.label, "Connections");
    const r = api().readiness();
    assert.equal(r.toolchain.entries.length, 9);
    const probes = api().toolObservations();
    for (const tool of ["cli.fab", "cli.az", "cli.git"]) {
      const e = r.toolchain.entries.find(x => x.tool === tool)!;
      const seen = probes.get(tool)?.state;
      if (seen === "absent") assert.equal(e.state, "missing", tool);
      else assert.ok(["ok", "outside-range", "version-unknown"].includes(e.state), `${tool}: ${e.state}`);
    }
    assert.match(row(rows, "tool:py.fabric-cicd@ci")?.description ?? "", /^not checked · >=0\.1\.20,<1 · CI$/);
    assert.match(row(rows, "tool:py.semantic-link-labs@fabric")?.description ?? "", /^not checked · Fabric$/);
    assert.match(row(rows, "tool:app.pbi-desktop@local")?.description ?? "", /^not checked$/);
    // Extensions are not installed in the isolated test profile: a click shows the extension page.
    const fabricExt = row(rows, "tool:ext.fabric@local")!;
    assert.match(fabricExt.description ?? "", /^missing/);
    assert.equal(fabricExt.command, "datapass.installTool");
    assert.equal(row(rows, "tool:extensions-json")?.description, "3/3 toolchain extension(s) recommended");
    assert.equal(row(rows, "tool:extensions-json")?.command, "datapass.showRecommendedExtensions");
    assert.equal(row(rows, "connection:sales-git")?.contextValue, "connection.portal");
    assert.match(row(rows, "connection:sales-git")?.description ?? "", /^git-binding · dev · declared, not checked · Sales workspace ↔ fabric · branch dev \(dev\)$/);
    assert.match(row(rows, "connection:sales-sql")?.description ?? "", /declared, not checked · fabric connection "conn-sales-sql"/);
    assert.equal(row(rows, "connections:check")?.command, "datapass.checkConnections");
    assert.match(row(rows, "connections:check")?.description ?? "", /az account show, fab auth status/);
    assert.match(row(rows, "env:id:ws-sales")?.description ?? "", /non-secret id · fabric workspace · dev \/ prod · click to copy/);
    record("toolchainTree", rows.filter(x => /^(tool|connection)/.test(x.id ?? "")).map(x => `${x.label} — ${x.description ?? ""}`));
  }, ["v18-toolchain"]);

  test("connections: Check connections runs only the fixed read-only commands; states follow; nothing leaks", async () => {
    const calls: string[] = [];
    api().setConnectionRunner(async (command, args): Promise<CommandResult> => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "az") return { ok: true, code: 0, stderr: "", stdout: JSON.stringify({ environmentName: "AzureCloud", id: SALES_IDS.subDev, name: "Contoso Sales Subscription", state: "Enabled", tenantId: SALES_IDS.tenant, user: { name: ACCOUNT, type: "user" } }) };
      if (command === "fab") return { ok: true, code: 0, stderr: "✓ Logged in to app.fabric.microsoft.com\n", stdout: `Logged In: True\nAccount: ${ACCOUNT}\nTenant Id: ${OTHER_TENANT}\nToken Fabric Powerbi: ${MASKED}\n` };
      return { ok: false, notFound: true, stdout: "", stderr: "" };
    });
    try {
      const ui = await withUi([], () => run("datapass.checkConnections"));
      assert.deepEqual(calls.sort(), ["az account show --output json", "fab auth status"]);
      noLeak("notifications", ui.notices.join(" "));
      assert.match(ui.notices.join(" "), /1\/2 sign-in\(s\) ok/);
      const r = api().readiness();
      assert.deepEqual(r.connections.map(c => `${c.id}:${c.state}`), ["azure-dev:ok", "fabric:mismatch", "sales-git:declared", "sales-sql:declared"]);
      const rows = await api().renderProjectTree();
      assert.equal(row(rows, "connection:fabric")?.command, "datapass.connections.copySignIn");
      assert.match(row(rows, "connection:azure-dev")?.description ?? "", /tenant "Entra tenant" ✓ · subscription "Data subscription" ✓/);
      noLeak("Project tree after the check", JSON.stringify(rows));
      // The sign-in command is built at click time; the tenant id is the declared, non-secret one.
      const copy = await withUi([], () => run("datapass.connections.copySignIn", "fabric"));
      assert.equal(copy.clipboard, `fab auth login --tenant ${SALES_IDS.tenant}`);
      noLeak("sign-in notice", copy.notices.join(" "));
      const refused = await withUi([], () => run("datapass.connections.copySignIn", "sales-sql"), { allowErrors: true });
      assert.match(refused.errors.join(" "), /needs no sign-in command/);
      const ghost = await withUi([], () => run("datapass.connections.copySignIn", "ghost"), { allowErrors: true });
      assert.match(ghost.errors.join(" "), /not declared/);

      // Every AI-facing and exported output: names and states only.
      const snap = await withUi([], () => run("datapass.copyEnvironmentSnapshot"));
      noLeak("environment snapshot", snap.clipboard);
      const doc = JSON.parse(snap.clipboard);
      assert.deepEqual(doc.environment.connections.map((c: { id: string; state: string }) => `${c.id}:${c.state}`), ["azure-dev:ok", "fabric:mismatch", "sales-git:declared", "sales-sql:declared"]);
      const pack = await withUi([{ button: "Copy" }], () => run("datapass.preparationPack", { question: "explain" }));
      noLeak("preparation pack", pack.clipboard);
      assert.match(pack.clipboard, /## Tools, ID map and connections \(names and states only\)/);
      assert.match(pack.clipboard, /`ws-sales` Sales workspace · fabric workspace · per environment: dev, prod/);
      assert.match(pack.clipboard, /`fabric` sign-in cli\.fab: signed in elsewhere/);
      const ctx = await withUi([{ pick: "current-task" }, { button: "Copy" }], () => run("datapass.copyAiContext"));
      noLeak("AI context", ctx.clipboard);
      assert.match(ctx.clipboard, /Tools, ID map and connections/);
      await withUi([], () => run("datapass.readinessReport"));
      const report = vscode.window.activeTextEditor?.document.getText() ?? "";
      noLeak("readiness report", report);
      assert.match(report, /## Tools & versions[\s\S]*## Connections/);
      await run("workbench.action.closeAllEditors");
      const wb = api().workbenchState().readiness!;
      noLeak("Workbench state", JSON.stringify(wb));
      assert.equal(wb.tools?.entries.length, 9);
      assert.equal(wb.connections.length, 4);
      record("connectionsAfterCheck", r.connections.map(c => `${c.label}: ${c.detail}`));
    } finally {
      api().setConnectionRunner(undefined);
    }
  }, ["v18-toolchain"]);

  test("ID map: Copy identifier asks which environment; a hover and Look Up an Id say which id a GUID is", async () => {
    const prod = await withUi([{ pick: "prod" }], () => run("datapass.env.copyIdentifier", "ws-sales"));
    assert.equal(prod.clipboard, SALES_IDS.wsProd);
    assert.deepEqual(prod.prompts.find(p => p.kind === "pick")?.options, ["dev", "prod"]);
    const direct = await withUi([], () => run("datapass.env.copyIdentifier", "ws-sales", "dev"));
    assert.equal(direct.clipboard, SALES_IDS.wsDev);
    const wrongEnv = await withUi([], () => run("datapass.env.copyIdentifier", "ws-sales", "staging"), { allowErrors: true });
    assert.match(wrongEnv.errors.join(" "), /no value for the environment "staging"/);
    const single = await withUi([], () => run("datapass.env.copyIdentifier", "tenant"));
    assert.equal(single.clipboard, SALES_IDS.tenant);

    const uri = at("fabric/parameter.yml");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const offset = doc.getText().indexOf(SALES_IDS.wsProd);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, doc.positionAt(offset + 5));
    // Labels are appended as plain text, so Markdown escapes them (backslashes, &nbsp;): compare without the escapes.
    const text = hovers.flatMap(h => h.contents.map(c => typeof c === "string" ? c : (c as vscode.MarkdownString).value)).join(" ").replace(/&nbsp;/g, " ").replace(/\\(.)/g, "$1");
    assert.match(text, /DataPass ID map/);
    assert.match(text, /Sales workspace.*ws-sales, prod · fabric workspace/);
    await run("workbench.action.closeAllEditors");

    const look = await withUi([], () => run("datapass.lookUpId", `https://app.fabric.microsoft.com/groups/${SALES_IDS.wsDev}/list`));
    assert.match(look.notices.join(" "), /"Sales workspace" \(ws-sales, dev · fabric workspace\)/);
    const none = await withUi([], () => run("datapass.lookUpId", "00000000-0000-0000-0000-000000000000"));
    assert.match(none.notices.join(" "), /not in this project's ID map/);
  }, ["v18-toolchain"]);

  test("portal pages, install commands and recommended extensions: shown or copied, never run or installed", async () => {
    const git = await withUi([], () => run("datapass.connections.openPortal", "sales-git"));
    assert.deepEqual(git.opened, [`https://app.fabric.microsoft.com/groups/${SALES_IDS.wsDev}`]);
    const sql = await withUi([], () => run("datapass.connections.openPortal", "sales-sql"));
    assert.match(sql.opened[0] ?? "", /^https:\/\/learn\.microsoft\.com\/fabric\//);
    const fab = await withUi([], () => run("datapass.toolchain.copyInstall", "cli.fab"));
    assert.equal(fab.clipboard, "pip install ms-fabric-cli");
    assert.match(fab.notices.join(" "), /DataPass installs nothing/);
    const labs = await withUi([], () => run("datapass.toolchain.copyInstall", "py.semantic-link-labs"));
    assert.equal(labs.clipboard, "%pip install semantic-link-labs");
    assert.match(labs.notices.join(" "), /in a Fabric notebook cell/);
    const unknown = await withUi([], () => run("datapass.toolchain.copyInstall", "cli.nope"), { allowErrors: true });
    assert.match(unknown.errors.join(" "), /not in this project's toolchain/);
    assert.ok((await vscode.commands.getCommands(true)).includes("workbench.extensions.action.showRecommendedExtensions"), "VS Code's own command exists");
    await run("datapass.showRecommendedExtensions");
    await run("workbench.action.closeSidebar");
    assert.deepEqual(vscode.extensions.all.filter(e => /fabric|tmdl|powerbi/i.test(e.id)).map(e => e.id), [], "nothing was installed");
  }, ["v18-toolchain"]);

  test("a version outside the project's range is a warning on the operations that use the tool, never on reading", async () => {
    // cli.git (>=2.40) is present on every machine the suite runs on; its operations only read here.
    const git = api().readiness().toolchain.entries.find(e => e.tool === "cli.git")!;
    assert.ok(["ok", "outside-range", "version-unknown"].includes(git.state), git.state);
    const ops = api().projectMap().components.flatMap(c => c.operations);
    for (const op of ops.filter(o => o.phase === "read")) assert.ok(!op.result.warnings.some(w => /outside this project's range/.test(w)), op.key);
  }, ["v18-toolchain"]);

  // ------------------------------------------------------------ v4 → v5 upgrade (runs last in its fixture)

  test("Upgrade Project Manifest: a v4 project moves to v5 with a backup copy, every field kept", async () => {
    const before = new TextDecoder().decode(await vscode.workspace.fs.readFile(at(".datapass/project.json")));
    assert.equal(JSON.parse(before).schemaVersion, 4);
    assert.ok(api().readiness().checks.some(c => c.id === "manifest.version" && /tools and versions/.test(c.message)));
    const ui = await withUi([{ button: "Upgrade" }], () => run("datapass.upgradeManifest"));
    assert.match(ui.prompts.find(p => p.modal)?.text ?? "", /v5 adds toolchain/);
    const after = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(at(".datapass/project.json"))));
    assert.equal(after.schemaVersion, 5);
    assert.deepEqual({ ...after, schemaVersion: 4 }, JSON.parse(before));
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(at(".datapass/project.v4.json"))), before, "backup is the exact previous file");
    assert.equal(api().project().manifest?.schemaVersion, 5);
    assert.ok(!api().readiness().checks.some(c => c.id === "manifest.version"));
    await run("workbench.action.closeAllEditors");
  }, ["v4-cloudflare"]);
}
