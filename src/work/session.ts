/**
 * Per-window work session. Holds the loaded project context, cached tool probes and the
 * user's local, non-committed state (selected scope, checklist notes, review confirmations,
 * exchange history, approvals). Nothing here is written to the repository.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { executablePath } from "../core/exec";
import { loadProjectContext, projectFacts, writeLocal, LOCAL_DIR, type ProjectContext } from "../core/workspace/loader";
import { factNotes, type FactObservation } from "../core/workspace/facts";
import { observeFileFacts } from "./observe";
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
import { upsertQualification, type QualificationRecord } from "../core/qualification/qualification";
import { classifyAsset, HEAD_BYTES, INVENTORY_EXCLUDE, parseStatusV2, type Asset, type RepoStatus } from "../core/inventory/inventory";
import { detectProjectRoot, setProjectRoot } from "../core/workspace/root";
import { observeProject, type ProjectObservation } from "./projectObserver";
import { buildProjectMap, type ProjectMap } from "../core/project/projectMap";
import { INCOMING_LOG_ARGS, parseIncomingLog, parseNameStatus, type IncomingCommit } from "../core/project/gitSync";
import { buildReadiness, type EnvFileObservation, type Readiness } from "../core/readiness/readiness";
import { LATEST_MANIFEST_VERSION } from "../core/projectManifestModel";
import { observeLocalEnv } from "./envObserver";

/** V3 selection shared by the Project tree, the Workbench, the diagram and the detail view. */
export interface Selection { subproject?: string; component?: string }

/** Machine-local repository locations chosen with "Locate clone" (git-ignored, never shared). */
export const LOCAL_REPOSITORIES_FILE = "repositories.json";

/** Inventory scans are cached this long unless the user refreshes the Work view. */
const INVENTORY_TTL_MS = 60_000;
const MAX_PY_FILES = 3000;
const QUALIFICATION_KEY = "datapass.qualification.v1";
const RECENT_KEY = "datapass.v3.recentProjects";
import {
  MAX_MONGOKU_CONTEXT_BYTES, mongokuEntityFor, parseMongokuContext, resolveCompanions,
  type MongokuStatus, type ResolvedCompanions
} from "../core/companions/companions";

const KEYS = {
  root: "datapass.v3.root",
  selection: "datapass.v3.selection",
  scope: "datapass.v22.scope",
  checklist: "datapass.v22.checklist",
  exchanges: "datapass.v22.exchanges",
  apps: "datapass.v22.appObservations",
  approvals: "datapass.v22.approvals",
  impact: "datapass.v22.impact"
} as const;
const MAX_EXCHANGES = 200;

/**
 * Git by absolute path (never a `git.exe` found in the folder being inspected, see core/exec.ts),
 * with the repository's fsmonitor hook disabled, and never prompting for credentials.
 */
export const gitRunner: GitRunner = (args, cwd, timeoutMs) =>
  new Promise(resolve => {
    const git = executablePath("git");
    if (!git) { resolve({ ok: false, stdout: "", stderr: "git was not found on PATH" }); return; }
    execFile(git, ["-c", "core.fsmonitor=false", ...args], {
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
  /** File-backed facts as observed on disk (a declared path counts only once it was seen). */
  private factObs: Map<string, FactObservation> = new Map();
  /** Review confirmations are session-only: a new window asks again. */
  private readonly reviews = new Set<string>();
  /** Companion URLs the user confirmed in this window; a changed URL is a new URL and asks again. */
  private readonly confirmedLinks = new Set<string>();
  /** The selected scope's imported Mongoku context (read on refresh, scope change and import). */
  private mongokuSnapshot?: { scopeId: string; status: MongokuStatus };
  private inv?: { at: number; root?: string; assets: Asset[]; truncated: boolean; repos: RepoStatus[] };
  private cached?: WorkModel;
  /** V3: repositories and component files as observed on this machine. */
  private projectObs?: ProjectObservation;
  private mapCache?: ProjectMap;
  /** Env files as observed (names' presence only, never values). */
  private envObs: Map<string, EnvFileObservation> = new Map();
  private readinessCache?: Readiness;
  private rootCandidates: vscode.Uri[] = [];
  private readonly selectionEmitter = new vscode.EventEmitter<Selection>();
  /** Fires when the selection changes (tree, diagram, workbench); views follow it. */
  readonly onDidChangeSelection = this.selectionEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose(): void { this.emitter.dispose(); this.selectionEmitter.dispose(); }

  get project(): ProjectContext { return this.ctx; }
  get extensionUri(): vscode.Uri { return this.context.extensionUri; }
  get root(): vscode.Uri | undefined { return this.ctx.root; }

  async refresh(forceProbe = false): Promise<void> {
    if (forceProbe) invalidateToolProbes();
    // F02: the project is the folder holding .datapass/project.json (or the one chosen), not simply the first folder.
    const { root, candidates } = await detectProjectRoot(this.context.workspaceState.get<string>(KEYS.root));
    setProjectRoot(root);
    this.rootCandidates = candidates;
    const [ctx, tools] = await Promise.all([loadProjectContext(this.context.extensionUri), probeTools(forceProbe)]);
    this.ctx = ctx;
    this.tools = tools;
    this.factObs = await observeFileFacts(ctx.root, ctx.manifest);
    this.projectObs = ctx.root ? await observeProject({
      root: ctx.root, manifest: ctx.manifest, graph: ctx.graph, trusted: vscode.workspace.isTrusted, git: gitRunner,
      localBindings: await this.localBindings(), cloneParents: cloneParents()
    }) : undefined;
    this.envObs = ctx.root ? await observeLocalEnv({
      root: ctx.root, manifest: ctx.manifest, coordinationKey: this.projectObs?.coordinationKey ?? ".", folders: this.projectObs?.folders ?? new Map(),
      trusted: vscode.workspace.isTrusted, git: gitRunner
    }) : new Map();
    this.cached = undefined;
    await this.rememberProject();
    await this.loadMongokuSnapshot();
    if (forceProbe || !this.inv || Date.now() - this.inv.at > INVENTORY_TTL_MS || this.inv.root !== ctx.root?.toString()) await this.scanInventory();
    this.changed();
  }

  // ------------------------------------------------------------ qualification (per user, all projects)

  qualification(): QualificationRecord[] { return this.context.globalState.get<QualificationRecord[]>(QUALIFICATION_KEY) ?? []; }

  async recordQualification(r: QualificationRecord): Promise<void> {
    await this.context.globalState.update(QUALIFICATION_KEY, upsertQualification(this.qualification(), r));
    this.changed();
  }

  async clearQualification(): Promise<void> {
    await this.context.globalState.update(QUALIFICATION_KEY, undefined);
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
      vscode.workspace.findFiles("**/{*.ipynb,*.pbip,databricks.yml,databricks.yaml,bundle.yml,bundle.yaml,host.json,main.tf,*.bicep}", INVENTORY_EXCLUDE, 2000),
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
      // Restricted Mode: Git can run repository-configured programs (fsmonitor, hooks), so it is not run at all.
      if (!vscode.workspace.isTrusted) return { key: t.key, label: t.label, state: "restricted", remote: t.remote };
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
      facts: projectFacts(this.ctx, this.factObs),
      factNotes: factNotes(this.ctx.manifest, this.factObs),
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
    return { tools: this.tools, facts: projectFacts(this.ctx, this.factObs), factNotes: factNotes(this.ctx.manifest, this.factObs), reviewsConfirmed: this.reviews };
  }

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
    await this.setChecklistByKey(checklistKey(scopeId, itemId), state, note);
  }

  /** Scope items use `scope/item`; component items use `component:<id>/<item>` (V3). */
  async setChecklistByKey(key: string, state: ChecklistState, note?: string): Promise<void> {
    const all = { ...(this.state<Record<string, ChecklistRecord>>(KEYS.checklist) ?? {}) };
    all[key] = { state, note: note?.slice(0, 500) || undefined, at: new Date().toISOString() };
    await this.context.workspaceState.update(KEYS.checklist, all);
    this.changed();
  }

  /** Projects opened on this machine (for "Switch project"); titles and folders only. */
  recentProjects(): Array<{ id: string; title: string; folder: string; at: string }> {
    return this.context.globalState.get<Array<{ id: string; title: string; folder: string; at: string }>>(RECENT_KEY) ?? [];
  }

  private async rememberProject(): Promise<void> {
    const m = this.ctx.manifest, root = this.ctx.root;
    if (!m || !root || root.scheme !== "file") return;
    const entry = { id: m.project.id, title: m.project.title, folder: root.fsPath, at: new Date().toISOString() };
    const recent = this.recentProjects();
    // Write only when this project is new or renamed: global state is shared with other writers (results).
    const top = recent[0];
    if (top && top.id === entry.id && top.title === entry.title && path.resolve(top.folder) === path.resolve(entry.folder)) return;
    const rest = recent.filter(p => path.resolve(p.folder) !== path.resolve(entry.folder));
    await this.context.globalState.update(RECENT_KEY, [entry, ...rest].slice(0, 30));
  }

  /** `key` comes from PreflightResult.reviewKeys: it binds the confirmation to one target digest. */
  confirmReview(key: string): void {
    this.reviews.add(key);
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
      const rev = await readRepoRevision(vscode.workspace.isTrusted ? gitRunner : async () => ({ ok: false, stdout: "" }), fsPath);
      // "+partial": some uncommitted bytes could not be fingerprinted, so this base never matches another capture.
      const suffix = `${rev.dirty ? "+dirty" : ""}${rev.coverage === "partial" ? "+partial" : ""}`;
      repositories.push({ repoRef: ref, revision: `${rev.revision}${suffix}`, workingTreeHash: rev.workingTreeHash });
    };
    if (this.ctx.root) await add("workspace", this.ctx.root.fsPath);
    for (const [key, repo] of Object.entries(m?.repositories ?? {})) {
      if (!repo.path || !this.ctx.root) continue;
      const abs = path.isAbsolute(repo.path) ? repo.path : path.join(this.ctx.root.fsPath, repo.path);
      if (path.resolve(abs) === path.resolve(this.ctx.root.fsPath)) continue;
      await add(key, abs);
    }
    // V3: clones found by identity or located by the person are part of the base too.
    for (const [key, folder] of this.projectObs?.folders ?? []) {
      if (this.ctx.root && path.resolve(folder.fsPath) === path.resolve(this.ctx.root.fsPath)) continue;
      await add(key, folder.fsPath);
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
    this.mapCache = undefined;
    this.readinessCache = undefined;
    this.emitter.fire();
  }

  // ------------------------------------------------------------ V3 project map, selection, repositories

  /** Folders of this window holding a project manifest (more than one: the person chooses). */
  projectRootCandidates(): readonly vscode.Uri[] { return this.rootCandidates; }

  async chooseProjectRoot(uri: vscode.Uri): Promise<void> {
    await this.context.workspaceState.update(KEYS.root, uri.toString());
    await this.context.workspaceState.update(KEYS.selection, undefined);
    await this.refresh();
  }

  /** The V3 project map: repositories, sub-projects, components, files, operations. */
  projectMap(): ProjectMap {
    if (this.mapCache) return this.mapCache;
    const obs = this.projectObs;
    this.mapCache = buildProjectMap({
      manifest: this.ctx.manifest, graph: this.ctx.graph, coordinationKey: obs?.coordinationKey ?? ".",
      repoObservations: obs?.repos ?? new Map(), fileObservations: obs?.files ?? new Map(),
      tools: this.tools, facts: projectFacts(this.ctx, this.factObs), factNotes: factNotes(this.ctx.manifest, this.factObs),
      reviewsConfirmed: this.reviews, checklist: this.state<Record<string, ChecklistRecord>>(KEYS.checklist) ?? {},
      qualification: this.qualification()
    });
    return this.mapCache;
  }

  observedAt(): string | undefined { return this.projectObs?.observedAt; }

  /**
   * Env files, variable names, non-secret identifiers, optional companions and deterministic
   * checks. Holds names and states only: safe for the tree, the Workbench, snapshots and AI context.
   */
  readiness(): Readiness {
    if (this.readinessCache) return this.readinessCache;
    const map = this.projectMap();
    const config = vscode.workspace.getConfiguration("datapass");
    this.readinessCache = buildReadiness({
      manifest: this.ctx.manifest, coordinationKey: map.coordinationKey, envFiles: this.envObs, repositories: map.repositories, problems: map.problems,
      settings: { mongokuUrl: config.get<string>("mongoku.url") ?? "", diagramCloudUrl: config.get<string>("diagramCloud.url") ?? "" },
      diagramCloudSidecar: Boolean(this.ctx.diagramCloudSidecar), latestSchemaVersion: LATEST_MANIFEST_VERSION
    });
    return this.readinessCache;
  }

  /** Folder of the repository an env file belongs to (session-private). */
  envFolder(repoRef: string | undefined): vscode.Uri | undefined {
    const root = this.ctx.root;
    if (!root) return undefined;
    if (!repoRef || repoRef === (this.projectObs?.coordinationKey ?? ".")) return root;
    return this.projectObs?.folders.get(repoRef);
  }

  /** Local folder of a repository (session-private: never exported to AI context or files). */
  repoFolder(key: string): vscode.Uri | undefined { return this.projectObs?.folders.get(key); }

  selection(): Selection {
    const sel = this.state<Selection>(KEYS.selection) ?? {};
    const map = this.projectMap();
    const component = sel.component && map.components.some(c => c.id === sel.component) ? sel.component : undefined;
    const subproject = sel.subproject && map.subprojects.some(s => s.id === sel.subproject) ? sel.subproject
      : component ? map.components.find(c => c.id === component)?.subprojects[0] ?? map.subprojects.find(s => s.componentIds.includes(component))?.id
      : undefined;
    return { subproject, component };
  }

  /** Select a sub-project and/or a component. A declared sub-project is also the Work view's scope. */
  async select(sel: Selection): Promise<void> {
    const map = this.projectMap();
    const subproject = sel.subproject ?? (sel.component ? map.components.find(c => c.id === sel.component)?.subprojects[0] ?? map.subprojects.find(s => s.componentIds.includes(sel.component!))?.id : undefined);
    const next: Selection = { subproject, component: sel.component };
    await this.context.workspaceState.update(KEYS.selection, next);
    if (subproject && (this.ctx.manifest?.scopes ?? []).some(s => s.id === subproject) && this.model().scope.id !== subproject) {
      await this.selectScope(subproject);
    }
    this.selectionEmitter.fire(next);
  }

  private async localBindings(): Promise<Record<string, string>> {
    const root = this.ctx.root ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return {};
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), LOCAL_REPOSITORIES_FILE));
      const doc = parseStrictJson(bytes, { maxBytes: 64 * 1024 }) as Record<string, unknown>;
      const map = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc.repositories as Record<string, unknown> | undefined) : undefined;
      return Object.fromEntries(Object.entries(map ?? {}).filter((e): e is [string, string] => typeof e[1] === "string" && path.isAbsolute(e[1])));
    } catch { return {}; }
  }

  /** Remember where a repository is cloned on this machine (.datapass/local, git-ignored). */
  async setLocalBinding(key: string, folder: string | undefined): Promise<void> {
    const root = this.ctx.root;
    if (!root) return;
    const current = await this.localBindings();
    if (folder) current[key] = folder; else delete current[key];
    await writeLocal(root, LOCAL_REPOSITORIES_FILE, new TextEncoder().encode(JSON.stringify({ format: "datapass.local-repositories", note: "Machine-local clone locations. Never committed.", repositories: current }, null, 2) + "\n"));
    await this.refresh();
  }

  /** `git fetch` one repository: contacts its remote, changes no local branch or file. */
  async fetchRepository(key: string): Promise<{ ok: boolean; detail?: string }> {
    const folder = this.repoFolder(key);
    if (!folder) return { ok: false, detail: "not cloned here" };
    if (!vscode.workspace.isTrusted) return { ok: false, detail: "Restricted Mode: trust the workspace first" };
    const r = await gitRunner(["fetch", "--prune", "origin"], folder.fsPath, 120000);
    return r.ok ? { ok: true } : { ok: false, detail: (r.stderr ?? "").split(/\r?\n/).find(l => l.trim())?.slice(0, 200) ?? "fetch failed" };
  }

  /** Commits on the upstream that this clone does not have yet (after a fetch). */
  async incomingCommits(key: string): Promise<IncomingCommit[]> {
    const folder = this.repoFolder(key);
    if (!folder || !vscode.workspace.isTrusted) return [];
    const r = await gitRunner(INCOMING_LOG_ARGS, folder.fsPath, 15000);
    return r.ok ? parseIncomingLog(r.stdout) : [];
  }

  /**
   * Fast-forward only to the fetched upstream. Refuses anything that is not a clean fast-forward;
   * never pushes, stashes, rebases or merges. Returns the paths that changed.
   */
  async fastForward(key: string): Promise<{ ok: boolean; changed: string[]; detail?: string }> {
    const folder = this.repoFolder(key);
    if (!folder) return { ok: false, changed: [], detail: "not cloned here" };
    if (!vscode.workspace.isTrusted) return { ok: false, changed: [], detail: "Restricted Mode" };
    const before = await gitRunner(["rev-parse", "HEAD"], folder.fsPath, 5000);
    const r = await gitRunner(["merge", "--ff-only", "@{u}"], folder.fsPath, 60000);
    if (!r.ok) return { ok: false, changed: [], detail: (r.stderr ?? "").split(/\r?\n/).find(l => l.trim())?.slice(0, 300) ?? "fast-forward refused" };
    const diff = before.ok ? await gitRunner(["diff", "--name-status", before.stdout.trim(), "HEAD"], folder.fsPath, 15000) : { ok: false, stdout: "" };
    return { ok: true, changed: diff.ok ? parseNameStatus(diff.stdout) : [] };
  }
}

/** Parent folders where project clones live (user setting), besides the project folder's own parent. */
function cloneParents(): string[] {
  const v = vscode.workspace.getConfiguration("datapass").get<string[]>("projectsFolders") ?? [];
  return Array.isArray(v) ? v.filter(p => typeof p === "string" && path.isAbsolute(p)).slice(0, 10) : [];
}
