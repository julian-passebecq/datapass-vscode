import * as vscode from "vscode";
import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { detectExtension } from "../core/vscodeDetection";
import { parseToolCatalog, type ToolCatalog } from "../core/catalog";

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
    const toolboxRoot = vscode.workspace.getConfiguration("datapass").get<string>("fabric.toolboxRoot", "").trim();
    const catalog = await this.loadCatalog();
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
        "DataPass composes Fabric tooling; it does not replace vendor/community clients."
      ]
    };
  }

  async loadCatalog(): Promise<ToolCatalog> {
    const uri = vscode.Uri.joinPath(this.extensionUri, "resources", "catalogs", "fabric-tools.json");
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseToolCatalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  }
}