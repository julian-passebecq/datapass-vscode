/**
 * Per-window work session. Holds the loaded project context, cached tool probes and the
 * user's local, non-committed state (selected scope, checklist notes, review confirmations,
 * exchange history, approvals). Nothing here is written to the repository.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { loadProjectContext, projectFacts, LOCAL_DIR, type ProjectContext } from "../core/workspace/loader";
import { probeTools, invalidateToolProbes } from "../core/capabilities/probe";
import type { ToolObservation } from "../core/capabilities/tools";
import type { PreflightContext } from "../core/capabilities/preflight";
import { buildWorkModel, checklistKey, type ChecklistRecord, type ChecklistState, type ExchangeRecord, type WorkModel } from "../core/work/workModel";
import type { ImpactEntry } from "../core/impact/facets";
import { readRepoRevision, type GitRunner, type RemoteObservation } from "../core/workspace/gitBase";
import { sha256Bytes, slugId } from "../core/model/ids";
import type { BaseRef } from "../core/contracts/envelopes";
import type { LocalApproval } from "../core/publication/brief";
import { parseStrictJson } from "../core/model/strictJson";
import { classifyAsset, HEAD_BYTES, INVENTORY_EXCLUDE, parseStatusV2, type Asset, type RepoStatus } from "../core/inventory/inventory";

/** Inventory scans are cached this long unless the user refreshes the Work view. */
const INVENTORY_TTL_MS = 60_000;
const MAX_PY_FILES = 3000;
import {
  MAX_MONGOKU_CONTEXT_BYTES, mongokuEntityFor, parseMongokuContext, resolveCompanions,
  type MongokuStatus, type ResolvedCompanions
} from "../core/companions/companions";

const KEYS = {
  scope: "datapass.v22.scope",
  checklist: "datapass.v22.checklist",
  exchanges: "datapass.v22.exchanges",
  apps: "datapass.v22.appObservations",
  approvals: "datapass.v22.approvals",
  impact: "datapass.v22.impact"
} as const;
const MAX_EXCHANGES = 200;

export const gitRunner: GitRunner = (args, cwd, timeoutMs) =>
  new Promise(resolve => {
    execFile("git", args, {
      cwd: cwd || undefined,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      // Never block on a credential prompt; a failed probe is reported as unreachable.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never" }
    }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
  });

export class WorkSession implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private ctx: ProjectContext = { manifestErrors: [], manifestExists: false, packs: [], packErrors: [] };
  private tools: Map<string, ToolObservation> = new Map();
  /** Review confirmations are session-only: a new window asks again. */
  private readonly reviews = new Set<string>();
  /** Companion URLs the user confirmed in this window; a changed URL is a new URL and asks again. */
  private readonly confirmedLinks = new Set<string>();
  /** The selected scope's imported Mongoku context (read on refresh, scope change and import). */
  private mongokuSnapshot?: { scopeId: string; status: MongokuStatus };
  private inv?: { at: number; root?: string; assets: Asset[]; truncated: boolean; repos: RepoStatus[] };
  private cached?: WorkModel;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose(): void { this.emitter.dispose(); }

  get project(): ProjectContext { return this.ctx; }
  get extensionUri(): vscode.Uri { return this.context.extensionUri; }
  get root(): vscode.Uri | undefined { return this.ctx.root; }

  async refresh(forceProbe = false): Promise<void> {
    if (forceProbe) invalidateToolProbes();
    const [ctx, tools] = await Promise.all([loadProjectContext(this.context.extensionUri), probeTools(forceProbe)]);
    this.ctx = ctx;
    this.tools = tools;
    this.cached = undefined;
    await this.loadMongokuSnapshot();
    if (forceProbe || !this.inv || Date.now() - this.inv.at > INVENTORY_TTL_MS || this.inv.root !== ctx.root?.toString()) await this.scanInventory();
    this.changed();
  }

  /** Static assets found in the workspace (never executed) and whether the scan hit its cap. */
  inventory(): { assets: Asset[]; truncated: boolean } { return { assets: this.inv?.assets ?? [], truncated: this.inv?.truncated ?? false }; }
  /** Local Git state of the workspace and declared repositories; remote ones are never contacted. */
  repositories(): RepoStatus[] { return this.inv?.repos ?? []; }

  private async scanInventory(): Promise<void> {
    const root = this.ctx.root;
    if (!root) { this.inv = { at: Date.now(), assets: [], truncated: false, repos: [] }; return; }
    const [named, py, platform, pipelines] = await Promise.all([
      vscode.workspace.findFiles("**/{*.ipynb,*.pbip,databricks.yml,databricks.yaml,bundle.yml,bundle.yaml}", INVENTORY_EXCLUDE, 2000),
      vscode.workspace.findFiles("**/*.py", INVENTORY_EXCLUDE, MAX_PY_FILES),
      vscode.workspace.findFiles("**/.platform", INVENTORY_EXCLUDE, 1000),
      vscode.workspace.findFiles("**/pipeline/*.json", INVENTORY_EXCLUDE, 500)
    ]);
    // Windows drive letters can differ in case between the workspace URI and search results.
    const norm = (p: string) => process.platform === "win32" ? p.replace(/^\/([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}:`) : p;
    const rootPath = norm(root.path).replace(/\/+$/, "");
    const rel = (uri: vscode.Uri) => { const p = norm(uri.path); return p.startsWith(`${rootPath}/`) ? p.slice(rootPath.length + 1) : `../${p}`; };
    const needsHead = (p: string) => !/\.(ipynb|pbip)$/i.test(p);
    const head = async (uri: vscode.Uri): Promise<string | undefined> => {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.SymbolicLink || stat.size > 4 * 1024 * 1024) return undefined;
        return new TextDecoder("utf-8", { fatal: false }).decode((await vscode.workspace.fs.readFile(uri)).subarray(0, HEAD_BYTES));
      } catch { return undefined; }
    };
    const uris = [...named, ...py, ...platform, ...pipelines].filter(u => !rel(u).startsWith(".."));
    const assets: Asset[] = [];
    for (let i = 0; i < uris.length; i += 50) {
      const batch = await Promise.all(uris.slice(i, i + 50).map(async uri => {
        const p = rel(uri);
        return classifyAsset(p, needsHead(p) ? await head(uri) : undefined);
      }));
      for (const a of batch) if (a) assets.push(a);
    }
    assets.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
    this.inv = { at: Date.now(), root: root.toString(), assets, truncated: py.length >= MAX_PY_FILES, repos: await this.readRepositories(root) };
  }

  private async readRepositories(root: vscode.Uri): Promise<RepoStatus[]> {
    const m = this.ctx.manifest;
    const targets: Array<{ key: string; label: string; fsPath?: string; remote?: string }> = [{ key: "workspace", label: "This folder", fsPath: root.fsPath }];
    for (const [key, repo] of Object.entries(m?.repositories ?? {}).slice(0, 30)) {
      const remote = repo.remote?.url.replace(/^https:\/\//, "").replace(/\.git$/, "");
      if (!repo.path) { targets.push({ key, label: repo.label ?? key, remote }); continue; }
      const abs = path.isAbsolute(repo.path) ? repo.path : path.join(root.fsPath, repo.path);
      if (path.resolve(abs) === path.resolve(root.fsPath)) continue;
      targets.push({ key, label: repo.label ?? key, fsPath: abs, remote });
    }
    return Promise.all(targets.map(async (t): Promise<RepoStatus> => {
      if (!t.fsPath) return { key: t.key, label: t.label, state: "remote-only", remote: t.remote };
      try { await vscode.workspace.fs.stat(vscode.Uri.file(t.fsPath)); } catch { return { key: t.key, label: t.label, state: "missing", remote: t.remote }; }
      const r = await gitRunner(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], t.fsPath, 10000);
      return r.ok ? { key: t.key, label: t.label, state: "ok", remote: t.remote, ...parseStatusV2(r.stdout) } : { key: t.key, label: t.label, state: "not-a-repo", remote: t.remote };
    }));
  }

  model(): WorkModel {
    if (this.cached) return this.cached;
    this.cached = buildWorkModel({
      manifest: this.ctx.manifest,
      graph: this.ctx.graph,
      packs: this.ctx.packs,
      tools: this.tools,
      facts: projectFacts(this.ctx),
      reviewsConfirmed: this.reviews,
      selectedScopeId: this.state<string>(KEYS.scope),
      checklist: this.state<Record<string, ChecklistRecord>>(KEYS.checklist) ?? {},
      impact: this.state<ImpactEntry[]>(KEYS.impact),
      appObservations: this.state<Record<string, RemoteObservation>>(KEYS.apps) ?? {},
      exchanges: this.state<ExchangeRecord[]>(KEYS.exchanges) ?? []
    });
    return this.cached;
  }

  toolObservations(): ReadonlyMap<string, ToolObservation> { return this.tools; }

  /** The context every preflight in this window uses (Work view, preflight command, Galaxy cards). */
  preflightContext(): PreflightContext {
    return { tools: this.tools, facts: projectFacts(this.ctx), reviewsConfirmed: this.reviews };
  }
  reviewConfirmed(key: string): boolean { return this.reviews.has(key); }

  async selectScope(id: string): Promise<void> {
    await this.context.workspaceState.update(KEYS.scope, id);
    await this.context.workspaceState.update(KEYS.impact, undefined);
    this.cached = undefined;
    await this.loadMongokuSnapshot();
    this.changed();
  }

  // ------------------------------------------------------------ companions (Grafana, Mongoku)

  /** Links for the selected scope. The Mongoku address is a user setting shared by all projects. */
  companions(): ResolvedCompanions {
    const mongokuUrl = vscode.workspace.getConfiguration("datapass").get<string>("mongoku.url") ?? "";
    return resolveCompanions({ manifest: this.ctx.manifest, scopeId: this.model().scope.id, mongokuUrl });
  }

  /** The imported Mongoku context for the selected scope; undefined when the scope maps to no entity. */
  mongokuStatus(): MongokuStatus | undefined {
    const scopeId = this.model().scope.id;
    const snap = this.mongokuSnapshot;
    return snap?.scopeId === scopeId && mongokuEntityFor(this.ctx.manifest, scopeId)?.entityId === snap.status.entityId ? snap.status : undefined;
  }

  linkConfirmed(url: string): boolean { return this.confirmedLinks.has(url); }
  confirmLink(url: string): void { this.confirmedLinks.add(url); }

  /** Re-read after an import; the file itself is written by the import command. */
  async reloadMongokuSnapshot(): Promise<void> {
    await this.loadMongokuSnapshot();
    this.changed();
  }

  private async loadMongokuSnapshot(): Promise<void> {
    this.mongokuSnapshot = undefined;
    const root = this.ctx.root;
    const scopeId = this.model().scope.id;
    const entity = mongokuEntityFor(this.ctx.manifest, scopeId);
    if (!root || !entity) return;
    const status = (s: MongokuStatus) => { this.mongokuSnapshot = { scopeId, status: s }; };
    const uri = vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), "mongoku", `${scopeId}.json`);
    let stat: vscode.FileStat;
    try { stat = await vscode.workspace.fs.stat(uri); } catch { return status({ entityId: entity.entityId, state: "missing" }); }
    // Private local data: refuse links (a checked-out symlink could point anywhere) and oversize files.
    if (stat.type & vscode.FileType.SymbolicLink) return status({ entityId: entity.entityId, state: "invalid", reason: "the stored snapshot is a symbolic link" });
    if (stat.size > MAX_MONGOKU_CONTEXT_BYTES) return status({ entityId: entity.entityId, state: "invalid", reason: "the stored snapshot is larger than 256 KiB" });
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const value = parseStrictJson(bytes, { maxBytes: MAX_MONGOKU_CONTEXT_BYTES, maxDepth: 8, maxEntries: 5000, maxStringLength: 4000 });
      status({ entityId: entity.entityId, state: "ok", context: parseMongokuContext(value, entity.entityId, Date.now()) });
    } catch (error) {
      status({ entityId: entity.entityId, state: "invalid", reason: error instanceof Error ? error.message : String(error) });
    }
  }

  async setChecklist(scopeId: string, itemId: string, state: ChecklistState, note?: string): Promise<void> {
    const all = { ...(this.state<Record<string, ChecklistRecord>>(KEYS.checklist) ?? {}) };
    all[checklistKey(scopeId, itemId)] = { state, note: note?.slice(0, 500) || undefined, at: new Date().toISOString() };
    await this.context.workspaceState.update(KEYS.checklist, all);
    this.changed();
  }

  confirmReview(capabilityId: string, reviewId: string): void {
    this.reviews.add(`${capabilityId}:${reviewId}`);
    this.changed();
  }

  async recordExchange(record: ExchangeRecord): Promise<void> {
    const list = [record, ...(this.state<ExchangeRecord[]>(KEYS.exchanges) ?? []).filter(e => e.id !== record.id)].slice(0, MAX_EXCHANGES);
    await this.context.workspaceState.update(KEYS.exchanges, list);
    this.changed();
  }

  exchanges(): ExchangeRecord[] { return this.state<ExchangeRecord[]>(KEYS.exchanges) ?? []; }

  async setImpact(entries: ImpactEntry[] | undefined): Promise<void> {
    await this.context.workspaceState.update(KEYS.impact, entries);
    this.changed();
  }

  async recordAppObservation(appId: string, obs: RemoteObservation): Promise<void> {
    const all = { ...(this.state<Record<string, RemoteObservation>>(KEYS.apps) ?? {}), [appId]: obs };
    await this.context.workspaceState.update(KEYS.apps, all);
    this.changed();
  }

  approvals(): LocalApproval[] { return this.state<LocalApproval[]>(KEYS.approvals) ?? []; }

  async addApproval(a: LocalApproval): Promise<void> {
    await this.context.workspaceState.update(KEYS.approvals, [a, ...this.approvals()].slice(0, 200));
    this.changed();
  }

  /**
   * Bind an exchange to the exact state it was prepared from: the manifest bytes, the scope
   * definition and the HEAD + uncommitted-change fingerprint of each local repository.
   */
  async captureBase(): Promise<BaseRef> {
    const m = this.ctx.manifest;
    const scope = this.model().scope;
    const scopeHash = sha256Bytes(JSON.stringify(scope)).value.slice(0, 16);
    const repositories: BaseRef["repositories"] = [];
    const seen = new Set<string>();
    const add = async (repoRef: string, fsPath: string) => {
      const ref = slugId(repoRef, "repo");
      if (seen.has(ref) || repositories.length >= 30) return;
      seen.add(ref);
      const rev = await readRepoRevision(gitRunner, fsPath);
      repositories.push({ repoRef: ref, revision: rev.dirty ? `${rev.revision}+dirty` : rev.revision, workingTreeHash: rev.workingTreeHash });
    };
    if (this.ctx.root) await add("workspace", this.ctx.root.fsPath);
    for (const [key, repo] of Object.entries(m?.repositories ?? {})) {
      if (!repo.path || !this.ctx.root) continue;
      const abs = path.isAbsolute(repo.path) ? repo.path : path.join(this.ctx.root.fsPath, repo.path);
      if (path.resolve(abs) === path.resolve(this.ctx.root.fsPath)) continue;
      await add(key, abs);
    }
    return {
      scopeRevision: `${scope.id}@${scopeHash}`,
      manifestHash: sha256Bytes(this.ctx.manifestBytes ?? new Uint8Array()),
      repositories
    };
  }

  private state<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  private changed(): void {
    this.cached = undefined;
    this.emitter.fire();
  }
}
