/**
 * Workbench hosts: the editor tab (full), the Architecture view in the bottom panel (map) and the
 * Details view in the secondary side bar (detail). All render the same state and share one
 * selection held by the session: clicking a component anywhere updates every view.
 *
 * Messages from the webviews are untrusted input: only select / openFile / command are accepted,
 * commands come from an allowlist, and every id is checked against the current project map.
 */
import * as vscode from "vscode";
import type { WorkSession } from "../work/session";
import { workbenchHtml, type WorkbenchMode } from "./workbenchHtml";
import { workbenchState, type WorkbenchState } from "./workbenchState";

/** Commands a webview may ask for (arguments are re-validated by each command). */
const ALLOWED = new Set([
  "datapass.refreshProject", "datapass.checkForUpdates", "datapass.getUpdates", "datapass.preparationPack", "datapass.arrangeWorkbench",
  "datapass.cloneRepository", "datapass.locateRepository", "datapass.openRepositoryWindow", "datapass.openComponentFolder",
  "datapass.openComponentEntry", "datapass.openNativeTool", "datapass.showOperation", "datapass.copyComponentCommand", "datapass.openAdfStudio",
  "datapass.recordComponentResult", "datapass.setProjectChecklist", "datapass.openDoc", "datapass.installTool", "datapass.explainMissingFile",
  "datapass.initializeProjectManifest", "datapass.openProjectManifest", "datapass.openGraph", "datapass.openPreparationGuide", "datapass.switchProject",
  "datapass.env.copyKeyName", "datapass.env.openFile", "datapass.env.copyIdentifier", "datapass.copyProjectId", "datapass.openPowerOps", "datapass.readinessReport",
  "vscode.openFolder"
]);

export class WorkbenchHost implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private readonly views = new Map<string, vscode.WebviewView>();
  private readonly subs: vscode.Disposable[] = [];
  private lastState?: WorkbenchState;

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
      readiness: ctx.manifest ? this.session.readiness() : undefined
    });
    return this.lastState;
  }

  hasPanel(): boolean { return this.panels.size > 0; }

  /** Open (or reveal) the full Workbench in an editor tab. */
  openPanel(column: vscode.ViewColumn = vscode.ViewColumn.Active): vscode.WebviewPanel {
    const existing = [...this.panels][0];
    if (existing) { existing.reveal(column); return existing; }
    const panel = vscode.window.createWebviewPanel("datapass.workbench", "DataPass Workbench", column, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")]
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "datapass.svg");
    this.attach(panel.webview, "full");
    this.panels.add(panel);
    panel.onDidDispose(() => this.panels.delete(panel));
    return panel;
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

  private attach(webview: vscode.Webview, mode: WorkbenchMode): void {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "workbench.js")).toString();
    webview.html = workbenchHtml({ cspSource: webview.cspSource, nonce, scriptUri, mode, title: mode === "map" ? "DataPass architecture" : mode === "detail" ? "DataPass details" : "DataPass Workbench" });
    webview.onDidReceiveMessage(message => void this.onMessage(webview, message));
  }

  private async onMessage(webview: vscode.Webview, message: unknown): Promise<void> {
    const m = message as { type?: unknown; subproject?: unknown; component?: unknown; componentId?: unknown; path?: unknown; command?: unknown; args?: unknown } | null;
    if (!m || typeof m !== "object") return;
    const map = this.session.projectMap();
    const str = (v: unknown) => (typeof v === "string" && v.length <= 200 ? v : undefined);
    switch (m.type) {
      case "ready":
        await this.postTo(webview);
        return;
      case "select": {
        const subproject = str(m.subproject), component = str(m.component);
        if (subproject && !map.subprojects.some(s => s.id === subproject)) return;
        if (component && !map.components.some(c => c.id === component)) return;
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
