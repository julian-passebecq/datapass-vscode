import * as vscode from "vscode";
import { collectGalaxyState } from "../core/galaxyState";
import { executeGalaxyAction } from "../core/actions";
import type { GalaxyState, PlatformOperation } from "../core/types";
import { CAPABILITY_INDEX } from "../core/capabilities/registry";
import { galaxyHtml } from "./galaxyHtml";

export class GalaxyViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "datapass.galaxy";
  private view?: vscode.WebviewView;

  /** `operations` supplies per-platform operation readiness (the Work session's preflight). */
  constructor(private readonly extensionUri: vscode.Uri, private readonly operations?: () => Map<string, PlatformOperation[]>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async message => {
      if (message?.type === "action" && typeof message.action === "string") {
        await executeGalaxyAction(message.action, this.extensionUri);
        await this.refresh();
      } else if (message?.type === "preflight" && typeof message.capability === "string" && CAPABILITY_INDEX.has(message.capability)) {
        // Only registry IDs are accepted from the webview; the preflight command does the rest.
        await vscode.commands.executeCommand("datapass.showPreflight", message.capability);
      }
    });
    void this.refresh();
  }

  private last?: GalaxyState;

  async refresh(): Promise<GalaxyState> {
    const state = await collectGalaxyState(this.extensionUri);
    this.last = state;
    await this.post(state);
    return state;
  }

  /** Re-post the last platform state with current operation readiness, without re-detecting platforms. */
  async refreshOperations(): Promise<void> {
    if (this.last) await this.post(this.last);
  }

  private async post(state: GalaxyState): Promise<void> {
    const ops = this.operations?.();
    if (ops) for (const platform of state.platforms) platform.operations = ops.get(platform.id);
    await this.view?.webview.postMessage({ type: "state", state });
  }

  private html(webview: vscode.Webview): string {
    return galaxyHtml(webview.cspSource, makeNonce());
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
