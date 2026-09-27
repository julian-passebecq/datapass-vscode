/**
 * V3-AIRFLOW: the "Airflow DAG" view in the secondary (right) side bar.
 *
 * When the active editor is a Python file that declares an Airflow DAG, the view draws its tasks
 * and dependencies, read statically from the editor's text (src/core/airflow/dagExtract.ts:
 * nothing is run). With `datapass.airflow.autoShow` (default on) the view is revealed without
 * taking the keyboard (`preserveFocus`, handoff/MEMORY.md). Clicking a task selects its lines in
 * the editor; moving the cursor into a task's code highlights the task. When the bridge holds a
 * DataPass Hop explanation for the file (V3-HOP1), a link opens it.
 *
 * Messages from the webview are untrusted: they carry a task id or line numbers, which are looked
 * up again in this reading of the file.
 */
import * as vscode from "vscode";
import { extractDag, type DagExtraction } from "../core/airflow/dagExtract";
import { findUnderstanding } from "../core/airflow/understandingLink";
import { airflowDagHtml, airflowViewState, taskAtLine, type AirflowDirection, type AirflowViewState } from "./airflowDagHtml";

const DIRECTION_KEY = "datapass.airflow.direction";

interface Current { uri: vscode.Uri; version: number; extraction: DagExtraction; explanation?: string }

export class AirflowDagView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "datapass.airflowDag";
  private view?: vscode.WebviewView;
  private current?: Current;
  private dag = 0;
  private highlight?: string;
  private lastShown?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly subs: vscode.Disposable[] = [];
  /** For the desktop tests: how many times the view was revealed automatically. */
  autoReveals = 0;

  constructor(private readonly context: vscode.ExtensionContext, private readonly bridgeRoot: () => string | undefined, private readonly shown: () => boolean) {
    this.subs.push(
      vscode.window.onDidChangeActiveTextEditor(e => { if (e) void this.follow(e.document, true); }),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (this.current && e.document.uri.toString() === this.current.uri.toString()) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => void this.follow(e.document, false), 300);
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(e => this.onSelection(e.textEditor))
    );
    const e = vscode.window.activeTextEditor;
    if (e) void this.follow(e.document, true);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: [] };
    view.webview.html = airflowDagHtml(view.webview.cspSource, makeNonce());
    view.webview.onDidReceiveMessage(m => void this.receive(m).catch(err => void vscode.window.showErrorMessage(String(err instanceof Error ? err.message : err))), undefined, this.subs);
    view.onDidChangeVisibility(() => { if (view.visible) void this.post(); }, undefined, this.subs);
    view.onDidDispose(() => { this.view = undefined; }, undefined, this.subs);
  }

  private direction(): AirflowDirection {
    return this.context.globalState.get<AirflowDirection>(DIRECTION_KEY) === "right" ? "right" : "down";
  }

  state(): AirflowViewState {
    const c = this.current;
    return airflowViewState(c?.extraction, c ? vscode.workspace.asRelativePath(c.uri) : undefined, this.dag, { explanation: !!c?.explanation, highlight: this.highlight, direction: this.direction() });
  }

  /** Read the file again when it is (or was) the active Python editor. */
  async follow(doc: vscode.TextDocument, switched: boolean): Promise<void> {
    if (!isPython(doc)) return;
    const same = this.current?.uri.toString() === doc.uri.toString();
    if (same && this.current!.version === doc.version && !switched) return;
    const extraction = extractDag(doc.getText());
    if (!same) { this.dag = 0; this.highlight = undefined; }
    const explanation = extraction.detected && doc.uri.scheme === "file"
      ? await findUnderstanding(doc.uri.fsPath, [this.bridgeRoot(), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)].filter((x): x is string => !!x), (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath))
      : undefined;
    this.current = { uri: doc.uri, version: doc.version, extraction, ...(explanation ? { explanation } : {}) };
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === doc) this.highlight = taskAtLine(extraction.tasks.filter(t => t.dag === this.dag), editor.selection.active.line + 1)?.id ?? this.highlight;
    await this.post();
    if (switched && extraction.detected && this.lastShown !== doc.uri.toString()) {
      this.lastShown = doc.uri.toString();
      if (this.shown() && vscode.workspace.getConfiguration("datapass").get<boolean>("airflow.autoShow", true)) {
        this.autoReveals++;
        // Show the view without taking the keyboard (an open Quick Pick stays open).
        await vscode.commands.executeCommand(`${AirflowDagView.viewType}.focus`, { preserveFocus: true });
      }
    }
    if (!extraction.detected && switched) this.lastShown = undefined;
  }

  private onSelection(editor: vscode.TextEditor): void {
    const c = this.current;
    if (!c || !c.extraction.detected || editor.document.uri.toString() !== c.uri.toString()) return;
    const t = taskAtLine(c.extraction.tasks.filter(x => x.dag === this.dag), editor.selection.active.line + 1);
    if (!t || t.id === this.highlight) return;
    this.highlight = t.id;
    if (this.view?.visible) void this.view.webview.postMessage({ type: "highlight", id: t.id });
  }

  private async post(): Promise<void> {
    if (this.view?.visible) await this.view.webview.postMessage({ type: "state", state: this.state() });
  }

  /** "DataPass: Show Airflow DAG": read the active editor and show the view (with the keyboard). */
  async show(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc && isPython(doc)) await this.follow(doc, false);
    await vscode.commands.executeCommand(`${AirflowDagView.viewType}.focus`);
    const c = this.current;
    if (!doc || !isPython(doc)) void vscode.window.showInformationMessage("Open an Airflow DAG file (Python) first; the Airflow DAG view shows the DAG of the active editor.");
    else if (c && !c.extraction.detected) void vscode.window.showInformationMessage(`${vscode.workspace.asRelativePath(doc.uri)} is not an Airflow DAG: ${c.extraction.reason ?? ""}`);
  }

  /** One message from the webview (public for the desktop tests, which have no webview to click). */
  async receive(raw: unknown): Promise<void> {
    const m = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const c = this.current;
    switch (m.type) {
      case "ready": return this.post();
      case "dag":
        if (c && typeof m.index === "number" && Number.isInteger(m.index) && m.index >= 0 && m.index < c.extraction.dags.length) { this.dag = m.index; this.highlight = undefined; await this.post(); }
        return;
      case "direction":
        await this.context.globalState.update(DIRECTION_KEY, m.direction === "right" ? "right" : "down");
        return this.post();
      case "reveal": {
        const t = c?.extraction.tasks.find(x => x.id === m.id);
        if (!c || !t) return;
        this.highlight = t.id;
        await this.revealLines(c.uri, t.startLine, t.endLine);
        return this.post();
      }
      case "revealLines": {
        const s = Number(m.start), e = Number(m.end);
        if (!c || !Number.isInteger(s) || !Number.isInteger(e) || !c.extraction.unresolved.some(u => u.startLine === s && u.endLine === e)) return;
        return this.revealLines(c.uri, s, e);
      }
      case "explain": return this.openExplanation();
    }
  }

  async openExplanation(): Promise<void> {
    const file = this.current?.explanation;
    if (!file) return;
    // V3-HOP2 renders the explanation beside the code; until then the JSON opens beside.
    await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }

  private async revealLines(uri: vscode.Uri, start: number, end: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const last = Math.min(end, doc.lineCount) - 1;
    const range = new vscode.Range(start - 1, 0, last, doc.lineAt(Math.max(0, last)).text.length);
    const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: visible?.viewColumn ?? vscode.ViewColumn.Active, preserveFocus: false, preview: false });
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const s of this.subs) s.dispose();
  }
}

function isPython(doc: vscode.TextDocument): boolean {
  return doc.languageId === "python" || doc.uri.path.toLowerCase().endsWith(".py");
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function registerAirflowDag(context: vscode.ExtensionContext, bridgeRoot: () => string | undefined, shown: () => boolean): AirflowDagView {
  const view = new AirflowDagView(context, bridgeRoot, shown);
  const guard = (fn: () => Promise<void>) => async () => { try { await fn(); } catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e)); } };
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(AirflowDagView.viewType, view),
    vscode.commands.registerCommand("datapass.showAirflowDag", guard(() => view.show())),
    vscode.commands.registerCommand("datapass.airflow.openExplanation", guard(() => view.openExplanation()))
  );
  return view;
}
