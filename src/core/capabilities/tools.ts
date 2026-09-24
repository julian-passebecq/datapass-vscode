/**
 * Registry of native tools DataPass can probe. A probe says only whether a tool is present;
 * it never says whether an operation works on a given target.
 *
 * Extension IDs verified against the VS Code Marketplace on 2026-09-24:
 * - TMDL: analysis-services.TMDL is the Marketplace listing; CPIM.TMDL-language-support (linked from Microsoft docs) is kept as an alias.
 * - Fabric Data Engineering: SynapseVSCode.synapse (desktop), SynapseVSCode.vscode-synapse-remote (web).
 */

export type ToolKind = "extension" | "cli" | "desktop-app" | "workspace-file";

export interface ToolDefinition {
  id: string;
  label: string;
  kind: ToolKind;
  /** Extension IDs (first is canonical, rest are verified aliases/legacy IDs). */
  extensionIds?: string[];
  cli?: { command: string; windowsCommand?: string; args: string[] };
  publisher: "microsoft" | "vendor" | "community" | "workspace";
  note?: string;
}

export const TOOLS: ToolDefinition[] = [
  { id: "ext.fabric", label: "Microsoft Fabric (core)", kind: "extension", extensionIds: ["fabric.vscode-fabric"], publisher: "microsoft" },
  { id: "ext.fabric-data-engineering", label: "Fabric Data Engineering", kind: "extension", extensionIds: ["SynapseVSCode.synapse", "SynapseVSCode.vscode-synapse-remote"], publisher: "microsoft",
    note: "Notebooks, Spark job definitions, environments and lakehouses. Fabric, not Azure Synapse Analytics." },
  { id: "ext.jupyter", label: "Jupyter", kind: "extension", extensionIds: ["ms-toolsai.jupyter"], publisher: "microsoft" },
  { id: "ext.python", label: "Python", kind: "extension", extensionIds: ["ms-python.python"], publisher: "microsoft" },
  { id: "cli.java", label: "Java (JDK)", kind: "cli", cli: { command: "java", args: ["-version"] }, publisher: "vendor", note: "Fabric Data Engineering local Spark development requires a JDK, not a JRE." },
  { id: "ext.fabric-studio", label: "Fabric Studio (community)", kind: "extension", extensionIds: ["GerhardBrueckl.fabricstudio"], publisher: "community" },
  { id: "ext.onelake", label: "OneLake explorer (community)", kind: "extension", extensionIds: ["GerhardBrueckl.onelake-vscode"], publisher: "community" },
  { id: "cli.fab", label: "Fabric CLI", kind: "cli", cli: { command: "fab", args: ["--version"] }, publisher: "microsoft" },
  { id: "cli.python", label: "Python", kind: "cli", cli: { command: "python3", windowsCommand: "python", args: ["--version"] }, publisher: "vendor" },
  { id: "cli.az", label: "Azure CLI", kind: "cli", cli: { command: "az", args: ["version"] }, publisher: "microsoft" },
  { id: "ext.databricks", label: "Databricks (official)", kind: "extension", extensionIds: ["databricks.databricks"], publisher: "vendor" },
  { id: "cli.databricks", label: "Databricks CLI", kind: "cli", cli: { command: "databricks", args: ["--version"] }, publisher: "vendor" },
  { id: "ext.tmdl", label: "TMDL language support", kind: "extension", extensionIds: ["analysis-services.TMDL", "CPIM.TMDL-language-support"], publisher: "microsoft" },
  { id: "app.pbi-desktop", label: "Power BI Desktop", kind: "desktop-app", publisher: "microsoft", note: "Windows desktop application; DataPass cannot reliably probe it." },
  { id: "app.tabular-editor", label: "Tabular Editor", kind: "desktop-app", publisher: "community" },
  { id: "cli.copilot", label: "GitHub Copilot CLI", kind: "cli", cli: { command: "copilot", args: ["--version"] }, publisher: "vendor" },
  { id: "ws.mcp", label: "Workspace MCP configuration", kind: "workspace-file", publisher: "workspace" },
  { id: "cli.gcx", label: "Grafana gcx", kind: "cli", cli: { command: "gcx", args: ["--version"] }, publisher: "vendor" },
  { id: "cli.tofu", label: "OpenTofu", kind: "cli", cli: { command: "tofu", args: ["version"] }, publisher: "vendor" },
  { id: "cli.terraform", label: "Terraform", kind: "cli", cli: { command: "terraform", args: ["version"] }, publisher: "vendor" },
  { id: "ext.containers", label: "Container Tools", kind: "extension", extensionIds: ["ms-azuretools.vscode-containers", "ms-azuretools.vscode-docker"], publisher: "microsoft",
    note: "vscode-docker is kept as a legacy alias." },
  { id: "ext.remote-ssh", label: "Remote - SSH", kind: "extension", extensionIds: ["ms-vscode-remote.remote-ssh"], publisher: "microsoft" },
  { id: "cli.ssh", label: "SSH client", kind: "cli", cli: { command: "ssh", args: ["-V"] }, publisher: "vendor" },
  { id: "ext.mongodb", label: "MongoDB for VS Code", kind: "extension", extensionIds: ["mongodb.mongodb-vscode"], publisher: "vendor" },
  { id: "cli.mongosh", label: "mongosh", kind: "cli", cli: { command: "mongosh", args: ["--version"] }, publisher: "vendor" },
  { id: "ext.drawio", label: "Draw.io Integration (community)", kind: "extension", extensionIds: ["hediet.vscode-drawio"], publisher: "community" },
  { id: "cli.git", label: "Git", kind: "cli", cli: { command: "git", args: ["--version"] }, publisher: "vendor" }
];

export const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map(t => [t.id, t]));

export type ProbeState = "present" | "absent" | "unknown";
export interface ToolObservation {
  toolId: string;
  state: ProbeState;
  version?: string;
  via?: string;          // which extension ID / command matched
  observedAt: string;
}
