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
import { registerResourceCommands } from "./work/resourceCommands";
import { registerQualificationCommands } from "./work/qualificationCommands";
import { platformOperations } from "./core/capabilities/platformOperations";
import { WorkbenchHost } from "./views/workbench";
import { ProjectTreeProvider } from "./views/projectTree";
import { registerWorkbenchCommands } from "./work/workbenchCommands";
import { registerOptionsCommands } from "./work/optionsCommands";
import type { WorkbenchState } from "./views/workbenchState";

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
}

export function activate(context: vscode.ExtensionContext): DataPassTestApi | undefined {
  // V2.2 Work view: scope → next step → checklist → operation readiness → outputs → exchanges.
  const session = new WorkSession(context);
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
  setReadinessSource(() => session.project.manifest ? session.readiness() : undefined);

  // V3 Workbench: Project tree (left), Architecture diagram (bottom panel), Details (secondary side bar), Workbench tab.
  const host = new WorkbenchHost(context, session);
  const projectTree = new ProjectTreeProvider(session);
  const projectView = vscode.window.createTreeView(ProjectTreeProvider.viewType, { treeDataProvider: projectTree, showCollapseAll: true });
  projectTree.attach(projectView);
  context.subscriptions.push(
    host, projectTree, projectView,
    vscode.window.registerWebviewViewProvider("datapass.architecture", host.viewProvider("map"), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider("datapass.details", host.viewProvider("detail"), { webviewOptions: { retainContextWhenHidden: true } })
  );
  registerWorkbenchCommands(context, session, host);
  registerOptionsCommands(context, session, host);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = "$(dashboard) DataPass";
  status.tooltip = "Open DataPass Galaxy";
  status.command = "datapass.openGalaxy";
  status.show();
  context.subscriptions.push(status);

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
  const workWatcher = vscode.workspace.createFileSystemWatcher("**/.datapass/{graph.json,options.json,sheet.json,claims.json,packs/*.json,queries/*.json}");
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

  void refreshState();

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