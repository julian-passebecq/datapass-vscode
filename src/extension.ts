import * as vscode from "vscode";
import { GalaxyViewProvider } from "./views/galaxy";

export function activate(context: vscode.ExtensionContext): void {
  const galaxy = new GalaxyViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GalaxyViewProvider.viewType,
      galaxy,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = "$(dashboard) DataPass";
  status.tooltip = "Open DataPass Galaxy";
  status.command = "datapass.openGalaxy";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("datapass.refresh", async () => {
      const state = await galaxy.refresh();
      const ready = state.platforms.filter(item => item.status === "ready").length;
      const partial = state.platforms.filter(item => item.status === "partial").length;
      status.text = `$(dashboard) DataPass ${ready} ready · ${partial} partial`;
    }),
    vscode.commands.registerCommand("datapass.openGalaxy", async () => {
      await vscode.commands.executeCommand("workbench.actions.view.openView", GalaxyViewProvider.viewType);
    }),
    vscode.commands.registerCommand("datapass.selectFoilControlRoot", async () => {
      await selectFoilRoot("foil.controlRoot", "Select foil-control-v1 repository");
      await galaxy.refresh();
    }),
    vscode.commands.registerCommand("datapass.selectFoilDatabricksRoot", async () => {
      await selectFoilRoot("foil.databricksRoot", "Select foil_databrick_dab repository");
      await galaxy.refresh();
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/{databricks,bundle}.{yml,yaml}");
  const refresh = () => void galaxy.refresh();
  watcher.onDidCreate(refresh);
  watcher.onDidChange(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("datapass")) void galaxy.refresh();
    })
  );
}

export function deactivate(): void {}

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
