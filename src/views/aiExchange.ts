/**
 * The AI exchange view (secondary side bar, beside Details): copy a DataPass file with the AI's
 * instructions, paste the AI's answer, see it checked live, then write it after a diff, a modal
 * confirmation and a backup. It replaces the clipboard-and-quick-pick round trip with one window.
 *
 * Messages from the webview are untrusted: kinds and tasks are checked against the known lists,
 * the pasted text is bounded and validated by the same parser as every other import, and writing
 * still goes through the diff and the modal. The answer is never stored.
 */
import * as vscode from "vscode";
import type { WorkSession } from "../work/session";
import { aiExchangeHtml } from "./aiExchangeHtml";
import { aiExchangeState, type AiExchangeState } from "./aiExchangeState";
import { AI_TASKS, MAX_EXCHANGE_BYTES, type ExchangeKind } from "../core/project/aiExchange";
import { KINDS, copyForAi, importAnswer, openExchangeFile, reviewAnswer } from "../work/optionsCommands";
import { clipboard } from "../core/clipboard";
import { errorMessage, readBounded, UserFacingError } from "../work/io";
import { readOptional } from "../core/workspace/loader";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { agentTabState, manualTabState, type AgentTabState, type ManualTabState } from "./agentState";
import type { WorkOrderService } from "../work/workOrders";
import { aiSettings, sanitizeDraft, type AgentPrefill, type Draft, type WorkOrderFlows } from "../work/workOrderCommands";
import type { GitObserver } from "../work/gitObserver";

/** Commands the view's footer may run (no arguments). */
const ALLOWED = new Set(["datapass.restoreBackup", "datapass.openPreparationGuide"]);
/** 0.20: commands the Agent and Manual tabs may run; arguments are short strings or numbers, re-checked by each command. */
const AGENT_ALLOWED = new Set([
  "datapass.workOrders.show", "datapass.workOrders.launch", "datapass.workOrders.resume", "datapass.workOrders.markDone", "datapass.workOrders.followUp",
  "datapass.workOrders.publishSummary", "datapass.workOrders.exportProject", "datapass.workOrders.openApp", "datapass.workOrders.enable",
  "datapass.workOrders.copyForChat", "datapass.openProjectManifest", "workbench.trust.manage",
  "datapass.project.focus", "datapass.git.focus", "datapass.readinessReport", "datapass.openWorkbench", "datapass.openNativeTool",
  "datapass.checkForUpdates", "datapass.openPreparationGuide", "workbench.actions.view.problems"
]);

/** 0.22 modes: `hiddenTabs` are the tabs the current mode does not show (the guided tab always shows). */
export type AiViewState = AiExchangeState & { agent?: AgentTabState; manual?: ManualTabState; hiddenTabs?: Array<"agent" | "manual"> };

type Reply = (message: Record<string, unknown>) => void | Thenable<boolean>;

export class AiExchangeView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "datapass.aiExchange";
  private view?: vscode.WebviewView;
  /** A reveal asked before the webview loaded: applied on its first "ready". */
  private pendingFocus?: { kind?: ExchangeKind };
  /** The webview's script has loaded (it said "ready"). */
  private loaded = false;
  private readonly subs: vscode.Disposable[] = [];
  private sizes: Partial<Record<ExchangeKind, number>> = {};
  private work?: { service: WorkOrderService; flows: WorkOrderFlows; git: GitObserver };
  /** Parts of a prefilled draft the webview never sees (a failing PR's checks, base branches, the order it follows). */
  private hidden?: { token: string; draft: Partial<Draft> };
  private lastVisible?: Partial<Draft>;
  private pendingPrefill?: Record<string, unknown>;
  /** 0.22 modes: which tabs the current mode shows (all until a mode is attached). */
  private shows: (surface: string) => boolean = () => true;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession) {
    this.subs.push(session.onDidChange(() => void this.post()));
  }

  /** 0.20: the work-order service behind the Agent tab. */
  attachWorkOrders(service: WorkOrderService, flows: WorkOrderFlows, git: GitObserver): void {
    this.work = { service, flows, git };
    this.subs.push(service.onDidChange(() => void this.post()), git.onDidChange(() => void this.post()));
  }

  /** 0.22 modes: hide the Agent and Manual tabs the mode does not show; a command that opens one still does. */
  setSurfaces(shows: (surface: string) => boolean, changed: vscode.Event<unknown>): void {
    this.shows = shows;
    this.subs.push(changed(() => void this.post()));
  }

  /** Open the Agent tab with a prefilled draft (entry points of §8.9). */
  async prefill(p: AgentPrefill): Promise<void> {
    const token = Math.random().toString(36).slice(2, 12);
    const { extra, baseBranches, followsUp, revises, ...visible } = p.draft;
    this.hidden = { token, draft: { extra, baseBranches, followsUp, revises } };
    this.lastVisible = visible;
    const message = { type: "prefill", draft: visible, note: p.note, token };
    this.pendingPrefill = message;
    await vscode.commands.executeCommand(`${AiExchangeView.viewType}.focus`);
    if (this.view && this.loaded) { await this.view.webview.postMessage(message); this.pendingPrefill = undefined; }
  }

  /** The last prefill the Agent tab received (desktop tests). */
  lastPrefill(): { token: string; draft: Partial<Draft>; visible: Partial<Draft> } | undefined { return this.hidden ? { ...this.hidden, visible: this.lastVisible ?? {} } : undefined; }

  /** Show one tab (desktop tests, commands). */
  async showTab(tab: "guided" | "agent" | "manual"): Promise<void> {
    await vscode.commands.executeCommand(`${AiExchangeView.viewType}.focus`);
    await this.view?.webview.postMessage({ type: "tab", tab });
  }

  /** A draft from the webview, with the hidden parts of the prefill it came from. */
  private draftFrom(raw: unknown, token: unknown): Draft {
    const d = sanitizeDraft(raw);
    if (this.hidden && token === this.hidden.token) return { ...d, ...Object.fromEntries(Object.entries(this.hidden.draft).filter(([, v]) => v !== undefined)) };
    return d;
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  /** The view has been shown at least once in this window (desktop tests). */
  resolved(): boolean { return Boolean(this.view); }
  /** Whether the view is showing (a work view records it, 0.17). */
  isVisible(): boolean { return this.view?.visible ?? false; }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.loaded = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = aiExchangeHtml(view.webview.cspSource, makeNonce());
    view.webview.onDidReceiveMessage(m => void this.handle(m, r => view.webview.postMessage(r)));
    view.onDidChangeVisibility(() => { if (view.visible) { void this.post(); this.work?.service.refreshGit(); } });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
  }

  /** Show the view in the secondary side bar, on one file when given. */
  async reveal(kind?: ExchangeKind): Promise<void> {
    if (kind && !KINDS.includes(kind)) kind = undefined;
    this.pendingFocus = { kind };
    await vscode.commands.executeCommand(`${AiExchangeView.viewType}.focus`);
    if (this.view && this.loaded) { await this.view.webview.postMessage({ type: "focus", kind }); this.pendingFocus = undefined; }
  }

  async state(): Promise<AiViewState> {
    await this.measure();
    const c = this.session.project;
    const base = aiExchangeState({
      version: String(this.context.extension.packageJSON.version ?? ""),
      hasRoot: Boolean(this.session.root), hasManifest: c.manifestExists, projectTitle: c.manifest?.project.title, graphPath: c.manifest?.graph,
      kinds: KINDS, sizes: this.sizes,
      problems: { manifest: c.manifestErrors[0], graph: c.graphError, options: c.optionsError, sheet: c.sheetError, board: c.boardError },
      exchanges: this.session.exchanges()
    });
    const hiddenTabs = (["agent", "manual"] as const).filter(t => !this.shows(`ai.${t}`));
    if (!this.work || !base.ready || !c.manifest) return { ...base, hiddenTabs };
    const s = aiSettings();
    return {
      ...base, hiddenTabs,
      agent: agentTabState(this.session, this.work.service, { choice: s.choice, effort: s.effort, model: s.model, exportScope: s.exportScope }),
      manual: manualTabState(this.session, this.work.git.observation().needsYou.length)
    };
  }

  /** Sizes of the files on disk (the loaded ones are known; graph and catalog are read). */
  private async measure(): Promise<void> {
    const root = this.session.root;
    const c = this.session.project;
    const sizes: Partial<Record<ExchangeKind, number>> = {};
    if (root) {
      for (const kind of KINDS) {
        const loaded = kind === "manifest" ? c.manifestBytes : kind === "options" ? c.optionsBytes : kind === "sheet" ? c.sheetBytes : kind === "board" ? c.boardBytes : undefined;
        if (loaded) { sizes[kind] = loaded.byteLength; continue; }
        if (kind !== "graph" && kind !== "catalog") continue;
        const rel = kind === "graph" ? c.manifest?.graph ?? ".datapass/graph.json" : ".datapass/catalog.json";
        const vet = vetRelativePath(rel);
        if (!vet.ok) continue;
        const bytes = await readOptional(vscode.Uri.joinPath(root, ...vet.relative.split("/")));
        if (bytes) sizes[kind] = bytes.byteLength;
      }
    }
    this.sizes = sizes;
  }

  private async post(): Promise<void> {
    if (!this.view?.visible) return;
    await this.view.webview.postMessage({ type: "state", state: await this.state() });
  }

  /** One message from the webview (also driven directly by the desktop tests). */
  async handle(message: unknown, reply: Reply): Promise<void> {
    const m = message as { type?: unknown; seq?: unknown; text?: unknown; kind?: unknown; task?: unknown; command?: unknown } | null;
    if (!m || typeof m !== "object") return;
    const kindOf = (v: unknown) => (typeof v === "string" && (KINDS as readonly string[]).includes(v) ? v as ExchangeKind : undefined);
    const text = (v: unknown) => (typeof v === "string" && v.length <= MAX_EXCHANGE_BYTES ? v : undefined);
    try {
      switch (m.type) {
        case "ready":
          this.loaded = true;
          await reply({ type: "state", state: await this.state() });
          if (this.pendingFocus) { await reply({ type: "focus", kind: this.pendingFocus.kind }); this.pendingFocus = undefined; }
          if (this.pendingPrefill) { await reply(this.pendingPrefill); this.pendingPrefill = undefined; }
          return;
        case "check": {
          const raw = text(m.text);
          const review = raw === undefined ? { ok: false, error: "The pasted text is larger than 2 MiB." } : await reviewAnswer(this.session, raw);
          await reply({ type: "checked", seq: m.seq, review });
          return;
        }
        case "copy": {
          const kind = kindOf(m.kind);
          if (!kind) return;
          const task = typeof m.task === "string" && AI_TASKS[kind].some(t => t.id === m.task) ? m.task : AI_TASKS[kind][0]!.id;
          const path = await copyForAi(this.session, String(this.context.extension.packageJSON.version ?? "unknown"), kind, task, true);
          await reply({ type: "copied", path, at: new Date().toISOString() });
          return;
        }
        case "paste": {
          const raw = await clipboard.readText();
          if (!raw.trim()) throw new UserFacingError("The clipboard is empty.");
          if (new TextEncoder().encode(raw).byteLength > MAX_EXCHANGE_BYTES) throw new UserFacingError("The clipboard holds more than 2 MiB.");
          await reply({ type: "pasted", text: raw });
          return;
        }
        case "fromFile": {
          const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { "JSON or Markdown": ["json", "md", "txt"] }, title: "The AI's answer" });
          if (!picked?.[0]) return;
          await reply({ type: "pasted", text: new TextDecoder().decode(await readBounded(picked[0], MAX_EXCHANGE_BYTES)) });
          return;
        }
        case "write": {
          const raw = text(m.text);
          if (raw === undefined) throw new UserFacingError("The pasted text is larger than 2 MiB.");
          const written = await importAnswer(this.session, raw);
          await reply({ type: "written", path: written?.path, backup: written?.backup });
          return;
        }
        case "open": {
          const kind = kindOf(m.kind);
          if (kind) await openExchangeFile(this.session, kind);
          return;
        }
        case "command": {
          if (typeof m.command === "string" && ALLOWED.has(m.command)) await vscode.commands.executeCommand(m.command);
          return;
        }
        // 0.20: the Agent tab.
        case "wo.preview": {
          if (!this.work) return;
          const mm = m as { draft?: unknown; token?: unknown };
          await this.work.flows.preview(this.draftFrom(mm.draft, mm.token));
          return;
        }
        case "wo.write": {
          if (!this.work) return;
          const mm = m as { draft?: unknown; token?: unknown; launch?: unknown };
          const written = await this.work.flows.write(this.draftFrom(mm.draft, mm.token));
          this.hidden = undefined;
          await reply({ type: "wo.done", id: written.id, launched: false });
          if (mm.launch === true) {
            await this.work.flows.launch(written.id);
            const launched = (this.work.service.get(written.id)?.state?.launches.length ?? 0) > 0;
            await reply({ type: "wo.done", id: written.id, launched });
          }
          return;
        }
        case "wo.cmd": {
          const mm = m as { command?: unknown; args?: unknown };
          if (typeof mm.command !== "string" || !AGENT_ALLOWED.has(mm.command)) return;
          const args = Array.isArray(mm.args) ? mm.args.slice(0, 3).filter(a => (typeof a === "string" && a.length <= 100) || (typeof a === "number" && Number.isFinite(a))) : [];
          await vscode.commands.executeCommand(mm.command, ...args);
          return;
        }
      }
    } catch (error) {
      const msg = errorMessage(error);
      if (m.type === "write") await reply({ type: "written", error: msg });
      else if (m.type === "copy") await reply({ type: "copied", error: msg });
      else if (m.type === "wo.write" || m.type === "wo.preview") await reply({ type: "wo.done", error: msg });
      else void vscode.window.showErrorMessage(`DataPass: ${msg}`);
    }
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
