/**
 * Pilot stage 1 (AI-4a, handoff/v3/09 §3.3, §4.6, §8.8, brief 2026-09-26-ai4-pilot-allowlist.md):
 * the guard-rail files of a pilot order's folder, and channel 2 — the agent's `requests/<n>.json`
 * become Pilot cards in the AI view; *Run it* runs the existing read-only DataPass capability,
 * *Not now* declines; DataPass writes `responses/<n>.json` (names and states only).
 *
 * Machine settings (a workspace can never set them): datapass.pilot.enabled (default false) and
 * datapass.pilot.codexAppQualified (set after the one-time qualification on this computer).
 */
import * as vscode from "vscode";
import { CAPABILITY_INDEX } from "../core/capabilities/registry";
import { executeGalaxyAction } from "../core/actions";
import { AGENT_CONFIG_DIRS, pilotFolderFiles } from "../core/pilot/folder";
import { PILOT_CLIS, type PilotCli } from "../core/pilot/rules";
import {
  MAX_REQUEST_BYTES, REQUESTS_DIR, RESPONSES_DIR, checkRequest, pilotResponse, requestNumber, sideEffectText,
  type PilotRequest, type RequestVerdict
} from "../core/pilot/requests";
import { WORK_ORDERS_DIR, localIso, shortId, type WorkOrder } from "../core/workOrders/format";
import { machineSetting, type LoadedOrder, type WorkOrderService } from "./workOrders";
import type { WorkSession } from "./session";
import { UserFacingError, errorMessage, jsonBytes } from "./io";

export const pilotEnabled = (): boolean => machineSetting<boolean>("pilot.enabled") === true;
export const codexAppQualified = (): boolean => machineSetting<boolean>("pilot.codexAppQualified") === true;

const decoder = new TextDecoder();

/** The project's environments (a project that declares none has only `dev`). */
export function projectEnvironments(session: WorkSession): Array<{ id: string; production?: boolean }> {
  const envs = session.project.manifest?.environments ?? [];
  return envs.length ? envs.map(e => ({ id: e.id, production: e.production })) : [{ id: "dev" }];
}

const guardRailInput = (order: WorkOrder) => ({
  orderId: order.id,
  clis: (order.pilot?.clis ?? []).filter((c): c is PilotCli => (PILOT_CLIS as readonly string[]).includes(c)),
  readRepositories: order.repositories.map(r => r.localPath)
});

/** Write the guard rails into a new pilot order's folder; refused when `.claude/` or `.codex/` already exists there. */
export async function writeGuardRails(folder: vscode.Uri, order: WorkOrder): Promise<void> {
  for (const dir of AGENT_CONFIG_DIRS) {
    let exists = true;
    try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, dir)); } catch { exists = false; }
    if (exists) throw new UserFacingError(`The pilot order's folder already has ${dir}/: DataPass writes its guard rails only into a folder without one.`);
  }
  for (const f of pilotFolderFiles(guardRailInput(order))) {
    const target = vscode.Uri.joinPath(folder, ...f.rel.split("/"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."));
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(f.text));
  }
}

/** Re-read just before a launch: each guard-rail file is exactly what DataPass generates for this order. */
export async function guardRailsMatch(folder: vscode.Uri, order: WorkOrder): Promise<boolean> {
  for (const f of pilotFolderFiles(guardRailInput(order))) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, ...f.rel.split("/")));
      if (decoder.decode(bytes) !== f.text) return false;
    } catch { return false; }
  }
  return true;
}

// ------------------------------------------------------------------ requests → cards

export interface PilotCard {
  orderId: string;
  short: string;
  orderTitle: string;
  n: number;
  state: "pending" | "refused" | "answered";
  capability?: string;
  label?: string;
  component?: string;
  environment?: string;
  effects?: string;
  runsIn?: string;
  why?: string;
  message?: string;
  outcome?: "done" | "declined" | "failed";
}

interface OrderRequests { order: LoadedOrder; cards: PilotCard[]; valid: Map<number, PilotRequest> }

export class PilotService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private watcher?: vscode.FileSystemWatcher;
  private watchedRoot?: string;
  private cards: PilotCard[] = [];
  private loading?: Promise<void>;
  private again = false;
  private lastSignature = "";
  /** Runs in progress (a second click on the same card does nothing). */
  private readonly running = new Set<string>();

  constructor(private readonly session: WorkSession, private readonly orders: WorkOrderService) {
    this.subs.push(
      orders.onDidChange(() => { this.rewatch(); void this.reload(); }),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.pilot")) this.emitter.fire(); })
    );
  }

  dispose(): void { for (const s of this.subs) s.dispose(); this.watcher?.dispose(); this.emitter.dispose(); }

  list(): readonly PilotCard[] { return this.cards; }
  pending(): number { return this.cards.filter(c => c.state === "pending").length; }

  /** Pilot orders of this project (the Pilot tab lists them). */
  pilotOrders(): LoadedOrder[] { return this.orders.list().filter(o => o.order?.kind === "pilot-read"); }

  private rewatch(): void {
    const root = this.session.root;
    const key = root?.toString();
    if (key === this.watchedRoot) return;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.watchedRoot = key;
    if (!root) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, `${WORK_ORDERS_DIR}/*/{${REQUESTS_DIR},${RESPONSES_DIR}}/*.json`));
    const on = () => void this.reload();
    this.watcher.onDidCreate(on); this.watcher.onDidChange(on); this.watcher.onDidDelete(on);
  }

  reload(): Promise<void> {
    if (this.loading) { this.again = true; return this.loading; }
    this.loading = (async () => {
      try { do { this.again = false; await this.load(); } while (this.again); } finally { this.loading = undefined; }
    })();
    return this.loading;
  }

  private async load(): Promise<void> {
    const cards: PilotCard[] = [];
    for (const o of this.pilotOrders()) {
      if (!o.state || !o.state.launches.length) continue;
      cards.push(...(await this.readOrder(o)).cards);
    }
    this.cards = cards.sort((a, b) => (a.state === "pending" ? 0 : 1) - (b.state === "pending" ? 0 : 1) || (a.orderId < b.orderId ? 1 : a.orderId > b.orderId ? -1 : b.n - a.n)).slice(0, 60);
    const signature = JSON.stringify(this.cards);
    if (signature !== this.lastSignature) { this.lastSignature = signature; this.emitter.fire(); }
  }

  private async names(dir: vscode.Uri): Promise<string[]> {
    try { return (await vscode.workspace.fs.readDirectory(dir)).filter(([, t]) => t === vscode.FileType.File).map(([n]) => n); } catch { return []; }
  }

  private async readResponse(o: LoadedOrder, n: number): Promise<"done" | "declined" | "failed" | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(o.folder, RESPONSES_DIR, `${n}.json`));
      const doc = JSON.parse(decoder.decode(bytes)) as { outcome?: unknown };
      return doc.outcome === "done" || doc.outcome === "declined" || doc.outcome === "failed" ? doc.outcome : "failed";
    } catch { return undefined; }
  }

  /** Every request of one order, checked in number order (earlier valid ones feed the duplicate check). */
  private async readOrder(o: LoadedOrder): Promise<OrderRequests> {
    const order = o.order!;
    const base = { orderId: o.id, short: shortId(o.id), orderTitle: order.title };
    const files = (await this.names(vscode.Uri.joinPath(o.folder, REQUESTS_DIR))).filter(n => n.endsWith(".json")).slice(0, 200);
    const numbers = files.map(requestNumber).filter((n): n is number => n !== undefined);
    const answered = new Map<number, "done" | "declined" | "failed">();
    for (const name of await this.names(vscode.Uri.joinPath(o.folder, RESPONSES_DIR))) {
      const n = requestNumber(name);
      if (n !== undefined) { const r = await this.readResponse(o, n); if (r) answered.set(n, r); }
    }
    const sorted = [...files].sort((a, b) => (requestNumber(a) ?? 1e9) - (requestNumber(b) ?? 1e9));
    const valid = new Map<number, PilotRequest>();
    const cards: PilotCard[] = [];
    for (const name of sorted) {
      const n = requestNumber(name);
      const uri = vscode.Uri.joinPath(o.folder, REQUESTS_DIR, name);
      let raw: Uint8Array;
      try {
        const st = await vscode.workspace.fs.stat(uri);
        raw = st.size > MAX_REQUEST_BYTES ? new Uint8Array(MAX_REQUEST_BYTES + 1) : await vscode.workspace.fs.readFile(uri);
      } catch { continue; }
      const v = this.check(raw, name, o, numbers, [...valid.values()], n !== undefined && answered.has(n) ? [] : [...answered.keys()]);
      if (v.ok) valid.set(v.request.n, v.request);
      const outcome = n !== undefined ? answered.get(n) : undefined;
      if (outcome) {
        cards.push({ ...base, n: n!, state: "answered", outcome, ...(v.ok ? this.describe(v) : { message: v.message }) });
      } else if (v.ok) {
        cards.push({ ...base, n: v.request.n, state: "pending", ...this.describe(v) });
      } else {
        cards.push({ ...base, n: v.n ?? 0, state: "refused", message: v.message });
      }
    }
    return { order: o, cards, valid };
  }

  private describe(v: Extract<RequestVerdict, { ok: true }>): Partial<PilotCard> {
    const cap = v.capability;
    return {
      capability: cap.id, label: cap.label, component: v.request.action.component, environment: v.request.action.environment,
      effects: sideEffectText(cap.sideEffects), runsIn: cap.actionMode === "open-native" ? "opens the official tool" : "runs a read-only DataPass capture",
      ...(v.request.why ? { why: v.request.why.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300) } : {})
    };
  }

  private check(raw: Uint8Array, name: string, o: LoadedOrder, numbers: number[], earlier: PilotRequest[], answered: number[]): RequestVerdict {
    return checkRequest(raw, name, {
      order: o.order!, capabilities: CAPABILITY_INDEX, components: this.session.projectMap().components.map(c => c.id),
      environments: projectEnvironments(this.session), numbers, earlier, answered
    });
  }

  // ------------------------------------------------------------------ Run it / Not now

  private requireCard(orderId: unknown, n: unknown): { o: LoadedOrder; n: number } {
    if (typeof orderId !== "string" || typeof n !== "number" || !Number.isInteger(n)) throw new UserFacingError("Choose a pilot request.");
    const o = this.orders.get(orderId);
    if (!o?.order || o.order.kind !== "pilot-read") throw new UserFacingError(`Pilot order ${orderId} is not in this project (refresh).`);
    return { o, n };
  }

  private async writeResponse(o: LoadedOrder, n: number, outcome: "done" | "declined" | "failed", what: string): Promise<void> {
    const dir = vscode.Uri.joinPath(o.folder, RESPONSES_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `${n}.json`), jsonBytes(pilotResponse(o.order!, n, outcome, what, localIso(new Date()))));
  }

  /** *Run it*: re-read and re-check the request now, run the capability's DataPass action, answer. */
  async run(orderId: unknown, nArg: unknown, exec: (actionId: string) => Promise<void> = id => this.execute(id)): Promise<void> {
    const { o, n } = this.requireCard(orderId, nArg);
    if (!pilotEnabled()) throw new UserFacingError("Pilot mode is off on this computer (setting datapass.pilot.enabled).");
    if (!vscode.workspace.isTrusted) throw new UserFacingError("Restricted Mode: trust this workspace first.");
    const key = `${o.id}#${n}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    try {
      const { valid } = await this.readOrder(o);
      const uri = vscode.Uri.joinPath(o.folder, REQUESTS_DIR, `${n}.json`);
      const raw = await vscode.workspace.fs.readFile(uri);
      const answered = (await this.names(vscode.Uri.joinPath(o.folder, RESPONSES_DIR))).map(requestNumber).filter((x): x is number => x !== undefined);
      const numbers = (await this.names(vscode.Uri.joinPath(o.folder, REQUESTS_DIR))).map(requestNumber).filter((x): x is number => x !== undefined);
      const v = this.check(raw, `${n}.json`, o, numbers, [...valid.values()].filter(r => r.n < n), answered);
      if (!v.ok) throw new UserFacingError(`Pilot request ${n} of ${shortId(o.id)} is refused: ${v.message}`);
      try {
        await exec(v.capability.datapassActionId!);
        await this.writeResponse(o, n, "done", `${v.capability.label}: ${v.capability.actionMode === "open-native" ? "opened in the official tool" : "read-only capture run"} for ${v.request.action.component} in ${v.request.action.environment}.`);
      } catch (e) {
        await this.writeResponse(o, n, "failed", `${v.capability.label}: ${errorMessage(e)}`);
        throw e;
      }
    } finally {
      this.running.delete(key);
      await this.reload();
    }
  }

  /** *Not now*: answer "declined" (the agent reads it and goes on). */
  async decline(orderId: unknown, nArg: unknown): Promise<void> {
    const { o, n } = this.requireCard(orderId, nArg);
    if (n < 1 || n > 50) throw new UserFacingError("This request has no valid number.");
    if (await this.readResponse(o, n)) return;
    const refused = this.cards.find(c => c.orderId === o.id && c.n === n && c.state === "refused");
    await this.writeResponse(o, n, "declined", refused?.message ? `Refused by DataPass: ${refused.message}` : "Julian chose Not now.");
    await this.reload();
  }

  private async execute(actionId: string): Promise<void> {
    if (actionId.startsWith("datapass.")) await vscode.commands.executeCommand(actionId);
    else await executeGalaxyAction(actionId, this.session.extensionUri);
  }
}
