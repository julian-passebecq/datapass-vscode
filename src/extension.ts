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
import type { ConnectionRunner } from "./work/connectionChecks";
import { registerResourceCommands } from "./work/resourceCommands";
import { registerQualificationCommands } from "./work/qualificationCommands";
import { platformOperations } from "./core/capabilities/platformOperations";
import { WorkbenchHost } from "./views/workbench";
import { ProjectTreeProvider } from "./views/projectTree";
import { registerWorkbenchCommands } from "./work/workbenchCommands";
import { registerOptionsCommands } from "./work/optionsCommands";
import { registerBoardCommands } from "./work/boardCommands";
import { registerGitHostCommands } from "./work/gitHostCommands";
import type { WorkbenchState } from "./views/workbenchState";
import { AiExchangeView } from "./views/aiExchange";
import type { AiExchangeState } from "./views/aiExchangeState";
import type { ExchangeKind } from "./core/project/aiExchange";
import { WorkViews } from "./work/workViews";
import { registerWindowCommands, setExportFileForTests } from "./work/windowCommands";
import { PANES, type DiagramMode, type DiagramUi, type Pane, type WorkViewsFile } from "./core/windows/workViews";
import { output } from "./work/io";
import { GitObserver, type GitObservation } from "./work/gitObserver";
import { GitTreeProvider } from "./views/gitTree";
import { registerGitCommands } from "./work/gitCommands";
import { WorkOrderService, type LoadedOrder } from "./work/workOrders";
import { WorkOrderFlows, registerWorkOrderCommands, type Draft } from "./work/workOrderCommands";
import type { AiViewState } from "./views/aiExchange";
import { ExperienceService, landOnArchitecture, registerExperienceCommands } from "./work/experienceCommands";
import type { Experience } from "./core/experience/presets";

/**
 * Read-only hooks for the desktop integration suite (tests/integration). Returned only when
 * VS Code runs the extension in Test mode, so installed users never get an API surface.
 */
export interface DataPassTestApi {
  refresh(): Promise<GalaxyState>;
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
  mongokuStatus(): ReturnType<WorkSession["mongokuStatus"]>;
  inventory(): ReturnType<WorkSession["inventory"]>;
  qualification(): ReturnType<WorkSession["qualification"]>;
  repositories(): ReturnType<WorkSession["repositories"]>;
  /** Drive the vscode://…/open handler directly (VS Code's own "allow URI?" prompt is not scriptable). */
  handleUri(uri: vscode.Uri): Promise<void>;
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
  /** 0.22 modes: the effective mode, its status item, and whether startup landed on the architecture. */
  experience: {
    current(): Experience;
    ready(): Promise<void>;
    status(): { text: string; tooltip: string; visible: boolean };
    landed(): Promise<boolean>;
  };
}

export function activate(context: vscode.ExtensionContext): DataPassTestApi | undefined {
  // V2.2 Work view: scope → next step → checklist → operation readiness → outputs → exchanges.
  const session = new WorkSession(context);
  // 0.22 modes: the context keys are set before the views render (`when` clauses read them).
  const experience = new ExperienceService(context);
  context.subscriptions.push(experience);
  registerExperienceCommands(context, experience);
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
  const companionUri = registerCompanionCommands(context, session);
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
  host.setSurfaces(experience.shows, experience.onDidChange);
  aiExchange.setSurfaces(experience.shows, experience.onDidChange);
  context.subscriptions.push(
    host, projectTree, projectView,
    vscode.window.registerWebviewViewProvider("datapass.architecture", host.viewProvider("map"), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider("datapass.details", host.viewProvider("detail"), { webviewOptions: { retainContextWhenHidden: true } }),
    // Kept alive while hidden so a pasted answer survives switching to Chat and back (memory only).
    aiExchange, vscode.window.registerWebviewViewProvider(AiExchangeView.viewType, aiExchange, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("datapass.showAiExchange", (kind?: unknown) => aiExchange.reveal(typeof kind === "string" ? kind as ExchangeKind : undefined))
  );
  registerWorkbenchCommands(context, session, host);
  registerOptionsCommands(context, session, host);
  registerBoardCommands(context, session, host);
  registerGitHostCommands(context, session);

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
    git, gitTree, gitView, git.onDidChange(gitBadge), git.onDidChange(() => host.refreshGit()),
    gitView.onDidChangeVisibility(e => { if (e.visible) void git.refresh(); }),
    vscode.window.onDidChangeWindowState(e => { if (e.focused) gitIfVisible(); }),
    session.onDidChange(gitIfVisible)
  );
  host.setGitSource(() => git.observation());
  registerGitCommands(context, session, git);

  // 0.20 work orders (pass AI-2): the Agent tab of the AI view, the Workbench's Work orders view, Details, Needs you rule 8.
  const workOrders = new WorkOrderService(context, session, git);
  const flows = new WorkOrderFlows(context, session, workOrders, git);
  aiExchange.attachWorkOrders(workOrders, flows, git);
  host.setWorkOrderSource(() => workOrders.view(), workOrders.onDidChange);
  context.subscriptions.push(workOrders);
  registerWorkOrderCommands(context, session, workOrders, flows, git,
    p => aiExchange.prefill(p),
    async id => {
      host.openPanel(vscode.ViewColumn.Active, "workOrders", id || undefined);
      if (id) await vscode.commands.executeCommand("datapass.details.focus");
      workOrders.refreshGit(Boolean(id));
    });
  void workOrders.reload();

  // 0.17 windows and work views: status-bar switcher, saved layouts, company workspace file, Power Ops list.
  const visiblePanes = (): Pane[] => {
    const shown: Record<Pane, boolean> = { project: projectView.visible, work: workView.visible, galaxy: galaxy.isVisible(), architecture: host.isVisible("map"), aiExchange: aiExchange.isVisible(), details: host.isVisible("detail") };
    return PANES.filter(p => shown[p]);
  };
  const views = new WorkViews(session, host, visiblePanes);
  context.subscriptions.push(views);
  const windows = registerWindowCommands(context, session, host, views);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = "$(dashboard) DataPass";
  status.tooltip = "Open DataPass Galaxy";
  status.command = "datapass.openGalaxy";
  const showStatus = () => { if (experience.shows("status.health")) status.show(); else status.hide(); };
  showStatus();
  context.subscriptions.push(status, experience.onDidChange(showStatus));

  const refreshState = async (): Promise<GalaxyState> => {
    // The session probes tools first so the Galaxy cards' operation readiness is current.
    await session.refresh();
    const state = await galaxy.refresh();
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
    vscode.commands.registerCommand("datapass.initializeFoilProjectManifest", async () => {
      await executeGalaxyAction("project.initializeManifestFoil", context.extensionUri);
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
    }),
    vscode.commands.registerCommand("datapass.selectFoilControlRoot", async () => {
      await selectFoilRoot("foil.controlRoot", "Select foil-control-v1 repository");
      await refreshState();
    }),
    vscode.commands.registerCommand("datapass.selectFoilDatabricksRoot", async () => {
      await selectFoilRoot("foil.databricksRoot", "Select foil_databrick_dab repository");
      await refreshState();
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
  const workWatcher = vscode.workspace.createFileSystemWatcher("**/.datapass/{graph.json,options.json,sheet.json,board.json,claims.json,packs/*.json,queries/*.json}");
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
  context.subscriptions.push(filesWatcher, envWatcher, { dispose: () => { if (pending) clearTimeout(pending); } });
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

  let landed: Promise<boolean> = Promise.resolve(false);
  // Once the project is loaded: DataPass in the secondary side bar (first time, 0.15.1), then the
  // startup work view or a launcher's request (0.17), which may arrange the panes differently.
  const startup = refreshState()
    .then(() => showDataPassSideBar(context, session).catch(() => undefined))
    .then(() => windows.startup())
    .then(async applied => { landed = landOnArchitecture(experience, session.project.manifestExists, applied).catch(() => false); await landed; experience.introduce(); return applied; })
    .catch(error => {
      output().appendLine(`[startup] ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });

  if (context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
  return {
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
    mongokuStatus: () => session.mongokuStatus(),
    handleUri: uri => companionUri.handleUri(uri),
    inventory: () => session.inventory(),
    qualification: () => session.qualification(),
    repositories: () => session.repositories(),
    projectMap: () => session.projectMap(),
    workbenchState: () => host.state(),
    selection: () => session.selection(),
    select: sel => session.select(sel),
    optionsAnalysis: () => session.optionsAnalysis(),
    setPreview: req => session.setPreview(req),
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
    experience: {
      current: () => experience.experience(),
      ready: () => experience.ready,
      status: () => ({ text: experience.statusText(), tooltip: experience.statusTooltip(), visible: experience.statusVisible() }),
      landed: async () => { await startup; return landed; }
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
  const editor = vscode.window.activeTextEditor;
  await vscode.commands.executeCommand(`${AiExchangeView.viewType}.focus`);
  // Give the keyboard back to the file being edited.
  if (editor) await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
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

async function selectFoilRoot(setting: string, title: string): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title
  });
  if (!picked?.[0]) return;
  await vscode.workspace.getConfiguration("datapass").update(
    setting,
    picked[0].fsPath,
    vscode.ConfigurationTarget.Workspace
  );
}