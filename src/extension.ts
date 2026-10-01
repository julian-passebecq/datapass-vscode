import * as vscode from "vscode";
import { GalaxyViewProvider } from "./views/galaxy";
import { executeGalaxyAction, setReadinessSource } from "./core/actions";
import type { GalaxyState } from "./core/types";
import { WorkSession } from "./work/session";
import { WorkTreeProvider } from "./views/workTree";
import { registerWorkCommands } from "./work/commands";
import { registerBridgeCommands } from "./work/bridgeCommands";
import { registerCompanionCommands } from "./work/companionCommands";
import { setClipboardForTests, type Clipboard } from "./core/clipboard";
import { setAppLauncherForTests, setExternalOpenerForTests, setFolderOpenerForTests, type AppLauncher, type ExternalOpener, type FolderOpener } from "./core/external";
import { registerReadinessCommands } from "./work/readinessCommands";
import { registerToolchainCommands } from "./work/toolchainCommands";
import { registerFileContextCommands } from "./work/fileContextCommands";
import { registerVariantCommands } from "./work/variantCommands";
import { ActiveVariantService, registerActiveVariantCommands } from "./work/activeVariantCommands";
import type { ConnectionRunner } from "./work/connectionChecks";
import { registerResourceCommands } from "./work/resourceCommands";
import { registerQualificationCommands } from "./work/qualificationCommands";
import { platformOperations } from "./core/capabilities/platformOperations";
import { WorkbenchHost } from "./views/workbench";
import { ProjectTreeProvider } from "./views/projectTree";
import { registerWorkbenchCommands } from "./work/workbenchCommands";
import { registerOptionsCommands } from "./work/optionsCommands";
import { registerBoardCommands } from "./work/boardCommands";
import { registerToolkitCommands } from "./work/toolkitCommands";
import { registerGitHostCommands } from "./work/gitHostCommands";
import { registerCheckCommands } from "./work/checkCommands";
import { registerNativeTestCommands, resolveComponentTest } from "./work/nativeTestCommands";
import type { WorkbenchState } from "./views/workbenchState";
import { AiExchangeView } from "./views/aiExchange";
import { registerNavigationSurfaces } from "./core/navigation/register";
import type { AiExchangeState } from "./views/aiExchangeState";
import type { ExchangeKind } from "./core/project/aiExchange";
import { WorkViews } from "./work/workViews";
import { registerWindowCommands, setExportFileForTests } from "./work/windowCommands";
import { HomeHost, isHomeTab, registerHomeCommands } from "./views/home";
import type { HomeState } from "./views/homeState";
import type { HomePage } from "./views/homeHtml";
import { PANES, type DiagramMode, type DiagramUi, type Pane, type WorkViewsFile } from "./core/windows/workViews";
import { output } from "./work/io";
import { GitObserver, type GitObservation } from "./work/gitObserver";
import { GitTreeProvider } from "./views/gitTree";
import { registerGitCommands } from "./work/gitCommands";
import { WorkOrderService, type LoadedOrder } from "./work/workOrders";
import { WorkOrderFlows, registerWorkOrderCommands, type Draft } from "./work/workOrderCommands";
import { PilotService, type PilotCard } from "./work/pilot";
import { registerPilotCommands } from "./work/pilotCommands";
import { CodexTestsService, registerCodexTestsCommands } from "./work/codexTests";
import type { WbCodexTests } from "./views/workbenchState";
import { ControlService, type ControlSnapshot } from "./work/controlService";
import { AgentPanelView, registerControlCommands } from "./views/agentPanel";
import type { AgentPanelState } from "./views/agentPanelState";
import { registerAirflowDag } from "./views/airflowDag";
import { findUnderstanding } from "./core/airflow/understandingLink";
import type { AirflowViewState } from "./views/airflowDagHtml";
import { isVisible } from "./core/experience/presets";
import type { AiViewState } from "./views/aiExchange";
import { ExperienceService, landOnArchitecture, registerExperienceCommands } from "./work/experienceCommands";
import { registerCodeFontCommand } from "./work/codeFontCommand";
import { registerOpenClientProject } from "./work/openClientProject";
import type { Experience } from "./core/experience/presets";
import { registerFileVersionCommands } from "./work/fileVersionCommands";
import { ShellService, registerShellCommands } from "./work/shellCommands";
import { railButtonsShown } from "./views/railHtml";
import { moduleEnabled } from "./core/modules";
import type { TreeLens } from "./core/windows/treeLens";
import { GitDiagram, registerGitDiagramCommands } from "./work/gitDiagram";
import { HopHost, registerHopCommands } from "./views/hop";
import type { HopState } from "./views/hopState";

/**
 * Read-only hooks for the desktop integration suite (tests/integration). Returned only when
 * VS Code runs the extension in Test mode, so installed users never get an API surface.
 */
export interface DataPassTestApi {
  refresh(): Promise<GalaxyState>;
  /** V3-GITDIAG: re-read the change sets drawn on the diagram, and those placed on one block. */
  gitDiagram: { refresh(): Promise<void>; setsOf(componentId: string): ReturnType<GitDiagram["setsOf"]> };
  workModel(): ReturnType<WorkSession["model"]>;
  project(): WorkSession["project"];
  toolObservations(): ReturnType<WorkSession["toolObservations"]>;
  /** Walk the Work tree through the real provider, as the tree view renders it. */
  renderWorkTree(): Promise<Array<{ depth: number; id?: string; label: string; description?: string; contextValue?: string; command?: string }>>;
  workViewMessage(): string | undefined;
  /** Replace the clipboard DataPass uses (undefined restores the system clipboard). */
  setClipboard(impl?: Clipboard): void;
  /** Replace how DataPass opens URLs outside VS Code (undefined restores the real browser). */
  setExternalOpener(impl?: ExternalOpener): void;
  /** Replace how DataPass opens a remote folder (undefined restores Remote - SSH). */
  setFolderOpener(impl?: FolderOpener): void;
  companions(): ReturnType<WorkSession["companions"]>;
  inventory(): ReturnType<WorkSession["inventory"]>;
  qualification(): ReturnType<WorkSession["qualification"]>;
  repositories(): ReturnType<WorkSession["repositories"]>;
  /** V3: the project map, the Workbench state the webviews render, and the shared selection. */
  projectMap(): ReturnType<WorkSession["projectMap"]>;
  workbenchState(): WorkbenchState;
  selection(): ReturnType<WorkSession["selection"]>;
  select(sel: { subproject?: string; component?: string }): Promise<void>;
  /** Env files, variable names, identifiers, companions and checks (names and states only). */
  readiness(): ReturnType<WorkSession["readiness"]>;
  /** Replace how DataPass starts Power Ops (undefined restores the real launcher). */
  setAppLauncher(impl?: AppLauncher): void;
  /** Walk the Project tree through the real provider. */
  renderProjectTree(): Promise<Array<{ depth: number; id?: string; label: string; description?: string; contextValue?: string; command?: string; commandArgs?: unknown[] }>>;
  /** 0.15: architecture options analysis and the previewed architecture. */
  optionsAnalysis(): ReturnType<WorkSession["optionsAnalysis"]>;
  setPreview(req: Parameters<WorkSession["setPreview"]>[0]): Promise<void>;
  /** 0.25 (V-A): the selected variant's status item and what this machine remembers for the project. */
  selectedVariant: { statusText(): string; statusVisible(): boolean; remembered(): { scenario?: string; picks?: string[] } | undefined };
  /** V1-TEST: the native Test route (what it would run, and the receipts kept on this machine). */
  nativeTests: { resolve(componentId: string): Promise<import("./work/nativeTestCommands").ComponentTestView>; receipts(): import("./core/nativeTest/tasks").TestReceipt[] };
  /** 0.15.1: the AI exchange view (secondary side bar), driven through its real message handler. */
  aiExchange: {
    /** The view was shown in this window (the secondary side bar displays DataPass). */
    resolved(): boolean;
    state(): Promise<AiExchangeState>;
    /** Send one webview message; resolves with the replies the webview would receive. */
    send(message: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  };
  /** 0.16: the board as the kanban shows it. */
  boardView(): ReturnType<WorkSession["boardView"]>;
  /** V3-HOME: the Home and Project links pages — state, open, a webview message, the last action handled. */
  home: {
    state(): Promise<HomeState>;
    open(page?: HomePage): Promise<void>;
    isOpen(page?: HomePage): boolean;
    send(message: Record<string, unknown>): Promise<HomeHost["lastAction"]>;
  };
  /** V3-HOP2: the DataPass Hop view — what it shows, the highlighted step, a webview message. */
  hop: {
    isOpen(): boolean;
    column(): vscode.ViewColumn | undefined;
    state(): HopState | undefined;
    activeStep(): string | undefined;
    shownUri(): string | undefined;
    send(message: Record<string, unknown>): Promise<void>;
  };
  /** 0.17: this project's work views, the switcher, diagram settings, the floating Workbench, startup. */
  workViews(): Promise<WorkViewsFile>;
  windowInfo(): { switcherText: string; switcherTooltip: string; company: string; diagramUi: Partial<Record<DiagramMode, DiagramUi>>; lastApplied?: string; panes: Pane[] };
  workbenchFloating(): Promise<boolean>;
  /** Apply diagram settings as a work view does (stored, and sent to the open webviews). */
  setDiagramUi(ui: Partial<Record<DiagramMode, DiagramUi>>): Promise<void>;
  /** Write the Power Ops list to this file instead of the per-user application data (undefined restores it). */
  setExportFile(file?: string): void;
  /** Resolves once the startup work view (or a launcher's request) was handled: the view applied, if any. */
  startup(): Promise<string | undefined>;
  /** 0.18: replace the runner of the read-only sign-in checks (fake CLIs; undefined restores the real one). */
  setConnectionRunner(impl?: ConnectionRunner): void;
  /** 0.19: the Git view's observation, a refresh through the real observer, and the tree as rendered. */
  git: {
    observation(): GitObservation;
    refresh(force?: boolean): Promise<GitObservation>;
    loadOthers(): Promise<GitObservation>;
    badge(): number | undefined;
    renderTree(expandOthers?: boolean): Promise<Array<{ depth: number; id?: string; label: string; description?: string; contextValue?: string; command?: string; commandArgs?: unknown[] }>>;
  };
  /** 0.20: work orders — the service's list, a reload, the flows (write, launch…) and the AI view's Agent tab. */
  workOrders: {
    list(): readonly LoadedOrder[];
    reload(): Promise<readonly LoadedOrder[]>;
    write(draft: Draft): Promise<LoadedOrder>;
    aiState(): Promise<AiViewState>;
    lastPrefill(): { token: string; draft: Partial<Draft>; visible: Partial<Draft> } | undefined;
    selected(): string | undefined;
  };
  /** 0.26 (AI-4a): pilot requests as cards; Run it with a stub action runner (tests never open real tools). */
  pilot: {
    cards(): readonly PilotCard[];
    reload(): Promise<readonly PilotCard[]>;
    run(orderId: string, n: number, ran: string[]): Promise<void>;
    decline(orderId: string, n: number): Promise<void>;
    /** One message as the AI view's webview would send it; the replies it got. */
    aiSend(message: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  };
  /** QA-2: the Codex tests section; Hand to Codex with a stub launcher that records the order ids (tests never open the Codex app). */
  codexTests: {
    state(): WbCodexTests;
    reload(): Promise<WbCodexTests>;
    handToCodex(launched: string[]): Promise<LoadedOrder>;
  };
  /** 0.24: Claude Control as DataPass read it, a refresh, and the Claude & Codex panel's state. */
  control: {
    snapshot(): ControlSnapshot;
    refresh(): Promise<ControlSnapshot>;
    panel(): AgentPanelState;
    /** Send one message as the panel's webview would (open a link, open a row, copy the start command). */
    panelSend(message: Record<string, unknown>): Promise<void>;
  };
  /** V3-AIRFLOW: the Airflow DAG view's state, one webview message, and how often it was revealed by itself. */
  airflow: {
    state(): AirflowViewState;
    send(message: Record<string, unknown>): Promise<void>;
    autoReveals(): number;
    /** V1.1.x-POLISH-3: what the rail's DAG button opens (the active DAG, else the project's). */
    dagForRail(): Promise<vscode.Uri | undefined>;
  };
  /** 0.22 modes: the effective mode, its status item, and whether startup landed on the architecture. */
  experience: {
    current(): Experience;
    ready(): Promise<void>;
    status(): { text: string; tooltip: string; visible: boolean };
    landed(): Promise<boolean>;
    /** Run the startup landing again (V1-RC3: it must not take the keyboard). */
    land(): Promise<boolean>;
  };
  /** V1-PERF: this activation's timings (ms) and how many refreshes ran since (scripts/perf.ts). V1-REF: first paint and full refresh. */
  perf(): PerfCounters;
  /** V3-SHELL: the left tree's lens, rail mode, and whether the bottom-panel Architecture view is on. */
  shell: {
    lens(): TreeLens;
    chosenLens(): TreeLens;
    chooseLens(lens: TreeLens): Promise<void>;
    rail(): boolean;
    railResolved(): boolean;
    /** One message as the rail webview would send it. */
    railSend(message: Record<string, unknown>): Promise<void>;
    railButtons(): readonly string[];
    /** V1.1.x-POLISH-3: the lens status-bar text, the separate Git view on screen. */
    lensStatus(): string;
    gitViewVisible(): boolean;
    /** V1.1.x-POLISH-3: the right-side view a rail button unfolded alone, if any. */
    solo(): string | undefined;
    architectureInPanel(): boolean;
  };
}

export interface PerfCounters {
  loadMs: number; activateMs: number;
  /** V1-REF: until the project, its architecture and the tree are painted (the gated number). */
  firstRefreshMs: number;
  /** V1-REF: until everything of the first refresh is in (probes, readiness, inventory, Galaxy). */
  fullRefreshMs: number;
  /** The session's own split of its first refresh (ms since that refresh started). */
  sessionFirstPaintMs: number; sessionSettledMs: number; sessionSteps: Record<string, number>;
  sessionRefreshes: number; sessionChanges: number; gitChanges: number;
}

// V1-PERF: esbuild's banner stamps the moment the bundle starts evaluating (esbuild.mjs).
const loadedAt = performance.now();
const loadStart = (globalThis as { __datapassLoadStart?: number }).__datapassLoadStart ?? loadedAt;

/** V1-REF: resolves when the session next paints the project (the first step of a refresh). */
function nextPaint(session: WorkSession): Promise<void> {
  return new Promise(resolve => {
    const sub = session.onDidPaint(step => { if (step === "first-paint") { sub.dispose(); resolve(); } });
  });
}

export function activate(context: vscode.ExtensionContext): DataPassTestApi | undefined {
  const activateStart = performance.now();
  const perf: PerfCounters = { loadMs: loadedAt - loadStart, activateMs: 0, firstRefreshMs: 0, fullRefreshMs: 0, sessionFirstPaintMs: 0, sessionSettledMs: 0, sessionSteps: {}, sessionRefreshes: 0, sessionChanges: 0, gitChanges: 0 };
  // V2.2 Work view: scope → next step → checklist → operation readiness → outputs → exchanges.
  const session = new WorkSession(context);
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    const refresh = session.refresh.bind(session);
    session.refresh = force => { perf.sessionRefreshes++; return refresh(force); };
    context.subscriptions.push(session.onDidChange(() => { perf.sessionChanges++; }));
  }
  // 0.22 modes: the context keys are set before the views render (`when` clauses read them).
  const experience = new ExperienceService(context);
  context.subscriptions.push(experience);
  registerExperienceCommands(context, experience);
  registerCodeFontCommand(context);
  registerOpenClientProject(context);
  // Galaxy cards show the same operation readiness as the Work view.
  const galaxy = new GalaxyViewProvider(context.extensionUri, () => platformOperations(session.preflightContext()));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GalaxyViewProvider.viewType,
      galaxy,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const workTree = new WorkTreeProvider(session);
  const workView = vscode.window.createTreeView(WorkTreeProvider.viewType, { treeDataProvider: workTree, showCollapseAll: true });
  const updateWorkBadge = () => {
    const m = session.model();
    workView.description = m.scopeSource === "declared" ? m.scope.id : undefined;
    workView.message = session.project.manifestErrors.length ? "The project manifest has errors; see Problems." : undefined;
  };
  context.subscriptions.push(session, workTree, workView, session.onDidChange(updateWorkBadge), session.onDidChange(() => void galaxy.refreshOperations()));
  registerWorkCommands(context, session);
  registerBridgeCommands(context, session);
  registerCompanionCommands(context, session);
  registerResourceCommands(context, session);
  registerQualificationCommands(context, session);
  registerReadinessCommands(context, session);
  registerToolchainCommands(context, session);
  registerFileContextCommands(context, session);
  setReadinessSource(() => session.project.manifest ? session.readiness() : undefined);

  // V3 Workbench: Project tree (left), Architecture diagram (bottom panel), AI exchange and Details (secondary side bar), Workbench tab.
  const host = new WorkbenchHost(context, session);
  const aiExchange = new AiExchangeView(context, session);
  const projectTree = new ProjectTreeProvider(session);
  const projectView = vscode.window.createTreeView(ProjectTreeProvider.viewType, { treeDataProvider: projectTree, showCollapseAll: true });
  projectTree.attach(projectView);
  projectTree.setSurfaces(experience.shows, experience.onDidChange);
  registerVariantCommands(context, session, projectTree);
  // V3-SHELL: tree lenses, rail mode, the bottom-panel Architecture view (off by default), close buttons.
  const shell = new ShellService(context, projectTree, projectView);
  registerShellCommands(context, shell);
  // V3-POLISH-2: the rail's DAG button follows the Airflow DAG view (mode) and the project's Airflow module.
  shell.setRailButtons(() => railButtonsShown({ shows: experience.shows, airflowModule: moduleEnabled(session.project.manifest, "airflow") }), [experience.onDidChange, session.onDidChange]);
  const activeVariant = new ActiveVariantService(context, session, experience.shows, experience.onDidChange);
  registerActiveVariantCommands(context, activeVariant, session);
  host.setSurfaces(experience.shows, experience.onDidChange);
  aiExchange.setSurfaces(experience.shows, experience.onDidChange);
  context.subscriptions.push(
    host, projectTree, projectView,
    vscode.window.registerWebviewViewProvider("datapass.architecture", host.viewProvider("map"), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider("datapass.details", host.viewProvider("detail"), { webviewOptions: { retainContextWhenHidden: true } }),
    // Kept alive while hidden so a pasted answer survives switching to Chat and back (memory only).
    aiExchange, vscode.window.registerWebviewViewProvider(AiExchangeView.viewType, aiExchange, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("datapass.showAiExchange", async (kind?: unknown) => {
      // V3-SHELL: in rail mode the AI view is folded into the rail: expand the panel first.
      if (shell.rail()) await shell.expand("datapass.aiExchange");
      return aiExchange.reveal(typeof kind === "string" ? kind as ExchangeKind : undefined);
    })
  );
  // V3-HOP2: DataPass Hop — an explained file's visual explanation beside its code.
  const hop = new HopHost(context, session, host);
  context.subscriptions.push(hop, vscode.languages.registerCodeLensProvider({ scheme: "file" }, hop.codeLensProvider()));
  registerHopCommands(context, session, hop);
  registerWorkbenchCommands(context, session, host, uri => hop.openIfExplained(uri));
  registerOptionsCommands(context, session, host);
  registerBoardCommands(context, session, host);
  registerToolkitCommands(context, session, host);
  registerGitHostCommands(context, session);
  registerCheckCommands(context);
  const nativeTests = registerNativeTestCommands(context, session, String(context.extension.packageJSON.version ?? "unknown"));

  // 0.19 Git module: read-only observation of the project's repositories, worktrees and PRs (left side bar, under Project).
  const git = new GitObserver(session);
  const gitTree = new GitTreeProvider(git);
  const gitView = vscode.window.createTreeView(GitTreeProvider.viewType, { treeDataProvider: gitTree, showCollapseAll: true });
  const gitBadge = () => {
    const n = git.observation().needsYou.length;
    gitView.badge = n ? { value: n, tooltip: `${n} Git item(s) need you` } : undefined;
  };
  // Refreshed only while visible (cached results are reused): on showing, on window focus, after the project changes.
  const gitIfVisible = () => { if (gitView.visible) void git.refresh(); };
  context.subscriptions.push(
    git, gitTree, gitView, git.onDidChange(gitBadge), git.onDidChange(() => host.refreshGit()), git.onDidChange(() => { perf.gitChanges++; }),
    gitView.onDidChangeVisibility(e => { if (e.visible) void git.refresh(); }),
    vscode.window.onDidChangeWindowState(e => { if (e.focused) gitIfVisible(); }),
    session.onDidChange(gitIfVisible)
  );
  host.setGitSource(() => git.observation());
  projectTree.attachGit(gitTree, () => void git.refresh());
  registerGitCommands(context, session, git);
  // 0.22 file versions (package F): read-only revisions of any file through native Git.
  registerFileVersionCommands(context, session);
  // V3-GITDIAG: open PRs and local changes drawn on the diagram blocks whose files they touch.
  const gitDiagram = new GitDiagram(session, git);
  context.subscriptions.push(gitDiagram);
  host.setGitDiagramSource(() => gitDiagram.view(), gitDiagram.onDidChange);
  registerGitDiagramCommands(context, gitDiagram);

  // 0.20 work orders (pass AI-2): the Agent tab of the AI view, the Workbench's Work orders view, Details, Needs you rule 8.
  const workOrders = new WorkOrderService(context, session, git);
  const flows = new WorkOrderFlows(context, session, workOrders, git);
  aiExchange.attachWorkOrders(workOrders, flows, git);
  projectTree.attachWorkOrders(() => workOrders.list(), workOrders.onDidChange);
  host.setWorkOrderSource(() => workOrders.view(), workOrders.onDidChange);
  context.subscriptions.push(workOrders);
  registerWorkOrderCommands(context, session, workOrders, flows, git,
    p => aiExchange.prefill(p),
    async id => {
      host.openPanel(vscode.ViewColumn.Active, "workOrders", id || undefined);
      if (id && shell.rail()) await shell.expand("datapass.details");
      else if (id) await vscode.commands.executeCommand("datapass.details.focus");
      workOrders.refreshGit(Boolean(id));
    });
  void workOrders.reload();
  // 0.26 (AI-4a): pilot stage 1 — requests/<n>.json as Pilot cards in the AI view.
  const pilot = new PilotService(session, workOrders);
  context.subscriptions.push(pilot);
  aiExchange.attachPilot(pilot);
  registerPilotCommands(context, pilot, () => aiExchange.showTab("pilot"));
  // V4-NAV: navigation surfaces (Context view…); NAVSVC1 passes the NavigationService.
  registerNavigationSurfaces(context);
  // QA-2: the Codex tests section of the Work orders view (qa-run orders for the Codex app).
  const codexTests = new CodexTestsService(context, session, workOrders, id => flows.handToCodexApp(id));
  context.subscriptions.push(codexTests);
  host.setCodexTestsSource(() => codexTests.view(), codexTests.onDidChange);
  registerCodexTestsCommands(context, codexTests, async () => { host.openPanel(vscode.ViewColumn.Active, "workOrders"); });
  void codexTests.reload();

  // 0.24 (pass AI-3): the Claude & Codex panel and Claude Control's data in the Work orders view (read only while someone looks).
  const control = new ControlService(session);
  control.attachWorkOrders(workOrders);
  workOrders.attachControl({ conversationOf: (id, agent) => control.conversationOf(id, agent), state: () => control.snapshot().state });
  const agentPanel = new AgentPanelView(session, control, () => flows.codexCliFound());
  context.subscriptions.push(control, agentPanel, vscode.window.registerWebviewViewProvider(AgentPanelView.viewType, agentPanel));
  const airflowDag = registerAirflowDag(context, async uri => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    return (await session.understandingFor(uri))?.file ?? findUnderstanding(uri.fsPath, [session.root?.fsPath, ...folders].filter((x): x is string => !!x), folders);
  }, () => isVisible(experience.experience(), "view.airflowDag"), session.onDidChange, uri => session.understandingIndexed(uri));
  shell.setDagOpener(() => airflowDag.openDagForRail());
  registerControlCommands(context, control, workOrders);

  // 0.17 windows and work views: status-bar switcher, saved layouts, company workspace file, Power Ops list.
  const visiblePanes = (): Pane[] => {
    const shown: Record<Pane, boolean> = { project: projectView.visible, work: workView.visible, galaxy: galaxy.isVisible(), architecture: host.isVisible("map"), aiExchange: aiExchange.isVisible(), details: host.isVisible("detail") };
    return PANES.filter(p => shown[p]);
  };
  const views = new WorkViews(session, host, visiblePanes);
  context.subscriptions.push(views);
  // V3-HOME: the module dashboard and the project links page; work views save and restore the Home tab.
  const home = new HomeHost(context, session, views, experience.shows);
  context.subscriptions.push(home);
  registerHomeCommands(context, session, home);
  views.attachHome({ isHomeTab, open: column => home.open("home", column, true), panel: () => home.panel("home") });
  const windows = registerWindowCommands(context, session, host, views, () => home.open("home"));

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = "$(dashboard) DataPass";
  status.tooltip = "Open DataPass Galaxy";
  status.command = "datapass.openGalaxy";
  const showStatus = () => { if (experience.shows("status.health")) status.show(); else status.hide(); };
  showStatus();
  context.subscriptions.push(status, experience.onDidChange(showStatus));

  const refreshState = async (): Promise<GalaxyState> => {
    // V1-REF: the session paints the project first; the Galaxy cards are gathered while it finishes
    // (probes, readiness, inventory). Operation readiness reaches the cards when the session settles.
    const done = session.refresh();
    await Promise.race([nextPaint(session), done]);
    const [state] = await Promise.all([galaxy.refresh(), done]);
    await galaxy.refreshOperations();
    updateStatusBar(status, state);
    return state;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("datapass.refresh", async () => {
      await refreshState();
    }),
    vscode.commands.registerCommand("datapass.openGalaxy", async () => {
      // VS Code generates `<viewId>.focus` for every contributed view.
      await vscode.commands.executeCommand(`${GalaxyViewProvider.viewType}.focus`);
    }),
    vscode.commands.registerCommand("datapass.initializeProjectManifest", async () => {
      await executeGalaxyAction("project.initializeManifest", context.extensionUri);
      await refreshState();
    }),
    vscode.commands.registerCommand("datapass.openProjectManifest", async () => {
      await executeGalaxyAction("project.openManifest", context.extensionUri);
    }),
    vscode.commands.registerCommand("datapass.copyEnvironmentSnapshot", async () => {
      await executeGalaxyAction("project.copyEnvironmentSnapshot", context.extensionUri);
    }),
    vscode.commands.registerCommand("datapass.fabric.captureSummary", async () => {
      await executeGalaxyAction("fabric.captureSummary", context.extensionUri);
    }),
    vscode.commands.registerCommand("datapass.fabric.scaffoldDeployConfig", async () => {
      await executeGalaxyAction("fabric.scaffoldDeployConfig", context.extensionUri);
      await refreshState();
    }),
    vscode.commands.registerCommand("datapass.fabric.copyDeployCommand", async () => {
      await executeGalaxyAction("fabric.copyDeployCommand", context.extensionUri);
    }),
    vscode.commands.registerCommand("datapass.fabric.scaffoldPreflightWorkflow", async () => {
      await executeGalaxyAction("fabric.scaffoldPreflightWorkflow", context.extensionUri);
    })
  );

  const refresh = () => void refreshState();
  const bundleWatcher = vscode.workspace.createFileSystemWatcher("**/{databricks,bundle}.{yml,yaml}");
  bundleWatcher.onDidCreate(refresh);
  bundleWatcher.onDidChange(refresh);
  bundleWatcher.onDidDelete(refresh);

  const manifestWatcher = vscode.workspace.createFileSystemWatcher("**/.datapass/project.json");
  manifestWatcher.onDidCreate(refresh);
  manifestWatcher.onDidChange(refresh);
  manifestWatcher.onDidDelete(refresh);

  // Graph, packs and claims only affect the Work view; .datapass/local is private session data.
  const workRefresh = () => void session.refresh();
  const workWatcher = vscode.workspace.createFileSystemWatcher("**/.datapass/{graph.json,options.json,sheet.json,board.json,links.json,claims.json,packs/*.json,queries/*.json,toolkit/*.json,toolkit/recipes/*.json}");
  workWatcher.onDidCreate(workRefresh);
  workWatcher.onDidChange(workRefresh);
  workWatcher.onDidDelete(workRefresh);

  context.subscriptions.push(bundleWatcher, manifestWatcher, workWatcher);

  // Files appearing or disappearing (an AI's pull request merged, a file created by hand) change what is
  // "found" or "missing": re-inspect, debounced. Edits of existing files only matter for digests (next refresh).
  let pending: NodeJS.Timeout | undefined;
  const soon = (uri: vscode.Uri) => {
    if (/[\\/](node_modules|\.git|\.venv|venv|dist|out|__pycache__|\.datapass[\\/]local)([\\/]|$)/.test(uri.fsPath)) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = undefined; void session.refresh(); }, 1500);
  };
  const filesWatcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
  filesWatcher.onDidCreate(soon);
  filesWatcher.onDidDelete(soon);
  // Env files: a name added or filled changes readiness. Only presence is re-read, never a value.
  const envWatcher = vscode.workspace.createFileSystemWatcher("**/{.env,.env.*,*.env,.dev.vars,.dev.vars.*}");
  envWatcher.onDidChange(soon);
  // V3-POLISH-1: an explanation edited in the bridge (the client AI's pull request, a hand edit) re-indexes
  // DataPass Hop: the Hop view, its CodeLens and the explained-files list follow the session refresh.
  const understandingWatcher = vscode.workspace.createFileSystemWatcher("**/.datapass/understanding/**");
  understandingWatcher.onDidCreate(soon);
  understandingWatcher.onDidChange(soon);
  understandingWatcher.onDidDelete(soon);
  context.subscriptions.push(filesWatcher, envWatcher, understandingWatcher, { dispose: () => { if (pending) clearTimeout(pending); } });
  // Trusting the workspace enables Git; adding or removing folders may change which one is the project.
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => void refreshState()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshState())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("datapass")) void refreshState();
    })
  );

  // V3-SHELL: without the bottom-panel Architecture view, the landing opens the Workbench tab (keyboard stays where it is).
  const landOnWorkbench = () => { host.openPanel(vscode.ViewColumn.Active, "architecture", undefined, true); };
  let landed: Promise<boolean> = Promise.resolve(false);
  // Once the project is loaded: DataPass in the secondary side bar (first time, 0.15.1), then the
  // startup work view or a launcher's request (0.17), which may arrange the panes differently.
  const firstRefreshStart = performance.now();
  void nextPaint(session).then(() => { perf.firstRefreshMs ||= performance.now() - firstRefreshStart; });
  const startup = refreshState()
    .then(() => {
      perf.fullRefreshMs = performance.now() - firstRefreshStart;
      perf.firstRefreshMs ||= perf.fullRefreshMs;
      perf.sessionFirstPaintMs = session.lastRefreshTimings.firstPaintMs ?? 0;
      perf.sessionSettledMs = session.lastRefreshTimings.settledMs ?? 0;
      perf.sessionSteps = { ...session.lastRefreshTimings.steps };
    })
    .then(() => showDataPassSideBar(context, session).catch(() => undefined))
    .then(() => windows.startup())
    .then(async applied => { landed = landOnArchitecture(experience, session.project.manifestExists, applied, landOnWorkbench).catch(() => false); await landed; experience.introduce(); return applied; })
    .catch(error => {
      output().appendLine(`[startup] ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });

  // V1.1.x-POLISH-3: once per install, point to the DataPass tree when a project opens while the Explorer shows.
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    void startup.then(() => new Promise(r => setTimeout(r, 4000))).then(() => {
      const p = session.project;
      return shell.hintTree(Boolean(p.root && p.manifestExists && !p.manifestErrors.length));
    }).catch(() => undefined);
  }

  perf.activateMs = performance.now() - activateStart;
  if (context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
  return {
    perf: () => ({ ...perf }),
    shell: {
      lens: () => shell.lens(),
      chosenLens: () => shell.lenses.chosen,
      chooseLens: lens => shell.chooseLens(lens),
      rail: () => shell.rail(),
      railResolved: () => shell.railResolved(),
      railSend: message => shell.onRailMessage(message),
      railButtons: () => shell.railButtons(),
      lensStatus: () => shell.lensStatusText(),
      gitViewVisible: () => gitView.visible,
      solo: () => shell.solo(),
      architectureInPanel: () => shell.architectureInPanel()
    },
    gitDiagram: { refresh: () => gitDiagram.refresh(), setsOf: (id: string) => gitDiagram.setsOf(id) },
    refresh: refreshState,
    workModel: () => session.model(),
    project: () => session.project,
    toolObservations: () => session.toolObservations(),
    workViewMessage: () => workView.message,
    setClipboard: setClipboardForTests,
    setExternalOpener: setExternalOpenerForTests,
    setFolderOpener: setFolderOpenerForTests,
    setAppLauncher: setAppLauncherForTests,
    readiness: () => session.readiness(),
    companions: () => session.companions(),
    inventory: () => session.inventory(),
    qualification: () => session.qualification(),
    repositories: () => session.repositories(),
    projectMap: () => session.projectMap(),
    workbenchState: () => host.state(),
    selection: () => session.selection(),
    select: sel => session.select(sel),
    optionsAnalysis: () => session.optionsAnalysis(),
    setPreview: req => session.setPreview(req),
    selectedVariant: { statusText: () => activeVariant.statusText(), statusVisible: () => activeVariant.statusVisible(), remembered: () => activeVariant.remembered() },
    nativeTests: { resolve: async id => { const { folder: _f, ...view } = await resolveComponentTest(session, id); return view; }, receipts: () => nativeTests.receipts() },
    aiExchange: {
      resolved: () => aiExchange.resolved(),
      state: () => aiExchange.state(),
      send: async message => {
        const replies: Array<Record<string, unknown>> = [];
        await aiExchange.handle(message, r => { replies.push(r); });
        return replies;
      }
    },
    boardView: () => session.boardView(),
    home: {
      state: () => home.state(),
      open: async page => { await home.open(page ?? "home"); },
      isOpen: page => home.isOpen(page ?? "home"),
      send: async message => { home.lastAction = undefined; await home.receive(message); return home.lastAction; }
    },
    hop: {
      isOpen: () => hop.isOpen(),
      column: () => hop.column(),
      state: () => hop.state(),
      activeStep: () => hop.activeStep(),
      shownUri: () => hop.shownUri()?.toString(),
      send: message => hop.receive(message)
    },
    workViews: async () => (await views.load()).file,
    windowInfo: () => {
      const full = session.diagramUi("full"), map = session.diagramUi("map");
      return {
        switcherText: windows.switcherText(), switcherTooltip: windows.switcherTooltip(), company: windows.company(),
        diagramUi: { ...(full ? { full } : {}), ...(map ? { map } : {}) }, lastApplied: views.lastApplied()?.id, panes: visiblePanes()
      };
    },
    workbenchFloating: () => host.isFloating(),
    setDiagramUi: ui => host.applyUi(ui),
    setExportFile: setExportFileForTests,
    startup: () => startup,
    control: {
      snapshot: () => control.snapshot(),
      refresh: async () => { await control.refresh(); return control.snapshot(); },
      panel: () => agentPanel.state(),
      panelSend: m => agentPanel.receive(m)
    },
    airflow: {
      state: () => airflowDag.state(),
      send: m => airflowDag.receive(m),
      autoReveals: () => airflowDag.autoReveals,
      dagForRail: () => airflowDag.openDagForRail()
    },
    experience: {
      current: () => experience.experience(),
      ready: () => experience.ready,
      status: () => ({ text: experience.statusText(), tooltip: experience.statusTooltip(), visible: experience.statusVisible() }),
      landed: async () => { await startup; return landed; },
      land: () => landOnArchitecture(experience, session.project.manifestExists, undefined, landOnWorkbench)
    },
    setConnectionRunner: impl => { session.connectionRunner = impl; },
    workOrders: {
      list: () => workOrders.list(),
      reload: async () => { await workOrders.reload(); return workOrders.list(); },
      write: draft => flows.write(draft),
      aiState: () => aiExchange.state(),
      lastPrefill: () => aiExchange.lastPrefill(),
      selected: () => workOrders.selected()?.id
    },
    codexTests: {
      state: () => codexTests.view(),
      reload: async () => { await codexTests.reload(); return codexTests.view(); },
      handToCodex: async launched => {
        const real = codexTests.launcher;
        codexTests.launcher = async id => { launched.push(id); };
        try { return await codexTests.handToCodex(); } finally { codexTests.launcher = real; }
      }
    },
    pilot: {
      cards: () => pilot.list(),
      reload: async () => { await pilot.reload(); return pilot.list(); },
      run: (orderId, n, ran) => pilot.run(orderId, n, async id => { ran.push(id); }),
      decline: (orderId, n) => pilot.decline(orderId, n),
      aiSend: async message => { const replies: Array<Record<string, unknown>> = []; await aiExchange.handle(message, r => { replies.push(r); }); return replies; }
    },
    git: {
      observation: () => git.observation(),
      refresh: async force => { await git.refresh(force); return git.observation(); },
      loadOthers: async () => { await git.loadOthers(true); return git.observation(); },
      badge: () => gitView.badge?.value,
      renderTree: async expandOthers => {
        const rows: Awaited<ReturnType<DataPassTestApi["git"]["renderTree"]>> = [];
        const walk = async (node: Parameters<GitTreeProvider["getTreeItem"]>[0] | undefined, depth: number): Promise<void> => {
          for (const child of await gitTree.getChildren(node)) {
            const item = gitTree.getTreeItem(child);
            const label = typeof item.label === "string" ? item.label : item.label?.label ?? "";
            rows.push({ depth, id: item.id, label, description: typeof item.description === "string" ? item.description : undefined, contextValue: item.contextValue, command: item.command?.command, commandArgs: item.command?.arguments });
            if (depth < 5 && (child.t !== "others" || expandOthers)) await walk(child, depth + 1);
          }
        };
        await walk(undefined, 0);
        return rows;
      }
    },
    renderProjectTree: async () => {
      const rows: Awaited<ReturnType<DataPassTestApi["renderProjectTree"]>> = [];
      const walk = async (node: Parameters<ProjectTreeProvider["getTreeItem"]>[0] | undefined, depth: number): Promise<void> => {
        for (const child of await projectTree.getChildren(node)) {
          const item = await projectTree.getTreeItem(child);
          const label = typeof item.label === "string" ? item.label : item.label?.label ?? "";
          rows.push({ depth, id: item.id, label, description: typeof item.description === "string" ? item.description : undefined, contextValue: item.contextValue, command: item.command?.command, commandArgs: item.command?.arguments });
          if (depth < 6) await walk(child, depth + 1);
        }
      };
      await walk(undefined, 0);
      return rows;
    },
    renderWorkTree: async () => {
      const rows: Awaited<ReturnType<DataPassTestApi["renderWorkTree"]>> = [];
      const walk = async (node: Parameters<WorkTreeProvider["getTreeItem"]>[0] | undefined, depth: number): Promise<void> => {
        for (const child of await workTree.getChildren(node)) {
          const item = await workTree.getTreeItem(child);
          const label = typeof item.label === "string" ? item.label : item.label?.label ?? "";
          rows.push({ depth, id: item.id, label, description: typeof item.description === "string" ? item.description : undefined, contextValue: item.contextValue, command: item.command?.command });
          if (depth < 6) await walk(child, depth + 1);
        }
      };
      await walk(undefined, 0);
      return rows;
    }
  };
}

export function deactivate(): void {}

const SIDE_BAR_SHOWN = "datapass.layout.secondarySideBarShown";

/**
 * VS Code opens Chat in the secondary side bar. The first time a DataPass project opens in a
 * workspace, show DataPass there instead (AI exchange and Details). VS Code then remembers the
 * active tab per workspace, so switching back to Chat sticks; the setting turns this off.
 */
async function showDataPassSideBar(context: vscode.ExtensionContext, session: WorkSession): Promise<void> {
  if (!session.project.manifestExists || context.workspaceState.get<boolean>(SIDE_BAR_SHOWN)) return;
  if (!vscode.workspace.getConfiguration("datapass").get<boolean>("layout.showInSecondarySideBar", true)) return;
  await context.workspaceState.update(SIDE_BAR_SHOWN, true);
  // Show the view without taking the keyboard (an open Quick Pick stays open).
  await vscode.commands.executeCommand(`${AiExchangeView.viewType}.focus`, { preserveFocus: true });
}

function updateStatusBar(status: vscode.StatusBarItem, state: GalaxyState): void {
  const health = state.health;
  if (!health) {
    const ready = state.platforms.filter(item => item.status === "ready").length;
    const partial = state.platforms.filter(item => item.status === "partial").length;
    status.text = `$(dashboard) DataPass ${ready} ready · ${partial} partial`;
    return;
  }

  if (health.overall === "healthy") {
    status.text = `$(pass) DataPass · ${health.platformCounts.ready}/${state.platforms.length} ready`;
  } else if (health.overall === "attention") {
    status.text = `$(warning) DataPass · ${health.attention.length} attention`;
  } else {
    status.text = "$(tools) DataPass · setup";
  }

  status.tooltip = [
    "Open DataPass Galaxy",
    `Tools: ${health.tools.available}/${health.tools.total} detected`,
    `Bindings: ${health.bindings.bound}/${health.bindings.total} bound`,
    `Attention: ${health.attention.length}`
  ].join("\n");
}