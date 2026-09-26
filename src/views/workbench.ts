/**
 * Workbench hosts: the editor tab (full), the Architecture view in the bottom panel (map) and the
 * Details view in the secondary side bar (detail). All render the same state and share one
 * selection held by the session: clicking a component anywhere updates every view.
 *
 * Messages from the webviews are untrusted input: only select / openFile / command are accepted,
 * commands come from an allowlist, and every id is checked against the current project map.
 *
 * 0.17: the diagram settings of each mode (orientation, lanes, folds, zoom, and the Workbench tab's
 * view) are reported by the webviews and held by the session, so work views can save and restore
 * them; the Workbench tab can move into a floating window of its own.
 */
import { toolkitState } from "./toolkitState";
import * as vscode from "vscode";
import type { WorkSession } from "../work/session";
import { workbenchHtml, type WorkbenchMode } from "./workbenchHtml";
import { workbenchState, type WbGit, type WbWorkOrders, type WorkbenchState } from "./workbenchState";
import type { GitObservation } from "../work/gitObserver";
import { sameDiagramUi, sanitizeDiagramUi, type DiagramMode, type DiagramUi } from "../core/windows/workViews";
import { CODING_LABELS, codingOfPicks, type CodingState } from "../core/project/variants";

/** Commands a webview may ask for (arguments are re-validated by each command). */
const ALLOWED = new Set([
  "datapass.refreshProject", "datapass.checkForUpdates", "datapass.getUpdates", "datapass.preparationPack", "datapass.arrangeWorkbench",
  "datapass.cloneRepository", "datapass.locateRepository", "datapass.openRepositoryWindow", "datapass.openComponentFolder",
  "datapass.openComponentEntry", "datapass.openNativeTool", "datapass.showOperation", "datapass.copyComponentCommand", "datapass.openAdfStudio",
  "datapass.recordComponentResult", "datapass.setProjectChecklist", "datapass.openDoc", "datapass.installTool", "datapass.explainMissingFile",
  "datapass.initializeProjectManifest", "datapass.openProjectManifest", "datapass.openGraph", "datapass.openPreparationGuide", "datapass.switchProject",
  "datapass.env.copyKeyName", "datapass.env.openFile", "datapass.env.copyIdentifier", "datapass.copyProjectId", "datapass.openPowerOps", "datapass.readinessReport",
  // 0.18: tools & versions, connections, ID map.
  "datapass.checkConnections", "datapass.connections.copySignIn", "datapass.connections.openPortal", "datapass.toolchain.copyInstall",
  "datapass.showRecommendedExtensions", "datapass.lookUpId",
  "vscode.openFolder",
  // 0.15: architecture options, project sheet, AI exchange of DataPass files, backups.
  "datapass.openOptions", "datapass.openSheet", "datapass.recordDecision", "datapass.exportOptionsComparison", "datapass.optionsAiContext",
  "datapass.copyForAi", "datapass.importFromAi", "datapass.showAiExchange", "datapass.openOptionsFile", "datapass.openSheetFile", "datapass.openOptionSource",
  "datapass.clearPreview", "datapass.restoreBackup", "datapass.openSheetReference",
  // 0.16: the board, Git hosts' web pages, CI runs.
  "datapass.openBoard", "datapass.openBoardFile", "datapass.board.moveCard", "datapass.board.aiPack", "datapass.board.openFile", "datapass.board.openLink",
  "datapass.openRepositoryWeb", "datapass.openCiRuns",
  // 0.17: work views and windows.
  "datapass.openSwitcher", "datapass.saveWorkView", "datapass.openWorkbenchFloating",
  // 0.19: the Git view (the overview's Git card).
  "datapass.git.focus", "datapass.git.fetchAll",
  // 0.20: work orders (the Work orders view, Details, entry points).
  "datapass.workOrders.new", "datapass.workOrders.select", "datapass.workOrders.show", "datapass.workOrders.launch", "datapass.workOrders.resume",
  "datapass.workOrders.copyPrompt", "datapass.workOrders.copyForChat", "datapass.workOrders.markDone", "datapass.workOrders.abandon", "datapass.workOrders.archive",
  "datapass.workOrders.followUp", "datapass.workOrders.revise", "datapass.workOrders.checkPrFiles", "datapass.workOrders.importProposed",
  "datapass.workOrders.publishSummary", "datapass.workOrders.exportProject", "datapass.workOrders.openFolder", "datapass.workOrders.openFile",
  "datapass.workOrders.refresh", "datapass.workOrders.enable", "datapass.workOrders.newFromCard", "datapass.workOrders.newFromDecision", "datapass.control.openConversation",
  "datapass.workOrders.newForMissingFiles", "datapass.workOrders.openPr",
  // 0.23: the toolkit catalogue.
  "datapass.openToolkit", "datapass.toolkit.openLink", "datapass.toolkit.copyInstall", "datapass.toolkit.copyStep", "datapass.toolkit.openStep", "datapass.toolkit.openFile"
]);

export type WorkbenchView = "architecture" | "options" | "sheet" | "board" | "workOrders" | "toolkit";

/** VS Code's command that moves the active editor into a floating window (VS Code 1.85+). */
export const MOVE_TO_NEW_WINDOW = "workbench.action.moveEditorToNewWindow";

/**
 * Leaves of the grid `vscode.getEditorLayout` reports. Verified in desktop VS Code (1.139): the
 * command describes the window that has the focus — the main window, or a floating one.
 */
export function layoutLeaves(raw: unknown): number {
  const groups = (raw as { groups?: unknown } | null)?.groups;
  return Array.isArray(groups) && groups.length ? groups.reduce((n: number, g) => n + layoutLeaves(g), 0) : 1;
}

export async function waitUntil(probe: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > end) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export class WorkbenchHost implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private readonly views = new Map<string, vscode.WebviewView>();
  private readonly subs: vscode.Disposable[] = [];
  private lastState?: WorkbenchState;
  /** View to show once a new Workbench tab has loaded. */
  private pendingShow?: { view: WorkbenchView; focus?: string };
  /** 0.19: the Git view's observation, for the overview's one-line Git card. */
  private gitSource?: () => GitObservation;
  /** 0.20: the work orders of this project. */
  private workOrderSource?: () => WbWorkOrders | undefined;
  /** 0.22 modes: which Workbench views and markers the current mode shows (all until a mode is attached). */
  private shows: (surface: string) => boolean = () => true;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession) {
    this.subs.push(session.onDidChange(() => this.post()), session.onDidChangeSelection(() => this.post()));
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    for (const p of this.panels) p.dispose();
  }

  /** The state every view renders (exposed for the desktop tests). */
  state(): WorkbenchState {
    const ctx = this.session.project;
    this.lastState = workbenchState({
      map: this.session.projectMap(), selection: this.session.selection(), version: String(this.context.extension.packageJSON.version ?? ""),
      hasRoot: Boolean(ctx.root), hasManifest: ctx.manifestExists, manifestErrors: ctx.manifestErrors, graphError: ctx.graphError,
      trusted: vscode.workspace.isTrusted, observedAt: this.session.observedAt(), multipleProjectFolders: this.session.projectRootCandidates().length > 1,
      readiness: ctx.manifest ? this.session.readiness() : undefined,
      options: ctx.options, analysis: this.session.optionsAnalysis(), optionsError: ctx.optionsError,
      sheet: ctx.sheet, sheetError: ctx.sheetError, preview: this.session.preview(),
      board: this.session.boardView(), boardError: ctx.boardError,
      git: this.gitCard(),
      workOrders: this.workOrderSource?.(),
      toolkit: toolkitState(this.session.catalogue(), this.session.toolkitFileResults(), this.session.recipeFacts(), ctx.root ? this.session.projectMap() : undefined, process.platform, this.shows("badge.hubChanged"))
    });
    this.lastState.experience = {
      hiddenViews: (["options", "sheet", "board", "workOrders", "toolkit"] as const).filter(v => !this.shows(`workbench.${v}`)),
      alternatives: this.shows("badge.alternatives")
    };
    // 0.23: coding state badges (derived from the files; nothing to maintain).
    const v = this.shows("badge.codingState") ? this.session.variants() : undefined;
    if (v && ctx.options) {
      const wb = (c: { state: CodingState; reason: string }) => ({ state: c.state, label: CODING_LABELS[c.state], reason: c.reason });
      const p = this.session.preview();
      this.lastState.coding = {
        options: Object.fromEntries(Object.entries(v.options).map(([k, c]) => [k, wb(c)])),
        scenarios: Object.fromEntries(v.scenarios.map(sc => [sc.id, wb(sc)])),
        preview: p ? wb(codingOfPicks(ctx.options, v, p.picks)) : undefined
      };
    }
    return this.lastState;
  }

  setGitSource(source: () => GitObservation): void { this.gitSource = source; }
  /** 0.22 modes: gate the Workbench views and the "alternatives exist" marker; repaint on a mode change. */
  setSurfaces(shows: (surface: string) => boolean, changed: vscode.Event<unknown>): void {
    this.shows = shows;
    this.subs.push(changed(() => void this.post()));
  }
  /** 0.20: where the Work orders view and the Details timeline read the orders; `changed` repaints every view. */
  setWorkOrderSource(source: () => WbWorkOrders | undefined, changed: vscode.Event<void>): void {
    this.workOrderSource = source;
    this.subs.push(changed(() => void this.post()));
  }

  private lastGitCard = "";
  /** The Git view checked the repositories again: repaint the overview when its Git card changed. */
  refreshGit(): void {
    const card = JSON.stringify(this.gitCard() ?? null);
    if (card === this.lastGitCard) return;
    this.lastGitCard = card;
    void this.post();
  }

  private gitCard(): WbGit | undefined {
    const o = this.gitSource?.();
    if (!o || (!o.checkedAt && !o.restricted)) return undefined;
    const s = o.summary;
    return { needsYou: s.needsYou, repositories: s.repositories, checked: s.checked, openPrs: s.openPrs, failing: s.failing, oldestFetch: s.oldestFetch, top: s.top, restricted: o.restricted };
  }

  hasPanel(): boolean { return this.panels.size > 0; }

  /** The Workbench tab, when one is open. */
  panel(): vscode.WebviewPanel | undefined { return [...this.panels][0]; }

  /** Whether the Architecture panel ("map") or the Details side bar ("detail") is visible. */
  isVisible(mode: "map" | "detail"): boolean { return this.views.get(mode)?.visible ?? false; }

  /**
   * Whether the Workbench tab is in a floating window. Tab groups are numbered main window first,
   * then floating windows; `vscode.getEditorLayout` describes the focused window. With the main
   * window focused, a floating Workbench has a column beyond its grid; with the floating Workbench
   * focused, its own one-group grid is reported and the column is still beyond it.
   */
  async isFloating(): Promise<boolean> {
    const column = this.panel()?.viewColumn;
    if (!column) return false;
    return column > layoutLeaves(await vscode.commands.executeCommand("vscode.getEditorLayout"));
  }

  /** Open (or reveal) the full Workbench in an editor tab, on one of its views. */
  openPanel(column: vscode.ViewColumn = vscode.ViewColumn.Active, view?: WorkbenchView, focus?: string, preserveFocus = false): vscode.WebviewPanel {
    const existing = this.panel();
    if (existing) {
      existing.reveal(column, preserveFocus);
      if (view) void existing.webview.postMessage({ type: "show", view, focus });
      return existing;
    }
    this.pendingShow = view ? { view, focus } : undefined;
    const panel = vscode.window.createWebviewPanel("datapass.workbench", "DataPass Workbench", { viewColumn: column, preserveFocus }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")]
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "datapass.svg");
    this.attach(panel.webview, "full");
    this.panels.add(panel);
    panel.onDidDispose(() => this.panels.delete(panel));
    return panel;
  }

  /**
   * Move the Workbench tab into a floating window (a second screen). VS Code's command moves the
   * active editor, so the Workbench is made active first; the result is checked, not assumed.
   */
  async openFloating(view?: WorkbenchView): Promise<"moved" | "already"> {
    const current = this.panel();
    if (current && await this.isFloating()) {
      current.reveal(current.viewColumn, false);
      if (view) void current.webview.postMessage({ type: "show", view });
      return "already";
    }
    if (!(await vscode.commands.getCommands(true)).includes(MOVE_TO_NEW_WINDOW)) throw new Error("This VS Code has no floating editor windows (VS Code 1.85 or later).");
    const panel = this.openPanel(vscode.ViewColumn.Active, view);
    if (!(await waitUntil(() => panel.active, 3000))) throw new Error("The Workbench tab could not be made active. Right-click its tab → Move into New Window.");
    await vscode.commands.executeCommand(MOVE_TO_NEW_WINDOW);
    if (!(await waitUntil(() => this.isFloating(), 4000))) throw new Error("VS Code did not move the Workbench into its own window. Right-click its tab → Move into New Window.");
    return "moved";
  }

  /** Provider for a WebviewView (Architecture panel = map, Details side bar = detail). */
  viewProvider(mode: Extract<WorkbenchMode, "map" | "detail">): vscode.WebviewViewProvider {
    return {
      resolveWebviewView: view => {
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")] };
        this.attach(view.webview, mode);
        this.views.set(mode, view);
        view.onDidDispose(() => this.views.delete(mode));
        view.onDidChangeVisibility(() => { if (view.visible) void this.postTo(view.webview); });
      }
    };
  }

  /**
   * Apply diagram settings (a work view): stored for each mode and sent to the webviews showing it.
   * A webview that does not exist yet receives them when it loads.
   */
  async applyUi(ui: Partial<Record<DiagramMode, DiagramUi>>): Promise<void> {
    for (const mode of ["full", "map"] as const) {
      const value = ui[mode];
      if (!value) continue;
      await this.session.setDiagramUi(mode, value);
      for (const webview of this.webviewsOf(mode)) await webview.postMessage({ type: "ui", ui: value });
    }
  }

  private webviewsOf(mode: DiagramMode): vscode.Webview[] {
    return mode === "full" ? [...this.panels].map(p => p.webview) : [this.views.get("map")?.webview].filter((w): w is vscode.Webview => !!w);
  }

  private attach(webview: vscode.Webview, mode: WorkbenchMode): void {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "workbench.js")).toString();
    webview.html = workbenchHtml({ cspSource: webview.cspSource, nonce, scriptUri, mode, title: mode === "map" ? "DataPass architecture" : mode === "detail" ? "DataPass details" : "DataPass Workbench" });
    webview.onDidReceiveMessage(message => void this.onMessage(webview, mode, message));
  }

  private async onMessage(webview: vscode.Webview, mode: WorkbenchMode, message: unknown): Promise<void> {
    const m = message as { type?: unknown; subproject?: unknown; component?: unknown; componentId?: unknown; path?: unknown; command?: unknown; args?: unknown; scenario?: unknown; picks?: unknown; ui?: unknown } | null;
    if (!m || typeof m !== "object") return;
    const map = this.session.projectMap();
    const str = (v: unknown) => (typeof v === "string" && v.length <= 200 ? v : undefined);
    switch (m.type) {
      case "ready": {
        await this.postTo(webview);
        if (this.pendingShow && [...this.panels].some(p => p.webview === webview)) {
          await webview.postMessage({ type: "show", ...this.pendingShow });
          this.pendingShow = undefined;
        }
        if (mode === "detail") return;
        // Settings held by the session win (a work view may have been applied before this webview
        // loaded); otherwise the webview's own remembered settings become the session's.
        const stored = this.session.diagramUi(mode);
        if (stored) await webview.postMessage({ type: "ui", ui: stored });
        else { const own = sanitizeDiagramUi(m.ui, mode); if (own) await this.session.setDiagramUi(mode, own); }
        return;
      }
      case "ui": {
        if (mode === "detail") return;
        const ui = sanitizeDiagramUi(m.ui, mode);
        if (ui && !sameDiagramUi(ui, this.session.diagramUi(mode))) await this.session.setDiagramUi(mode, ui);
        return;
      }
      case "preview": {
        // Only scenarios and picks the options file declares; anything else clears the preview.
        const options = this.session.project.options;
        if (!options) return;
        const scenario = str(m.scenario);
        if (scenario) {
          if (scenario !== "current" && scenario !== "decided" && !options.scenarios?.some(s => s.id === scenario)) return;
          await this.session.setPreview(scenario === "current" ? undefined : { scenario });
          return;
        }
        const picks = Array.isArray(m.picks) ? m.picks.slice(0, 50).map(str).filter((p): p is string => !!p && /^[a-z][a-z0-9_.-]{0,79}=[a-z][a-z0-9_.-]{0,79}$/.test(p)) : [];
        const valid = picks.filter(p => { const [d, o] = p.split("="); return options.decisions.some(x => x.id === d && x.options.some(y => y.id === o)); });
        await this.session.setPreview(valid.length ? { picks: valid } : undefined);
        return;
      }
      case "select": {
        const subproject = str(m.subproject), component = str(m.component);
        if (subproject && !map.subprojects.some(s => s.id === subproject)) return;
        if (component && !map.components.some(c => c.id === component) && !this.session.preview()?.map.components.some(c => c.id === component)) return;
        await this.session.select({ subproject, component });
        return;
      }
      case "openFile": {
        const componentId = str(m.componentId), path = str(m.path);
        if (componentId && path) await vscode.commands.executeCommand("datapass.openComponentFile", componentId, path);
        return;
      }
      case "command": {
        const id = str(m.command);
        if (!id || !ALLOWED.has(id)) return;
        const args = Array.isArray(m.args) ? m.args.slice(0, 3) : [];
        await vscode.commands.executeCommand(id, ...args);
        return;
      }
    }
  }

  private async post(): Promise<void> {
    if (!this.panels.size && !this.views.size) return;
    const s = this.state();
    for (const p of this.panels) await p.webview.postMessage({ type: "state", state: s });
    for (const v of this.views.values()) if (v.visible) await v.webview.postMessage({ type: "state", state: s });
  }

  private async postTo(webview: vscode.Webview): Promise<void> {
    await webview.postMessage({ type: "state", state: this.state() });
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
