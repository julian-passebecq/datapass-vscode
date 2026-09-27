/**
 * V3-HOP2: the DataPass Hop view (vision §2.2) — a file's code on the right, its narrow vertical
 * visual explanation on the left, synchronised both ways.
 *
 *   opening   double-click a diagram block whose file is explained, "DataPass: Explain This File",
 *             a CodeLens or the Home tile: the code opens in the column right of the diagram and the
 *             Hop view covers the diagram's column (the "zoom"); "← Diagram" brings the diagram back.
 *             Without a diagram, the Hop view takes the first column and the code the second.
 *   code → visual   cursor → the step holding it; editor scrolled so that the highlighted step left
 *             the screen → the step at the top. The view scrolls the step into view.
 *   visual → code   click a step → its lines are selected, revealed and highlighted; scrolling the
 *             view → the step at the top is highlighted with its lines (no selection change).
 *
 * Nothing here takes the keyboard focus from the editor (handoff/MEMORY.md, 2026-09-27): panels are
 * revealed with preserveFocus and the webview never focuses an element. Events caused by the view's
 * own reveal are ignored for a short while, so the two sides never ping-pong.
 *
 * The explanation JSON is written by the client AI; DataPass never generates it. "Explain this
 * file" prepares a work order (datapass.workOrders.newForExplanation).
 */
import * as vscode from "vscode";
import * as path from "node:path";
import type { WorkSession } from "../work/session";
import type { WorkbenchHost } from "./workbench";
import { guarded, UserFacingError } from "../work/io";
import { workOrdersEnabled } from "../work/workOrders";
import { vetRelativePath } from "../core/exchange/pathSafety";
import type { UnderstandingEntry } from "../core/understanding/load";
import { hopState, explanationPathOf, type HopState } from "./hopState";
import { hopHtml } from "./hopHtml";
import { codeLensSteps, parseHopMessage, stepForCursor, stepForTopLine, stepRange, type HopMessage } from "./hopSync";

export const HOP_VIEW_TYPE = "datapass.hop";
/** How long the editor events caused by the view's own reveal are ignored. */
const ECHO_MS = 450;

interface Shown {
  uri?: vscode.Uri;
  located?: { repositoryKey: string; nativePath: string };
  entry?: UnderstandingEntry;
  state: HopState;
  stepIds: Set<string>;
}

export class HopHost implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private shown?: Shown;
  private active?: string;
  private readonly subs: vscode.Disposable[] = [];
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  private echoUntil = 0;
  private lastSelectionAt = 0;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private scrollTimer?: ReturnType<typeof setTimeout>;
  private followTimer?: ReturnType<typeof setTimeout>;
  private lastHtml = "";
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.rangeHighlightForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });
  /** Messages handled (tests). */
  readonly handled: HopMessage[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession, private readonly workbench: WorkbenchHost) {
    this.subs.push(
      this.decoration, this.lensEmitter,
      session.onDidChange(() => { this.lensEmitter.fire(); this.scheduleReload(); void this.updateContext(); }),
      vscode.workspace.onDidSaveTextDocument(d => { if (this.isShown(d.uri)) this.scheduleReload(); }),
      vscode.window.onDidChangeActiveTextEditor(e => { void this.updateContext(); this.follow(e); }),
      vscode.window.onDidChangeTextEditorSelection(e => this.onSelection(e)),
      vscode.window.onDidChangeTextEditorVisibleRanges(e => this.onVisibleRanges(e)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate())
    );
    void this.updateContext();
  }

  dispose(): void {
    for (const t of [this.reloadTimer, this.scrollTimer, this.followTimer]) if (t) clearTimeout(t);
    this.panel?.dispose();
    for (const s of this.subs) s.dispose();
  }

  // ---------------------------------------------------------------- test hooks and queries

  isOpen(): boolean { return Boolean(this.panel); }
  column(): vscode.ViewColumn | undefined { return this.panel?.viewColumn; }
  state(): HopState | undefined { return this.shown?.state; }
  activeStep(): string | undefined { return this.active; }
  shownUri(): vscode.Uri | undefined { return this.shown?.uri; }

  // ---------------------------------------------------------------- opening

  /**
   * Show the Hop view of a native file. `openCode`: also open the code in the column to the right of
   * the view (the diagram's column when a diagram is open). The editor keeps the keyboard focus.
   */
  async show(target: vscode.Uri | { repositoryKey: string; nativePath: string }, how: { openCode?: boolean } = {}): Promise<void> {
    const { uri, located } = this.resolve(target);
    const left = await this.leftColumn();
    if (how.openCode && uri) {
      await vscode.window.showTextDocument(uri, { viewColumn: left + 1, preview: true, preserveFocus: false });
    }
    await this.load(uri, located);
    this.ensurePanel(left);
  }

  /** Double-click on a diagram block: show the Hop view when the file is explained; false otherwise. */
  async openIfExplained(uri: vscode.Uri): Promise<boolean> {
    if (!this.session.understandingIndexed(uri)) return false;
    await this.show(uri, { openCode: true });
    return true;
  }

  /** Jump the visual to a step (CodeLens). */
  async showStep(uri: vscode.Uri, step: string): Promise<void> {
    if (!this.isShown(uri) || !this.panel) await this.show(uri);
    if (!this.shown?.stepIds.has(step)) return;
    this.setActive(step, true);
  }

  private resolve(target: vscode.Uri | { repositoryKey: string; nativePath: string }): { uri?: vscode.Uri; located?: { repositoryKey: string; nativePath: string } } {
    if (target instanceof vscode.Uri) return { uri: target, located: this.session.understandingLocate(target) };
    const vet = vetRelativePath(target.nativePath);
    if (!vet.ok) throw new UserFacingError(`Refusing ${target.nativePath}: ${vet.reason}.`);
    const folder = this.session.repoFolder(target.repositoryKey);
    return { uri: folder ? vscode.Uri.joinPath(folder, ...vet.relative.split("/")) : undefined, located: { repositoryKey: target.repositoryKey, nativePath: vet.relative } };
  }

  /** The Hop view's column: where it already is, else the diagram's (not floating), else the first. */
  private async leftColumn(): Promise<number> {
    if (this.panel?.viewColumn) return this.panel.viewColumn;
    const wb = this.workbench.panel();
    if (wb?.viewColumn && !(await this.workbench.isFloating())) return wb.viewColumn;
    return vscode.ViewColumn.One;
  }

  private ensurePanel(column: number): void {
    if (this.panel) {
      if (!this.panel.visible || this.panel.viewColumn !== column) this.panel.reveal(column, true);
      this.render(true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(HOP_VIEW_TYPE, this.title(), { viewColumn: column, preserveFocus: true }, { enableScripts: true, localResourceRoots: [] });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "datapass.svg");
    this.panel = panel;
    this.lastHtml = "";
    panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.shown = undefined; this.active = undefined; this.decorate(); } });
    panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) this.render(); });
    panel.webview.onDidReceiveMessage(m => void this.receive(m));
    this.render(true);
  }

  private title(): string { return `Hop: ${this.shown?.state.fileName ?? "file"}`; }

  private async load(uri: vscode.Uri | undefined, located: { repositoryKey: string; nativePath: string } | undefined): Promise<void> {
    const changedFile = !this.shown || this.shown.uri?.toString() !== uri?.toString() || this.shown.located?.nativePath !== located?.nativePath;
    let entry: UnderstandingEntry | undefined;
    if (located) entry = uri ? await this.session.understandingFor(uri) : await this.session.understandingByPath(located.repositoryKey, located.nativePath);
    const doc = uri && vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const repositoryLabel = located ? this.session.projectMap().repositories.find(r => r.key === located.repositoryKey)?.label : undefined;
    const state = hopState({
      fileName: uri ? path.basename(uri.fsPath) : located ? path.posix.basename(located.nativePath) : "file",
      located: located && { ...located, repositoryLabel },
      entry, hasProject: Boolean(this.session.project.manifestExists && this.session.project.manifest),
      workOrdersEnabled: workOrdersEnabled(), lineCount: doc?.lineCount,
      canGoBack: Boolean(this.session.project.manifestExists)
    });
    const stepIds = new Set(state.steps.map(s => s.id));
    this.shown = { uri, located, entry, state, stepIds };
    if (changedFile || (this.active && !stepIds.has(this.active))) this.active = undefined;
    if (changedFile && uri) {
      // Start on the step at the cursor of the code, when the code is open.
      const editor = this.editorFor(uri);
      if (editor && entry?.doc && state.steps.length) this.active = stepForCursor(entry.doc, editor.selection.active.line + 1);
    }
    if (this.panel) this.panel.title = this.title();
    this.decorate();
  }

  private render(force = false): void {
    const panel = this.panel;
    if (!panel || !this.shown || (!force && !panel.visible)) return;
    const body = hopHtml(this.shown.state, panel.webview.cspSource, "NONCE", this.active);
    if (!force && body === this.lastHtml) return;
    if (force && body === this.lastHtml && panel.webview.html) return;
    this.lastHtml = body;
    panel.title = this.title();
    panel.webview.html = hopHtml(this.shown.state, panel.webview.cspSource, makeNonce(), this.active);
  }

  private scheduleReload(): void {
    if (!this.panel || !this.shown) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      if (!this.shown) return;
      const located = this.shown.uri ? this.session.understandingLocate(this.shown.uri) ?? this.shown.located : this.shown.located;
      void this.load(this.shown.uri, located).then(() => this.render());
    }, 250);
  }

  /** The Hop view follows the code: another file of the project brought to the front is shown in its place. */
  private follow(editor: vscode.TextEditor | undefined): void {
    if (!this.panel?.visible || !editor || editor.document.uri.scheme !== "file") return;
    if (editor.viewColumn === this.panel.viewColumn || this.isShown(editor.document.uri)) return;
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => {
      this.followTimer = undefined;
      const uri = editor.document.uri;
      if (!this.panel || vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) return;
      // Files outside the project's repositories (settings, notes) leave the view as it is.
      const located = this.session.understandingLocate(uri);
      if (located) void this.load(uri, located).then(() => this.render(true));
    }, 120);
  }

  private async updateContext(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    await vscode.commands.executeCommand("setContext", "datapass.hop.explained", Boolean(uri && this.session.understandingIndexed(uri)));
  }

  // ---------------------------------------------------------------- sync

  private isShown(uri: vscode.Uri): boolean { return Boolean(this.shown?.uri && this.shown.uri.toString() === uri.toString()); }

  private editorFor(uri: vscode.Uri): vscode.TextEditor | undefined {
    // Never an editor the Hop view itself covers (its own column).
    const all = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === uri.toString() && e.viewColumn !== this.panel?.viewColumn);
    return all.find(e => e === vscode.window.activeTextEditor) ?? all[0];
  }

  private doc() { return this.shown?.state.steps.length ? this.shown.entry?.doc : undefined; }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const doc = this.doc();
    if (!doc || !this.panel || !this.isShown(e.textEditor.document.uri)) return;
    this.lastSelectionAt = Date.now();
    if (Date.now() < this.echoUntil) return;
    const step = stepForCursor(doc, e.selections[0]!.active.line + 1);
    if (step === this.active) return;
    this.setActive(step, true);
  }

  private onVisibleRanges(e: vscode.TextEditorVisibleRangesChangeEvent): void {
    const doc = this.doc();
    if (!doc || !this.panel || !this.isShown(e.textEditor.document.uri) || !e.visibleRanges.length) return;
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = undefined;
      // The cursor moved (the editor scrolled to follow it) or the view revealed lines itself: the cursor's step wins.
      if (Date.now() < this.echoUntil || Date.now() - this.lastSelectionAt < 400) return;
      const ranges = e.textEditor.visibleRanges;
      const first = ranges[0]!.start.line + 1, last = ranges[ranges.length - 1]!.end.line + 1;
      const current = this.active ? stepRange(doc, this.active, e.textEditor.document.lineCount) : undefined;
      if (current && current[1] >= first && current[0] <= last) return; // still on screen: keep it
      const step = stepForTopLine(doc, first);
      if (step && step !== this.active) this.setActive(step, true);
    }, 200);
  }

  /** Highlight a step in the view (and its lines in the code); `scroll` brings it into view. */
  private setActive(step: string | undefined, scroll: boolean): void {
    this.active = step;
    void this.panel?.webview.postMessage({ type: "highlight", step: step ?? "", scroll });
    this.decorate();
  }

  private decorate(): void {
    const uri = this.shown?.uri;
    const doc = this.doc();
    for (const editor of vscode.window.visibleTextEditors) {
      const mine = uri && doc && this.panel && editor.document.uri.toString() === uri.toString();
      const range = mine && this.active ? stepRange(doc, this.active, editor.document.lineCount) : undefined;
      editor.setDecorations(this.decoration, range ? [new vscode.Range(range[0] - 1, 0, range[1] - 1, 0)] : []);
    }
  }

  /** Reveal a step's lines in the code; `select` also moves the cursor to its first line. */
  private async revealStep(step: string, select: boolean): Promise<void> {
    const shown = this.shown, doc = this.doc();
    if (!shown?.uri || !doc) return;
    let editor = this.editorFor(shown.uri);
    const lineCount = editor?.document.lineCount ?? shown.entry?.lines;
    const range = stepRange(doc, step, lineCount);
    this.active = step;
    if (!range) { this.decorate(); return; }
    this.echoUntil = Date.now() + ECHO_MS;
    const r = new vscode.Range(range[0] - 1, 0, range[1] - 1, 0);
    if (!editor) {
      const column = (this.panel?.viewColumn ?? vscode.ViewColumn.One) + 1;
      editor = await vscode.window.showTextDocument(shown.uri, { viewColumn: column, preview: true, preserveFocus: true });
      this.echoUntil = Date.now() + ECHO_MS;
    }
    if (select) editor.selection = new vscode.Selection(r.start, r.start);
    editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.decorate();
  }

  // ---------------------------------------------------------------- webview messages

  /** Handle one webview message (also used by the tests). */
  async receive(raw: unknown): Promise<void> {
    const m = parseHopMessage(raw, this.shown?.stepIds ?? new Set());
    if (!m) return;
    this.handled.push(m);
    if (this.handled.length > 50) this.handled.shift();
    try {
      switch (m.type) {
        case "ready":
          if (this.active) void this.panel?.webview.postMessage({ type: "highlight", step: this.active, scroll: true });
          return;
        case "step": return await this.revealStep(m.step, true);
        case "scrolled": return await this.revealStep(m.step, false);
        case "back": return this.back();
        case "explain":
          if (!this.shown?.uri && !this.shown?.located) return;
          await vscode.commands.executeCommand("datapass.workOrders.newForExplanation", this.shown.located ?? this.shown.uri?.toString());
          return;
        case "openCode":
          if (this.shown?.uri) await vscode.window.showTextDocument(this.shown.uri, { viewColumn: (this.panel?.viewColumn ?? 1) + 1, preview: true });
          return;
        case "openExplanation": {
          const file = this.shown?.entry?.file;
          if (file) await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: (this.panel?.viewColumn ?? 1) + 1, preview: false });
          return;
        }
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`DataPass: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** "← Diagram": the architecture diagram comes back in the Hop view's column. */
  private back(): void {
    const column = this.panel?.viewColumn ?? vscode.ViewColumn.One;
    this.workbench.openPanel(column, "architecture", undefined, true);
  }

  // ---------------------------------------------------------------- CodeLens

  codeLensProvider(): vscode.CodeLensProvider {
    return {
      onDidChangeCodeLenses: this.onDidChangeCodeLenses,
      provideCodeLenses: async (document: vscode.TextDocument) => {
        if (document.uri.scheme !== "file" || !this.session.understandingIndexed(document.uri)) return [];
        const entry = await this.session.understandingFor(document.uri);
        if (!entry?.doc || entry.state === "invalid") return [];
        return codeLensSteps(entry.doc, document.lineCount).map(({ line, steps }) => new vscode.CodeLens(new vscode.Range(line - 1, 0, line - 1, 0), {
          title: `▶ ${steps.map(s => s.title).join(" · ")}`,
          tooltip: "Show this step in the DataPass Hop view",
          command: "datapass.hop.showStep",
          arguments: [document.uri.toString(), steps[0]!.id]
        }));
      }
    };
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

/** A command argument naming a native file: a Uri, a file URI string, or { repositoryKey, nativePath }. */
export function hopTarget(arg: unknown): vscode.Uri | { repositoryKey: string; nativePath: string } | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (typeof arg === "string" && arg.length <= 4096) {
    try { const u = vscode.Uri.parse(arg, true); return u.scheme === "file" ? u : undefined; } catch { return undefined; }
  }
  if (arg && typeof arg === "object") {
    const a = arg as { repositoryKey?: unknown; nativePath?: unknown };
    if (typeof a.repositoryKey === "string" && typeof a.nativePath === "string" && a.repositoryKey.length <= 80 && a.nativePath.length <= 512) return { repositoryKey: a.repositoryKey, nativePath: a.nativePath };
  }
  return undefined;
}

export function registerHopCommands(context: vscode.ExtensionContext, session: WorkSession, hop: HopHost): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const activeFile = () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== "file") throw new UserFacingError("Open a file of the project first, then run DataPass: Explain This File.");
    return uri;
  };
  // "DataPass: Explain This File": the Hop view beside the code (from the palette, the editor title or a menu).
  reg("datapass.hop.explain", async (arg?: unknown) => {
    const target = hopTarget(arg) ?? activeFile();
    await hop.show(target, { openCode: true });
  });
  // The Home tile and other entry points: the file by repository key and path.
  reg("datapass.hop.open", async (arg?: unknown) => {
    const target = hopTarget(arg);
    if (!target) throw new UserFacingError("Choose an explained file.");
    await hop.show(target, { openCode: true });
  });
  reg("datapass.hop.showStep", async (uri?: unknown, step?: unknown) => {
    const target = hopTarget(uri);
    if (!(target instanceof vscode.Uri) || typeof step !== "string") return;
    await hop.showStep(target, step);
  });
  reg("datapass.hop.showExplained", async () => {
    const files = session.understandingIndex()?.files ?? [];
    if (!files.length) throw new UserFacingError("No file of this project is explained yet. The client AI writes the explanations in .datapass/understanding/ (docs/PREPARING_A_PROJECT.md, section 17); open a file and run DataPass: Explain This File to prepare a work order.");
    const pick = await vscode.window.showQuickPick(files.map(f => ({ label: path.posix.basename(f.nativePath), description: `${f.repositoryKey} / ${f.nativePath}`, f })).sort((a, b) => a.description.localeCompare(b.description)), { title: "DataPass Hop: explained files", matchOnDescription: true });
    if (pick) await hop.show({ repositoryKey: pick.f.repositoryKey, nativePath: pick.f.nativePath }, { openCode: true });
  });
}

export { explanationPathOf };
