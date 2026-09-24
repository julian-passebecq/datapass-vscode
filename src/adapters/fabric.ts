import * as vscode from "vscode";
import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { CatalogItemState, PlatformAction, PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { anyWorkspaceFile, detectAnyExtension, detectExtension } from "../core/vscodeDetection";
import { parseToolCatalog, type CatalogAction, type ToolCatalog } from "../core/catalog";
import { getProjectPlatformConfig } from "../core/projectState";
import { resolveManifestPath } from "../core/projectManifest";

export class FabricAdapter implements PlatformAdapter {
  readonly id = "fabric";
  readonly displayName = "Microsoft Fabric";

  constructor(private readonly extensionUri: vscode.Uri) {}

  async detect(): Promise<PlatformState> {
    // Card status reflects the core route (Fabric extension + fab CLI). Task-specific routes
    // (Data Engineering notebooks, community explorers) are evaluated per operation in the
    // Work view preflight, so they are optional here and never lower the card status.
    const integrationTools: ToolProbe[] = [
      detectExtension("fabric.vscode-fabric", "Microsoft Fabric VS Code"),
      await detectCli({ id: "fab", label: "Fabric CLI", command: "fab", args: ["--version"] }),
      detectAnyExtension(["SynapseVSCode.synapse", "SynapseVSCode.vscode-synapse-remote"], "Fabric Data Engineering", {
        optional: true, note: "notebooks, Spark job definitions, environments, lakehouses; needs Jupyter + a JDK for local runs"
      }),
      detectAnyExtension(["ms-toolsai.jupyter"], "Jupyter", { optional: true, note: "required by Fabric Data Engineering notebooks" }),
      { ...detectExtension("GerhardBrueckl.fabricstudio", "Fabric Studio (community)"), optional: true },
      { ...detectExtension("GerhardBrueckl.onelake-vscode", "OneLake-VSCode (community)"), optional: true }
    ];
    const workflowTools: ToolProbe[] = [
      await detectCli({ id: "fat", label: "Fabric Assessment Tool", command: "fat", args: ["--help"] }),
      await detectCli({ id: "python", label: "Python", command: process.platform === "win32" ? "python" : "python3", args: ["--version"] }),
      await detectCli({ id: "pwsh", label: "PowerShell 7", command: "pwsh", args: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"] }),
      await detectCli({ id: "dotnet", label: ".NET SDK", command: "dotnet", args: ["--version"] })
    ];
    const workspaceMcp = await anyWorkspaceFile([".vscode/mcp.json"]);
    const fabAvailable = integrationTools.find(tool => tool.id === "fab")?.available ?? false;
    const config = vscode.workspace.getConfiguration("datapass");
    const localOverride = config.get<string>("fabric.toolboxRoot", "").trim();
    const platformConfig = await getProjectPlatformConfig();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manifestToolbox = platformConfig?.fabric?.toolboxRoot?.trim();
    const toolboxRoot = localOverride || (workspaceRoot && manifestToolbox ? resolveManifestPath(workspaceRoot, manifestToolbox) : "");
    const fabricConfig = platformConfig?.fabric;
    const hasWorkspaceIdentity = Boolean(fabricConfig?.workspaceName?.trim() || fabricConfig?.workspaceId?.trim());
    const deployConfigRelative = fabricConfig?.deployment?.configPath?.trim() || ".deploy/fabric.yml";
    const deployConfigExists = workspaceRoot
      ? await exists(vscode.Uri.file(resolveManifestPath(workspaceRoot, deployConfigRelative)))
      : false;
    const catalog = await this.loadCatalog();
    const fatAvailable = workflowTools.find(tool => tool.id === "fat")?.available ?? false;
    const catalogItems = catalog.items.map(item => toCatalogItemState(item, Boolean(toolboxRoot), fatAvailable));
    const tools: ToolProbe[] = [
      ...integrationTools,
      ...workflowTools,
      {
        id: "workspace-mcp",
        label: "Workspace MCP configuration",
        available: workspaceMcp,
        optional: true,
        detail: workspaceMcp ? ".vscode/mcp.json detected" : "No workspace MCP configuration detected"
      },
      {
        id: "fabric-toolbox-catalog",
        label: "Fabric Toolbox catalog",
        available: catalog.items.length > 0,
        version: `${catalog.items.length} assets`,
        detail: toolboxRoot ? `Local clone: ${toolboxRoot}` : "Catalog available; local clone not configured"
      }
    ];
    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(integrationTools, Boolean(toolboxRoot)),
      summary: `${integrationTools.filter(tool => !tool.optional && tool.available).length}/${integrationTools.filter(tool => !tool.optional).length} core Fabric surfaces detected (+${integrationTools.filter(tool => tool.optional && tool.available).length} optional). ${catalog.items.length} curated Toolbox assets registered.`,
      tools,
      actions: [
        { id: "fabric.open", label: "Open Fabric", enabled: true, kind: "open" },
        { id: "fabric.openStudio", label: "Open Fabric Studio", enabled: true, kind: "open" },
        { id: "fabric.authStatus", label: "Auth status", enabled: fabAvailable, kind: "run", detail: fabAvailable ? "Run official fab auth status." : "Install Microsoft Fabric CLI first." },
        { id: "fabric.login", label: "Login", enabled: fabAvailable, kind: "run", detail: fabAvailable ? "Run official interactive fab auth login." : "Install Microsoft Fabric CLI first." },
        { id: "fabric.listWorkspaces", label: "List workspaces", enabled: fabAvailable, kind: "run", detail: fabAvailable ? "Run read-only fab ls." : "Install Microsoft Fabric CLI first." },
        { id: "fabric.listProjectWorkspace", label: "Project workspace", enabled: fabAvailable && Boolean(fabricConfig?.workspaceName), kind: "run", detail: fabricConfig?.workspaceName ? `Inspect ${fabricConfig.workspaceName}.Workspace with fab ls -l.` : "Declare platforms.fabric.workspaceName in the project manifest." },
        { id: "fabric.captureSummary", label: "Environment summary", enabled: fabAvailable && Boolean(fabricConfig?.workspaceName), kind: "run", detail: fabricConfig?.workspaceName ? "Capture read-only workspace metadata and item listing in a local VS Code output channel." : "Declare platforms.fabric.workspaceName first." },
        { id: "fabric.scaffoldDeployConfig", label: "Scaffold deploy config", enabled: Boolean(workspaceRoot && hasWorkspaceIdentity), kind: "configure", detail: hasWorkspaceIdentity ? "Create a local Fabric deployment YAML with unpublish disabled." : "Verify and declare a Fabric workspace name or ID first." },
        { id: "fabric.copyDeployCommand", label: "Copy deploy command", enabled: fabAvailable && deployConfigExists, kind: "copy", detail: deployConfigExists ? "Copy fab deploy command only; DataPass will not execute it." : `Scaffold ${deployConfigRelative} first.` },
        { id: "fabric.scaffoldPreflightWorkflow", label: "Scaffold CI preflight", enabled: Boolean(workspaceRoot && fabricConfig?.workspaceName && deployConfigExists), kind: "configure", detail: deployConfigExists ? "Create a manual read-only GitHub Actions preflight using Azure OIDC." : "Scaffold the Fabric deployment config first." },
        { id: "fabric.openToolbox", label: "Fabric Toolbox", enabled: true, kind: "link" },
        { id: "fabric.securityAudit", label: "Security audit", enabled: Boolean(toolboxRoot), kind: "run", detail: toolboxRoot ? "Run the upstream Fabric Toolbox security audit script." : "Configure a local Fabric Toolbox clone first." },
        { id: "fabric.openCostAnalysis", label: "Cost Analysis", enabled: true, kind: "link" },
        { id: "fabric.configureToolbox", label: toolboxRoot ? "Change local Toolbox" : "Configure local Toolbox", enabled: true, kind: "configure" }
      ],
      details: [
        toolboxRoot ? `Local Toolbox: ${toolboxRoot}` : "Local Fabric Toolbox clone not configured.",
        fabricConfig?.workspaceName ? `Manifest workspace: ${fabricConfig.workspaceName}` : "Fabric workspace name is not declared in the project manifest.",
        hasWorkspaceIdentity ? `Deployment config: ${deployConfigRelative} · ${deployConfigExists ? "present" : "not created"}` : "Fabric deployment is unbound until a workspace identity is verified.",
        integrationTools.find(tool => tool.label === "Fabric Data Engineering")?.available
          ? "Fabric Data Engineering is installed. Local-sync and remote-VFS notebook editing are different routes; see Operations in the Work view."
          : "Fabric Data Engineering (SynapseVSCode.synapse) is not installed; notebook/Spark job work uses the Fabric portal until it is.",
        "DataPass composes Fabric tooling; it does not replace vendor/community clients. Eventstream deployment activates target resources: review before deploying."
      ],
      catalog: {
        title: "Fabric Toolbox",
        items: catalogItems
      }
    };
  }

  async loadCatalog(): Promise<ToolCatalog> {
    const uri = vscode.Uri.joinPath(this.extensionUri, "resources", "catalogs", "fabric-tools.json");
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseToolCatalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  }
}

function toCatalogItemState(
  item: ToolCatalog["items"][number],
  hasToolboxRoot: boolean,
  fatAvailable: boolean
): CatalogItemState {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    kind: item.kind,
    source: item.source,
    description: item.description,
    verifiedRef: item.verifiedRef,
    actions: item.actions.map(action => catalogAction(item.id, action, hasToolboxRoot, fatAvailable))
  };
}

function catalogAction(
  itemId: string,
  action: CatalogAction,
  hasToolboxRoot: boolean,
  fatAvailable: boolean
): PlatformAction {
  const runEnabled =
    (itemId === "fabric-security-audit" && hasToolboxRoot) ||
    (itemId === "fabric-assessment-tool" && fatAvailable);
  const enabled =
    action === "read" ||
    action === "clone" ||
    action === "configure" ||
    (action === "run" && runEnabled);

  const labels: Record<CatalogAction, string> = {
    read: "Open",
    clone: "Clone",
    configure: "Configure",
    run: "Run",
    scaffold: "Scaffold",
    deploy: "Deploy"
  };
  const kinds: Record<CatalogAction, PlatformAction["kind"]> = {
    read: "link",
    clone: "copy",
    configure: "configure",
    run: "run",
    scaffold: "configure",
    deploy: "run"
  };

  return {
    id: `fabric.catalog::${itemId}::${action}`,
    label: labels[action],
    enabled,
    kind: kinds[action],
    detail: enabled
      ? undefined
      : action === "run" && itemId === "fabric-security-audit" && !hasToolboxRoot
        ? "Configure a local Fabric Toolbox clone first."
        : action === "run" && itemId === "fabric-assessment-tool" && !fatAvailable
          ? "Install the upstream Fabric Assessment Tool (fat) first."
          : "This catalog action is registered but not automated yet."
  };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}