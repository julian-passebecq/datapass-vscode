import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { EnterpriseHub } from '../work/enterpriseHub';
import { inspectorHtml, HUB_SCRIPT, HUB_STYLE } from './hubHtml';
import { STYLE } from './homeHtml';
export class HubInspector implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'datapass.hubInspector';
  private view?: vscode.WebviewView;
  private readonly sub: vscode.Disposable;
  private revision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly hub: EnterpriseHub) { this.sub = hub.onDidChange(() => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.render(); }, 250);
  }); }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view; view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage(m => { if (m?.type === 'hub') void this.hub.handle(m).catch(e => vscode.window.showErrorMessage(e instanceof Error ? e.message : 'Hub action failed')); });
    view.onDidChangeVisibility(() => { if (view.visible) void this.render(); });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    void this.render();
  }
  private async render(): Promise<void> {
    const view = this.view; if (!view?.visible) return;
    const revision = ++this.revision; const state = await this.hub.state();
    if (view !== this.view || revision !== this.revision) return;
    const nonce = randomBytes(16).toString('hex');
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src ${view.webview.cspSource} 'unsafe-inline';script-src 'nonce-${nonce}'"><style>${STYLE}${HUB_STYLE}body{padding:0}</style></head><body>${inspectorHtml(state)}<script nonce="${nonce}">const vscode=acquireVsCodeApi();${HUB_SCRIPT}</script></body></html>`;
  }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.sub.dispose(); }
}
