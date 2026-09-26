/**
 * End-to-end user flows driven through the real command handlers with a scripted UI
 * (quick picks, inputs, modals, file dialogs, clipboard). These replace the manual
 * "click through it" checks for everything that does not need an account.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as os from "node:os";
import type { DataPassTestApi } from "../../src/extension";
import { sha256Bytes } from "../../src/core/model/ids";
import { record, test } from "./harness";
import { bindUi, withUi } from "./ui";

const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const at = (rel: string) => vscode.Uri.joinPath(root(), ...rel.split("/"));
const read = async (rel: string) => vscode.workspace.fs.readFile(at(rel));
const readText = async (rel: string) => new TextDecoder().decode(await read(rel));
const exists = async (rel: string) => { try { await vscode.workspace.fs.stat(at(rel)); return true; } catch { return false; } };
const write = async (rel: string, bytes: Uint8Array | string) => {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(at(rel), ".."));
  await vscode.workspace.fs.writeFile(at(rel), typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
};
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const closeEditors = () => vscode.commands.executeCommand("workbench.action.closeAllEditors");

export function registerFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  test("scripted UI binds to the Test-mode clipboard seam", () => bindUi(api()));

  // ------------------------------------------------------------ v2-retail: scope & checklist

  test("flow: mark a checklist item blocked with a note", async () => {
    await withUi([{ pick: "Review the report" }, { pick: "Blocked" }, { input: "waiting for data" }], () => run("datapass.setChecklistState"));
    const item = api().workModel().checklist.find(c => c.id === "review")!;
    assert.equal(item.state, "blocked");
    assert.equal(item.note, "waiting for data");
    assert.match(api().workModel().nextStep, /Resolve "Review the report" \(blocked: waiting for data\)/);
    const row = (await api().renderWorkTree()).find(r => r.label === "Review the report");
    assert.match(row?.description ?? "", /blocked/);
  }, ["v2-retail"]);

  test("flow: a note longer than 500 characters is refused by the input's own validation", async () => {
    const ui = await withUi([{ pick: "Update the forecast notebook" }, { pick: "Problem" }, { input: "x".repeat(501) }], () => run("datapass.setChecklistState"), { allowErrors: true });
    assert.ok(ui.errors.some(e => /under 500 characters/.test(e)), ui.errors.join(" / "));
    assert.equal(api().workModel().checklist.find(c => c.id === "notebook")?.state, "todo");
  }, ["v2-retail"]);

  test("flow: switch scope to whole project and back", async () => {
    await withUi([{ pick: "Whole project" }], () => run("datapass.selectScope"));
    assert.equal(api().workModel().scopeSource, "implicit");
    await withUi([{ pick: "Weekly forecast refresh" }], () => run("datapass.selectScope"));
    assert.equal(api().workModel().scope.id, "weekly-forecast");
    // The checklist state survives the round trip (workspaceState, not the tree).
    assert.equal(api().workModel().checklist.find(c => c.id === "review")?.state, "blocked");
  }, ["v2-retail"]);

  // ------------------------------------------------------------ v2-retail: app exchange

  let requestId = "";
  let requestFile = "";

  test("flow: create an app request (frozen bytes, private local folder)", async () => {
    await withUi([{ pick: "forecast-app" }, { pick: "validate" }, { pick: "forecast-app" }, { pick: "internal" }, { dismiss: true }], () => run("datapass.createAppRequest"));
    const rec = api().workModel().exchanges.find(e => e.kind === "app-request");
    assert.ok(rec?.file && rec.digest, "request not recorded");
    requestId = rec.id;
    requestFile = rec.file;
    const bytes = await read(rec.file);
    assert.equal(sha256Bytes(bytes).value, rec.digest, "recorded digest is not the digest of the saved bytes");
    const env = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(env.format, "datapass.app-exchange");
    assert.equal(env.payload.direction, "request");
    assert.equal(env.payload.operation, "validate");
    assert.deepEqual(env.payload.inputRefs, ["forecast-app"]);
    assert.match(await readText(".datapass/local/.gitignore"), /^\*$/m, ".datapass/local must ignore itself");
    const text = new TextDecoder().decode(bytes);
    assert.ok(!text.includes(root().fsPath) && !text.includes(os.homedir()), "a local absolute path leaked into the request");
    record("appRequest", { base: env.base, bytes: bytes.length });
  }, ["v2-retail"]);

  const resultFor = (requestBytes: Uint8Array, artifact: Uint8Array) => {
    const r = JSON.parse(new TextDecoder().decode(requestBytes));
    r.id = "res-desktop-1";
    Object.assign(r.payload, {
      direction: "result", resultState: "succeeded", executionEvidenceRef: "run-log-1",
      requestHash: sha256Bytes(requestBytes),
      outputArtifacts: [{ id: "candidate-1", locatorRef: "candidate-1", mediaType: "application/json", schemaRef: "sample.candidate/1",
        byteHash: sha256Bytes(artifact), inputRefs: ["forecast-app"], producerRef: "forecast-app" }]
    });
    return r;
  };

  test("flow: import a correlated app result from files → candidate, nothing applied", async () => {
    const requestBytes = await read(requestFile);
    const artifact = new TextEncoder().encode('{"candidate":true}\n');
    await write("incoming/result.json", JSON.stringify(resultFor(requestBytes, artifact), null, 2));
    await write("incoming/candidate-1.json", artifact);
    const manifestBefore = await read(".datapass/project.json");
    const ui = await withUi([{ pick: "forecast-app" }, { pick: "From file" }, { open: [at("incoming/result.json")] }, { open: [at("incoming/candidate-1.json")] }], () => run("datapass.importAppResult"));
    assert.ok(ui.notices.some(n => /staged as a candidate/.test(n)), ui.notices.join(" / "));
    const ex = api().workModel().exchanges;
    assert.equal(ex.find(e => e.kind === "app-result")?.status, "candidate");
    assert.equal(ex.find(e => e.id === requestId)?.status, "result-received");
    assert.ok(await exists(`.datapass/local/exchanges/${requestId}/result/artifacts/candidate-1`));
    assert.deepEqual(await read(".datapass/project.json"), manifestBefore, "importing a result must not change the project");
  }, ["v2-retail"]);

  test("flow: a result for a different base is quarantined", async () => {
    const requestBytes = await read(requestFile);
    const stale = resultFor(requestBytes, new TextEncoder().encode("{}"));
    stale.base.scopeRevision = "weekly-forecast@0000000000000000";
    await write("incoming/stale.json", JSON.stringify(stale));
    const ui = await withUi([{ pick: "forecast-app" }, { pick: "From file" }, { open: [at("incoming/stale.json")] }, { dismiss: true }], () => run("datapass.importAppResult"));
    assert.ok(ui.notices.some(n => /quarantined/i.test(n)), ui.notices.join(" / "));
    assert.ok(api().workModel().exchanges.some(e => e.kind === "app-result" && e.status === "quarantined"));
  }, ["v2-retail"]);

  test("flow: import from clipboard reads the (scripted) clipboard, never the system one", async () => {
    const ui = await withUi([{ pick: "forecast-app" }, { pick: "From clipboard" }], async u => { u.clipboard = "   "; await run("datapass.importAppResult"); }, { allowErrors: true });
    assert.ok(ui.errors.some(e => /clipboard is empty/.test(e)), ui.errors.join(" / "));
  }, ["v2-retail"]);

  // ------------------------------------------------------------ v2-retail: AI context

  test("flow: copy AI context — preview counts, no local paths, recorded as copied", async () => {
    const ui = await withUi([{ pick: "current-task" }, { button: "Copy" }], () => run("datapass.copyAiContext"));
    const modal = ui.prompts.find(p => p.kind === "message" && p.modal);
    assert.match(modal?.text ?? "", /AI context: \d+ bytes/);
    assert.match(ui.clipboard, /Weekly forecast refresh/);
    for (const leak of [root().fsPath, os.homedir(), os.userInfo().username]) {
      assert.ok(!ui.clipboard.includes(leak), `AI context leaked ${leak}`);
    }
    assert.ok(api().workModel().exchanges.some(e => e.kind === "ai-context" && e.status === "copied"));
    record("aiContext", { bytes: ui.clipboard.length, head: ui.clipboard.split("\n").slice(0, 3) });
  }, ["v2-retail"]);

  // ------------------------------------------------------------ v2-retail: publication brief

  test("flow: first brief asks to create the claims register (never writes claims)", async () => {
    await withUi([{ button: "Create" }], () => run("datapass.prepareBrief"));
    const reg = JSON.parse(await readText(".datapass/claims.json"));
    assert.deepEqual(reg.claims, []);
    await closeEditors();
  }, ["v2-retail"]);

  test("flow: prepare and approve a brief; confidential sources never reach it", async () => {
    const hash = { algorithm: "sha256", value: "761b83212a13d9cea140970f1628b4a3d212a60a2c4ae4f3177d9f0fba31afeb" };
    const src = (id: string, classification: string) => ({ id, authority: "synthetic-example", recordRef: "fixture-only", revision: "1", observedAt: "2026-09-24T00:00:00Z", classification, snapshotHash: hash });
    const claim = (id: string, review: string, sourceRefs: string[]) => ({ id, statement: `Statement ${id}.`, basis: "assumption", sourceRefs, review, limitations: ["Synthetic"], allowedAudiences: ["internal"] });
    await write(".datapass/claims.json", JSON.stringify({
      format: "datapass.claims-register", version: "0.1-draft",
      sources: [src("source-internal", "internal"), src("source-secret", "confidential")],
      claims: [claim("claim-ok", "approved", ["source-internal"]), claim("claim-draft", "draft", ["source-internal"]), claim("claim-secret", "approved", ["source-secret"])]
    }, null, 2));
    await withUi([{ pick: "Executive review" }, { input: "Weekly review" }, { pick: ["pptx", "pdf"] }], () => run("datapass.prepareBrief"));
    const brief = api().workModel().exchanges.find(e => e.kind === "brief");
    assert.ok(brief?.file);
    const env = JSON.parse(await readText(brief.file));
    assert.deepEqual(env.payload.claims.map((c: { id: string }) => c.id).sort(), ["claim-draft", "claim-ok"]);
    assert.ok(!JSON.stringify(env).includes("source-secret"), "a confidential source reached an internal brief");
    assert.equal(env.payload.publication, "not-authorized");
    assert.deepEqual(env.payload.outputFormats, ["pptx", "pdf"]);

    const approveUi = await withUi([{ pick: "Weekly review" }, { button: "Approve for generation" }, { dismiss: true }], () => run("datapass.approveBrief"));
    const modal = approveUi.prompts.find(p => p.modal);
    assert.match(modal?.text ?? "", /Approve brief for generation \(internal\)/);
    const after = api().workModel().exchanges.find(e => e.id === brief.id)!;
    assert.notEqual(after.status, "draft");
    record("brief", { status: after.status, claims: env.payload.claims.length });
  }, ["v2-retail"]);

  test("flow: tampering with an approved brief's bytes voids the approval", async () => {
    const brief = api().workModel().exchanges.find(e => e.kind === "brief")!;
    const env = JSON.parse(await readText(brief.file!));
    env.payload.purpose = "Weekly review (edited after approval)";
    await write(brief.file!, JSON.stringify(env));
    // Re-approving shows the new digest; declining leaves the recorded state untouched.
    const ui = await withUi([{ pick: "Weekly review" }, { dismiss: true }], () => run("datapass.approveBrief"));
    const modal = ui.prompts.find(p => p.modal);
    assert.match(modal?.text ?? "", /edited after approval/);
  }, ["v2-retail"]);

  // ------------------------------------------------------------ v1-foil: manifest upgrade

  test("flow: declining the upgrade modal changes nothing", async () => {
    const before = await read(".datapass/project.json");
    await withUi([{ dismiss: true }], () => run("datapass.migrateManifestToV2"));
    assert.deepEqual(await read(".datapass/project.json"), before);
    assert.equal(await exists(".datapass/project.v1.json"), false);
  }, ["v1-foil"]);

  test("flow: upgrade v1 → v2 is journaled, backed up byte-for-byte and loads cleanly", async () => {
    const before = await read(".datapass/project.json");
    await withUi([{ button: "Upgrade" }], () => run("datapass.migrateManifestToV2"));
    assert.deepEqual(await read(".datapass/project.v1.json"), before, "backup is not byte-identical");
    const v2 = JSON.parse(await readText(".datapass/project.json"));
    assert.equal(v2.schemaVersion, 2);
    const files = (await vscode.workspace.fs.readDirectory(at(".datapass/local/journal"))).map(([name]) => name);
    const journalName = files.find(f => f.endsWith(".json"))!;
    const journal = JSON.parse(await readText(`.datapass/local/journal/${journalName}`));
    assert.equal(journal.state, "committed");
    // The journal keeps its own backup of each overwritten file, besides the visible project.v1.json.
    const bak = journal.entries.find((e: { target: string }) => e.target === ".datapass/project.json")?.backup;
    assert.ok(bak, `no journal backup for the manifest: ${files.join(", ")}`);
    assert.deepEqual(await read(bak), before);
    await run("datapass.work.refresh");
    assert.deepEqual(api().project().manifestErrors, []);
    assert.equal(api().project().manifest?.schemaVersion, 2);
    await closeEditors();
    const again = await withUi([], () => run("datapass.migrateManifestToV2"));
    assert.ok(again.notices.some(n => /already schemaVersion 2/.test(n)));
  }, ["v1-foil"]);

  // ------------------------------------------------------------ broken: refusals

  test("flow: an invalid manifest is never migrated or used for requests", async () => {
    const before = await read(".datapass/project.json");
    const ui = await withUi([], async () => {
      await run("datapass.migrateManifestToV2");
      await run("datapass.createAppRequest");
      await run("datapass.copyAiContext");
    }, { allowErrors: true });
    assert.equal(ui.errors.length, 3, ui.errors.join(" / "));
    assert.ok(ui.errors.every(e => /valid (project )?manifest/i.test(e)), ui.errors.join(" / "));
    assert.equal(ui.clipboard, "");
    assert.deepEqual(await read(".datapass/project.json"), before);
  }, ["broken"]);
}
