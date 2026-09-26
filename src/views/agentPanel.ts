/**
 * The Claude & Codex panel (pass AI-3, handoff/v3/09 §7): a small webview view in the right side
 * bar, between the AI view and Details, folded by default. Quick links (yours, from
 * datapass.ai.quickLinks), Claude Control's status, plan usage, this project's conversations, open
 * PRs, urgent alerts and your "À faire par toi" rows.
 *
 * Messages from the webview are untrusted: a link is named by its index in the setting or by a row
 * key, and the link is re-read here and checked (scheme policy, conversation / PR allowlist) before
 * `openExternal`. Control is read only while the panel is visible (controlService.ts).
 */
import * as vscode from "vscode";
import { agentPanelHtml } from "./agentPanelHtml";
import { agentPanelState, linkOfKey, type AgentPanelState } from "./agentPanelState";
import { parseQuickLinks, quickLinkAllowed, safeConversationLink, safePrLink } from "../work/controlClient";
import { startCommand, type ControlService } from "../work/controlService";
import type { WorkSession } from "../work/session";
import { openExternal } from "../core/external";
import { clipboard } from "../core/clipboard";
import { errorMessage, UserFacingError } from "../work/io";
import type { WorkOrderService } from "../work/workOrders";

export class AgentPanelView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "datapass.agentPanel";
  private view?: vscode.WebviewView;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly session: WorkSession, private readonly control: ControlService, private readonly codexCli: () => boolean) {
    this.subs.push(control.onDidChange(() => void this.post()), session.onDidChange(() => void this.post()));
    this.subs.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.ai.quickLinks") || e.affectsConfiguration("datapass.ai.codex.path")) void this.post(); }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: [] };
    view.webview.html = agentPanelHtml(view.webview.cspSource, makeNonce());
    view.webview.onDidReceiveMessage(m => void this.receive(m).catch(e => void vscode.window.showErrorMessage(errorMessage(e))), undefined, this.subs);
    view.onDidChangeVisibility(() => this.control.want("panel", view.visible), undefined, this.subs);
    view.onDidDispose(() => { this.control.want("panel", false); this.view = undefined; }, undefined, this.subs);
    this.control.want("panel", view.visible);
  }

  state(): AgentPanelState {
    const { links, refused } = parseQuickLinks(vscode.workspace.getConfiguration("datapass").get("ai.quickLinks"));
    return agentPanelState(this.control.snapshot(), links, refused, this.codexCli(), !!this.session.project.manifest);
  }

  private async post(): Promise<void> {
    if (this.view?.visible) await this.view.webview.postMessage({ type: "state", state: this.state() });
  }

  /** One message from the webview (public for the desktop tests, which have no webview to click). */
  async receive(raw: unknown): Promise<void> {
    const m = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    switch (m.type) {
      case "ready": return this.post();
      case "refresh": return this.control.refresh();
      case "settings": await vscode.commands.executeCommand("workbench.action.openSettings", "datapass.ai.quickLinks"); return;
      case "copyStart":
        await clipboard.writeText(startCommand());
        void vscode.window.showInformationMessage("Claude Control's start command was copied. DataPass never starts Control itself.");
        return;
      case "openLink": {
        const { links } = parseQuickLinks(vscode.workspace.getConfiguration("datapass").get("ai.quickLinks"));
        const link = typeof m.index === "number" && Number.isInteger(m.index) ? links[m.index] : undefined;
        if (link && quickLinkAllowed(link.url)) await openExternal(vscode.Uri.parse(link.url, true));
        return;
      }
      case "open": {
        const url = linkOfKey(this.control.snapshot(), m.key);
        const safe = safeConversationLink(url) ?? safePrLink(url);
        if (safe) await openExternal(vscode.Uri.parse(safe, true));
        return;
      }
    }
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Commands of the panel and of the Work orders view's conversation link. */
export function registerControlCommands(context: vscode.ExtensionContext, control: ControlService, workOrders: WorkOrderService): void {
  const reg = (id: string, fn: (...args: unknown[]) => Promise<void> | void) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
    try { await fn(...args); } catch (e) { void vscode.window.showErrorMessage(errorMessage(e)); }
  }));
  reg("datapass.control.refresh", async () => {
    await control.refresh();
    const s = control.snapshot();
    if (s.state !== "on") void vscode.window.showInformationMessage(s.state === "disabled" ? "Reading Claude Control is switched off (datapass.control.enabled)." : s.state === "bad-url" ? String(s.detail) : "Claude Control is off. DataPass works normally; conversation status and token counts are hidden.");
  });
  reg("datapass.control.copyStartCommand", async () => {
    await clipboard.writeText(startCommand());
    void vscode.window.showInformationMessage("Claude Control's start command was copied. DataPass never starts Control itself.");
  });
  // The link is looked up here from Control's data for this order (never taken from a webview message).
  reg("datapass.control.openConversation", async (id?: unknown) => {
    const o = typeof id === "string" ? workOrders.get(id) : undefined;
    if (!o?.order) throw new UserFacingError("Choose a work order.");
    const link = safeConversationLink(control.conversationLinkOf(o.id, o.order.agent));
    if (!link) throw new UserFacingError(control.snapshot().state === "on" ? "Claude Control has no conversation link for this order yet." : "Claude Control is off: the conversation link is unknown.");
    await openExternal(vscode.Uri.parse(link, true));
  });
}
