/**
 * V3-HOP2 desktop flows (real VS Code, offline) on the public example examples/v3/hop: the Hop view
 * opens beside the code (visual left, code right), the cursor highlights a step, a step moves the
 * selection, scrolling the view highlights without moving the cursor, a diagram block opens the Hop
 * view in the diagram's column with a way back, CodeLenses mark the steps, and a file without an
 * explanation offers the work order.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, sleep, test, waitFor } from "./harness";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const native = (rel: string) => vscode.Uri.joinPath(root(), "..", "pipelines", ...rel.split("/"));
/** The code's editor beside the Hop view (not a tab the view now covers). */
const editorOf = (uri: vscode.Uri, column?: vscode.ViewColumn) => vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase() && (column === undefined || e.viewColumn === column));
const webviewIn = (type: string) => vscode.window.tabGroups.all.find(g => g.tabs.some(t => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(type)))?.viewColumn;

export function registerHopFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("V3-HOP2: Explain This File opens the Hop view on the left, the PySpark code on the right, focus stays in the code", async () => {
    await run("datapass.refreshProject");
    await run("workbench.action.closeAllEditors");
    const job = native("jobs/daily_sales.py");
    await vscode.window.showTextDocument(job);
    await run("datapass.hop.explain");
    await waitFor("the Hop view", () => api().hop.isOpen() || undefined);
    const s = await waitFor("the explained steps", () => api().hop.state()?.steps.length ? api().hop.state() : undefined);
    assert.equal(s.kind, "explained");
    assert.equal(s.state, "ok");
    assert.equal(s.languageLabel, "PySpark");
    assert.deepEqual(s.steps.map(x => x.id), ["config", "read", "filter", "join", "aggregate", "write"]);
    assert.equal(api().hop.column(), vscode.ViewColumn.One, "the visual is on the left");
    const editor = await waitFor("the code on the right", () => editorOf(job, vscode.ViewColumn.Two));
    assert.equal(editor.viewColumn, vscode.ViewColumn.Two, "the code is on the right");
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase(), job.fsPath.toLowerCase(), "the code keeps the focus");
    record("hopSteps", s.steps.map(x => `${x.kindLabel}: ${x.title} (L${x.lines[0]}–${x.lines[1]})`));
  }, ["v3-hop"]);

  test("V3-HOP2: moving the cursor highlights the step; a step click selects its lines; view scrolling does not move the cursor", async () => {
    const job = native("jobs/daily_sales.py");
    const editor = await waitFor("the code", () => editorOf(job, vscode.ViewColumn.Two));
    editor.selection = new vscode.Selection(23, 0, 23, 0); // line 24: inside "join" (20–25)
    await waitFor("the join step highlighted", () => api().hop.activeStep() === "join" || undefined);
    editor.selection = new vscode.Selection(6, 0, 6, 0); // line 7: between config (5–6) and read (8–10)
    await waitFor("no step between steps", () => api().hop.activeStep() === undefined || undefined);

    await api().hop.send({ type: "step", step: "aggregate" });
    await waitFor("the cursor on the aggregate step's first line", () => editor.selection.active.line === 26 || undefined);
    assert.equal(api().hop.activeStep(), "aggregate");
    await sleep(600);
    assert.equal(api().hop.activeStep(), "aggregate", "the view's own reveal does not bounce back");

    // Untrusted messages: an unknown step or type changes nothing.
    await api().hop.send({ type: "step", step: "nope" });
    await api().hop.send({ type: "command", command: "workbench.action.terminal.new" });
    assert.equal(editor.selection.active.line, 26);

    await api().hop.send({ type: "scrolled", step: "write" });
    await waitFor("the write step highlighted", () => api().hop.activeStep() === "write" || undefined);
    assert.equal(editor.selection.active.line, 26, "scrolling the view reveals lines without moving the cursor");
  }, ["v3-hop"]);

  test("V3-HOP2: CodeLenses mark each step's first line", async () => {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", native("jobs/daily_sales.py"));
    const hop = (lenses ?? []).filter(l => l.command?.command === "datapass.hop.showStep");
    assert.deepEqual(hop.map(l => l.range.start.line + 1), [5, 8, 12, 20, 27, 37]);
    assert.match(hop[3]!.command!.title, /^▶ Attach the store's region/);
    await run("datapass.hop.showStep", ...hop[1]!.command!.arguments!);
    await waitFor("the read step highlighted", () => api().hop.activeStep() === "read" || undefined);
  }, ["v3-hop"]);

  test("V3-HOP2: a diagram block zooms into the Hop view in the diagram's column; back returns to the diagram", async () => {
    await run("workbench.action.closeAllEditors");
    await waitFor("the Hop view closed", () => !api().hop.isOpen() || undefined);
    await run("datapass.openWorkbench");
    await waitFor("the Workbench tab", () => webviewIn("datapass.workbench"));
    await run("datapass.openComponentEntry", "customer-orders");
    const sql = native("sql/customer_orders.sql");
    const s = await waitFor("the SQL explanation", () => api().hop.state()?.languageLabel === "SQL" ? api().hop.state() : undefined);
    assert.equal(s.steps.filter(x => x.joins.length).length, 2, "the two joins are drawn");
    assert.equal(api().hop.column(), webviewIn("datapass.workbench"), "the Hop view covers the diagram's column");
    await waitFor("the SQL code to the right of the Hop view", () => editorOf(sql, (api().hop.column() ?? 1) + 1));
    await api().hop.send({ type: "back" });
    await waitFor("the diagram back in front", () => {
      const g = vscode.window.tabGroups.all.find(x => x.viewColumn === api().hop.column());
      const t = g?.activeTab?.input;
      return t instanceof vscode.TabInputWebview && t.viewType.endsWith("datapass.workbench") || undefined;
    });
  }, ["v3-hop"]);

  test("V3-HOP2: a file without an explanation offers Explain this file (a work order), and the Home tile lists the explained files", async () => {
    await run("datapass.hop.explain", native("jobs/unexplained.py").toString());
    const s = await waitFor("the missing state", () => api().hop.state()?.kind === "missing" ? api().hop.state() : undefined);
    assert.equal(s.explanationPath, ".datapass/understanding/pipelines/jobs/unexplained.py.json");
    const home = await api().home.state();
    const tile = home.areas.flatMap(a => a.tiles).find(t => t.id === "understand")!;
    assert.deepEqual(tile.items?.map(i => i.detail), ["pipelines / dags/daily_sales_dag.py", "pipelines / jobs/daily_sales.py", "pipelines / sql/customer_orders.sql"]);
    const done = await api().home.send({ type: "hop", index: tile.items![0]!.index });
    assert.equal(done?.command, "datapass.hop.open");
    await waitFor("the DAG explained", () => api().hop.state()?.languageLabel === "Airflow DAG" || undefined);
    await run("workbench.action.closeAllEditors");
  }, ["v3-hop"]);
  test("V3-POLISH-1: the Airflow view's Open explanation link opens the DAG in the Hop view", async () => {
    await run("workbench.action.closeAllEditors");
    await vscode.window.showTextDocument(native("dags/daily_sales_dag.py"));
    await waitFor("the DAG's explanation found", () => api().airflow.state().explanation || undefined);
    await api().airflow.send({ type: "explain" });
    await waitFor("the DAG in the Hop view", () => api().hop.state()?.languageLabel === "Airflow DAG" || undefined);
    assert.ok(String(api().hop.shownUri()).toLowerCase().endsWith("daily_sales_dag.py"), "the DAG file is shown");
    await run("workbench.action.closeAllEditors");
  }, ["v3-hop"]);

  test("V3-POLISH-1: an explanation edited in .datapass/understanding refreshes the open Hop view", async () => {
    await run("workbench.action.closeAllEditors");
    await vscode.window.showTextDocument(native("jobs/daily_sales.py"));
    await run("datapass.hop.explain");
    await waitFor("the explained steps", () => api().hop.state()?.steps.some(s => s.title === "Attach the store's region") || undefined);
    const file = vscode.Uri.joinPath(root(), ".datapass", "understanding", "pipelines", "jobs", "daily_sales.py.json").fsPath;
    const before = fs.readFileSync(file, "utf8");
    try {
      // Written on disk (as a pulled pull request would), not through an editor.
      fs.writeFileSync(file, before.replace("Attach the store's region", "Attach the region of the store"));
      await waitFor("the edited step title", () => api().hop.state()?.steps.some(s => s.title === "Attach the region of the store") || undefined, 20_000);
    } finally {
      fs.writeFileSync(file, before);
    }
    await waitFor("the original step title back", () => api().hop.state()?.steps.some(s => s.title === "Attach the store's region") || undefined, 20_000);
    await run("workbench.action.closeAllEditors");
  }, ["v3-hop"]);
}
