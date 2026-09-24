/**
 * Desktop acceptance suite. Runs inside a real VS Code extension host (see
 * scripts/desktop-test.ts) against generated fixture workspaces. It checks what a stubbed
 * `vscode` cannot: real activation, command registration, tree rendering (unique IDs),
 * webview resolution, JSON-schema diagnostics from the built-in JSON server, file creation
 * through the real workspace FS, and what the capability probes observe on this machine.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { fixture, record, runAll, sleep, test, waitFor } from "./harness";
import { registerFlows } from "./flows";

const EXTENSION_ID = "julian-passebecq.datapass-vscode";
let api: DataPassTestApi;

const root = () => vscode.workspace.workspaceFolders?.[0]?.uri;
const exists = async (uri: vscode.Uri) => { try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; } };

/** Run a command that may open a quick pick, then dismiss whatever UI it opened. */
async function runAndDismiss(command: string, ...args: unknown[]): Promise<void> {
  const pending = Promise.resolve(vscode.commands.executeCommand(command, ...args));
  await sleep(600);
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  await Promise.race([pending, sleep(5000).then(() => { throw new Error(`${command} did not settle after its UI was dismissed`); })]);
}

test("extension activates in desktop VS Code and exposes the Test-mode hooks", async () => {
  const ext = vscode.extensions.getExtension<DataPassTestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed in the test host`);
  const exported = await ext.activate();
  assert.ok(exported, "activate() returned no test API although the host runs in Test mode");
  api = exported;
  await api.refresh();
  record("host", { vscodeVersion: vscode.version, platform: process.platform, arch: process.arch, uiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? "desktop" : "web", remoteName: vscode.env.remoteName ?? null, extensionVersion: ext.packageJSON.version });
});

test("every contributed command is registered", async () => {
  const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
  const contributed: string[] = ext.packageJSON.contributes.commands.map((c: { command: string }) => c.command);
  const registered = new Set(await vscode.commands.getCommands(true));
  const missing = contributed.filter(c => !registered.has(c));
  assert.deepEqual(missing, [], `contributed but not registered: ${missing.join(", ")}`);
  record("commands", { contributed: contributed.length, registered: contributed.length - missing.length });
});

test("menus and tree items only reference commands that exist", async () => {
  const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
  const registered = new Set(await vscode.commands.getCommands(true));
  const menus = ext.packageJSON.contributes.menus as Record<string, Array<{ command: string }>>;
  const referenced = Object.values(menus).flat().map(m => m.command);
  const rows = await api.renderWorkTree();
  const fromTree = rows.map(r => r.command).filter((c): c is string => !!c);
  const dangling = [...new Set([...referenced, ...fromTree])].filter(c => !registered.has(c));
  assert.deepEqual(dangling, []);
});

test("Work tree renders through the real provider with unique item IDs", async () => {
  const rows = await api.renderWorkTree();
  assert.ok(rows.length > 0, "the Work tree is empty");
  const ids = rows.map(r => r.id).filter((id): id is string => !!id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  // VS Code refuses to render a tree whose items share an id ("Element with id … is already registered").
  assert.deepEqual([...new Set(dupes)], [], "duplicate tree item ids");
  assert.ok(rows.every(r => r.label.trim().length > 0), "a tree item has an empty label");
  record("workTree", rows.filter(r => r.depth === 0).map(r => `${r.label}${r.description ? ` — ${r.description}` : ""}`));
});

test("Work and Galaxy views open without errors (status bar command included)", async () => {
  await vscode.commands.executeCommand("workbench.view.extension.datapass");
  await vscode.commands.executeCommand("datapass.work.focus");
  // Registered commands swallow nothing here: openGalaxy is what the status bar item runs.
  await vscode.commands.executeCommand("datapass.openGalaxy");
  await sleep(500);
});

test("Galaxy webview resolves and renders platform state", async () => {
  await vscode.commands.executeCommand("datapass.galaxy.focus");
  const state = await api.refresh();
  assert.ok(state.platforms.length >= 5, `platforms: ${state.platforms.map(p => p.id).join(", ")}`);
  // Cards carry operation readiness, and it agrees with the Work view for every shared operation.
  const fabric = state.platforms.find(p => p.id === "fabric");
  assert.ok(fabric?.operations?.length, "the Fabric card has no operations");
  const work = new Map(api.workModel().operations.map(o => [o.capability.id, o.result.status]));
  for (const op of state.platforms.flatMap(p => p.operations ?? [])) {
    if (work.has(op.id)) assert.equal(op.status, work.get(op.id), `${op.id}: Galaxy says ${op.status}, Work says ${work.get(op.id)}`);
  }
  record("galaxyState", state);
  record("galaxy", {
    overall: state.health?.overall,
    platforms: state.platforms.map(p => `${p.id}: ${p.status} · ops ${(p.operations ?? []).filter(o => o.status === "ready").length}/${(p.operations ?? []).length} ready`)
  });
});

test("refresh commands complete and are repeatable", async () => {
  const start = Date.now();
  await vscode.commands.executeCommand("datapass.refresh");
  await vscode.commands.executeCommand("datapass.work.refresh");
  await vscode.commands.executeCommand("datapass.refresh");
  record("refreshMs", Date.now() - start);
});

test("preflight opens for every operation in scope and closes cleanly", async () => {
  const ops = api.workModel().operations;
  for (const op of ops) await runAndDismiss("datapass.showPreflight", op.capability.id);
  record("operations", ops.map(o => `${o.capability.id}: ${o.result.status}`));
});

test("capability probes on this machine (evidence, not a pass/fail gate)", async () => {
  const obs = [...api.toolObservations().values()].map(o => ({ tool: o.toolId, state: o.state, via: o.via, version: o.version }));
  assert.ok(obs.length > 0);
  // Desktop apps can never be probed; they must stay "unknown", never "absent".
  for (const o of obs.filter(x => x.tool.startsWith("app."))) assert.equal(o.state, "unknown", o.tool);
  record("toolObservations", obs);
});

test("external command IDs DataPass hands off to (evidence)", async () => {
  const registered = new Set(await vscode.commands.getCommands(true));
  const external = [
    "workbench.action.remote.showMenu", "vscode.openFolder",
    "databricks.quickstart.open", "vscode-fabric.refreshArtifactView",
    "workbench.view.extension.vscode-fabric_view_workspace", "workbench.view.extension.fabricstudio"
  ];
  record("externalCommands", Object.fromEntries(external.map(c => [c, registered.has(c)])));
});

// ---------------------------------------------------------------- per-fixture behaviour

test("no manifest: implicit scope, initialize next step, no errors", async () => {
  const m = api.workModel();
  assert.equal(api.project().manifestExists, false);
  assert.equal(m.scopeSource, "implicit");
  assert.match(m.nextStep, /Initialize a project manifest/);
}, ["empty"]);

test("v2 manifest: declared scope, builtin non-FOIL pack loads from the installed extension", async () => {
  const p = api.project();
  assert.deepEqual(p.manifestErrors, []);
  assert.deepEqual(p.packErrors, []);
  assert.ok(p.packs.some(pack => pack.namespace === "sample.retail"), `packs: ${p.packs.map(x => x.namespace).join(", ")}`);
  const m = api.workModel();
  assert.equal(m.scopeSource, "declared");
  assert.equal(m.scope.id, "weekly-forecast");
  assert.ok(m.operations.length >= 2);
  assert.equal(api.workViewMessage(), undefined);
}, ["v2-retail"]);

test("initialize graph writes a strictly valid graph seeded from declared apps", async () => {
  const graph = vscode.Uri.joinPath(root()!, ".datapass", "graph.json");
  assert.equal(await exists(graph), false);
  await vscode.commands.executeCommand("datapass.initGraph");
  await waitFor("graph.json", () => exists(graph));
  await vscode.commands.executeCommand("datapass.work.refresh");
  const loaded = await waitFor("graph to load", () => api.project().graph);
  assert.equal(api.project().graphError, undefined);
  assert.ok(loaded.items.some(i => i.id === "forecast-app"), "declared app not seeded into the graph");
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}, ["v2-retail"]);

test("validate command accepts a real pack file without prompting", async () => {
  const pack = vscode.Uri.joinPath(vscode.extensions.getExtension(EXTENSION_ID)!.extensionUri, "resources", "domain-packs", "sample.retail.json");
  await Promise.race([vscode.commands.executeCommand("datapass.validateContract", pack), sleep(5000).then(() => { throw new Error("validateContract prompted or hung"); })]);
}, ["v2-retail"]);

test("scope picker opens and can be dismissed", async () => {
  await runAndDismiss("datapass.selectScope");
  assert.equal(api.workModel().scope.id, "weekly-forecast", "dismissing the picker must not change the scope");
}, ["v2-retail"]);

test("v1 FOIL manifest still loads (migration is not forced)", async () => {
  const p = api.project();
  assert.deepEqual(p.manifestErrors, []);
  assert.equal(p.manifest?.schemaVersion, 1);
  const m = api.workModel();
  assert.equal(m.scopeSource, "implicit");
  assert.ok(m.operations.length > 0);
}, ["v1-foil"]);

test("invalid manifest: reported in the Work view, never replaced by defaults", async () => {
  const p = api.project();
  assert.equal(p.manifestExists, true);
  assert.ok(p.manifestErrors.length > 0, "manifest errors were not reported");
  assert.equal(p.manifest, undefined, "an invalid manifest must not be half-loaded");
  assert.match(api.workViewMessage() ?? "", /manifest has errors/);
  record("manifestErrors", p.manifestErrors);
}, ["broken"]);

test("the contributed JSON schema produces diagnostics in the editor", async () => {
  const uri = vscode.Uri.joinPath(root()!, ".datapass", "project.json");
  await vscode.window.showTextDocument(uri);
  const diags = await waitFor("JSON schema diagnostics", () => {
    const d = vscode.languages.getDiagnostics(uri);
    return d.length ? d : undefined;
  }, 30000);
  record("schemaDiagnostics", diags.map(d => d.message).slice(0, 5));
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}, ["broken"]);

registerFlows(() => api);

export function run(): Promise<void> {
  console.log(`DataPass desktop suite — fixture ${fixture()}`);
  return runAll();
}
