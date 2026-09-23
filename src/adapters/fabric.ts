import * as vscode from "vscode";
import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { CatalogItemState, PlatformAction, PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { detectExtension } from "../core/vscodeDetection";
import { parseToolCatalog, type CatalogAction, type ToolCatalog } from "../core/catalog";
import { getProjectPlatformConfig } from "../core/projectState";
import { resolveManifestPath } from "../core/projectManifest";

export class FabricAdapter implements PlatformAdapter {
  readonly id = "fabric";
  readonly displayName = "Microsoft Fabric";

  constructor(private readonly extensionUri: vscode.Uri) {}

  async detect(): Promise<PlatformState> {
    const integrationTools: ToolProbe[] = [
      detectExtension("fabric.vscode-fabric", "Microsoft Fabric VS Code"),
      detectExtension("GerhardBrueckl.fabricstudio", "Fabric Studio"),
      detectExtension("GerhardBrueckl.onelake-vscode", "OneLake-VSCode"),
      await detectCli({ id: "fab", label: "Fabric CLI", command: "fab", args: ["--version"] })
    ];
    const config = vscode.workspace.getConfiguration("datapass");
    const localOverride = config.get<string>("fabric.toolboxRoot", "").trim();
    const platformConfig = await getProjectPlatformConfig();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manifestToolbox = platformConfig?.fabric?.toolboxRoot?.trim();
    const toolboxRoot = localOverride || (workspaceRoot && manifestToolbox ? resolveManifestPath(workspaceRoot, manifestToolbox) : "");
    const catalog = await this.loadCatalog();
    const catalogItems = catalog.items.map(item => toCatalogItemState(item, Boolean(toolboxRoot)));
    const tools: ToolProbe[] = [
      ...integrationTools,
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
      summary: `${integrationTools.filter(tool => tool.available).length}/${integrationTools.length} Fabric integration surfaces detected. ${catalog.items.length} curated Toolbox assets registered.`,
      tools,
      actions: [
        { id: "fabric.open", label: "Open Fabric", enabled: true, kind: "open" },
        { id: "fabric.openStudio", label: "Open Fabric Studio", enabled: true, kind: "open" },
        { id: "fabric.openToolbox", label: "Fabric Toolbox", enabled: true, kind: "link" },
        { id: "fabric.securityAudit", label: "Security audit", enabled: Boolean(toolboxRoot), kind: "run", detail: toolboxRoot ? "Run the upstream Fabric Toolbox security audit script." : "Configure a local Fabric Toolbox clone first." },
        { id: "fabric.openCostAnalysis", label: "Cost Analysis", enabled: true, kind: "link" },
        { id: "fabric.configureToolbox", label: toolboxRoot ? "Change local Toolbox" : "Configure local Toolbox", enabled: true, kind: "configure" }
      ],
      details: [
        toolboxRoot ? `Local Toolbox: ${toolboxRoot}` : "Local Fabric Toolbox clone not configured.",
        platformConfig?.fabric?.workspaceName ? `Manifest workspace: ${platformConfig.fabric.workspaceName}` : "Fabric workspace identity is not declared in the project manifest.",
        "DataPass composes Fabric tooling; it does not replace vendor/community clients."
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
  hasToolboxRoot: boolean
): CatalogItemState {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    kind: item.kind,
    source: item.source,
    description: item.description,
    verifiedRef: item.verifiedRef,
    actions: item.actions.map(action => catalogAction(item.id, action, hasToolboxRoot))
  };
}

function catalogAction(itemId: string, action: CatalogAction, hasToolboxRoot: boolean): PlatformAction {
  const supportedRun = itemId === "fabric-security-audit";
  const enabled =
    action === "read" ||
    action === "clone" ||
    action === "configure" ||
    (action === "run" && supportedRun && hasToolboxRoot);

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
      : action === "run" && !hasToolboxRoot
        ? "Configure a local Fabric Toolbox clone first."
        : "This catalog action is registered but not implemented in Pass 2."
  };
}