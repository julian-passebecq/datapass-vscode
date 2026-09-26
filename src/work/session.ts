/**
 * Per-window work session. Holds the loaded project context, cached tool probes and the
 * user's local, non-committed state (selected scope, checklist notes, review confirmations,
 * exchange history, approvals). Nothing here is written to the repository.
 */
import { environmentOf, variantStamp, type PackStamp } from "../core/exchange/stamp";
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
import { coordinationKeyOf, observeProject, type ProjectObservation } from "./projectObserver";
import { buildProjectMap, type ProjectMap, type ProjectMapInput } from "../core/project/projectMap";
import { incompleteText } from "../core/project/observation";
import { deriveVariants, type VariantsAnalysis } from "../core/project/variants";
import { analyzeOptions, evaluatePicks, optionComponentRepositories, optionsProblems, picksFrom, scenarioPicks, type ArchitectureImpact, type DerivedArchitecture, type OptionsAnalysis } from "../core/project/options";
import { sheetProblems } from "../core/project/sheet";
import { boardProblems, boardView, cardFileLocation, type BoardView } from "../core/project/board";
import { INCOMING_LOG_ARGS, parseIncomingLog, parseNameStatus, type IncomingCommit } from "../core/project/gitSync";
import { buildCatalogue, hubToolchainTools, recipeView, type Catalogue, type RecipeFacts, type RecipeView } from "../core/toolkit/toolkit";
import { loadToolkitFiles } from "./toolkitFiles";
import type { ToolkitFileResult } from "../core/toolkit/toolkit";
import { buildReadiness, readinessForVariant, type EnvFileObservation, type Readiness } from "../core/readiness/readiness";
import { LATEST_MANIFEST_VERSION } from "../core/projectManifestModel";
import { observeLocalEnv } from "./envObserver";
import { observeBindingFolders, observeExtensionsJson } from "./toolchainObserver";
import { defaultConnectionRunner, runConnectionChecks, type ConnectionRunner } from "./connectionChecks";
import { toolsToCheck, type ConnectionProbe } from "../core/toolchain/connections";
import { buildToolchain, toolRangeWarnings } from "../core/toolchain/toolchain";
import type { ExtensionsJsonObservation } from "../core/toolchain/extensionsJson";
import type { DiagramMode, DiagramUi } from "../core/windows/workViews";

/** V3 selection shared by the Project tree, the Workbench, the diagram and the detail view. */
export interface Selection { subproject?: string; component?: string }

/**
 * 0.15: the architecture being previewed on the diagram (session UI state, never written to the
 * project): a scenario ("current", "decided" or a declared one) or a list of "decision=option" picks.
 */
export interface PreviewRequest { scenario?: string; picks?: string[] }
export interface Preview { key: string; title: string; picks: Map<string, string>; impact: ArchitectureImpact; derived: DerivedArchitecture; map: ProjectMap }

/** Machine-local repository locations chosen with "Locate clone" (git-ignored, never shared). */
export const LOCAL_REPOSITORIES_FILE = "repositories.json";

/** Inventory scans are cached this long unless the user refreshes the Work view. */
const INVENTORY_TTL_MS = 60_000;
const MAX_PY_FILES = 3000;
const QUALIFICATION_KEY = "datapass.qualification.v1";
const RECENT_KEY = "datapass.v3.recentProjects";
import { resolveCompanions, type ResolvedCompanions } from "../core/companions/companions";

const KEYS = {
  root: "datapass.v3.root",
  selection: "datapass.v3.selection",
  preview: "datapass.v32.preview",
  diagramUi: "datapass.v17.diagramUi",
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
  /** 0.23: the toolkit files of the hub repositories this window knows. */
  private toolkitFiles: ToolkitFileResult[] = [];
  private catalogueCache?: Catalogue;
  /** File-backed facts as observed on disk (a declared path counts only once it was seen). */
  private factObs: Map<string, FactObservation> = new Map();
  /** Review confirmations are session-only: a new window asks again. */
  private readonly reviews = new Set<string>();
  /** Companion URLs the user confirmed in this window; a changed URL is a new URL and asks again. */
  private readonly confirmedLinks = new Set<string>();
  private inv?: { at: number; root?: string; assets: Asset[]; truncated: boolean; repos: RepoStatus[] };
  private cached?: WorkModel;
  /** V3: repositories and component files as observed on this machine. */
  private projectObs?: ProjectObservation;
  private mapCache?: ProjectMap;
  /** Env files as observed (names' presence only, never values). */
  private envObs: Map<string, EnvFileObservation> = new Map();
  /** v5: .vscode/extensions.json and git-binding folders as observed. */
  private extensionsObs?: ExtensionsJsonObservation;
  private bindingObs: Map<string, "found" | "missing" | "not-cloned"> = new Map();
  /**
   * v5: the last read-only sign-in checks, by tool. Memory only (a new window checks again) and
   * only run when the person asks: `databricks auth profiles` contacts each workspace.
   */
  private connectionProbes: Map<string, ConnectionProbe> = new Map();
  /** Replaceable by the desktop tests (fake CLIs); undefined = the real, read-only runner. */
  connectionRunner?: ConnectionRunner;
  private readinessCache?: Readiness;
  private analysisCache?: OptionsAnalysis;
  private variantsCache?: VariantsAnalysis;
  private previewCache?: Preview;
  private boardCache?: BoardView;
  /** The person accepted, in this window, that moving a card writes its status in board.json. */
  boardMovesConfirmed = false;
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
    this.toolkitFiles = await loadToolkitFiles(ctx.root, this.version);
    this.factObs = await observeFileFacts(ctx.root, ctx.manifest);
    const coordination = ctx.root ? coordinationKeyOf(ctx.manifest, ctx.root) : ".";
    this.projectObs = ctx.root ? await observeProject({
      root: ctx.root, manifest: ctx.manifest, graph: ctx.graph, trusted: vscode.workspace.isTrusted, git: gitRunner,
      localBindings: await this.localBindings(), cloneParents: cloneParents(),
      extraItems: optionComponentRepositories(ctx.options, ctx.manifest, coordination),
      // The files the board's cards name, so a card says whether each one is here.
      extraFiles: (ctx.board?.items ?? []).flatMap(it => it.files ?? []).slice(0, 400)
        .map(f => { const l = cardFileLocation(f, coordination); return l.repoPath ? { repoKey: l.repoKey, repoPath: l.repoPath + (f.path.endsWith("/") ? "/" : "") } : undefined; })
        .filter((f): f is { repoKey: string; repoPath: string } => !!f)
    }) : undefined;
    this.envObs = ctx.root ? await observeLocalEnv({
      root: ctx.root, manifest: ctx.manifest, coordinationKey: this.projectObs?.coordinationKey ?? ".", folders: this.projectObs?.folders ?? new Map(),
      trusted: vscode.workspace.isTrusted, git: gitRunner
    }) : new Map();
    this.extensionsObs = ctx.root && ctx.manifest?.toolchain ? await observeExtensionsJson(ctx.root) : undefined;
    this.bindingObs = ctx.root ? await observeBindingFolders({ root: ctx.root, manifest: ctx.manifest, coordinationKey: this.projectObs?.coordinationKey ?? ".", folders: this.projectObs?.folders ?? new Map() }) : new Map();
    this.cached = undefined;
    await this.rememberProject();
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
      toolRangeWarnings: this.rangeWarnings(),
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
    return {
      tools: this.tools, facts: projectFacts(this.ctx, this.factObs), factNotes: factNotes(this.ctx.manifest, this.factObs), reviewsConfirmed: this.reviews,
      toolRangeWarnings: this.rangeWarnings()
    };
  }

  /** v5: tools present here whose version is outside the project's declared range. */
  private rangeWarnings(): ReadonlyMap<string, string> | undefined {
    const toolchain = this.ctx.manifest?.toolchain;
    return toolchain ? toolRangeWarnings(buildToolchain({ toolchain, tools: this.tools, platform: process.platform })) : undefined;
  }

  /**
   * v5: run the read-only sign-in checks for the declared connections (az account show, databricks
   * auth profiles, fab auth status). Returns the tools checked. Never prompts, never signs in.
   */
  async checkConnections(): Promise<string[]> {
    const tools = toolsToCheck(this.ctx.manifest?.connections);
    if (!tools.length) return [];
    const results = await runConnectionChecks(tools, this.connectionRunner ?? defaultConnectionRunner);
    for (const [tool, probe] of results) this.connectionProbes.set(tool, probe);
    this.changed();
    return tools;
  }

  async selectScope(id: string): Promise<void> {
    await this.context.workspaceState.update(KEYS.scope, id);
    await this.context.workspaceState.update(KEYS.impact, undefined);
    this.cached = undefined;
    this.changed();
  }

  // ------------------------------------------------------------ companions (Grafana)

  /** Links for the selected scope. */
  companions(): ResolvedCompanions {
    return resolveCompanions({ manifest: this.ctx.manifest, scopeId: this.model().scope.id });
  }

  linkConfirmed(url: string): boolean { return this.confirmedLinks.has(url); }
  confirmLink(url: string): void { this.confirmedLinks.add(url); }

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
    // 0.27 (P1, D-23): every AI pack remembers the selection it was built for.
    if (record.kind === "ai-context" && !record.stamp) record = { ...record, stamp: await this.packStamp() };
    const list = [record, ...(this.state<ExchangeRecord[]>(KEYS.exchanges) ?? []).filter(e => e.id !== record.id)].slice(0, MAX_EXCHANGES);
    await this.context.workspaceState.update(KEYS.exchanges, list);
    this.changed();
  }

  /** 0.27 (P1, D-23): the selected variant and environment, and the bridge revision (HEAD of the coordination repository) when Git knows it. */
  selectionStamp(): PackStamp {
    const environment = environmentOf(this.projectMap().environments);
    return { variant: variantStamp(this.ctx.options, this.preview()), ...(environment ? { environment } : {}) };
  }
  async packStamp(): Promise<PackStamp> {
    const stamp = this.selectionStamp();
    const root = this.root?.fsPath;
    if (!root) return stamp;
    const head = await gitRunner(["rev-parse", "--verify", "HEAD"], root, 5000);
    const commit = head.ok ? head.stdout.trim() : "";
    return /^[0-9a-f]{40}$/.test(commit) ? { ...stamp, bridge: commit } : stamp;
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
    this.analysisCache = undefined;
    this.variantsCache = undefined;
    this.previewCache = undefined;
    this.boardCache = undefined;
    this.catalogueCache = undefined;
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

  /** Everything the project map is built from (also the base of every architecture preview). */
  private mapInput(): ProjectMapInput {
    const obs = this.projectObs;
    return {
      manifest: this.ctx.manifest, graph: this.ctx.graph, coordinationKey: obs?.coordinationKey ?? ".",
      repoObservations: obs?.repos ?? new Map(), fileObservations: obs?.files ?? new Map(),
      tools: this.tools, facts: projectFacts(this.ctx, this.factObs), factNotes: factNotes(this.ctx.manifest, this.factObs),
      reviewsConfirmed: this.reviews, checklist: this.state<Record<string, ChecklistRecord>>(KEYS.checklist) ?? {},
      qualification: this.qualification(), toolRangeWarnings: this.rangeWarnings(),
      observationIncomplete: obs?.incomplete ? incompleteText(obs.incomplete) : undefined
    };
  }

  /** The V3 project map: repositories, sub-projects, components, files, operations. */
  projectMap(): ProjectMap {
    if (this.mapCache) return this.mapCache;
    const map = buildProjectMap(this.mapInput());
    // The project's companion files are part of what "Problems in project files" lists.
    const c = this.ctx;
    if (c.optionsError) map.problems.push({ severity: "error", where: "options.json", message: c.optionsError });
    if (c.sheetError) map.problems.push({ severity: "error", where: "sheet.json", message: c.sheetError });
    if (c.options) map.problems.push(...optionsProblems(c.options, c.manifest, c.graph).filter(p => p.severity !== "info"));
    if (c.sheet) map.problems.push(...sheetProblems(c.sheet, c.manifest, c.graph, c.options?.decisions.map(d => d.id) ?? []));
    if (c.boardError) map.problems.push({ severity: "error", where: "board.json", message: c.boardError });
    if (c.board) map.problems.push(...boardProblems(c.board, c.manifest, c.graph, c.options, this.catalogue().hub ? this.catalogue().recipes : undefined));
    this.mapCache = map;
    return this.mapCache;
  }

  // ------------------------------------------------------------ 0.23 toolkit catalogue

  /** This extension's version (what a toolkit file's requires.datapass is compared with). */
  get version(): string { return String(this.context.extension?.packageJSON?.version ?? "0.0.0"); }

  /** The built-in baseline with the hub's toolkit files layered over it. */
  catalogue(): Catalogue {
    this.catalogueCache ??= buildCatalogue(this.toolkitFiles.filter(f => !f.error), this.version);
    return this.catalogueCache;
  }
  toolkitFileResults(): readonly ToolkitFileResult[] { return this.toolkitFiles; }
  /** A recipe as a card or a pack shows it (undefined when the catalogue has no such recipe). */
  recipe(id: string | undefined): RecipeView | undefined {
    const r = id ? this.catalogue().recipes.get(id) : undefined;
    return r ? recipeView(r, this.catalogue(), this.recipeFacts()) : undefined;
  }

  /** What a recipe route's condition can be checked against: project facts and this computer's probes. */
  recipeFacts(): RecipeFacts {
    const facts = new Map<string, boolean>();
    const m = this.ctx.manifest;
    if (m && m.schemaVersion >= 5) facts.set("fabric.gitBinding", (m.connections ?? []).some(c => c.kind === "git-binding" && c.provider === "fabric"));
    const coord = this.projectMap().repositories.find(r => r.coordination);
    if (coord && coord.state !== "restricted") facts.set("git.repository", coord.state === "local");
    const tools = new Map<string, "present" | "absent">();
    for (const [id, o] of this.tools) if (o.state === "present" || o.state === "absent") tools.set(id, o.state);
    return { facts, tools };
  }

  // ------------------------------------------------------------ 0.16 board

  /** The board as the kanban and the Project tree show it (undefined without a valid board.json). */
  boardView(): BoardView | undefined {
    const board = this.ctx.board;
    if (!board) return undefined;
    if (!this.boardCache) this.boardCache = boardView(board, { map: this.projectMap(), files: this.projectObs?.files ?? new Map(), options: this.ctx.options, today: localDate() });
    return this.boardCache;
  }

  // ------------------------------------------------------------ 0.15 architecture options

  /** Consequences of every option and scenario of .datapass/options.json (undefined without a valid file). */
  optionsAnalysis(): OptionsAnalysis | undefined {
    const options = this.ctx.options;
    if (!options) return undefined;
    if (!this.analysisCache) this.analysisCache = analyzeOptions({ base: this.mapInput(), options, baseMap: this.projectMap() });
    return this.analysisCache;
  }

  /** 0.23: coding state of every option and scenario, and the files each variant needs (undefined without options). */
  variants(): VariantsAnalysis | undefined {
    const options = this.ctx.options;
    if (!options) return undefined;
    if (!this.variantsCache) {
      const input = this.mapInput();
      this.variantsCache = deriveVariants({ options, manifest: input.manifest, graph: input.graph, coordinationKey: input.coordinationKey, repositories: this.projectMap().repositories, fileObservations: input.fileObservations });
    }
    return this.variantsCache;
  }

  /** The architecture previewed on the diagram, when one is selected and still valid. */
  preview(): Preview | undefined {
    const options = this.ctx.options;
    const req = this.state<PreviewRequest>(KEYS.preview);
    if (!options || !req) return undefined;
    let picks: Map<string, string> | undefined, key: string, title: string;
    if (req.scenario) {
      picks = scenarioPicks(options, req.scenario);
      key = `scenario:${req.scenario}`;
      title = req.scenario === "current" ? "Current architecture" : req.scenario === "decided" ? "Decided (to apply)" : options.scenarios?.find(s => s.id === req.scenario)?.title ?? req.scenario;
    } else {
      picks = picksFrom(options, (req.picks ?? []).slice(0, 50));
      key = `picks:${[...picks].map(([d, o]) => `${d}=${o}`).join(",")}`;
      const changed = options.decisions.filter(d => picks!.get(d.id) !== d.current).map(d => d.options.find(o => o.id === picks!.get(d.id))?.label ?? picks!.get(d.id));
      title = changed.length ? `Custom: ${changed.join(" + ")}` : "Current architecture";
    }
    if (!picks) return undefined;
    if (this.previewCache?.key !== key) {
      const r = evaluatePicks({ base: this.mapInput(), options, baseMap: this.projectMap() }, picks, key);
      this.previewCache = { key, title, picks, ...r };
    }
    return this.previewCache;
  }

  /** Select (or clear) the previewed architecture; every view follows. */
  async setPreview(req: PreviewRequest | undefined): Promise<void> {
    await this.context.workspaceState.update(KEYS.preview, req && (req.scenario || req.picks?.length) ? { scenario: req.scenario, picks: req.picks?.slice(0, 50) } : undefined);
    this.previewCache = undefined;
    this.readinessCache = undefined;
    this.selectionEmitter.fire(this.selection());
  }

  /** The preview as requested (a work view saves this, not the computed architecture). */
  previewRequest(): PreviewRequest | undefined {
    const req = this.state<PreviewRequest>(KEYS.preview);
    return req && (req.scenario || req.picks?.length) ? { ...(req.scenario ? { scenario: req.scenario } : {}), ...(req.picks?.length ? { picks: [...req.picks] } : {}) } : undefined;
  }

  // ------------------------------------------------------------ 0.17 diagram settings (per webview mode)

  /**
   * Orientation, lanes, folds, zoom (and the Workbench tab's view) of the Workbench tab ("full") and of
   * the Architecture panel ("map"). Held here rather than only inside each webview so a work view can
   * save and restore them, and a view applied before a webview exists reaches it when it loads.
   */
  diagramUi(mode: DiagramMode): DiagramUi | undefined {
    return this.state<Partial<Record<DiagramMode, DiagramUi>>>(KEYS.diagramUi)?.[mode];
  }

  async setDiagramUi(mode: DiagramMode, ui: DiagramUi | undefined): Promise<void> {
    const all = { ...(this.state<Partial<Record<DiagramMode, DiagramUi>>>(KEYS.diagramUi) ?? {}) };
    if (ui) all[mode] = ui; else delete all[mode];
    await this.context.workspaceState.update(KEYS.diagramUi, all);
  }

  observedAt(): string | undefined { return this.projectObs?.observedAt; }

  /**
   * Env files, variable names, non-secret identifiers, optional companions and deterministic
   * checks. Holds names and states only: safe for the tree, the Workbench, snapshots and AI context.
   */
  readiness(): Readiness {
    if (this.readinessCache) return this.readinessCache;
    const map = this.projectMap();
    const preview = this.preview();
    const variant = preview && preview.key !== "scenario:current" ? preview : undefined;
    const config = vscode.workspace.getConfiguration("datapass");
    this.readinessCache = buildReadiness({
      // A selected variant brings its own repositories (a planned one it adds, for instance).
      manifest: this.ctx.manifest, coordinationKey: map.coordinationKey, envFiles: this.envObs, repositories: (variant?.map ?? map).repositories, problems: map.problems,
      settings: { diagramCloudUrl: config.get<string>("diagramCloud.url") ?? "" },
      diagramCloudSidecar: Boolean(this.ctx.diagramCloudSidecar), latestSchemaVersion: LATEST_MANIFEST_VERSION,
      tools: this.tools, platform: process.platform, hubTools: hubToolchainTools(this.catalogue()), connectionProbes: this.connectionProbes, extensionsJson: this.extensionsObs, bindingFolders: this.bindingObs
    });
    // V1-STAB: with a variant selected, rows of repositories only other variants use leave the view.
    if (variant) {
      const repoOf = (c: { repoKey?: string; artifacts?: { repoKey?: string } }) => c.artifacts?.repoKey ?? c.repoKey;
      const used = new Set([map.coordinationKey, ...variant.map.components.map(repoOf)].filter((k): k is string => !!k));
      const hide = new Set([
        ...map.components.map(repoOf),
        ...Object.values(this.variants()?.options ?? {}).flatMap(o => o.components.map(c => c.repoKey))
      ].filter((k): k is string => !!k && !used.has(k)));
      this.readinessCache = readinessForVariant(this.readinessCache, hide, variant.title);
    }
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
  /** 0.19: the last observation of the project's repositories (the Git view reuses its status when fresh). */
  projectObservation(): ProjectObservation | undefined { return this.projectObs; }

  selection(): Selection {
    const sel = this.state<Selection>(KEYS.selection) ?? {};
    const map = this.projectMap();
    // A component that exists only in the previewed architecture can be selected while that preview lasts.
    const component = sel.component && (map.components.some(c => c.id === sel.component) || this.preview()?.map.components.some(c => c.id === sel.component)) ? sel.component : undefined;
    const subproject = sel.subproject && map.subprojects.some(s => s.id === sel.subproject) ? sel.subproject
      : component ? this.subprojectOf(component)
      : undefined;
    return { subproject, component };
  }

  /** First sub-project of a component (of the project, else of the previewed architecture). */
  private subprojectOf(componentId: string): string | undefined {
    const map = this.projectMap();
    return map.components.find(c => c.id === componentId)?.subprojects[0]
      ?? this.preview()?.map.components.find(c => c.id === componentId)?.subprojects[0]
      ?? map.subprojects.find(s => s.componentIds.includes(componentId))?.id;
  }

  /** Select a sub-project and/or a component. A declared sub-project is also the Work view's scope. */
  async select(sel: Selection): Promise<void> {
    const map = this.projectMap();
    const subproject = sel.subproject ?? (sel.component ? this.subprojectOf(sel.component) : undefined);
    const next: Selection = { subproject, component: sel.component };
    await this.context.workspaceState.update(KEYS.selection, next);
    if (subproject && (this.ctx.manifest?.scopes ?? []).some(s => s.id === subproject) && this.model().scope.id !== subproject) {
      await this.selectScope(subproject);
    }
    this.selectionEmitter.fire(next);
  }

  private async localBindings(): Promise<Record<string, string>> {
    const root = this.ctx.root ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? readLocalBindings(root) : {};
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
    const view = this.projectMap().repositories.find(r => r.key === key);
    if (view && view.state !== "local") return { ok: false, changed: [], detail: view.detail };
    const before = await gitRunner(["rev-parse", "HEAD"], folder.fsPath, 5000);
    const r = await gitRunner(["merge", "--ff-only", "@{u}"], folder.fsPath, 60000);
    if (!r.ok) return { ok: false, changed: [], detail: (r.stderr ?? "").split(/\r?\n/).find(l => l.trim())?.slice(0, 300) ?? "fast-forward refused" };
    const diff = before.ok ? await gitRunner(["diff", "--name-status", before.stdout.trim(), "HEAD"], folder.fsPath, 15000) : { ok: false, stdout: "" };
    return { ok: true, changed: diff.ok ? parseNameStatus(diff.stdout) : [] };
  }
}

/** Today on this machine, YYYY-MM-DD (sprints and due dates are calendar dates). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Clone locations chosen with "Locate clone" for the project in `root` (its own `.datapass/local`). */
export async function readLocalBindings(root: vscode.Uri): Promise<Record<string, string>> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), LOCAL_REPOSITORIES_FILE));
    const doc = parseStrictJson(bytes, { maxBytes: 64 * 1024 }) as Record<string, unknown>;
    const map = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc.repositories as Record<string, unknown> | undefined) : undefined;
    return Object.fromEntries(Object.entries(map ?? {}).filter((e): e is [string, string] => typeof e[1] === "string" && path.isAbsolute(e[1])));
  } catch { return {}; }
}

/** Parent folders where project clones live (user setting), besides the project folder's own parent. */
export function cloneParents(): string[] {
  const v = vscode.workspace.getConfiguration("datapass").get<string[]>("projectsFolders") ?? [];
  return Array.isArray(v) ? v.filter(p => typeof p === "string" && path.isAbsolute(p)).slice(0, 10) : [];
}
