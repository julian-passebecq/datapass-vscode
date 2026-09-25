/**
 * Desktop flows for the DiagramCloud bridge and the optional companions (Grafana, Mongoku),
 * driven through the real command handlers with a scripted UI. Nothing is contacted: links only
 * reach the Test-mode browser seam and the clipboard is the scripted one.
 *
 * Fixture v2-retail carries DiagramCloud's own sidecar sample plus DiagramCloud's serialization
 * of it after a known plan, a synthetic Grafana stack with one scoped dashboard, a project-level
 * Mongoku mapping (no Mongoku address set yet) and a context produced by Mongoku's own exporter.
 */
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test } from "./harness";
import { withUi } from "./ui";

const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const at = (rel: string) => vscode.Uri.joinPath(root(), ...rel.split("/"));
const read = async (rel: string) => vscode.workspace.fs.readFile(at(rel));
const readText = async (rel: string) => new TextDecoder().decode(await read(rel));
const write = async (rel: string, text: string) => vscode.workspace.fs.writeFile(at(rel), new TextEncoder().encode(text));
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const setting = (key: string) => vscode.workspace.getConfiguration("datapass").get<string>(key) ?? "";
const leaks = () => [root().fsPath, os.homedir(), os.userInfo().username].filter(v => v.length > 2);

export function registerBridgeAndCompanionFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  // ------------------------------------------------------------ DiagramCloud bridge (v2-retail)

  let contextBase = "";

  test("bridge: copy DiagramCloud AI context — contract envelope bound to the sidecar revision, no local data", async () => {
    const ui = await withUi([{ button: "Copy JSON only" }], () => run("datapass.diagramCloud.copyAiContext"));
    const ctx = JSON.parse(ui.clipboard);
    assert.equal(ctx.format, "datapass.ai-context");
    assert.equal(ctx.diagramCloud.documentId, "total-project-controls");
    assert.equal(ctx.base.diagramCloudRevision, 0);
    assert.match(ctx.base.projectManifestRevision, /^sha256:[0-9a-f]{64}$/);
    for (const leak of leaks()) assert.ok(!ui.clipboard.includes(leak), `AI context leaked ${leak}`);
    assert.ok(api().workModel().exchanges.some(e => e.kind === "ai-context" && /DiagramCloud/.test(e.label)));
    contextBase = ctx.base.projectManifestRevision;
  }, ["v2-retail"]);

  const plan = () => JSON.stringify({
    format: "datapass.ai-plan", schemaVersion: 1,
    base: { projectManifestRevision: contextBase, diagramCloudRevision: 0 },
    scope: { id: "weekly-forecast", type: "workstream" }, summary: "Rename the document and link Power BI to its screen.",
    operations: [
      { id: "a", target: "diagramcloud-document", action: "set-project-metadata", reviewLabel: "Rename the document", payload: { title: "Renamed by plan", summary: "New summary" } },
      { id: "b", target: "diagramcloud-document", action: "link-node-workspace", reviewLabel: "Link Power BI to the controls screen", entityId: "powerbi", payload: { workspaceId: "controls-screen" } },
      { id: "c", target: "project-manifest", action: "set-project-metadata", reviewLabel: "Manifest change (must stay review-only)", payload: { title: "x" } }
    ]
  }, null, 2);

  test("bridge: import a reviewed AI plan — journaled write, byte-identical to DiagramCloud's own serializer", async () => {
    const manifestBefore = await read(".datapass/project.json");
    const ui = await withUi([{ pick: "From clipboard" }, { pick: ["Rename the document", "Link Power BI"] }, { button: "Write file" }, { dismiss: true }], async u => {
      u.clipboard = plan();
      await run("datapass.diagramCloud.importAiPlan");
    });
    const approval = ui.prompts.find(p => p.kind === "pick" && /Approve changes/.test(p.title ?? ""));
    assert.deepEqual(approval?.options, ["Rename the document", "Link Power BI to the controls screen"], "the manifest operation must not be offered for approval");
    assert.equal(await readText(".datapass/diagramcloud.json"), await readText("incoming/diagramcloud.after-plan.golden.json"),
      "DataPass's write must equal DiagramCloud's own serialization, so its next save produces no Git diff");
    assert.deepEqual(await read(".datapass/project.json"), manifestBefore, "an AI plan never changes the project manifest");
    const journals = (await vscode.workspace.fs.readDirectory(at(".datapass/local/journal"))).map(([n]) => n).filter(n => n.startsWith("plan"));
    assert.ok(journals.length, "no journal for the plan write");
    assert.equal(JSON.parse(await readText(`.datapass/local/journal/${journals[0]}`)).state, "committed");
    assert.ok(api().workModel().exchanges.some(e => e.kind === "diagramcloud" && e.status === "applied"));
    record("bridgeApply", { revision: JSON.parse(await readText(".datapass/diagramcloud.json")).revision, journal: journals[0] });
  }, ["v2-retail"]);

  test("bridge: the same plan again is refused (sidecar revision moved) and nothing is written", async () => {
    const before = await read(".datapass/diagramcloud.json");
    const ui = await withUi([{ pick: "From clipboard" }], async u => {
      u.clipboard = plan();
      await run("datapass.diagramCloud.importAiPlan");
    }, { allowErrors: true });
    assert.ok(ui.errors.some(e => /does not match the current project/.test(e)), ui.errors.join(" / "));
    assert.deepEqual(await read(".datapass/diagramcloud.json"), before);
  }, ["v2-retail"]);

  test("bridge: Open in DiagramCloud asks for its address once and opens it with no project data", async () => {
    const ui = await withUi([{ button: "Open DiagramCloud" }, { input: "http://localhost:5173" }], () => run("datapass.diagramCloud.openArchitecture"));
    assert.match(ui.prompts.find(p => p.modal)?.text ?? "", /Renamed by plan.*revision 1/s);
    assert.deepEqual(ui.opened, ["http://localhost:5173/"]);
    assert.equal(setting("diagramCloud.url"), "http://localhost:5173/");
  }, ["v2-retail"]);

  test("bridge: copy project/scope summary — declared state only, no paths", async () => {
    const ui = await withUi([], () => run("datapass.diagramCloud.copySummary"));
    assert.match(ui.clipboard, /DiagramCloud: “Renamed by plan” \(total-project-controls\), revision 1/);
    for (const leak of leaks()) assert.ok(!ui.clipboard.includes(leak), `summary leaked ${leak}`);
  }, ["v2-retail"]);

  // ------------------------------------------------------------ Links: Grafana (v2-retail)

  test("links: the Work view shows Grafana (scoped dashboard + source), Mongoku and DiagramCloud", async () => {
    const ids = new Set((await api().renderWorkTree()).map(r => r.id));
    for (const id of ["links", "links:grafana", "link:grafana.home", "link:grafana.explore", "link:grafana.dashboard:weekly-1", "linksrc:grafana.dashboard:weekly-1",
      "links:mongoku", "mongoku:setUrl", "mongoku:none", "mongoku:import", "links:diagramcloud"]) assert.ok(ids.has(id), `missing row ${id}`);
    await withUi([{ pick: "Whole project" }], () => run("datapass.selectScope"));
    const whole = new Set((await api().renderWorkTree()).map(r => r.id));
    assert.ok(whole.has("link:grafana.home") && !whole.has("link:grafana.dashboard:weekly-1"), "a scoped dashboard must stay in its scope");
    await withUi([{ pick: "Weekly forecast refresh" }], () => run("datapass.selectScope"));
  }, ["v2-retail"]);

  test("links: the first open shows the exact address; later opens of the same address do not ask again", async () => {
    const first = await withUi([{ button: "Open" }], () => run("datapass.openCompanionLink", "grafana.dashboard:weekly-1"));
    assert.deepEqual(first.opened, ["https://metrics.example.com/grafana/d/weekly-1"]);
    assert.match(first.prompts.find(p => p.modal)?.text ?? "", /https:\/\/metrics\.example\.com\/grafana\/d\/weekly-1/);
    const again = await withUi([], () => run("datapass.openCompanionLink", "grafana.dashboard:weekly-1"));
    assert.deepEqual(again.opened, ["https://metrics.example.com/grafana/d/weekly-1"]);
    assert.ok(!again.prompts.some(p => p.modal), "an already confirmed address must not ask again");
  }, ["v2-retail"]);

  test("links: a destination changed while the dialog is open is refused, not followed", async () => {
    const original = await readText(".datapass/project.json");
    const changed = JSON.parse(original);
    changed.platforms.grafana.url = "https://other.example.net/";
    const ui = await withUi([{ button: "Open", during: () => write(".datapass/project.json", JSON.stringify(changed, null, 2)) }],
      () => run("datapass.openCompanionLink", "grafana.explore"), { allowErrors: true });
    assert.deepEqual(ui.opened, []);
    assert.ok(ui.errors.some(e => /changed while you were reviewing/.test(e)), ui.errors.join(" / "));
    await write(".datapass/project.json", original);
    await api().refresh();
    assert.equal(api().companions().grafana?.host, "metrics.example.com");
  }, ["v2-retail"]);

  test("links: Galaxy's Observability card offers Open Grafana through the same reviewed path", async () => {
    const state = await api().refresh();
    const action = state.platforms.find(p => p.id === "observability")?.actions.find(a => a.id === "grafana.openStack");
    assert.equal(action?.enabled, true, JSON.stringify(action));
    const ui = await withUi([{ button: "Open" }], () => run("datapass.openCompanionLink", "grafana.home"));
    assert.deepEqual(ui.opened, ["https://metrics.example.com/grafana/"]);
  }, ["v2-retail"]);

  // ------------------------------------------------------------ Mongoku Lite (v2-retail)

  test("mongoku: an unsafe address is refused by the input itself and nothing is saved", async () => {
    const ui = await withUi([{ input: "http://mongoku.lan/" }], () => run("datapass.openCompanionLink", "mongoku.entity"), { allowErrors: true });
    assert.ok(ui.errors.some(e => /own validation/.test(e)), ui.errors.join(" / "));
    assert.deepEqual(ui.opened, []);
    assert.equal(setting("mongoku.url"), "");
  }, ["v2-retail"]);

  test("mongoku: the address is asked once, then Open in Mongoku uses Mongoku's own ?project= deep link", async () => {
    const ui = await withUi([{ input: "http://localhost:3100" }, { button: "Open" }], () => run("datapass.openCompanionLink", "mongoku.entity"));
    assert.deepEqual(ui.opened, ["http://localhost:3100/?project=retail_bi"]);
    assert.equal(setting("mongoku.url"), "http://localhost:3100/");
    const ids = new Set((await api().renderWorkTree()).map(r => r.id));
    assert.ok(ids.has("link:mongoku.entity") && !ids.has("mongoku:setUrl"));
  }, ["v2-retail"]);

  const freshContext = async (mutate?: (ctx: any) => void) => {
    const ctx = JSON.parse(await readText("incoming/mongoku-context.json"));
    ctx.generated_at = new Date(Date.now() - 60_000).toISOString();
    mutate?.(ctx);
    return JSON.stringify(ctx, null, 2);
  };

  test("mongoku: import the Developer context from the clipboard → private dated snapshot in the Work view", async () => {
    const text = await freshContext();
    const ui = await withUi([{ pick: "From clipboard" }], async u => { u.clipboard = text; await run("datapass.mongoku.importContext"); });
    assert.ok(ui.notices.some(n => /imported .*not a live view/s.test(n)), ui.notices.join(" / "));
    assert.equal(await readText(".datapass/local/mongoku/weekly-forecast.json"), text, "the snapshot is stored byte-for-byte");
    assert.match(await readText(".datapass/local/.gitignore"), /^\*$/m);
    assert.equal(api().mongokuStatus()?.state, "ok");
    const rows = await api().renderWorkTree();
    const next = rows.find(r => r.id === "mongoku:next");
    assert.match(next?.label ?? "", /Review the weekly report/);
    assert.match(next?.description ?? "", /reported/);
    assert.match(rows.find(r => r.id === "mongoku:snapshot")?.description ?? "", /not live/);
    assert.ok(rows.some(r => r.id === "mongoku:items"));
    record("mongokuRows", rows.filter(r => r.id?.startsWith("mongoku:")).map(r => `${r.label}${r.description ? ` — ${r.description}` : ""}`));
  }, ["v2-retail"]);

  test("mongoku: a context for another Mongoku project is refused and the snapshot is kept", async () => {
    const before = await read(".datapass/local/mongoku/weekly-forecast.json");
    const text = await freshContext(ctx => { ctx.scope.project_id = "other_project"; });
    const ui = await withUi([{ pick: "From clipboard" }], async u => { u.clipboard = text; await run("datapass.mongoku.importContext"); }, { allowErrors: true });
    assert.ok(ui.errors.some(e => /maps to "retail_bi".*Nothing was saved/s.test(e)), ui.errors.join(" / "));
    assert.deepEqual(await read(".datapass/local/mongoku/weekly-forecast.json"), before);
  }, ["v2-retail"]);

  test("mongoku: vscode://…/open?entity= selects the mapped scope and ignores everything else", async () => {
    const opened = await withUi([], () => api().handleUri(vscode.Uri.parse("vscode://julian-passebecq.datapass-vscode/open?entity=retail_bi&mongoku=https%3A%2F%2Fevil.example%2F")));
    assert.equal(api().workModel().scope.id, "project", "the project-level mapping selects the whole project");
    assert.ok(opened.notices.some(n => /opened from Mongoku/.test(n)), opened.notices.join(" / "));
    assert.equal(setting("mongoku.url"), "http://localhost:3100/", "a link never configures DataPass");
    const unknown = await withUi([], () => api().handleUri(vscode.Uri.parse("vscode://julian-passebecq.datapass-vscode/open?entity=nobody")));
    assert.ok(unknown.notices.some(n => /Nothing in .* is mapped to Mongoku project "nobody"/.test(n)), unknown.notices.join(" / "));
    const other = await withUi([], () => api().handleUri(vscode.Uri.parse("vscode://julian-passebecq.datapass-vscode/run?command=workbench.action.terminal.new")), { allowErrors: true });
    assert.ok(other.errors.some(e => /Unsupported DataPass link/.test(e)), other.errors.join(" / "));
    assert.equal(api().workModel().scope.id, "project");
    await withUi([{ pick: "Weekly forecast refresh" }], () => run("datapass.selectScope"));
  }, ["v2-retail"]);

  // ------------------------------------------------------------ per-project modules (v2-retail)

  test("modules: switching modules off hides their Galaxy card, operations and links; switching back restores them", async () => {
    const core = ["Microsoft Fabric", "Databricks", "Infrastructure", "Airflow", "Grafana"];
    await withUi([{ pick: core }, { button: "Save" }], () => run("datapass.chooseModules"));
    const saved = JSON.parse(await readText(".datapass/project.json"));
    assert.deepEqual(saved.modules, { fabric: true, databricks: true, powerbi: false, grafana: true, infrastructure: true, airflow: true, mongoku: false, diagramcloud: false });
    assert.equal(Object.keys(saved)[2], "modules", "the block is written right after project");
    const state = await api().refresh();
    assert.ok(!state.platforms.some(p => p.id === "powerbi"), state.platforms.map(p => p.id).join(","));
    assert.ok(state.platforms.some(p => p.id === "fabric") && state.platforms.some(p => p.id === "observability"));
    const ids = new Set((await api().renderWorkTree()).map(r => r.id));
    assert.ok(ids.has("modules") && ids.has("links:grafana"));
    assert.ok(!ids.has("links:mongoku") && !ids.has("links:diagramcloud"), [...ids].filter(i => i?.startsWith("links")).join(","));
    const refused = await withUi([], () => run("datapass.diagramCloud.copySummary"), { allowErrors: true });
    assert.ok(refused.errors.some(e => /DiagramCloud module is switched off/.test(e)), refused.errors.join(" / "));
    record("modulesOff", { galaxy: state.platforms.map(p => p.id), workRows: [...ids].filter(i => i?.startsWith("links")) });

    await withUi([{ pick: ["Microsoft Fabric", "Databricks", "Infrastructure", "Airflow", "Power BI", "Grafana", "Mongoku", "DiagramCloud"] }, { button: "Save" }], () => run("datapass.chooseModules"));
    const restored = await api().refresh();
    assert.equal(restored.platforms.length, 5);
    assert.ok((await api().renderWorkTree()).some(r => r.id === "links:mongoku"));
  }, ["v2-retail"]);

  test("modules: declining the save changes nothing", async () => {
    const before = await read(".datapass/project.json");
    await withUi([{ pick: "Microsoft Fabric" }, { dismiss: true }], () => run("datapass.chooseModules"));
    assert.deepEqual(await read(".datapass/project.json"), before);
  }, ["v2-retail"]);

  // ------------------------------------------------------------ companions off / refusals

  test("companions off: no Links section and a clear message when nothing is configured", async () => {
    assert.ok(!(await api().renderWorkTree()).some(r => r.id === "links"));
    const ui = await withUi([], () => run("datapass.openCompanionLink"), { allowErrors: true });
    assert.ok(ui.errors.some(e => /No companion links/.test(e)), ui.errors.join(" / "));
    assert.deepEqual(ui.opened, []);
  }, ["v1-foil"]);

  test("companions and bridge refuse an invalid manifest", async () => {
    const ui = await withUi([], async () => {
      await run("datapass.openCompanionLink", "grafana.home");
      await run("datapass.mongoku.importContext");
      await run("datapass.diagramCloud.copyAiContext");
    }, { allowErrors: true });
    assert.equal(ui.errors.length, 3, ui.errors.join(" / "));
    assert.ok(ui.errors.every(e => /valid .*project\.json/i.test(e)), ui.errors.join(" / "));
    assert.equal(ui.clipboard, "");
    assert.deepEqual(ui.opened, []);
  }, ["broken"]);
}
