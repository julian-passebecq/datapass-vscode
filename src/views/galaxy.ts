import * as vscode from "vscode";
import { collectGalaxyState } from "../core/galaxyState";
import { executeGalaxyAction } from "../core/actions";
import type { GalaxyState } from "../core/types";

export class GalaxyViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "datapass.galaxy";
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async message => {
      if (message?.type === "action" && typeof message.action === "string") {
        await executeGalaxyAction(message.action, this.extensionUri);
        await this.refresh();
      }
    });
    void this.refresh();
  }

  async refresh(): Promise<GalaxyState> {
    const state = await collectGalaxyState(this.extensionUri);
    await this.view?.webview.postMessage({ type: "state", state });
    return state;
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>DataPass Galaxy</title>
<style>
  :root { color-scheme: light dark; }
  body { padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .sub { color: var(--vscode-descriptionForeground); margin-bottom: 14px; font-size: 12px; }
  .grid { display: grid; gap: 10px; }
  .card { border: 1px solid var(--vscode-widget-border); background: var(--vscode-editor-background); border-radius: 6px; padding: 10px; }
  .head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .title { font-weight: 600; }
  .badge { font-size: 10px; text-transform: uppercase; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 2px 6px; }
  .ready, .yes { color: var(--vscode-testing-iconPassed); }
  .partial, .unbound { color: var(--vscode-editorWarning-foreground); }
  .missing, .error { color: var(--vscode-errorForeground); }
  .summary, .no { color: var(--vscode-descriptionForeground); }
  .summary { margin: 7px 0; font-size: 12px; }
  .tool, .binding { display:flex; justify-content:space-between; gap:6px; font-size:11px; padding:2px 0; }
  .actions { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
  button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 3px; padding: 4px 7px; font: inherit; font-size: 11px; cursor:pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:disabled { opacity:.45; cursor:not-allowed; }
</style>
</head>
<body>
<h1>DataPass Galaxy</h1>
<div class="sub">One control plane. Vendor tools stay vendor tools.</div>
<div id="root" class="grid"><div class="summary">Detecting tools and project context…</div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  function elt(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function addActions(card, actions) {
    const row = elt('div', 'actions');
    actions.forEach((action, index) => {
      const button = elt('button', index === 0 ? 'primary' : '', action.label);
      button.disabled = !action.enabled;
      if (action.detail) button.title = action.detail;
      button.addEventListener('click', () => vscode.postMessage({ type: 'action', action: action.id }));
      row.appendChild(button);
    });
    card.appendChild(row);
  }

  function renderProject(project) {
    const card = elt('section', 'card');
    const head = elt('div', 'head');
    head.appendChild(elt('span', 'title', project.title + ' project'));
    head.appendChild(elt('span', 'badge ' + (project.active ? 'ready' : 'unbound'), project.active ? 'active' : 'available'));
    card.appendChild(head);
    card.appendChild(elt('div', 'summary', project.summary));
    project.bindings.forEach(binding => {
      const row = elt('div', 'binding');
      row.appendChild(elt('span', '', binding.label));
      row.appendChild(elt('span', binding.status === 'bound' ? 'yes' : 'no', binding.status + (binding.value ? ' · ' + binding.value : '')));
      card.appendChild(row);
    });
    addActions(card, project.actions);
    return card;
  }

  function renderPlatform(platform) {
    const card = elt('section', 'card');
    const head = elt('div', 'head');
    head.appendChild(elt('span', 'title', platform.title));
    head.appendChild(elt('span', 'badge ' + platform.status, platform.status));
    card.appendChild(head);
    card.appendChild(elt('div', 'summary', platform.summary));
    platform.tools.forEach(tool => {
      const row = elt('div', 'tool');
      row.appendChild(elt('span', '', tool.label));
      row.appendChild(elt('span', tool.available ? 'yes' : 'no', (tool.available ? 'detected' : 'missing') + (tool.version ? ' · ' + tool.version : '')));
      card.appendChild(row);
    });
    addActions(card, platform.actions);
    return card;
  }

  function render(state) {
    root.replaceChildren();
    root.appendChild(renderProject(state.project));
    state.platforms.forEach(platform => root.appendChild(renderPlatform(platform)));
  }

  window.addEventListener('message', event => {
    if (event.data && event.data.type === 'state') render(event.data.state);
  });
</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}