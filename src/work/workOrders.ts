/**
 * Work orders (pass AI-2, handoff/v3/09 §3.2, §4, §5, §9, §13.1): the service behind the AI view's
 * Agent tab, the Workbench's Work orders view, the Details timeline and the Git view's rule 8.
 *
 *   <coordination repository>/.datapass/local/work-orders/<id>/   (git-ignored through .datapass/local)
 *     order.md, order.json, attachments/   written once by DataPass
 *     state.json                            DataPass only
 *     result.json, proposed/<kind>.json     the agent only: untrusted, parsed strictly
 *
 * It lists the orders (the newest 100; *Archive* moves one to work-orders/archive/, nothing is ever
 * deleted), watches for results, checks each result's receipt, finds each repository's PR by the
 * planned branch through the Git observer (never from the result's text alone), and records what it
 * saw in state.json as a display cache. It never launches anything by itself: launching is a
 * command with a modal confirmation (workOrderCommands.ts).
 *
 * Machine settings (a workspace can never set them): datapass.ai.workOrders.enabled,
 * datapass.ai.claude.path, datapass.ai.codex.path, datapass.ai.projectTypes,
 * datapass.ai.workLog.privateRepository.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import {
  MAX_ORDER_BYTES, MAX_RESULT_BYTES, MAX_STATE_BYTES, ORDER_ID_RE, ORDERS_KEPT, ARCHIVE_DIR, WORK_ORDERS_DIR,
  checkResult, initialState, parseOrderState, parseWorkOrder, shortId,
  type OrderState, type WorkOrder
} from "../core/workOrders/format";
import { keyOfRef } from "../core/workOrders/builder";
import { resolveProjectType, workOrdersVerdict, type ProjectTypeInfo, type WorkOrdersVerdict } from "../core/workOrders/projectType";
import { discoverOutputs, outputText, seenPullRequests, summarize, workOrderNeedsYou, type OrderSummary, type RepoOutput, type ResultInfo } from "../core/workOrders/status";
import type { WbOrder, WbWorkOrders } from "../views/workbenchState";
import { sha256Bytes } from "../core/model/ids";
import type { NeedsYou } from "../core/git/gitReport";
import type { GitObserver } from "./gitObserver";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import type { ClosedPullRequest } from "../core/git/hostPrs";
import { errorMessage, jsonBytes } from "./io";

export interface LoadedOrder {
  id: string;
  folder: vscode.Uri;
  order?: WorkOrder;
  /** order.json could not be read: the order is listed with the reason, nothing else is done with it. */
  error?: string;
  state?: OrderState;
  /** state.json was missing or invalid (shown; rebuilt in memory as "written"). */
  stateProblem?: string;
  result: ResultInfo;
  resultKey?: string;
  digestNow?: string;
  outputs: RepoOutput[];
  summary?: OrderSummary;
  /** DataPass files the agent proposes (proposed/<kind>.json). */
  proposed: string[];
}

const decoder = new TextDecoder();

/** A machine- or user-level value only: a workspace or folder value of these settings is ignored. */
export function machineSetting<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration("datapass").inspect<T>(key)?.globalValue;
}

export function workOrdersEnabled(): boolean { return machineSetting<boolean>("ai.workOrders.enabled") === true; }

/** The files the agent reads — order.json, order.md and every attachment — by relative path. */
async function orderFiles(folder: vscode.Uri): Promise<string[]> {
  const files = ["order.json", "order.md"];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 3 || files.length > 200) return;
    let entries: [string, vscode.FileType][] = [];
    try { entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, ...rel.split("/"))); } catch { return; }
    for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const child = `${rel}/${name}`;
      if (type === vscode.FileType.Directory) await walk(child, depth + 1);
      else if (type === vscode.FileType.File) files.push(child);
    }
  };
  await walk("attachments", 0);
  return files;
}

/** Digest of what the agent reads: order.json, order.md and every attachment, by relative path. */
export async function orderDigest(folder: vscode.Uri): Promise<string> {
  const parts: string[] = [];
  for (const rel of await orderFiles(folder)) {
    let bytes: Uint8Array;
    try { bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, ...rel.split("/"))); } catch { bytes = new Uint8Array(); }
    parts.push(`${rel}\n${sha256Bytes(bytes).value}`);
  }
  return `sha256:${sha256Bytes(parts.join("\n")).value}`;
}

/** Sizes and times of the files the agent reads: the digest is recomputed only when one of them changed. */
async function orderSignature(folder: vscode.Uri): Promise<string> {
  const sig: string[] = [];
  for (const rel of await orderFiles(folder)) {
    try { const st = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, ...rel.split("/"))); sig.push(`${rel}:${st.size}:${st.mtime}`); } catch { sig.push(`${rel}:-`); }
  }
  return sig.join("|");
}

/** Orders DataPass wrote on this computer, with the digest it wrote (only those can be launched). */
const OWN_KEY = "datapass.v20.workOrders.own";
const OWN_KEPT = 1000;
/** An agent may still be working this long after its launch; later, results are picked up by the watcher and on focus. */
const POLL_WINDOW_MS = 48 * 60 * 60 * 1000;
const GIT_REFRESH_MS = 60_000;

export class WorkOrderService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private orders: LoadedOrder[] = [];
  private loading?: Promise<void>;
  private again = false;
  private watcher?: vscode.FileSystemWatcher;
  private watchedRoot?: string;
  private poll?: ReturnType<typeof setInterval>;
  private readonly announced = new Set<string>();
  private lastNeeds = "";
  private selectedId?: string;
  private selecting = false;
  /** state.json writes, one at a time (a reload's derived state never overwrites a launch or a close). */
  private stateChain: Promise<unknown> = Promise.resolve();
  private lastSignature = "";
  private readonly digests = new Map<string, { sig: string; digest: string }>();
  /** Merge commits checked in the clones' default branches: `${folder}\0${sha}` → contained. */
  private readonly pulled = new Map<string, boolean>();
  private readonly pulling = new Set<string>();
  private lastGitRefresh = 0;
  /** Set once the first load finished (desktop tests wait on it). */
  loadedAt?: string;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession, private readonly git: GitObserver) {
    this.subs.push(
      session.onDidChange(() => { this.rewatch(); void this.reload(); }),
      git.onDidChange(() => this.recompute()),
      session.onDidChangeSelection(() => { if (!this.selecting && this.selectedId) { this.selectedId = undefined; this.emitter.fire(); } }),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.ai")) { this.recompute(); } }),
      vscode.window.onDidChangeWindowState(e => { if (e.focused && this.hasOpenLaunched()) void this.reload(); })
    );
    git.setExtraNeeds(() => this.needsYou());
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.watcher?.dispose();
    if (this.poll) clearInterval(this.poll);
    this.emitter.dispose();
  }

  // ------------------------------------------------------------------ settings and verdicts

  projectType(): ProjectTypeInfo {
    const m = this.session.project.manifest;
    return resolveProjectType(m?.project.type, machineSetting<Record<string, string>>("ai.projectTypes"), m?.project.id);
  }

  verdict(): WorkOrdersVerdict {
    const m = this.session.project.manifest;
    return workOrdersVerdict({
      machineEnabled: workOrdersEnabled(), trusted: vscode.workspace.isTrusted, hasProject: Boolean(this.session.root && m),
      type: this.projectType().type, moduleSwitch: m?.modules?.workOrders
    });
  }

  /** Record an order DataPass has just written here, with the digest of what the agent reads. */
  async markOwn(id: string, digest: string): Promise<void> {
    const own = { ...(this.context.globalState.get<Record<string, string>>(OWN_KEY) ?? {}), [id]: digest };
    const ids = Object.keys(own).sort();
    for (const old of ids.slice(0, Math.max(0, ids.length - OWN_KEPT))) delete own[old];
    await this.context.globalState.update(OWN_KEY, own);
  }

  /** The digest DataPass recorded when it wrote this order on this computer (undefined: not written here). */
  ownDigest(id: string): string | undefined {
    const v = this.context.globalState.get<Record<string, string>>(OWN_KEY)?.[id];
    return typeof v === "string" ? v : undefined;
  }

  /** Check the repositories' PRs again (the Git observer caches; at most once a minute unless forced). */
  refreshGit(force = false): void {
    if (!vscode.workspace.isTrusted || (!force && Date.now() - this.lastGitRefresh < GIT_REFRESH_MS)) return;
    this.lastGitRefresh = Date.now();
    void this.git.refresh();
  }

  /** The coordination repository's work-orders folder. */
  ordersFolder(): vscode.Uri | undefined {
    const root = this.session.root;
    return root ? vscode.Uri.joinPath(root, ...WORK_ORDERS_DIR.split("/")) : undefined;
  }

  // ------------------------------------------------------------------ listing

  list(): readonly LoadedOrder[] { return this.orders; }
  get(id: string): LoadedOrder | undefined { return this.orders.find(o => o.id === id); }
  selected(): LoadedOrder | undefined { return this.selectedId ? this.get(this.selectedId) : undefined; }

  /** Select an order (Details shows its timeline) and its components (the diagram follows). */
  async select(id: string | undefined): Promise<void> {
    const o = id ? this.get(id) : undefined;
    this.selectedId = o?.id;
    if (o?.order?.scope.components?.length || o?.order?.scope.subproject) {
      this.selecting = true;
      try {
        const map = this.session.projectMap();
        const comp = o.order.scope.components?.find(c => map.components.some(x => x.id === c));
        const sub = o.order.scope.subproject && map.subprojects.some(s => s.id === o.order!.scope.subproject) ? o.order.scope.subproject : undefined;
        await this.session.select({ subproject: sub, component: comp });
      } finally { this.selecting = false; }
    }
    this.emitter.fire();
  }

  /** An order launched in the last 48 hours still waits for its result: worth polling for it. */
  private hasOpenLaunched(): boolean {
    const now = Date.now();
    return this.orders.some(o => o.state?.status === "launched" && o.result.state === "none" && o.state.launches.some(l => now - Date.parse(l.at) < POLL_WINDOW_MS));
  }

  /** Re-read every order folder (coalesced). */
  reload(): Promise<void> {
    if (this.loading) { this.again = true; return this.loading; }
    this.loading = (async () => {
      try {
        do { this.again = false; await this.load(); } while (this.again);
      } finally { this.loading = undefined; }
    })();
    return this.loading;
  }

  private async load(): Promise<void> {
    const dir = this.ordersFolder();
    if (!dir) { this.orders = []; this.finish(); return; }
    let names: string[] = [];
    try {
      names = (await vscode.workspace.fs.readDirectory(dir)).filter(([n, t]) => t === vscode.FileType.Directory && ORDER_ID_RE.test(n)).map(([n]) => n);
    } catch { names = []; }
    names.sort((a, b) => (a < b ? 1 : -1));
    const loaded: LoadedOrder[] = [];
    for (const id of names.slice(0, ORDERS_KEPT)) loaded.push(await this.loadOne(id, vscode.Uri.joinPath(dir, id)));
    this.orders = loaded;
    await this.afterLoad();
    this.finish();
  }

  private async readText(uri: vscode.Uri, max: number): Promise<{ text?: string; tooLarge?: boolean; mtime?: number }> {
    try {
      const st = await vscode.workspace.fs.stat(uri);
      if (st.size > max) return { tooLarge: true, mtime: st.mtime };
      return { text: decoder.decode(await vscode.workspace.fs.readFile(uri)), mtime: st.mtime };
    } catch { return {}; }
  }

  private async loadOne(id: string, folder: vscode.Uri): Promise<LoadedOrder> {
    const base: LoadedOrder = { id, folder, result: { state: "none" }, outputs: [], proposed: [] };
    const orderFile = await this.readText(vscode.Uri.joinPath(folder, "order.json"), MAX_ORDER_BYTES);
    if (!orderFile.text) return { ...base, error: orderFile.tooLarge ? "order.json is too large" : "order.json is missing" };
    let order: WorkOrder;
    try { order = parseWorkOrder(orderFile.text, id); } catch (e) { return { ...base, error: errorMessage(e) }; }
    let state: OrderState, stateProblem: string | undefined;
    const stateFile = await this.readText(vscode.Uri.joinPath(folder, "state.json"), MAX_STATE_BYTES);
    try {
      if (!stateFile.text) throw new Error("state.json is missing");
      state = parseOrderState(stateFile.text, id);
    } catch (e) {
      stateProblem = errorMessage(e);
      state = initialState(order, `sha256:${"0".repeat(64)}`);
    }
    const resultUri = vscode.Uri.joinPath(folder, "result.json");
    const resultFile = await this.readText(resultUri, MAX_RESULT_BYTES);
    let result: ResultInfo = { state: "none" };
    const at = resultFile.mtime ? new Date(resultFile.mtime).toISOString() : undefined;
    if (resultFile.tooLarge) result = { state: "refused", why: "too-large", message: `result.json is larger than ${MAX_RESULT_BYTES / 1024} KiB`, at };
    else if (resultFile.text !== undefined) {
      const v = checkResult(resultFile.text, order);
      result = v.ok ? { state: "valid", checked: v.checked, at } : { state: "refused", why: v.why, message: v.message, at };
    }
    const open = state.status !== "done" && state.status !== "abandoned";
    let digestNow: string | undefined;
    if (open && state.launches.length) {
      const sig = await orderSignature(folder);
      const hit = this.digests.get(id);
      digestNow = hit?.sig === sig ? hit.digest : await orderDigest(folder);
      this.digests.set(id, { sig, digest: digestNow });
    }
    let proposed: string[] = [];
    try {
      proposed = (await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, "proposed")))
        .filter(([n, t]) => t === vscode.FileType.File && /^(project|graph|options|sheet|board|catalog)\.json$/.test(n)).map(([n]) => n.replace(/\.json$/, ""));
    } catch { proposed = []; }
    return { ...base, order, state, stateProblem, result, resultKey: resultFile.mtime ? `${id}@${resultFile.mtime}` : undefined, digestNow, proposed };
  }

  /** Outputs from the Git observer, summaries, then what changed on disk (reported, seen PRs). */
  private async afterLoad(): Promise<void> {
    this.computeOutputs();
    for (const o of this.orders) {
      if (!o.order || !o.state || o.stateProblem) continue;
      // What DataPass observed (a valid result, PRs seen), applied to the state as it is on disk now.
      const derive = (s: OrderState): OrderState => {
        let next = s;
        if (o.result.state === "valid" && (next.status === "written" || next.status === "launched")) next = { ...next, status: "reported" };
        if (next.status !== "done" && next.status !== "abandoned") {
          const now = new Date().toISOString();
          const seen = seenPullRequests(o.outputs, now);
          const strip = (x: typeof seen) => JSON.stringify(x.map(({ checkedAt: _c, ...rest }) => rest));
          if (seen.length && strip(seen) !== strip(next.seen.pullRequests)) next = { ...next, seen: { pullRequests: seen, checkedAt: now } };
        }
        return next;
      };
      if (derive(o.state) !== o.state) {
        o.state = await this.mutateState(o, derive);
        o.summary = this.summaryOf(o);
      }
      if (o.result.state !== "none" && o.resultKey && !this.announced.has(o.resultKey)) {
        this.announced.add(o.resultKey);
        if (this.loadedAt) { this.announce(o); this.refreshGit(true); }
      }
    }
  }

  private announce(o: LoadedOrder): void {
    const r = o.result;
    const text = r.state === "valid" ? `Work order ${shortId(o.id)}: the agent says ${r.checked.result.status}${r.checked.result.questions?.length ? ` (${r.checked.result.questions.length} question${r.checked.result.questions.length === 1 ? "" : "s"})` : ""}.`
      : r.state === "refused" ? `Work order ${shortId(o.id)}: result refused — ${r.message}` : "";
    if (!text) return;
    const show = r.state === "refused" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(text, "Open").then(x => { if (x === "Open") void vscode.commands.executeCommand("datapass.workOrders.show", o.id); });
  }

  private computeOutputs(): void {
    const keys = Object.keys(this.session.project.manifest?.repositories ?? {});
    for (const o of this.orders) {
      if (!o.order) continue;
      const checked = o.result.state === "valid" ? o.result.checked : undefined;
      o.outputs = discoverOutputs(o.order, checked, ref => this.git.report(keyOfRef(ref, keys)), (ref, pr) => this.pulledState(keyOfRef(ref, keys), pr));
      o.summary = this.summaryOf(o);
    }
  }

  /** Whether a merged PR's commit is in the clone's default branch; checked once per commit, in the background. */
  private pulledState(key: string, pr: ClosedPullRequest): boolean | undefined {
    if (!pr.mergeCommit || !/^[0-9a-f]{7,40}$/.test(pr.mergeCommit) || !vscode.workspace.isTrusted) return undefined;
    const map = this.session.projectMap();
    const folder = key === map.coordinationKey || key === "." ? this.session.root?.fsPath : this.session.repoFolder(key)?.fsPath;
    if (!folder) return undefined;
    const cacheKey = `${folder}\0${pr.mergeCommit}`;
    const hit = this.pulled.get(cacheKey);
    if (hit !== undefined) return hit;
    if (!this.pulling.has(cacheKey)) {
      this.pulling.add(cacheKey);
      const branch = this.git.report(key)?.defaultBranch ?? "main";
      void gitRunner(["merge-base", "--is-ancestor", pr.mergeCommit, `refs/heads/${branch}`], folder, 5000).then(r => {
        this.pulling.delete(cacheKey);
        // Not an ancestor, or the commit is not even fetched: not pulled here. A later Get updates changes the answer.
        this.pulled.set(cacheKey, r.ok);
        if (!r.ok) setTimeout(() => this.pulled.delete(cacheKey), GIT_REFRESH_MS);
        this.recompute();
      });
    }
    return undefined;
  }

  private summaryOf(o: LoadedOrder): OrderSummary | undefined {
    if (!o.order || !o.state) return undefined;
    return summarize({ order: o.order, state: o.state, result: o.result, outputs: o.outputs, digestNow: o.digestNow, now: Date.now() });
  }

  /** The Git observer checked the repositories again: outputs, summaries and rule 8 follow. */
  private recompute(): void {
    this.computeOutputs();
    this.finish();
  }

  private finish(): void {
    this.loadedAt ??= new Date().toISOString();
    // First load: results already there are not announced again.
    for (const o of this.orders) if (o.resultKey) this.announced.add(o.resultKey);
    this.schedulePoll();
    // Views repaint only when what they show changed (a poll or a session change that changes nothing repaints nothing).
    const signature = JSON.stringify([this.selectedId, this.orders.map(o => [o.id, o.error, o.stateProblem, o.proposed, o.summary, o.state?.published, o.state?.imported])]);
    if (signature !== this.lastSignature) { this.lastSignature = signature; this.emitter.fire(); }
    const needs = JSON.stringify(this.needsYou());
    if (needs !== this.lastNeeds) { this.lastNeeds = needs; this.git.notifyChanged(); }
  }

  /** What the Workbench's Work orders view and the Details timeline show. */
  view(): WbWorkOrders | undefined {
    if (!this.session.root || !this.session.project.manifest) return undefined;
    const verdict = this.verdict();
    const type = this.projectType();
    const coordination = this.session.projectMap().coordinationKey;
    const keys = Object.keys(this.session.project.manifest.repositories ?? {});
    const orders: WbOrder[] = this.orders.map(o => {
      const s = o.summary;
      if (!o.order || !s) {
        return { id: o.id, short: shortId(o.id), title: "(unreadable order)", kind: "", createdAt: "", status: "error", agent: "", scope: "", components: [], outputs: [], result: { state: "none", questions: [], followUps: [], checks: [], warnings: [] }, needs: [], next: "Open its folder: order.json cannot be read.", suggestDone: false, canLaunch: false, canResume: false, closed: false, changesCoordination: false, proposed: [], timeline: [], error: o.error };
      }
      const r = s.result;
      const closed = s.status === "done" || s.status === "abandoned";
      return {
        id: o.id, short: s.short, title: s.title, kind: s.kind, createdAt: s.createdAt, status: s.status, agent: s.agent, scope: s.scope,
        components: o.order.scope.components ?? [], subproject: o.order.scope.subproject,
        outputs: s.outputs.filter(x => x.access === "change").map(x => ({ ref: x.ref, text: outputText(x), state: x.state, url: x.pr?.url, ci: x.pr?.ci })),
        result: r.state === "valid"
          ? { state: "valid", status: r.checked.result.status, summary: r.checked.result.summary, questions: r.checked.result.questions ?? [], followUps: r.checked.result.followUps ?? [], checks: (r.checked.result.checks ?? []).map(c => `${c.what}: ${c.outcome}${c.note ? ` (${c.note})` : ""}`), warnings: r.checked.warnings }
          : r.state === "refused" ? { state: "refused", message: r.message, questions: [], followUps: [], checks: [], warnings: [] }
          : { state: "none", questions: [], followUps: [], checks: [], warnings: [] },
        needs: [...(o.stateProblem ? [`state.json: ${o.stateProblem}`] : []), ...(!closed && !this.ownDigest(o.id) ? ["not written by DataPass on this computer: it cannot be launched from here"] : []), ...s.needs], next: s.next, suggestDone: s.suggestDone,
        canLaunch: !closed && verdict.allowed && !!this.ownDigest(o.id), canResume: Boolean(o.order.agent.sessionId) && (o.state?.launches.some(l => l.how === "launched") ?? false), closed,
        changesCoordination: o.order.repositories.some(x => x.access === "change" && keyOfRef(x.ref, keys) === coordination),
        proposed: o.proposed,
        timeline: s.timeline
      };
    });
    return {
      allowed: verdict.allowed, why: verdict.why, typeLine: `${type.type} project (${type.source === "machine" ? "this computer's setting" : type.source === "manifest" ? "project.json" : "default"})`,
      orders, selected: this.selectedId, open: orders.filter(o => !o.closed && o.status !== "error").length, needs: orders.reduce((n, o) => n + o.needs.length, 0)
    };
  }

  /** Needs you rule 8, for the Git view. */
  needsYou(): NeedsYou[] {
    const keys = Object.keys(this.session.project.manifest?.repositories ?? {});
    const items = this.orders.filter(o => o.order && o.state).map(o => ({ order: o.order!, state: o.state!, result: o.result, outputs: o.outputs }));
    return workOrderNeedsYou(items, ref => keyOfRef(ref, keys), key => this.git.report(key)?.label ?? key, Date.now());
  }

  // ------------------------------------------------------------------ watching

  private rewatch(): void {
    const root = this.session.root;
    const key = root?.toString();
    if (key === this.watchedRoot) return;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.watchedRoot = key;
    if (!root) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, `${WORK_ORDERS_DIR}/*/{result.json,state.json,order.json,proposed/*.json}`));
    const on = () => void this.reload();
    this.watcher.onDidCreate(on); this.watcher.onDidChange(on); this.watcher.onDidDelete(on);
  }

  /** While an agent may be working, results are also polled (a watcher can miss a folder outside the workspace). */
  private schedulePoll(): void {
    const want = this.hasOpenLaunched();
    if (want && !this.poll) this.poll = setInterval(() => { void this.reload(); this.refreshGit(); }, 15_000);
    else if (!want && this.poll) { clearInterval(this.poll); this.poll = undefined; }
  }

  // ------------------------------------------------------------------ writing

  /** The first state.json of a new order (nothing else can write it yet). */
  async writeState(folder: vscode.Uri, state: OrderState): Promise<void> {
    await this.lock(() => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "state.json"), jsonBytes(state)));
  }

  private lock<T>(fn: () => Thenable<T> | Promise<T>): Promise<T> {
    const run = this.stateChain.then(() => fn(), () => fn());
    this.stateChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Read state.json as it is on disk now, apply `fn`, write it back — one order at a time, so a
   * change made meanwhile (a launch, a close, an import) is never overwritten by an older copy.
   */
  private mutateState(o: LoadedOrder, fn: (s: OrderState, order: WorkOrder) => OrderState): Promise<OrderState> {
    return this.lock(async () => {
      const order = o.order!;
      let current: OrderState;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(o.folder, "state.json"));
        if (bytes.byteLength > MAX_STATE_BYTES) throw new Error("state.json is too large");
        current = parseOrderState(bytes, o.id);
      } catch {
        // A missing or broken state.json is rebuilt from the order as it is now.
        current = initialState(order, await orderDigest(o.folder));
      }
      const next = fn(current, order);
      if (JSON.stringify(next) !== JSON.stringify(current)) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(o.folder, "state.json"), jsonBytes(next));
      return next;
    });
  }

  /** Change an order's state (launch, close, import, publish) and re-read (unless `reload` is false). */
  async updateState(id: string, fn: (s: OrderState, order: WorkOrder) => OrderState, reload = true): Promise<OrderState> {
    const o = this.get(id);
    if (!o?.order) throw new Error(`Work order ${id} cannot be read${o?.error ? `: ${o.error}` : ""}.`);
    const next = await this.mutateState(o, fn);
    if (reload) await this.reload();
    return next;
  }

  /** Move an order to work-orders/archive/ (never deleted). */
  async archive(id: string): Promise<void> {
    const dir = this.ordersFolder();
    const o = this.get(id);
    if (!dir || !o) throw new Error(`Unknown work order ${id}.`);
    const target = vscode.Uri.joinPath(dir, ARCHIVE_DIR, id);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, ARCHIVE_DIR));
    await vscode.workspace.fs.rename(o.folder, target, { overwrite: false });
    if (this.selectedId === id) this.selectedId = undefined;
    await this.reload();
  }

  /** Absolute path of an order folder on this machine (extension host only). */
  folderPath(id: string): string | undefined {
    const dir = this.ordersFolder();
    return dir && ORDER_ID_RE.test(id) ? path.join(dir.fsPath, id) : undefined;
  }
}
