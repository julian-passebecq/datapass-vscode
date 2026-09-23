import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { CatalogItemState, PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { supportedPowerBiAgenticPlugins } from "../core/powerbiAgentic";
import { anyWorkspaceFile } from "../core/vscodeDetection";

export class PowerBiAdapter implements PlatformAdapter {
  readonly id = "powerbi";
  readonly displayName = "Power BI";

  async detect(): Promise<PlatformState> {
    const [pbip, tmdl, pbir, copilot] = await Promise.all([
      anyWorkspaceFile(["**/*.pbip"]),
      anyWorkspaceFile(["**/*.tmdl"]),
      anyWorkspaceFile(["**/*.pbir"]),
      detectCli({ id: "copilot", label: "GitHub Copilot CLI", command: "copilot", args: ["--version"] })
    ]);

    const tools: ToolProbe[] = [
      { id: "pbip", label: "PBIP source", available: pbip, detail: pbip ? "PBIP file detected" : "No PBIP file detected" },
      { id: "tmdl", label: "TMDL source", available: tmdl, detail: tmdl ? "TMDL file detected" : "No TMDL file detected" },
      { id: "pbir", label: "PBIR source", available: pbir, detail: pbir ? "PBIR file detected" : "No PBIR file detected" },
      copilot
    ];
    const configured = pbip || tmdl || pbir;
    const catalog: CatalogItemState[] = supportedPowerBiAgenticPlugins().map(plugin => ({
      id: plugin.id,
      name: plugin.label,
      category: "Agentic / Skills",
      kind: "Copilot CLI plugin",
      source: "data-goblin/power-bi-agentic-development",
      description: plugin.description,
      actions: [
        {
          id: `powerbi.installPlugin::${plugin.id}`,
          label: "Copy install",
          enabled: copilot.available,
          kind: "copy",
          detail: copilot.available
            ? "Copy the Copilot CLI plugin install command. DataPass will not install it automatically."
            : "Install GitHub Copilot CLI first."
        },
        {
          id: "powerbi.openAgentic",
          label: "Open source",
          enabled: true,
          kind: "link"
        }
      ]
    }));

    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, configured),
      summary: configured
        ? "Power BI source engineering markers detected. DataPass composes agentic/source tools while keeping specialized model/report editors external."
        : "No PBIP/TMDL/PBIR source detected in the current workspace.",
      tools,
      actions: [
        {
          id: "powerbi.addMarketplace",
          label: "Copy marketplace add",
          enabled: copilot.available,
          kind: "copy",
          detail: copilot.available
            ? "Copy the Data Goblin marketplace registration command for Copilot CLI."
            : "Install GitHub Copilot CLI first."
        },
        { id: "powerbi.openAgentic", label: "Agentic development", enabled: true, kind: "link" },
        { id: "powerbi.openMacguyver", label: "MacGyver toolbox", enabled: true, kind: "link" }
      ],
      details: [
        "Agentic plugins are user-wide in Copilot CLI; DataPass only copies install commands and does not install them automatically.",
        "Tabular Editor, Power BI Desktop and other specialized editors remain external peer tools."
      ],
      catalog: {
        title: "Power BI Agentic Modules",
        items: catalog
      }
    };
  }
}
