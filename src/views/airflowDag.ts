/**
 * V3-AIRFLOW: the "Airflow DAG" view in the secondary (right) side bar.
 *
 * When the active editor is a Python file that declares an Airflow DAG, the view draws its tasks
 * and dependencies, read statically from the editor's text (src/core/airflow/dagExtract.ts:
 * nothing is run). With `datapass.airflow.autoShow` (default on) the view is revealed without
 * taking the keyboard (`preserveFocus`, handoff/MEMORY.md). Clicking a task selects its lines in
 * the editor; moving the cursor into a task's code highlights the task. When the bridge holds a
 * DataPass Hop explanation for the file (V3-HOP1), a link opens it in the Hop view (V3-HOP2).
 *
 * Messages from the webview are untrusted: they carry a task id or line numbers, which are looked
 * up again in this reading of the file.
 */
import * as vscode from "vscode";
import { extractDag, type DagExtraction } from "../core/airflow/dagExtract";
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

  constructor(private readonly context: vscode.ExtensionContext, private readonly explain: (uri: vscode.Uri) => Promise<string | undefined>, private readonly shown: () => boolean, projectChanged: vscode.Event<void>, private readonly indexed: (uri: vscode.Uri) => boolean = () => false) {
    this.subs.push(
      // A refresh may index a new DataPass Hop explanation for the file shown.
      projectChanged(() => { const c = this.current; if (c) void this.explain(c.uri).then(async f => { if (this.current === c && f !== c.explanation) { this.current = { ...c, ...(f ? { explanation: f } : { explanation: undefined }) }; await this.post(); } }); }),
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
    const explanation = extraction.detected && doc.uri.scheme === "file" ? await this.explain(doc.uri).catch(() => undefined) : undefined;
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

  /**
   * V1.1.x-POLISH-3 (Julian's check of rc.1: the DAG button showed "Not an Airflow DAG" for rules.py):
   * the rail's DAG button shows the active file when it is a DAG, else the project's DAG files, found by
   * reading the Python files statically (never running them): one is opened, several are offered in a
   * Quick Pick, none is said in plain words. Returns the DAG file shown in the editor, or undefined.
   */
  async openDagForRail(): Promise<vscode.Uri | undefined> {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc && isPython(doc) && extractDag(doc.getText()).detected) return doc.uri;
    const dags = await findDagFiles();
    if (!dags.length) {
      void vscode.window.showInformationMessage("This project has no Airflow DAG: no Python file in the workspace declares one. (DataPass reads the files to find DAGs; it never runs them.)");
      return undefined;
    }
    let uri = dags[0]!;
    if (dags.length > 1) {
      const pick = await vscode.window.showQuickPick(dags.map(u => ({ label: vscode.workspace.asRelativePath(u), uri: u })), { title: "Which Airflow DAG should the DAG view show?", placeHolder: `${dags.length} Airflow DAG files in this project` });
      if (!pick) return undefined;
      uri = pick.uri;
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    return uri;
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
    const c = this.current;
    if (!c?.explanation) return;
    // V3-POLISH-1: the DataPass Hop view (V3-HOP2) — the DAG's visual explanation left, its code right —
    // when the project's index holds the file; an explanation found by name only (no project open) opens beside as JSON.
    if (this.indexed(c.uri) && (await vscode.commands.getCommands(true)).includes("datapass.hop.explain")) {
      await vscode.commands.executeCommand("datapass.hop.explain", c.uri);
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(c.explanation), { viewColumn: vscode.ViewColumn.Beside, preview: true });
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

/** Folders never searched for DAG files. */
const DAG_SEARCH_EXCLUDE = "**/{node_modules,.git,dist,out,.venv,venv,env,__pycache__,site-packages,.datapass}/**";
/** Bigger files are not read (a DAG file is small). */
const DAG_FILE_MAX_BYTES = 512 * 1024;

/** V1.1.x-POLISH-3: the workspace's Airflow DAG files, read statically (never run), sorted by path. */
export async function findDagFiles(limit = 400): Promise<vscode.Uri[]> {
  const files = await vscode.workspace.findFiles("**/*.py", DAG_SEARCH_EXCLUDE, limit);
  const dags: vscode.Uri[] = [];
  for (const f of files) {
    try {
      const bytes = await vscode.workspace.fs.readFile(f);
      if (bytes.byteLength > DAG_FILE_MAX_BYTES) continue;
      const text = Buffer.from(bytes).toString("utf8");
      if (/airflow/.test(text) && extractDag(text).detected) dags.push(f);
    } catch { /* unreadable: not offered */ }
  }
  return dags.sort((a, b) => vscode.workspace.asRelativePath(a).localeCompare(vscode.workspace.asRelativePath(b)));
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

/**
 * `explain`: the DataPass Hop file of a native file — the session's index (V3-HOP1) first, then a
 * name lookup in the bridge for a file the last refresh did not index yet.
 */
export function registerAirflowDag(context: vscode.ExtensionContext, explain: (uri: vscode.Uri) => Promise<string | undefined>, shown: () => boolean, projectChanged: vscode.Event<void>, indexed?: (uri: vscode.Uri) => boolean): AirflowDagView {
  const view = new AirflowDagView(context, explain, shown, projectChanged, indexed);
  const guard = (fn: () => Promise<void>) => async () => { try { await fn(); } catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e)); } };
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(AirflowDagView.viewType, view),
    vscode.commands.registerCommand("datapass.showAirflowDag", guard(() => view.show())),
    vscode.commands.registerCommand("datapass.airflow.openExplanation", guard(() => view.openExplanation()))
  );
  return view;
}
