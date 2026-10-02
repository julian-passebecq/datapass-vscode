/**
 * V4-NAV NAVBAR1: the Navigator webview view. One provider, two contributed view ids
 * (`datapass.navigator` first in the secondary side bar, `datapass.navigatorLeft` in its own
 * activity-bar container), each shown by `config.datapass.navigator.location`; the command
 * `datapass.nav.moveNavigator` flips the setting and focuses the view. A person can still drag the
 * view elsewhere; VS Code remembers it. Works with rail mode on or off (it is not gated on the rail).
 *
 * The NavigationService (NAVSVC1) is the single source of truth: this view draws its state and sends
 * its commands back, validated by `parseNavigatorMessage`. Quick icons run the rail buttons' commands.
 */
import * as vscode from "vscode";
import type { NavCommand, NavLocation, NavState, ViewDef } from "../core/navigation/navTypes";
import { railButtonCommand } from "./railHtml";

/** The part of NAVSVC1's `NavigationService` a navigation surface uses. */
export interface NavigationLike<E = unknown> {
  readonly state: NavState;
  readonly onDidChange: (listener: (e: E) => unknown) => { dispose(): unknown };
  dispatch(cmd: NavCommand): void;
  views(): readonly ViewDef[];
}
import {
  NAVIGATOR_LABELS, NAVIGATOR_VIEW_IDS, navigatorHtml, navigatorLocation, navigatorModel, otherLocation, parseNavigatorMessage, quickIcons,
  type NavigatorLocation
} from "./navigatorHtml";

/** Optional extras a host may give: the ladder trail for the breadcrumb, node names, up/down availability. */
export interface NavigatorExtras {
  trail?(l: NavLocation): readonly NavLocation[];
  label?(l: NavLocation): string;
  canUp?(): boolean;
  canDown?(): boolean;
}

export const MOVE_NAVIGATOR_COMMAND = "datapass.nav.moveNavigator";

const config = () => vscode.workspace.getConfiguration("datapass.navigator");

export class NavigatorView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly views = new Map<string, vscode.WebviewView>();
  private readonly loaded = new Set<string>();
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly nav: NavigationLike, private readonly extras: NavigatorExtras = {}) {
    this.subs.push(nav.onDidChange(() => void this.post()) as vscode.Disposable);
    this.subs.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.navigator")) void this.post(); }));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  resolveWebviewView(view: vscode.WebviewView): void {
    const id = view.viewType;
    this.views.set(id, view);
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = navigatorHtml(view.webview.cspSource, makeNonce());
    view.webview.onDidReceiveMessage(m => void this.handle(id, m));
    view.onDidChangeVisibility(() => { if (!view.visible) this.loaded.delete(id); });
    view.onDidDispose(() => { this.views.delete(id); this.loaded.delete(id); });
  }

  /** The model posted to the webviews (desktop tests). */
  model() {
    const state = this.nav.state;
    return navigatorModel({
      state, views: this.nav.views(),
      trail: this.extras.trail?.(state.location), label: this.extras.label,
      canUp: this.extras.canUp?.(), canDown: this.extras.canDown?.(),
      quick: quickIcons(config().get("quickIcons")), labels: NAVIGATOR_LABELS
    });
  }

  private async post(): Promise<void> {
    const model = this.model();
    const message = { type: "nav-state", state: this.nav.state, views: this.nav.views(), labels: model.labels, model };
    // Hidden views have no page (no retainContextWhenHidden): they re-send "ready" when shown again.
    for (const [id, v] of this.views) if (this.loaded.has(id) && v.visible) await v.webview.postMessage(message);
  }

  private async handle(id: string, raw: unknown): Promise<void> {
    const m = parseNavigatorMessage(raw);
    if (!m) return;
    switch (m.type) {
      case "ready": this.loaded.add(id); return this.post();
      case "nav": return this.nav.dispatch(m.command);
      case "select": {
        const trail = this.extras.trail?.(this.nav.state.location) ?? [this.nav.state.location];
        const target = trail.find(l => l.nodeId === m.nodeId);
        if (target && target.nodeId !== this.nav.state.location.nodeId) this.nav.dispatch({ type: "go", location: target });
        return;
      }
      case "quick": {
        const c = railButtonCommand(m.id);
        await vscode.commands.executeCommand(c.command, ...c.args);
        return;
      }
    }
  }
}

/** Flip the Navigator between the secondary side bar and its own left container, then focus it. */
export async function moveNavigator(to?: NavigatorLocation): Promise<NavigatorLocation> {
  const target = to ?? otherLocation(navigatorLocation(config().get("location")));
  await config().update("location", target, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand(`${NAVIGATOR_VIEW_IDS[target]}.focus`);
  return target;
}

/** The one line `register.ts` calls (NAVSVC1). */
export function registerNavigator(context: vscode.ExtensionContext, nav: NavigationLike, extras?: NavigatorExtras): NavigatorView {
  const view = new NavigatorView(nav, extras);
  // Lazy: no retainContextWhenHidden, so a hidden Navigator costs nothing (its page reloads and asks again).
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(NAVIGATOR_VIEW_IDS.right, view),
    vscode.window.registerWebviewViewProvider(NAVIGATOR_VIEW_IDS.left, view),
    vscode.commands.registerCommand(MOVE_NAVIGATOR_COMMAND, (to?: unknown) => moveNavigator(to === "left" || to === "right" ? to : undefined))
  );
  return view;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
