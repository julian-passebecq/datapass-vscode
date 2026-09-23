import * as path from "node:path";
import * as vscode from "vscode";
import { buildDatabricksBundleCommand, buildFabricSecurityAuditCommand, buildGrafanaPreviewCommand, buildIaCCommand, quoteShellArg } from "./commands";
import { parseToolCatalog } from "./catalog";
import { commandAvailable } from "./vscodeDetection";
import { getFoilBinding } from "../profiles/foil";

const URLS: Record<string, string> = {
  "fabric.toolbox": "https://github.com/microsoft/fabric-toolbox",
  "fabric.costAnalysis": "https://github.com/microsoft/fabric-toolbox/tree/main/monitoring/fabric-cost-analysis",
  "fabric.studioMarketplace": "https://marketplace.visualstudio.com/items?itemName=GerhardBrueckl.fabricstudio",
  "databricks.marketplace": "https://marketplace.visualstudio.com/items?itemName=databricks.databricks",
  "powerbi.agentic": "https://github.com/data-goblin/power-bi-agentic-development",
  "powerbi.macguyver": "https://github.com/data-goblin/powerbi-macguyver-toolbox",
  "powerbi.pbibench": "https://github.com/julian-passebecq/powerbi_enhanced_dev",
  "grafana.foundation": "https://github.com/grafana/grafana-foundation-sdk",
  "grafana.provider": "https://github.com/grafana/terraform-provider-grafana",
  "remoteSsh.marketplace": "https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh"
};

export async function executeGalaxyAction(action: string, extensionUri: vscode.Uri): Promise<void> {
  switch (action) {
    case "refresh": await vscode.commands.executeCommand("datapass.refresh"); return;
    case "fabric.open": await openFabric(); return;
    case "fabric.openStudio": await openFabricStudio(); return;
    case "fabric.openToolbox": await openUrl(URLS["fabric.toolbox"]!); return;
    case "fabric.securityAudit": await runFabricSecurityAudit(extensionUri); return;
    case "fabric.openCostAnalysis": await openUrl(URLS["fabric.costAnalysis"]!); return;
    case "fabric.configureToolbox": await selectFolderSetting("fabric.toolboxRoot", "Select local Microsoft Fabric Toolbox clone"); return;
    case "databricks.open": await openDatabricks(); return;
    case "databricks.copyValidate": await copyDatabricks("validate"); return;
    case "databricks.copyDeploy": await copyDatabricks("deploy"); return;
    case "powerbi.openAgentic": await openUrl(URLS["powerbi.agentic"]!); return;
    case "powerbi.openMacguyver": await openUrl(URLS["powerbi.macguyver"]!); return;
    case "powerbi.openPbiBench": await openUrl(URLS["powerbi.pbibench"]!); return;
    case "grafana.copyPreview": await copyGrafanaPreview(); return;
    case "grafana.openFoundation": await openUrl(URLS["grafana.foundation"]!); return;
    case "grafana.openProvider": await openUrl(URLS["grafana.provider"]!); return;
    case "infra.copyTofuValidate": await copyIaC("validate"); return;
    case "infra.copyTofuPlan": await copyIaC("plan"); return;
    case "infra.openRemoteSsh": await openRemoteSsh(); return;
    case "foil.selectControl": await vscode.commands.executeCommand("datapass.selectFoilControlRoot"); return;
    case "foil.selectDatabricks": await vscode.commands.executeCommand("datapass.selectFoilDatabricksRoot"); return;
    case "foil.openControl": await openFoilRoot("control"); return;
    case "foil.openDatabricks": await openFoilRoot("databricks"); return;
    case "foil.openOracle": await openFoilOracle(); return;
    default: void vscode.window.showWarningMessage(`DataPass: unknown action ${action}`);
  }
}

async function openFabric(): Promise<void> {
  if (await commandAvailable("vscode-fabric.refreshArtifactView")) {
    try {
      await vscode.commands.executeCommand("workbench.view.extension.vscode-fabric_view_workspace");
      return;
    } catch {
      // fall through
    }
  }
  await openUrl("https://app.fabric.microsoft.com/");
}

async function openFabricStudio(): Promise<void> {
  if (vscode.extensions.getExtension("GerhardBrueckl.fabricstudio")) {
    try {
      await vscode.commands.executeCommand("workbench.view.extension.fabricstudio");
      return;
    } catch {
      // fall through
    }
  }
  await openUrl(URLS["fabric.studioMarketplace"]!);
}

async function runFabricSecurityAudit(extensionUri: vscode.Uri): Promise<void> {
  const toolboxRoot = vscode.workspace.getConfiguration("datapass").get<string>("fabric.toolboxRoot", "").trim();
  if (!toolboxRoot) {
    void vscode.window.showWarningMessage("DataPass: configure a local Fabric Toolbox clone first.");
    return;
  }

  const catalogUri = vscode.Uri.joinPath(extensionUri, "resources", "catalogs", "fabric-tools.json");
  const bytes = await vscode.workspace.fs.readFile(catalogUri);
  const catalog = parseToolCatalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  const tool = catalog.items.find(item => item.id === "fabric-security-audit");
  if (!tool?.relativePath) {
    void vscode.window.showErrorMessage("DataPass: Fabric Security Audit catalog entry is missing its local path.");
    return;
  }

  const scriptPath = path.join(toolboxRoot, tool.relativePath);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(scriptPath));
  } catch {
    void vscode.window.showErrorMessage(`DataPass: Fabric Security Audit script not found at ${scriptPath}.`);
    return;
  }

  const url = await vscode.window.showInputBox({
    title: "Fabric Security Audit",
    prompt: "Paste the Fabric or Power BI item URL to audit",
    placeHolder: "https://app.fabric.microsoft.com/...",
    validateInput: value => /^https:\/\//i.test(value.trim()) ? undefined : "Enter a full https:// URL."
  });
  if (!url) return;

  const user = await vscode.window.showInputBox({
    title: "Fabric Security Audit",
    prompt: "Optional user UPN/email for the upstream audit script",
    placeHolder: "user@example.com"
  });

  let command: string;
  try {
    command = buildFabricSecurityAuditCommand(scriptPath, url, user || undefined);
  } catch (error) {
    void vscode.window.showErrorMessage(`DataPass: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Run the upstream Fabric Security Audit script now, or copy the generated command?",
    { modal: true },
    "Run",
    "Copy command"
  );
  if (!choice) return;

  await vscode.env.clipboard.writeText(command);
  if (choice === "Run") {
    const terminal = vscode.window.createTerminal({
      name: "Fabric Security Audit",
      shellPath: process.platform === "win32" ? "powershell.exe" : "pwsh"
    });
    terminal.show(true);
    terminal.sendText(command, true);
    return;
  }
  void vscode.window.showInformationMessage("DataPass: Fabric Security Audit command copied.");
}

async function openDatabricks(): Promise<void> {
  if (await commandAvailable("databricks.quickstart.open")) {
    await vscode.commands.executeCommand("databricks.quickstart.open");
    return;
  }
  await openUrl(URLS["databricks.marketplace"]!);
}

async function copyDatabricks(operation: "validate" | "deploy"): Promise<void> {
  const root = await resolveDatabricksRoot();
  if (!root) {
    void vscode.window.showWarningMessage("DataPass: bind a Databricks project or open a workspace containing databricks.yml/bundle.yml first.");
    return;
  }
  const command = buildDatabricksBundleCommand(operation, root);
  await vscode.env.clipboard.writeText(command);
  void vscode.window.showInformationMessage(`DataPass: copied Databricks bundle ${operation} command.`);
}

async function resolveDatabricksRoot(): Promise<string | undefined> {
  const foil = await getFoilBinding("databricks");
  if (foil) return foil;
  for (const glob of ["**/databricks.yml", "**/databricks.yaml", "**/bundle.yml", "**/bundle.yaml"]) {
    const found = await vscode.workspace.findFiles(glob, "**/{node_modules,.git,dist,out}/**", 1);
    if (found[0]) return path.dirname(found[0].fsPath);
  }
  return undefined;
}

async function copyGrafanaPreview(): Promise<void> {
  const config = vscode.workspace.getConfiguration("datapass");
  const generator = config.get<string>("grafana.generatorCommand", "");
  const watch = config.get<string>("grafana.watchPath", "");
  try {
    const command = buildGrafanaPreviewCommand(generator, watch || undefined);
    await vscode.env.clipboard.writeText(command);
    void vscode.window.showInformationMessage("DataPass: copied Grafana gcx preview command.");
  } catch (error) {
    void vscode.window.showWarningMessage(`DataPass: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function copyIaC(operation: "validate" | "plan"): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage("DataPass: open an infrastructure project folder first.");
    return;
  }
  const command = buildIaCCommand("tofu", operation, root);
  await vscode.env.clipboard.writeText(command);
  void vscode.window.showInformationMessage(`DataPass: copied tofu ${operation} command. It was not executed.`);
}

async function openRemoteSsh(): Promise<void> {
  if (await commandAvailable("workbench.action.remote.showMenu")) {
    await vscode.commands.executeCommand("workbench.action.remote.showMenu");
    return;
  }
  await openUrl(URLS["remoteSsh.marketplace"]!);
}

async function openFoilRoot(id: "control" | "databricks"): Promise<void> {
  const root = await getFoilBinding(id);
  if (!root) {
    void vscode.window.showWarningMessage(`DataPass: FOIL ${id} repository is not bound.`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root), { forceNewWindow: true });
}

async function openFoilOracle(): Promise<void> {
  const host = vscode.workspace.getConfiguration("datapass").get<string>("foil.oracleSshHost", "").trim();
  if (!host) {
    void vscode.window.showWarningMessage("DataPass: configure datapass.foil.oracleSshHost with an SSH config host alias first.");
    return;
  }
  const command = `ssh ${quoteShellArg(host)}`;
  await vscode.env.clipboard.writeText(command);
  if (await commandAvailable("workbench.action.remote.showMenu")) {
    await vscode.commands.executeCommand("workbench.action.remote.showMenu");
    void vscode.window.showInformationMessage(`DataPass: Remote SSH menu opened and ${command} copied as fallback.`);
    return;
  }
  void vscode.window.showInformationMessage(`DataPass: copied ${command}. Install/use Remote SSH to open the VM.`);
}

async function selectFolderSetting(setting: string, title: string): Promise<void> {
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title });
  if (!picked?.[0]) return;
  await vscode.workspace.getConfiguration("datapass").update(setting, picked[0].fsPath, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("datapass.refresh");
}

async function openUrl(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}