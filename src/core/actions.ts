import * as path from "node:path";
import * as vscode from "vscode";
import { clipboard } from "./clipboard";
import { openExternal } from "./external";
import {
  buildDatabricksBundleCommand,
  buildFabricAssessmentCommand,
  buildFabricCliCommand,
  buildFabricDeployCommand,
  fabricCliArgs,
  buildFabricSecurityAuditCommand,
  buildGrafanaPreviewCommand,
  buildIaCCommand,
  quoteShellArg
} from "./commands";
import { parseToolCatalog, type ToolCatalogItem } from "./catalog";
import { defaultProbeRunner } from "./detection";
import {
  renderSafeFabricDeploymentConfig,
  repositoryPathRelativeToConfig
} from "./fabricDeployment";
import { renderFabricPreflightWorkflow } from "./fabricWorkflow";
import { fabricToolboxMcpDefinition, mergeMcpServer, parseMcpConfig } from "./mcp";
import { commandAvailable } from "./vscodeDetection";
import { collectGalaxyState } from "./galaxyState";
import { buildSanitizedEnvironmentSnapshot } from "./snapshot";
import {
  buildCopilotMarketplaceCommand,
  buildCopilotPluginInstallCommand,
  type PowerBiAgenticPlugin
} from "./powerbiAgentic";
import { getFoilBinding } from "../profiles/foil";
import {
  getProjectPlatformConfig,
  resolveProjectRepository,
  workspaceFolderName
} from "./projectState";
import {
  foilProjectManifest,
  genericProjectManifest,
  readProjectManifest,
  resolveManifestPath,
  writeProjectManifest
} from "./projectManifest";

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
  if (action.startsWith("fabric.catalog::")) {
    await executeFabricCatalogAction(action, extensionUri);
    return;
  }
  if (action.startsWith("powerbi.installPlugin::")) {
    await copyPowerBiPluginInstall(action.slice("powerbi.installPlugin::".length));
    return;
  }
  if (action.startsWith("project.openRepo::")) {
    await openProjectRepository(action.slice("project.openRepo::".length));
    return;
  }
  if (action.startsWith("project.openLink::")) {
    await openProjectLink(action.slice("project.openLink::".length));
    return;
  }

  switch (action) {
    case "refresh": await vscode.commands.executeCommand("datapass.refresh"); return;
    case "project.initializeManifest": await initializeProjectManifest("generic"); return;
    case "project.initializeManifestFoil": await initializeProjectManifest("foil"); return;
    case "project.openManifest": await openProjectManifest(); return;
    case "project.copyEnvironmentSnapshot": await copyEnvironmentSnapshot(extensionUri); return;
    case "fabric.open": await openFabric(); return;
    case "fabric.openStudio": await openFabricStudio(); return;
    case "fabric.openToolbox": await openUrl(URLS["fabric.toolbox"]!); return;
    case "fabric.authStatus": await runFabricCli("auth-status"); return;
    case "fabric.login": await runFabricCli("login"); return;
    case "fabric.listWorkspaces": await runFabricCli("list-workspaces"); return;
    case "fabric.listProjectWorkspace": await runFabricCli("list-workspace-items"); return;
    case "fabric.captureSummary": await captureFabricEnvironmentSummary(); return;
    case "fabric.scaffoldDeployConfig": await scaffoldFabricDeployConfig(); return;
    case "fabric.copyDeployCommand": await copyFabricDeployCommand(); return;
    case "fabric.scaffoldPreflightWorkflow": await scaffoldFabricPreflightWorkflow(); return;
    case "fabric.securityAudit": await runFabricSecurityAudit(extensionUri); return;
    case "fabric.openCostAnalysis": await openUrl(URLS["fabric.costAnalysis"]!); return;
    case "fabric.configureToolbox": await selectFolderSetting("fabric.toolboxRoot", "Select local Microsoft Fabric Toolbox clone"); return;
    case "databricks.open": await openDatabricks(); return;
    case "databricks.copyValidate": await copyDatabricks("validate"); return;
    case "databricks.copyDeploy": await copyDatabricks("deploy"); return;
    case "powerbi.addMarketplace": await copyPowerBiMarketplaceAdd(); return;
    case "powerbi.openAgentic": await openUrl(URLS["powerbi.agentic"]!); return;
    case "powerbi.openMacguyver": await openUrl(URLS["powerbi.macguyver"]!); return;
    case "powerbi.openPbiBench": await openUrl(URLS["powerbi.pbibench"]!); return;
    case "grafana.copyPreview": await copyGrafanaPreview(); return;
    // Same reviewed path as the Work view's Links: confirm once per address, re-resolve, open.
    case "grafana.openStack": await vscode.commands.executeCommand("datapass.openCompanionLink", "grafana.home"); return;
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

async function copyPowerBiMarketplaceAdd(): Promise<void> {
  const command = buildCopilotMarketplaceCommand();
  await clipboard.writeText(command);
  void vscode.window.showInformationMessage(
    "DataPass: copied Copilot CLI marketplace registration command. Nothing was installed."
  );
}

async function copyPowerBiPluginInstall(pluginId: string): Promise<void> {
  const allowed: PowerBiAgenticPlugin[] = [
    "pbip",
    "semantic-models",
    "reports",
    "pbi-desktop",
    "tabular-editor",
    "fabric-cli"
  ];
  if (!allowed.includes(pluginId as PowerBiAgenticPlugin)) {
    void vscode.window.showWarningMessage(`DataPass: unsupported Power BI agentic plugin "${pluginId}".`);
    return;
  }
  const command = buildCopilotPluginInstallCommand(pluginId as PowerBiAgenticPlugin);
  await clipboard.writeText(command);
  void vscode.window.showInformationMessage(
    `DataPass: copied Copilot CLI install command for ${pluginId}. Nothing was installed.`
  );
}

async function copyEnvironmentSnapshot(extensionUri: vscode.Uri): Promise<void> {
  const state = await collectGalaxyState(extensionUri);
  const snapshot = buildSanitizedEnvironmentSnapshot(state);
  await clipboard.writeText(JSON.stringify(snapshot, null, 2));
  void vscode.window.showInformationMessage(
    "DataPass: copied sanitized environment snapshot. Local paths, action payloads and credentials are omitted."
  );
}

async function initializeProjectManifest(kind: "generic" | "foil"): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.[0]) {
    void vscode.window.showWarningMessage("DataPass: open a workspace folder before creating a project manifest.");
    return;
  }

  const existing = await readProjectManifest();
  if (existing.exists) {
    await openProjectManifest();
    return;
  }

  const manifest = kind === "foil"
    ? foilProjectManifest()
    : genericProjectManifest(workspaceFolderName());

  const uri = await writeProjectManifest(manifest);
  await vscode.window.showTextDocument(uri);
  await vscode.commands.executeCommand("datapass.refresh");
  void vscode.window.showInformationMessage("DataPass: created .datapass/project.json. Keep secrets out of this file.");
}

async function openProjectManifest(): Promise<void> {
  const result = await readProjectManifest();
  if (!result.uri || !result.exists) {
    void vscode.window.showWarningMessage("DataPass: no .datapass/project.json exists in this workspace.");
    return;
  }
  await vscode.window.showTextDocument(result.uri);
}

async function openProjectLink(indexText: string): Promise<void> {
  const index = Number(indexText);
  const manifest = (await readProjectManifest()).manifest;
  const link = Number.isInteger(index) ? manifest?.links?.[index] : undefined;
  if (!link) {
    void vscode.window.showWarningMessage("DataPass: project link is no longer available.");
    return;
  }
  await openUrl(link.url);
}

async function openProjectRepository(key: string): Promise<void> {
  const root = await resolveProjectRepository(key);
  if (!root) {
    void vscode.window.showWarningMessage(`DataPass: project repository "${key}" is not bound.`);
    return;
  }
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(root));
  } catch {
    void vscode.window.showErrorMessage(`DataPass: project repository path does not exist: ${root}`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root), { forceNewWindow: true });
}

async function captureFabricEnvironmentSummary(): Promise<void> {
  const projectConfig = await getProjectPlatformConfig();
  const workspace = projectConfig?.fabric?.workspaceName?.trim();
  if (!workspace) {
    void vscode.window.showWarningMessage(
      "DataPass: declare platforms.fabric.workspaceName before capturing a Fabric environment summary."
    );
    return;
  }

  const channel = vscode.window.createOutputChannel("DataPass Fabric Environment");
  channel.clear();
  channel.appendLine(`DataPass Fabric Environment — ${workspace}`);
  channel.appendLine("Read-only capture using the official Fabric CLI.");
  channel.appendLine("");

  const checks: Array<{ title: string; args: string[] }> = [
    { title: "Workspace", args: fabricCliArgs("get-workspace", workspace) },
    { title: "Workspace items", args: fabricCliArgs("list-workspace-items", workspace) }
  ];

  for (const check of checks) {
    channel.appendLine(`## ${check.title}`);
    const result = await defaultProbeRunner("fab", check.args, 15000);
    if (result.ok) {
      channel.appendLine(result.output || "(no output)");
    } else {
      channel.appendLine(`ERROR: ${result.error || "Fabric CLI command failed."}`);
    }
    channel.appendLine("");
  }

  channel.appendLine("No Fabric mutation command was executed.");
  channel.show(true);
}

async function scaffoldFabricDeployConfig(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage("DataPass: open a workspace folder before scaffolding Fabric deployment.");
    return;
  }

  const projectConfig = await getProjectPlatformConfig();
  const fabric = projectConfig?.fabric;
  if (!fabric?.workspaceName?.trim() && !fabric?.workspaceId?.trim()) {
    void vscode.window.showWarningMessage(
      "DataPass: verify and declare a Fabric workspace name or ID in .datapass/project.json first."
    );
    return;
  }

  const deployment = fabric.deployment;
  const configRelative = deployment?.configPath?.trim() || ".deploy/fabric.yml";
  const repositoryRelative = deployment?.repositoryDirectory?.trim() || ".";
  const configPath = resolveManifestPath(workspaceRoot, configRelative);
  const repositoryPath = resolveManifestPath(workspaceRoot, repositoryRelative);
  const repositoryFromConfig = repositoryPathRelativeToConfig(configPath, repositoryPath);

  let content: string;
  try {
    content = renderSafeFabricDeploymentConfig({
      workspaceName: fabric.workspaceName,
      workspaceId: fabric.workspaceId,
      repositoryDirectory: repositoryFromConfig
    });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `DataPass: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const configUri = vscode.Uri.file(configPath);
  try {
    await vscode.workspace.fs.stat(configUri);
    const choice = await vscode.window.showWarningMessage(
      `Fabric deployment config already exists at ${configRelative}.`,
      { modal: true },
      "Open existing",
      "Replace with safe baseline"
    );
    if (choice === "Open existing") {
      await vscode.window.showTextDocument(configUri);
      return;
    }
    if (choice !== "Replace with safe baseline") return;
  } catch {
    // file does not exist
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(configPath)));
  await vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(content));
  await vscode.window.showTextDocument(configUri);
  void vscode.window.showInformationMessage(
    "DataPass: created Fabric deployment config with unpublish disabled. Review it before any deployment."
  );
}

async function scaffoldFabricPreflightWorkflow(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage("DataPass: open a workspace folder before scaffolding Fabric CI preflight.");
    return;
  }

  const projectConfig = await getProjectPlatformConfig();
  const fabric = projectConfig?.fabric;
  const workspace = fabric?.workspaceName?.trim();
  if (!workspace) {
    void vscode.window.showWarningMessage(
      "DataPass: declare platforms.fabric.workspaceName before creating the Fabric preflight workflow."
    );
    return;
  }

  const configRelative = fabric?.deployment?.configPath?.trim() || ".deploy/fabric.yml";
  const workflowPath = path.join(workspaceRoot, ".github", "workflows", "fabric-preflight.yml");
  const workflowUri = vscode.Uri.file(workflowPath);

  let content: string;
  try {
    content = renderFabricPreflightWorkflow({
      workspaceName: workspace,
      deploymentConfigPath: configRelative
    });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `DataPass: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  try {
    await vscode.workspace.fs.stat(workflowUri);
    const choice = await vscode.window.showWarningMessage(
      "Fabric preflight workflow already exists.",
      { modal: true },
      "Open existing",
      "Replace"
    );
    if (choice === "Open existing") {
      await vscode.window.showTextDocument(workflowUri);
      return;
    }
    if (choice !== "Replace") return;
  } catch {
    // workflow does not exist
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(workflowPath)));
  await vscode.workspace.fs.writeFile(workflowUri, new TextEncoder().encode(content));
  await vscode.window.showTextDocument(workflowUri);
  void vscode.window.showInformationMessage(
    "DataPass: created manual read-only Fabric preflight workflow. Configure the referenced Azure OIDC secrets before running it."
  );
}

async function copyFabricDeployCommand(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage("DataPass: open a workspace folder first.");
    return;
  }

  const projectConfig = await getProjectPlatformConfig();
  const fabric = projectConfig?.fabric;
  const deployment = fabric?.deployment;
  const configRelative = deployment?.configPath?.trim() || ".deploy/fabric.yml";
  const configPath = resolveManifestPath(workspaceRoot, configRelative);

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(configPath));
  } catch {
    void vscode.window.showWarningMessage(
      "DataPass: Fabric deployment config does not exist yet. Use Scaffold deploy config first."
    );
    return;
  }

  let command: string;
  try {
    command = buildFabricDeployCommand(
      configRelative,
      deployment?.targetEnvironment
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `DataPass: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  await clipboard.writeText(command);
  void vscode.window.showWarningMessage(
    "DataPass copied a Fabric deployment command but did not run it. The generated baseline disables unpublish; review the config before execution."
  );
}

async function runFabricCli(
  operation: "auth-status" | "login" | "list-workspaces" | "list-workspace-items"
): Promise<void> {
  const projectConfig = await getProjectPlatformConfig();
  const workspace = projectConfig?.fabric?.workspaceName?.trim();

  if (operation === "list-workspace-items" && !workspace) {
    void vscode.window.showWarningMessage(
      "DataPass: declare platforms.fabric.workspaceName in .datapass/project.json before inspecting the project workspace."
    );
    return;
  }

  let command: string;
  try {
    command = buildFabricCliCommand(operation, workspace);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `DataPass: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const title =
    operation === "auth-status" ? "Fabric CLI Auth Status" :
    operation === "login" ? "Fabric CLI Login" :
    operation === "list-workspaces" ? "Fabric CLI Workspaces" :
    "Fabric CLI Project Workspace";

  const terminal = vscode.window.createTerminal({ name: title });
  terminal.show(true);
  terminal.sendText(command, true);
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

async function executeFabricCatalogAction(actionId: string, extensionUri: vscode.Uri): Promise<void> {
  const parts = actionId.split("::");
  const itemId = parts[1];
  const action = parts[2];
  if (!itemId || !action) {
    void vscode.window.showWarningMessage("DataPass: malformed Fabric Toolbox action.");
    return;
  }

  const catalog = await loadFabricCatalog(extensionUri);
  const item = catalog.items.find(candidate => candidate.id === itemId);
  if (!item) {
    void vscode.window.showWarningMessage(`DataPass: Fabric Toolbox item "${itemId}" is not registered.`);
    return;
  }

  switch (action) {
    case "read":
      await openUrl(item.url);
      return;
    case "clone":
      await copyCatalogCloneCommand(item);
      return;
    case "configure":
      if (item.id === "fabric-security-audit") {
        await selectFolderSetting("fabric.toolboxRoot", "Select local Microsoft Fabric Toolbox clone");
        return;
      }
      if (isFabricMcpItem(item.id)) {
        await configureFabricMcp(item);
        return;
      }
      await openCatalogConfiguration(item);
      return;
    case "run":
      if (item.id === "fabric-security-audit") {
        await runFabricSecurityAudit(extensionUri);
        return;
      }
      if (item.id === "fabric-assessment-tool") {
        await runFabricAssessment();
        return;
      }
      break;
  }

  void vscode.window.showInformationMessage(`DataPass: ${item.name} · ${action} is catalogued but intentionally not automated yet.`);
}

function isFabricMcpItem(itemId: string): boolean {
  return itemId === "semantic-model-mcp"
    || itemId === "fabric-management-mcp"
    || itemId === "dax-performance-mcp";
}

async function configureFabricMcp(item: ToolCatalogItem): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage("DataPass: open a workspace folder before configuring MCP.");
    return;
  }

  const toolboxRoot = await resolveFabricToolboxRoot();
  if (!toolboxRoot) {
    const choice = await vscode.window.showWarningMessage(
      "DataPass: configure a local Microsoft Fabric Toolbox clone before adding this MCP server.",
      "Configure Toolbox",
      "Open upstream"
    );
    if (choice === "Configure Toolbox") {
      await selectFolderSetting("fabric.toolboxRoot", "Select local Microsoft Fabric Toolbox clone");
    } else if (choice === "Open upstream") {
      await openUrl(item.url);
    }
    return;
  }

  let definition;
  try {
    definition = fabricToolboxMcpDefinition(item.id, toolboxRoot);
  } catch (error) {
    void vscode.window.showWarningMessage(`DataPass: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(definition.executablePath));
  } catch {
    const choice = await vscode.window.showWarningMessage(
      `DataPass: ${item.name} is not built/installed at the expected upstream path.`,
      "Open setup instructions",
      "Open local folder"
    );
    if (choice === "Open setup instructions") await openUrl(item.url);
    if (choice === "Open local folder") {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(definition.workingRoot),
        { forceNewWindow: true }
      );
    }
    return;
  }

  const vscodeDir = vscode.Uri.joinPath(workspaceRoot, ".vscode");
  const mcpUri = vscode.Uri.joinPath(vscodeDir, "mcp.json");
  await vscode.workspace.fs.createDirectory(vscodeDir);

  let config = { servers: {} as Record<string, { command: string; args?: string[] }> };
  try {
    const bytes = await vscode.workspace.fs.readFile(mcpUri);
    config = parseMcpConfig(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      // new configuration
    } else {
      try {
        await vscode.workspace.fs.stat(mcpUri);
        void vscode.window.showErrorMessage(
          `DataPass: existing .vscode/mcp.json could not be safely parsed: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      } catch {
        // file does not exist
      }
    }
  }

  const existing = config.servers[definition.serverName];
  if (existing) {
    const replace = await vscode.window.showWarningMessage(
      `MCP server "${definition.serverName}" already exists. Replace it with the verified local Fabric Toolbox path?`,
      { modal: true },
      "Replace"
    );
    if (replace !== "Replace") return;
  }

  const merged = mergeMcpServer(config, definition.serverName, definition.server);
  await vscode.workspace.fs.writeFile(
    mcpUri,
    new TextEncoder().encode(JSON.stringify(merged, null, 2) + "\n")
  );
  await vscode.window.showTextDocument(mcpUri);
  void vscode.window.showInformationMessage(
    `DataPass: configured ${item.name} in .vscode/mcp.json without storing credentials.`
  );
}

async function runFabricAssessment(): Promise<void> {
  const source = await vscode.window.showQuickPick(
    [
      { label: "Databricks", value: "databricks" as const },
      { label: "Synapse", value: "synapse" as const }
    ],
    { title: "Fabric Assessment Tool", placeHolder: "Select source platform" }
  );
  if (!source) return;

  let cloud: "azure" | "aws" | undefined = "azure";
  if (source.value === "databricks") {
    const cloudChoice = await vscode.window.showQuickPick(
      [
        { label: "Azure", value: "azure" as const },
        { label: "AWS", value: "aws" as const }
      ],
      { title: "Fabric Assessment Tool", placeHolder: "Select Databricks cloud" }
    );
    if (!cloudChoice) return;
    cloud = cloudChoice.value;
  }

  const workspace = await vscode.window.showInputBox({
    title: "Fabric Assessment Tool",
    prompt: "Optional workspace name. Leave blank to use the tool's interactive selection when supported."
  });

  const output = await vscode.window.showInputBox({
    title: "Fabric Assessment Tool",
    prompt: "Output directory",
    value: "./fabric-assessment-output",
    validateInput: value => value.trim() ? undefined : "Output directory is required."
  });
  if (!output) return;

  let command: string;
  try {
    command = buildFabricAssessmentCommand({
      source: source.value,
      workspace: workspace || undefined,
      output,
      cloud
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`DataPass: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Run the Fabric Assessment Tool now, or copy the generated command?",
    { modal: true },
    "Run",
    "Copy command"
  );
  if (!choice) return;

  await clipboard.writeText(command);
  if (choice === "Run") {
    const terminal = vscode.window.createTerminal({ name: "Fabric Assessment Tool" });
    terminal.show(true);
    terminal.sendText(command, true);
    return;
  }
  void vscode.window.showInformationMessage("DataPass: Fabric Assessment Tool command copied.");
}

async function openCatalogConfiguration(item: ToolCatalogItem): Promise<void> {
  const toolboxRoot = await resolveFabricToolboxRoot();
  if (toolboxRoot && item.relativePath) {
    const localUri = vscode.Uri.file(path.join(toolboxRoot, item.relativePath));
    try {
      await vscode.workspace.fs.stat(localUri);
      await vscode.window.showTextDocument(localUri);
      return;
    } catch {
      // fall back to upstream documentation
    }
  }
  await openUrl(item.url);
  void vscode.window.showInformationMessage(`DataPass: opened upstream setup for ${item.name}.`);
}

async function copyCatalogCloneCommand(item: ToolCatalogItem): Promise<void> {
  const repoUrl = sourceRepositoryUrl(item.source);
  if (!repoUrl) {
    void vscode.window.showWarningMessage(`DataPass: no clone source registered for ${item.source}.`);
    return;
  }
  const command = `git clone ${quoteShellArg(repoUrl)}`;
  await clipboard.writeText(command);
  void vscode.window.showInformationMessage(`DataPass: copied clone command for ${item.source}.`);
}

function sourceRepositoryUrl(source: string): string | undefined {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    return `https://github.com/${source}.git`;
  }
  return undefined;
}

async function runFabricSecurityAudit(extensionUri: vscode.Uri): Promise<void> {
  const toolboxRoot = await resolveFabricToolboxRoot();
  if (!toolboxRoot) {
    void vscode.window.showWarningMessage("DataPass: configure a local Fabric Toolbox clone first.");
    return;
  }

  const catalog = await loadFabricCatalog(extensionUri);
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

  await clipboard.writeText(command);
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

async function loadFabricCatalog(extensionUri: vscode.Uri) {
  const catalogUri = vscode.Uri.joinPath(extensionUri, "resources", "catalogs", "fabric-tools.json");
  const bytes = await vscode.workspace.fs.readFile(catalogUri);
  return parseToolCatalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
}

async function resolveFabricToolboxRoot(): Promise<string | undefined> {
  const localOverride = vscode.workspace.getConfiguration("datapass").get<string>("fabric.toolboxRoot", "").trim();
  if (localOverride) return localOverride;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const projectConfig = await getProjectPlatformConfig();
  const configured = projectConfig?.fabric?.toolboxRoot?.trim();
  if (workspaceRoot && configured) return resolveManifestPath(workspaceRoot, configured);
  return undefined;
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
  await clipboard.writeText(command);
  void vscode.window.showInformationMessage(`DataPass: copied Databricks bundle ${operation} command.`);
}

async function resolveDatabricksRoot(): Promise<string | undefined> {
  const repoRoot = await resolveProjectRepository("databricks");
  if (repoRoot) return repoRoot;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const projectConfig = await getProjectPlatformConfig();
  const configured = projectConfig?.databricks?.bundleRoot?.trim();
  if (workspaceRoot && configured) return resolveManifestPath(workspaceRoot, configured);

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
  const projectConfig = await getProjectPlatformConfig();
  const generator = config.get<string>("grafana.generatorCommand", "").trim()
    || projectConfig?.grafana?.generatorCommand?.trim()
    || "";
  const watch = config.get<string>("grafana.watchPath", "").trim()
    || projectConfig?.grafana?.watchPath?.trim()
    || "";

  try {
    const command = buildGrafanaPreviewCommand(generator, watch || undefined);
    await clipboard.writeText(command);
    void vscode.window.showInformationMessage("DataPass: copied Grafana gcx preview command.");
  } catch (error) {
    void vscode.window.showWarningMessage(`DataPass: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function copyIaC(operation: "validate" | "plan"): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage("DataPass: open an infrastructure project folder first.");
    return;
  }
  const projectConfig = await getProjectPlatformConfig();
  const configured = projectConfig?.infrastructure?.root?.trim();
  const root = configured ? resolveManifestPath(workspaceRoot, configured) : workspaceRoot;
  const command = buildIaCCommand("tofu", operation, root);
  await clipboard.writeText(command);
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
  const manifestRoot = await resolveProjectRepository(id);
  const root = manifestRoot || await getFoilBinding(id);
  if (!root) {
    void vscode.window.showWarningMessage(`DataPass: FOIL ${id} repository is not bound.`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root), { forceNewWindow: true });
}

async function openFoilOracle(): Promise<void> {
  const localOverride = vscode.workspace.getConfiguration("datapass").get<string>("foil.oracleSshHost", "").trim();
  const projectConfig = await getProjectPlatformConfig();
  const host = localOverride || projectConfig?.oracle?.sshHost?.trim() || "";
  if (!host) {
    void vscode.window.showWarningMessage("DataPass: configure an SSH config host alias in settings or .datapass/project.json first.");
    return;
  }
  const command = `ssh ${quoteShellArg(host)}`;
  await clipboard.writeText(command);
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
  await openExternal(vscode.Uri.parse(url, true));
}