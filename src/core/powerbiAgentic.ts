export type PowerBiAgenticPlugin =
  | "pbip"
  | "semantic-models"
  | "reports"
  | "pbi-desktop"
  | "tabular-editor"
  | "fabric-cli";

const MARKETPLACE = "power-bi-agentic-development";

export function buildCopilotMarketplaceCommand(): string {
  return "copilot plugin marketplace add data-goblin/power-bi-agentic-development";
}

export function buildCopilotPluginInstallCommand(plugin: PowerBiAgenticPlugin): string {
  return `copilot plugin install ${plugin}@${MARKETPLACE}`;
}

export function supportedPowerBiAgenticPlugins(): Array<{
  id: PowerBiAgenticPlugin;
  label: string;
  description: string;
}> {
  return [
    { id: "pbip", label: "PBIP", description: "PBIP/PBIR source engineering and validation workflows." },
    { id: "semantic-models", label: "Semantic models", description: "Semantic-model engineering and analysis workflows." },
    { id: "reports", label: "Reports", description: "Power BI report engineering workflows." },
    { id: "pbi-desktop", label: "Power BI Desktop", description: "Power BI Desktop-focused agentic workflows." },
    { id: "tabular-editor", label: "Tabular Editor", description: "Tabular Editor-focused semantic-model workflows." },
    { id: "fabric-cli", label: "Fabric CLI", description: "Agent guidance for official Microsoft Fabric CLI workflows." }
  ];
}
