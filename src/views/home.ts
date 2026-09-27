/**
 * DataPass Home and Project links (V3-HOME): two editor tabs rendered from the session's loaded
 * state. The Home is the module dashboard (vision §2.1): each tile runs an existing command; the
 * links page lists `.datapass/links.json` (vision §2.5).
 *
 * Webview messages are untrusted: an action id is looked up in HOME_ACTIONS (never run as a command
 * name), a layout id must be one of the saved work views, and a link is re-read from the validated
 * links file by its position and re-checked before `openExternal`, after the confirmation the other
 * link commands use. Nothing here calls the network or probes a tool.
 */
import * as vscode from "vscode";
import type { WorkSession } from "../work/session";
import type { WorkViews } from "../work/workViews";
import { confirmModal, guarded, UserFacingError } from "../work/io";
import { openExternal } from "../core/external";
import { workOrdersEnabled } from "../work/workOrders";
import { describeView } from "../core/windows/workViews";
import { linkHost, linkUrlProblem, LINKS_PATH } from "../core/project/links";
import { HOME_ACTIONS, homeState, type HomeLayout, type HomeState } from "./homeState";
import { homeHtml, type HomePage } from "./homeHtml";

export const HOME_VIEW_TYPE = "datapass.home";
export const LINKS_VIEW_TYPE = "datapass.projectLinks";

/** Is this tab the DataPass Home? (work views save and restore it). */
export const isHomeTab = (tab: vscode.Tab): boolean => tab.input instanceof vscode.TabInputWebview && /datapass\.home$/.test(tab.input.viewType);

export class HomeHost implements vscode.Disposable {
  private readonly panels = new Map<HomePage, vscode.WebviewPanel>();
  private readonly subs: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastHtml = new Map<HomePage, string>();
  /** Last message handled (tests). */
  lastAction?: { type: string; id?: string; command?: string; error?: string };

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession, private readonly views: WorkViews, private readonly shows: (surface: string) => boolean) {
    this.subs.push(session.onDidChange(() => this.schedule()), views.onDidChange(() => this.schedule()));
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const p of this.panels.values()) p.dispose();
    for (const s of this.subs) s.dispose();
  }

  isOpen(page: HomePage = "home"): boolean { return this.panels.has(page); }
  panel(page: HomePage = "home"): vscode.WebviewPanel | undefined { return this.panels.get(page); }

  async state(): Promise<HomeState> {
    const all = await this.views.all().catch(() => []);
    const current = this.session.root?.toString();
    const map = this.session.projectMap();
    const labels = { subproject: (id: string) => map.subprojects.find(s => s.id === id)?.title, component: (id: string) => map.components.find(c => c.id === id)?.label };
    const layouts: HomeLayout[] = all.flatMap(s => s.file.views.map(v => ({
      id: v.id, name: v.name, detail: describeView(v, labels), ...(all.length > 1 && s.root.toString() !== current ? { project: s.title } : {})
    })));
    const errors = all.filter(s => s.error).map(s => `${s.title}: saved layouts cannot be read (${s.error})`);
    const ctx = this.session.project;
    return homeState({
      hasProject: Boolean(ctx.manifestExists && ctx.manifest), map,
      board: this.session.boardView(), boardError: ctx.boardError,
      links: ctx.links, linksError: ctx.linksError,
      optionsDecisions: ctx.options?.decisions.length,
      workOrdersEnabled: workOrdersEnabled(),
      layouts, layoutsError: errors[0],
      shows: this.shows
    });
  }

  /** Open (or reveal) a page in the active editor group, or in `column`. */
  async open(page: HomePage = "home", column?: vscode.ViewColumn, preserveFocus = false): Promise<vscode.WebviewPanel> {
    const existing = this.panels.get(page);
    if (existing) { existing.reveal(column ?? existing.viewColumn, preserveFocus); await this.render(page); return existing; }
    const panel = vscode.window.createWebviewPanel(page === "links" ? LINKS_VIEW_TYPE : HOME_VIEW_TYPE, page === "links" ? "Project Links" : "DataPass Home",
      { viewColumn: column ?? vscode.ViewColumn.Active, preserveFocus }, { enableScripts: true, localResourceRoots: [] });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "datapass.svg");
    this.panels.set(page, panel);
    panel.onDidDispose(() => { this.panels.delete(page); this.lastHtml.delete(page); });
    panel.webview.onDidReceiveMessage(m => void this.receive(m));
    panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) void this.render(page); });
    await this.render(page, true);
    return panel;
  }

  private schedule(): void {
    if (!this.panels.size) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; for (const page of this.panels.keys()) void this.render(page); }, 250);
  }

  private async render(page: HomePage, force = false): Promise<void> {
    const panel = this.panels.get(page);
    if (!panel || (!force && !panel.visible)) return;
    const state = await this.state();
    const nonce = makeNonce();
    // Compare without the nonce, so an unchanged state does not reset the page (and its scroll).
    const body = homeHtml(state, page, panel.webview.cspSource, "NONCE");
    if (!force && this.lastHtml.get(page) === body) return;
    this.lastHtml.set(page, body);
    panel.webview.html = homeHtml(state, page, panel.webview.cspSource, nonce);
  }

  /** Handle one webview message (also used by the tests). */
  async receive(message: unknown): Promise<void> {
    const m = message && typeof message === "object" ? message as Record<string, unknown> : {};
    try {
      if (m.type === "action" && typeof m.id === "string") {
        const entry = Object.prototype.hasOwnProperty.call(HOME_ACTIONS, m.id) ? HOME_ACTIONS[m.id] : undefined;
        if (!entry) throw new UserFacingError("Unknown Home action.");
        this.lastAction = { type: "action", id: m.id, command: entry.command };
        await vscode.commands.executeCommand(entry.command, ...(entry.args ?? []));
      } else if (m.type === "layout" && typeof m.id === "string" && m.id.length <= 80) {
        const all = await this.views.all();
        if (!all.some(s => s.file.views.some(v => v.id === m.id))) throw new UserFacingError("That layout no longer exists.");
        this.lastAction = { type: "layout", id: m.id, command: "datapass.applyWorkView" };
        await vscode.commands.executeCommand("datapass.applyWorkView", m.id);
      } else if (m.type === "link" && Number.isInteger(m.group) && Number.isInteger(m.index)) {
        this.lastAction = { type: "link", id: `${m.group}:${m.index}`, command: "datapass.openProjectLink" };
        await vscode.commands.executeCommand("datapass.openProjectLink", { group: m.group, index: m.index });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.lastAction = { ...(this.lastAction ?? { type: String(m.type) }), error: text };
      void vscode.window.showErrorMessage(`DataPass: ${text}`);
    }
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

export function registerHomeCommands(context: vscode.ExtensionContext, session: WorkSession, home: HomeHost): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.openHome", async () => { await home.open("home"); });
  reg("datapass.openProjectLinks", async () => { await home.open("links"); });
  reg("datapass.openLinksFile", async () => {
    if (!session.root) throw new UserFacingError("Open a DataPass project first.");
    const uri = vscode.Uri.joinPath(session.root, ...LINKS_PATH.split("/"));
    try { await vscode.workspace.fs.stat(uri); } catch { throw new UserFacingError(`This project has no ${LINKS_PATH} yet. Ask your AI to add it (docs/PREPARING_A_PROJECT.md, "Project links").`); }
    await vscode.window.showTextDocument(uri, { preview: false });
  });
  reg("datapass.openProjectLink", async (arg?: unknown) => {
    const a = arg && typeof arg === "object" ? arg as { group?: unknown; index?: unknown } : {};
    const links = session.project.links;
    if (!links) throw new UserFacingError(session.project.linksError ? `${LINKS_PATH} has errors: ${session.project.linksError}` : `This project has no ${LINKS_PATH}.`);
    const group = typeof a.group === "number" ? links.groups[a.group] : undefined;
    const link = group && typeof a.index === "number" ? group.links[a.index] : undefined;
    if (!group || !link) throw new UserFacingError("Unknown project link (the file may have changed).");
    const why = linkUrlProblem(link.url);
    if (why) throw new UserFacingError(`Refusing this link: the address ${why}.`);
    if (!session.linkConfirmed(link.url)) {
      if (!(await confirmModal(`Open ${linkHost(link.url)}?`, `${link.label} — ${group.title}\n${link.url}\n\nThis address comes from ${LINKS_PATH}. DataPass sends nothing to it and does not check that you can see it.`, "Open"))) return;
      session.confirmLink(link.url);
    }
    await openExternal(vscode.Uri.parse(link.url, true));
  });
}
