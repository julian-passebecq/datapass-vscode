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
 *   data      bindings come from the providers registry (core/navigation/bindings). NAVDATA1: the panel loads
 *             the view renderer (`viewHtml` + dist/navView.js) once and the host posts `nav-state` then
 *             `view-data` on every Location / view change and on the webview's `ready`; without the bundle
 *             (tests, unbuilt tree) the plain server-side fallback draws the body.
 *
 * Title format, surfaces and labels are settings/data, not hard-coded here. No client code runs.
 */
import * as fs from "fs";
import * as vscode from "vscode";
import type { ProjectMap } from "../core/project/projectMap";
import type { NavigationService } from "../core/navigation/navigationService";
import type { NavLocation, NavState, ViewDef } from "../core/navigation/navTypes";
import { resolveBindings, type BoundData } from "../core/navigation/bindings";
import { isCodeStepsInput } from "../webview/views/layouts/codeSteps.layout";
import type { CodeStepsInput } from "../webview/views/layouts/codeSteps";
import { bindCodeStepsSamples } from "./pqSampleHost";
import { viewHtml } from "./viewHtml";
import { navViewLabels, navViewMessages } from "./navViewData";
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
  /** The panel runs the view renderer (dist/navView.js) and receives posted data; else the HTML fallback. */
  private rendererMode = false;
  private readonly selectEmitter = new vscode.EventEmitter<string>();
  /** PQSAMP1 hook (NAVFIX1, review M7): stored step samples join a code-steps payload; a selected step is the sample target. */
  private lastSteps?: CodeStepsInput;
  private readonly samples = bindCodeStepsSamples(() => this.lastSteps, () => this.render());
  /** A node selected in the view (the code link, NAVCODE1, decorates its source). */
  readonly onDidSelect = this.selectEmitter.event;
  /** Messages handled (tests). */
  readonly handled: NavViewMessage[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly nav: NavigationService, private readonly deps: NavViewDeps) {
    this.subs.push(
      this.selectEmitter, { dispose: () => this.samples.dispose() },
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
      const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
      const bundle = vscode.Uri.joinPath(dist, "navView.js");
      this.rendererMode = fs.existsSync(bundle.fsPath);
      const panel = vscode.window.createWebviewPanel(NAV_VIEW_TYPE, "DataPass", { viewColumn: column, preserveFocus: true },
        { enableScripts: true, localResourceRoots: this.rendererMode ? [dist] : [] });
      if (this.rendererMode) {
        panel.webview.html = viewHtml({ cspSource: panel.webview.cspSource, nonce: makeNonce(), scriptUri: panel.webview.asWebviewUri(bundle).toString(), title: "DataPass" });
      }
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
    const cmd = view && surfaceCommand(view, config.get<Record<string, unknown>>("surfaces", {}));
    if (this.rendererMode) {
      if (view?.layout === "surface") {
        const key = `${state.location.nodeId}/${view.id}`;
        if (cmd && this.lastSurface !== key) { this.lastSurface = key; void vscode.commands.executeCommand(cmd); }
      } else this.lastSurface = undefined;
      const bound = view && view.layout !== "surface" ? this.withSamples(resolveBindings(view, { location: state.location, projectMap: this.deps.projectMap() })) : [];
      for (const m of navViewMessages({ state, views, labels: navViewLabels(config.get("labels", {})), bound })) void panel.webview.postMessage(m);
      return;
    }
    let body: string;
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

  private withSamples(bound: BoundData[]): BoundData[] {
    this.lastSteps = undefined;
    return bound.map(b => {
      if (!isCodeStepsInput(b.result.steps)) return b;
      const steps = this.samples.input(b.result.steps);
      this.lastSteps = steps;
      return { ...b, result: { ...b.result, steps } };
    });
  }

  private receive(raw: unknown): void {
    const m = parseNavViewMessage(raw);
    if (!m) return;
    this.handled.push(m);
    if (m.type === "nav") this.nav.dispatch(m.command);
    else if (m.type === "select") { this.samples.onMessage(m); this.selectEmitter.fire(m.nodeId); }
    else if (m.type === "open-surface") {
      // Only the current place's own surface view, through the same setting map as the automatic open.
      const view = this.nav.views().find(v => v.id === m.viewId && v.surface === m.surface);
      const cmd = view && surfaceCommand(view, vscode.workspace.getConfiguration("datapass.navView").get<Record<string, unknown>>("surfaces", {}));
      if (cmd) void vscode.commands.executeCommand(cmd);
    }
    else if (m.type === "ready" && this.rendererMode) this.render();
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
