/**
 * Claude Control in the extension (pass AI-3, handoff/v3/09 §7): when and what DataPass reads from
 * Julian's local dashboard, for the Claude & Codex panel and the Work orders view.
 *
 * - Never during activation, and nothing while nobody looks: the service reads Control only while
 *   the panel is visible or a launched order is still open (every 60 s), every 5 min once Control is
 *   off, and on request (the panel's ⟳, *DataPass: Refresh Claude Control Status*).
 * - `datapass.control.enabled` off = no request at all. The address is a machine setting and must be
 *   loopback (controlClient.ts refuses anything else).
 * - DataPass never starts Control: when it is off, the panel offers the start command to copy.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { ControlClient, DEFAULT_CONTROL_URL, controlBase, matchProjectNames, orderConversation, orderConversationLink, type ControlPlan, type ControlProject, type ConversationView, type OrderConversation } from "./controlClient";
import { machineSetting, type WorkOrderService } from "./workOrders";
import type { WorkSession } from "./session";

export const ON_REFRESH_MS = 60_000;
export const OFF_REFRESH_MS = 5 * 60_000;

export type ControlState = "disabled" | "unknown" | "off" | "on" | "bad-url";
export interface ControlSnapshot {
  state: ControlState;
  detail?: string;
  checkedAt?: string;
  plan?: ControlPlan;
  /** The project's folders Control knows, with their data. */
  projects: ControlProject[];
  /** Folder names tried (the coordination repository and every clone). */
  tried: string[];
  /** Work orders: id → Control's conversations. */
  orders: ReadonlyMap<string, OrderConversation[]>;
}

export function controlEnabled(): boolean {
  return vscode.workspace.getConfiguration("datapass").get<boolean>("control.enabled", true) !== false;
}

/** The start command to copy when Control is off: `python server/server.py` in the claude-control folder (a machine setting when set). */
export function startCommand(platform: NodeJS.Platform = process.platform): string {
  const folder = machineSetting<string>("control.folder");
  const f = typeof folder === "string" && path.isAbsolute(folder.trim()) ? folder.trim() : undefined;
  if (!f) return "python server/server.py   (in your claude-control folder)";
  return platform === "win32" ? `Set-Location '${f.replace(/'/g, "''")}'; python server/server.py` : `cd '${f.replace(/'/g, "'\\''")}' && python server/server.py`;
}

export class ControlService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private snap: ControlSnapshot = { state: "unknown", projects: [], tried: [], orders: new Map() };
  private readonly wanted = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private again = false;
  /** Control's project names, cached after an "unknown project" answer. */
  private known?: string[];
  private work?: WorkOrderService;
  /** Tests: another client (a fake server's address is set through the machine setting instead in desktop tests). */
  clientFactory: (base: string) => ControlClient = base => new ControlClient(base);

  constructor(private readonly session: WorkSession) {
    this.subs.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("datapass.control")) { this.known = undefined; if (this.wanted.size || this.snap.state !== "unknown") void this.refresh(); }
    }));
    this.subs.push(session.onDidChange(() => { const t = this.names().join("|"); if (t !== this.snap.tried.join("|") && this.wanted.size) void this.refresh(); }));
  }

  attachWorkOrders(service: WorkOrderService): void {
    this.work = service;
    // A launched order that is still open keeps Control's data fresh for the Work orders view.
    const sync = () => this.want("orders", service.list().some(o => o.state && o.state.launches.length > 0 && o.state.status !== "done" && o.state.status !== "abandoned"));
    this.subs.push(service.onDidChange(sync));
    // Not during activation: the first look waits until the window has settled.
    const t = setTimeout(sync, 5000);
    this.subs.push({ dispose: () => clearTimeout(t) });
  }

  snapshot(): ControlSnapshot { return this.snap; }

  /** A reason to keep reading Control (the panel is visible, an order is running). */
  want(reason: string, on: boolean): void {
    const had = this.wanted.size > 0;
    if (on) this.wanted.add(reason); else this.wanted.delete(reason);
    if (!had && this.wanted.size) void this.refresh();
    else if (!this.wanted.size) this.stopTimer();
  }

  /** The conversation line of a work order (undefined when Control has nothing for it). */
  conversationOf(id: string, agent: Parameters<typeof orderConversation>[0]): ConversationView | undefined {
    return orderConversation(agent, this.snap.orders.get(id));
  }

  conversationLinkOf(id: string, agent: { sessionId?: string }): string | undefined {
    return orderConversationLink(agent, this.snap.orders.get(id));
  }

  /** Folder names to try with Control: the coordination repository and the project's clones. */
  private names(): string[] {
    const out: string[] = [];
    if (this.session.root) out.push(path.basename(this.session.root.fsPath));
    for (const key of Object.keys(this.session.project.manifest?.repositories ?? {})) {
      const f = this.session.repoFolder(key);
      if (f) out.push(path.basename(f.fsPath));
    }
    return [...new Set(out)].slice(0, 20);
  }

  /** One read at a time; a refresh asked during a read (a setting changed) runs once more after it. */
  refresh(): Promise<void> {
    if (this.running) { this.again = true; return this.running.then(() => this.running ?? Promise.resolve()); }
    this.running = this.read().finally(() => {
      this.running = undefined;
      if (this.again) { this.again = false; void this.refresh(); } else this.schedule();
    });
    return this.running;
  }

  private async read(): Promise<void> {
    const at = new Date().toISOString();
    if (!controlEnabled()) { this.set({ state: "disabled", projects: [], tried: [], orders: new Map(), checkedAt: at }); return; }
    const configured = machineSetting<string>("control.url");
    const base = controlBase(typeof configured === "string" && configured.trim() ? configured : DEFAULT_CONTROL_URL);
    if (!base) { this.set({ state: "bad-url", detail: "datapass.control.url must be http://127.0.0.1:<port> or http://localhost:<port>.", projects: [], tried: [], orders: new Map(), checkedAt: at }); return; }
    const client = this.clientFactory(base);
    const health = await client.health();
    if (!health.ok) { this.set({ state: "off", detail: health.detail, projects: [], tried: this.names(), orders: new Map(), checkedAt: at }); return; }
    const tried = this.names();
    const plan = await client.plan();
    const projects: ControlProject[] = [];
    for (const name of matchProjectNames(tried, this.known)) {
      const r = await client.project(name);
      if (!r.ok) continue;
      if (r.data.project) projects.push(r.data.project);
      else if (r.data.known && !this.known) {
        this.known = r.data.known;
        for (const again of matchProjectNames([name], this.known).filter(n => n !== name && !projects.some(p => p.name === n))) {
          const r2 = await client.project(again);
          if (r2.ok && r2.data.project) projects.push(r2.data.project);
        }
      }
    }
    const ids = (this.work?.list() ?? []).filter(o => o.order).map(o => o.id);
    const orders = ids.length ? await client.workOrders(ids) : { ok: true as const, data: new Map<string, OrderConversation[]>() };
    this.set({ state: "on", checkedAt: at, plan: plan.ok ? plan.data : undefined, projects, tried, orders: orders.ok ? orders.data : new Map(), detail: orders.ok ? undefined : orders.detail });
  }

  private set(s: ControlSnapshot): void {
    const before = JSON.stringify({ ...this.snap, checkedAt: undefined, orders: [...this.snap.orders] });
    const after = JSON.stringify({ ...s, checkedAt: undefined, orders: [...s.orders] });
    this.snap = s;
    // The panel shows the time of the last check; the Work orders view repaints only on a real change.
    if (before !== after) this.work?.notifyControlChanged();
    this.emitter.fire();
  }

  private schedule(): void {
    this.stopTimer();
    if (!this.wanted.size || this.snap.state === "disabled" || this.snap.state === "bad-url") return;
    this.timer = setTimeout(() => void this.refresh(), this.snap.state === "on" ? ON_REFRESH_MS : OFF_REFRESH_MS);
  }

  private stopTimer(): void { if (this.timer) { clearTimeout(this.timer); this.timer = undefined; } }

  dispose(): void { this.stopTimer(); this.emitter.dispose(); for (const s of this.subs) s.dispose(); }
}
