import * as vscode from "vscode";
import { GalaxyViewProvider } from "./views/galaxy";
import { executeGalaxyAction } from "./core/actions";
import type { GalaxyState } from "./core/types";
import { WorkSession } from "./work/session";
import { WorkTreeProvider } from "./views/workTree";
import { registerWorkCommands } from "./work/commands";
import { registerBridgeCommands } from "./work/bridgeCommands";
import { setClipboardForTests, type Clipboard } from "./core/clipboard";
import { platformOperations } from "./core/capabilities/platformOperations";

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
  const workWatcher = vscode.workspace.createFileSystemWatcher("**/.datapass/{graph.json,claims.json,packs/*.json,queries/*.json}");
  workWatcher.onDidCreate(workRefresh);
  workWatcher.onDidChange(workRefresh);
  workWatcher.onDidDelete(workRefresh);

  context.subscriptions.push(bundleWatcher, manifestWatcher, workWatcher);

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