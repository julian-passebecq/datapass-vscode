/**
 * V4-NAV NAVCTX1: the DataPass Context view (bottom panel, `datapass-context`). It shows the details
 * of where you are, one tab per section (summary, process step, why & alternatives, patterns, on
 * Fabric, evidence), cycled with ←/→ inside the view. People may drag it under the left pane
 * (VS Code native). Sections come from the provider registry in core/navigation/context.
 *
 * Messages from the webview are untrusted: only "ready" and "tab" with a known tab id are accepted.
 * Nothing here runs client code.
 */
import * as vscode from "vscode";
import { buildSections, contextTabs, ORIGIN_LABELS } from "../core/navigation/context";
import type { NavSource } from "../core/navigation/navStub";
import { contextHtml } from "./contextHtml";

const ACTIVE_KEY = "datapass.context.activeTab";

export class ContextView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "datapass.context";
  private view?: vscode.WebviewView;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly nav?: NavSource) {
    if (nav) this.subs.push(nav.onDidChange(() => void this.post()));
    this.subs.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.context")) void this.post(); }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = contextHtml(view.webview.cspSource, makeNonce());
    view.webview.onDidReceiveMessage(m => void this.handle(m));
    view.onDidChangeVisibility(() => { if (view.visible) void this.post(); });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
  }

  private tabs() { return contextTabs(vscode.workspace.getConfiguration("datapass.context").get("tabTitles")); }

  async handle(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") return;
    const m = message as { type?: unknown; id?: unknown };
    if (m.type === "ready") return this.post();
    if (m.type === "tab" && typeof m.id === "string" && this.tabs().some(t => t.id === m.id)) {
      await this.context.workspaceState.update(ACTIVE_KEY, m.id);
    }
  }

  /** The message the webview gets (also used by tests). */
  async payload(): Promise<{ type: "context"; sections: unknown[]; active: string; labels: Record<string, unknown> }> {
    const sections = await buildSections({ location: this.nav?.state?.location ?? null }, this.tabs());
    const active = this.context.workspaceState.get<string>(ACTIVE_KEY) ?? "summary";
    return { type: "context", sections, active, labels: { origins: ORIGIN_LABELS, hint: "← → switch sections" } };
  }

  private async post(): Promise<void> {
    if (!this.view?.visible) return;
    await this.view.webview.postMessage(await this.payload());
  }

  dispose(): void { this.subs.forEach(s => s.dispose()); }
}

/** One line in the navigation register: the view and its "show" command. */
export function registerContextView(context: vscode.ExtensionContext, nav?: NavSource): ContextView {
  const view = new ContextView(context, nav);
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(ContextView.viewType, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("datapass.context.show", () => vscode.commands.executeCommand(`${ContextView.viewType}.focus`))
  );
  return view;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
