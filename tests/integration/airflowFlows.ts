/**
 * V3-AIRFLOW desktop flows (real VS Code, offline): opening an Airflow DAG file shows its tasks in
 * the Airflow DAG view without taking the keyboard, clicking a task selects its lines, moving the
 * cursor highlights the task, a DataPass Hop explanation is linked when the bridge has one, and a
 * plain Python file is not taken for a DAG. The file is only read, never run.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";

const DAG = `from datetime import datetime

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.providers.databricks.operators.databricks import DatabricksSubmitRunOperator
from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator
from airflow.sensors.filesystem import FileSensor

with DAG(dag_id="etl_daily", schedule="0 6 * * *", start_date=datetime(2026, 1, 1)) as dag:
    wait_for_file = FileSensor(task_id="wait_for_file", filepath="/data/in/orders.csv")
    extract = BashOperator(task_id="extract", bash_command="python extract.py")
    transform_spark = DatabricksSubmitRunOperator(
        task_id="transform_spark",
        json={"notebook_task": {"notebook_path": "/Shared/transform"}},
    )
    load_sql = SQLExecuteQueryOperator(
        task_id="load_sql",
        conn_id="warehouse",
        sql="INSERT INTO sales SELECT * FROM staging_sales",
    )
    wait_for_file >> extract >> transform_spark >> load_sql
`;

export function registerAirflowFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("V3-AIRFLOW: an Airflow DAG file shows its tasks in the right panel; click a task, move the cursor", async () => {
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const dagUri = vscode.Uri.joinPath(root, "pipelines", "dags", "etl_dag.py");
    const plainUri = vscode.Uri.joinPath(root, "pipelines", "helpers.py");
    const explanation = vscode.Uri.joinPath(root, ".datapass", "understanding", "pipelines", "dags", "etl_dag.py.json");
    const hadDataPass = await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ".datapass")).then(() => true, () => false);
    await vscode.workspace.fs.writeFile(dagUri, Buffer.from(DAG, "utf8"));
    await vscode.workspace.fs.writeFile(plainUri, Buffer.from("import os\n\ndef DAG(x):\n    return x\n", "utf8"));
    await vscode.workspace.fs.writeFile(explanation, Buffer.from("{}\n", "utf8"));
    try {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      const before = api().airflow.autoReveals();
      const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(dagUri));
      const s = await waitFor("the DAG in the Airflow DAG view", () => { const x = api().airflow.state(); return x.status === "dag" && x.tasks.length === 4 ? x : undefined; });
      assert.deepEqual(s.dags.map(d => [d.dagId, d.schedule]), [["etl_daily", "0 6 * * *"]]);
      assert.deepEqual(s.tasks.map(t => [t.id, t.kind, t.layer]), [["wait_for_file", "sensor", 0], ["extract", "bash", 1], ["transform_spark", "databricks", 2], ["load_sql", "sql", 3]]);
      assert.equal(s.edges.length, 3);
      assert.deepEqual(s.unresolved, []);
      assert.equal(s.explanation, true, "the bridge's DataPass Hop file is linked");
      await waitFor("the view revealed by itself", () => api().airflow.autoReveals() > before || undefined);
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), dagUri.toString(), "the editor keeps the keyboard");

      // Click a task: its lines are selected in the editor.
      await api().airflow.send({ type: "reveal", id: "load_sql" });
      const load = s.tasks.find(t => t.id === "load_sql")!;
      await waitFor("the task's lines selected", () => {
        const e = vscode.window.activeTextEditor;
        return e?.document.uri.toString() === dagUri.toString() && e.selection.start.line === load.startLine - 1 && e.selection.end.line === load.endLine - 1 || undefined;
      });
      assert.equal(api().airflow.state().highlight, "load_sql");
      // A forged message is ignored.
      await api().airflow.send({ type: "reveal", id: "not_a_task" });
      await api().airflow.send({ type: "revealLines", start: 1, end: 3 });
      assert.equal(vscode.window.activeTextEditor!.selection.start.line, load.startLine - 1);

      // Cursor in a task's code: the task is highlighted.
      const extract = s.tasks.find(t => t.id === "extract")!;
      const e = vscode.window.activeTextEditor ?? editor;
      e.selection = new vscode.Selection(extract.startLine - 1, 8, extract.startLine - 1, 8);
      await waitFor("the task under the cursor highlighted", () => api().airflow.state().highlight === "extract" || undefined);

      // Open the DataPass Hop explanation.
      await api().airflow.send({ type: "explain" });
      await waitFor("the explanation opened", () => vscode.window.visibleTextEditors.some(x => x.document.uri.fsPath.toLowerCase() === explanation.fsPath.toLowerCase()) || undefined);

      // A plain Python file is not a DAG.
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(plainUri));
      const n = await waitFor("the plain file read", () => { const x = api().airflow.state(); return x.status === "not-dag" ? x : undefined; });
      assert.match(n.reason ?? "", /No `airflow` import/);
      record("airflowDag", { tasks: s.tasks.map(t => `${t.id} (${t.operator}, lines ${t.startLine}-${t.endLine}, layer ${t.layer})`), autoReveals: api().airflow.autoReveals() - before });
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      for (const u of [dagUri, plainUri, explanation]) { try { await vscode.workspace.fs.delete(u); } catch { /* gone */ } }
      try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, ".datapass", ...(hadDataPass ? ["understanding"] : [])), { recursive: true }); } catch { /* gone */ }
      try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, "pipelines"), { recursive: true }); } catch { /* gone */ }
    }
  }, ["empty"]);
}
