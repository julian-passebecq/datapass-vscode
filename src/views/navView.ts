/**
 * V4-NAV NAVHOST1: the DataPass view host — one webview panel (`datapass.navView`) in the column
 * left of the code, showing the current Location's current view (go/NAV-contract.md).
 *
 *   follows   the NavigationService is the single source of truth: every state change re-renders;
 *             the panel only sends `{type:"nav"}` / `{type:"select"}` messages back (validated).
 *   layout    the view takes the first column (or the one it already has), the code the next one,
 *             like DataPass Hop. Nothing takes the keyboard focus from the editor.
 *   surface   a `surface` view opens the existing DataPass view (Workbench, Hop, Airflow DAG…)
 *             through the command the `datapass.navView.surfaces` setting maps it to.
 *   data      bindings come from the providers registry (core/navigation/bindings); the body is drawn
 *             by the view renderer (NAVREN1), with a plain fallback until it is wired.
 *
 * Title format, surfaces and labels are settings/data, not hard-coded here. No client code runs.
 */
import * as vscode from "vscode";
import type { ProjectMap } from "../core/project/projectMap";
import type { NavigationService } from "../core/navigation/navigationService";
import type { NavLocation, NavState, ViewDef } from "../core/navigation/navTypes";
import { resolveBindings } from "../core/navigation/bindings";
import { fallbackRender, navViewHtml, navViewTitle, parseNavViewMessage, surfaceCommand, type NavRenderer, type NavViewMessage } from "./navViewHtml";

export const NAV_VIEW_TYPE = "datapass.navView";
const DEFAULT_TITLE_FORMAT = "{location} · {view} {n}/{N}";

export interface NavViewDeps {
  /** The current project map, when a project is open. */
  projectMap(): ProjectMap | undefined;
  /** Display label of a Location (NAVLOC1); defaults to the project map's labels. */
  labelOf?(location: NavLocation): string;
  /** Ladder override for the ↑/↓ buttons; defaults to the NavigationService ladder (NAVSVC1). */
  ladder?: { parent(l: NavLocation): NavLocation | null; children(l: NavLocation): readonly NavLocation[] };
  /** View renderer (NAVREN1). */
  render?: NavRenderer;
}

export class NavViewHost implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly subs: vscode.Disposable[] = [];
  private lastSurface?: string;
  private readonly selectEmitter = new vscode.EventEmitter<string>();
  /** A node selected in the view (the code link, NAVCODE1, decorates its source). */
  readonly onDidSelect = this.selectEmitter.event;
  /** Messages handled (tests). */
  readonly handled: NavViewMessage[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly nav: NavigationService, private readonly deps: NavViewDeps) {
    this.subs.push(
      this.selectEmitter,
      nav.onDidChange(() => this.render()),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.navView")) this.render(); })
    );
  }

  dispose(): void {
    this.panel?.dispose();
    for (const s of this.subs) s.dispose();
  }

  isOpen(): boolean { return Boolean(this.panel); }
  column(): vscode.ViewColumn | undefined { return this.panel?.viewColumn; }

  /** Open (or reveal) the view in the left column; the active code moves to the column on its right. */
  async show(): Promise<void> {
    const column = this.panel?.viewColumn ?? vscode.ViewColumn.One;
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.viewColumn === column) {
      await vscode.window.showTextDocument(editor.document, { viewColumn: column + 1, preview: true, preserveFocus: false, selection: editor.selection });
    }
    if (this.panel) {
      if (!this.panel.visible) this.panel.reveal(column, true);
    } else {
      const panel = vscode.window.createWebviewPanel(NAV_VIEW_TYPE, "DataPass", { viewColumn: column, preserveFocus: true }, { enableScripts: true, localResourceRoots: [] });
      panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "datapass.svg");
      this.panel = panel;
      panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; });
      panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) this.render(); });
      panel.webview.onDidReceiveMessage(m => this.receive(m));
    }
    this.lastSurface = undefined;
    this.render();
  }

  private currentView(state: NavState, views: readonly ViewDef[]): { view?: ViewDef; index: number } {
    const index = Math.max(0, views.findIndex(v => v.id === state.viewId));
    return { view: views[index], index };
  }

  private labelOf(l: NavLocation): string {
    if (this.deps.labelOf) return this.deps.labelOf(l);
    const map = this.deps.projectMap();
    if (l.level === "project") return map?.project?.title ?? l.nodeId;
    if (l.level === "subproject") return map?.subprojects.find(s => s.id === l.nodeId)?.title ?? l.nodeId;
    if (l.level === "artifact") return map?.components.find(c => c.id === l.nodeId)?.label ?? l.nodeId;
    return l.nodeId;
  }

  private render(): void {
    const panel = this.panel;
    if (!panel || !panel.visible) return;
    const state = this.nav.state;
    const views = this.nav.views();
    const { view, index } = this.currentView(state, views);
    const config = vscode.workspace.getConfiguration("datapass.navView");
    const title = navViewTitle(config.get<string>("titleFormat", DEFAULT_TITLE_FORMAT), this.labelOf(state.location), view, index, views.length);
    panel.title = title;
    let body: string;
    const cmd = view && surfaceCommand(view, config.get<Record<string, unknown>>("surfaces", {}));
    if (view?.layout === "surface") {
      body = cmd ? `<p class="desc">Opened in its own DataPass view.</p>` : `<p class="hole">No DataPass view is set for "${view.surface ?? ""}" (setting datapass.navView.surfaces).</p>`;
      const key = `${state.location.nodeId}/${view.id}`;
      if (cmd && this.lastSurface !== key) { this.lastSurface = key; void vscode.commands.executeCommand(cmd); }
    } else {
      this.lastSurface = undefined;
      const data = view ? resolveBindings(view, { location: state.location, projectMap: this.deps.projectMap() }) : [];
      body = view ? (this.deps.render ?? fallbackRender)(view, data) : `<p class="hole">No view is defined for this place.</p>`;
    }
    const ladder = this.deps.ladder;
    panel.webview.html = navViewHtml({
      cspSource: panel.webview.cspSource, nonce: makeNonce(), title, body, viewCount: views.length,
      canUp: ladder ? ladder.parent(state.location) !== null : this.nav.canUp(),
      canDown: ladder ? ladder.children(state.location).length > 0 : this.nav.canDown()
    });
  }

  private receive(raw: unknown): void {
    const m = parseNavViewMessage(raw);
    if (!m) return;
    this.handled.push(m);
    if (m.type === "nav") this.nav.dispatch(m.command);
    else if (m.type === "select") this.selectEmitter.fire(m.nodeId);
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** register.ts line: `registerNavView(ctx, nav, deps)`. */
export function registerNavView(context: vscode.ExtensionContext, nav: NavigationService, deps: NavViewDeps): NavViewHost {
  const host = new NavViewHost(context, nav, deps);
  context.subscriptions.push(host, vscode.commands.registerCommand("datapass.navView.open", () => host.show()));
  return host;
}
