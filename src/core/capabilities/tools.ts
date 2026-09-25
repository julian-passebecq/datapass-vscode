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
  { id: "cli.git", label: "Git", kind: "cli", cli: { command: "git", args: ["--version"] }, publisher: "vendor" },
  // V3: Azure data services and databases used as project destinations.
  { id: "ext.azure-functions", label: "Azure Functions", kind: "extension", extensionIds: ["ms-azuretools.vscode-azurefunctions"], publisher: "microsoft" },
  { id: "cli.func", label: "Azure Functions Core Tools", kind: "cli", cli: { command: "func", args: ["--version"] }, publisher: "microsoft" },
  { id: "ext.azure-storage", label: "Azure Storage", kind: "extension", extensionIds: ["ms-azuretools.vscode-azurestorage"], publisher: "microsoft" },
  { id: "ext.cosmosdb", label: "Azure Cosmos DB (Azure Databases)", kind: "extension", extensionIds: ["ms-azuretools.vscode-cosmosdb"], publisher: "microsoft",
    note: "Cosmos DB for NoSQL (and other Azure databases). Not the MongoDB Atlas client." },
  { id: "ext.azure-resources", label: "Azure Resources", kind: "extension", extensionIds: ["ms-azuretools.vscode-azureresourcegroups"], publisher: "microsoft",
    note: "Sign-in and resource tree shared by the Azure extensions." },
  { id: "ext.pgsql", label: "PostgreSQL (Microsoft)", kind: "extension", extensionIds: ["ms-ossdata.vscode-pgsql"], publisher: "microsoft" },
  { id: "ext.neon", label: "Neon (serverless Postgres)", kind: "extension", extensionIds: ["databricks.neon-local-connect"], publisher: "vendor" },
  { id: "cli.psql", label: "psql", kind: "cli", cli: { command: "psql", args: ["--version"] }, publisher: "vendor" },
  // 0.15: tools of architecture alternatives (probed so a comparison can say what is installed here).
  { id: "cli.docker", label: "Docker CLI", kind: "cli", cli: { command: "docker", args: ["--version"] }, publisher: "vendor",
    note: "Docker Desktop is free for personal use and small businesses; larger companies need a paid subscription." },
  { id: "ext.gcloud-data", label: "Google Cloud Data Agent Kit", kind: "extension", extensionIds: ["GoogleCloudTools.datacloud"], publisher: "vendor",
    note: "Browse BigQuery schemas and Cloud Storage files, query, build pipelines. Verified on the Marketplace on 2026-09-25." },
  { id: "cli.gcloud", label: "Google Cloud CLI (gcloud)", kind: "cli", cli: { command: "gcloud", args: ["--version"] }, publisher: "vendor" },
  // 0.16: Git hosts and CI. IDs and view containers read from each extension's package.json on 2026-09-25.
  { id: "ext.github-actions", label: "GitHub Actions", kind: "extension", extensionIds: ["github.vscode-github-actions"], publisher: "vendor",
    note: "Validates workflow YAML and expressions; lists workflows and runs (view container \"github-actions\")." },
  { id: "ext.github-prs", label: "GitHub Pull Requests", kind: "extension", extensionIds: ["GitHub.vscode-pull-request-github"], publisher: "vendor",
    note: "Review and create pull requests and issues in VS Code (view container \"github-pull-requests\")." },
  { id: "ext.azure-pipelines", label: "Azure Pipelines (YAML)", kind: "extension", extensionIds: ["ms-azure-devops.azure-pipelines"], publisher: "microsoft",
    note: "Language support for azure-pipelines.yml; it has no view: runs are in the Azure DevOps portal. Microsoft's Azure Boards extension was archived in 2023: boards are on the web." },
  { id: "ext.gitlab", label: "GitLab Workflow", kind: "extension", extensionIds: ["GitLab.gitlab-workflow"], publisher: "vendor",
    note: "GitLab's official extension. Its manifest declares no pipeline view container, so DataPass opens pipelines on GitLab." },
  { id: "ext.grafana", label: "Grafana (official)", kind: "extension", extensionIds: ["Grafana.grafana-vscode"], publisher: "vendor",
    note: "Opens a dashboard JSON file in an editor connected to your Grafana (its own URL and service-account token settings; DataPass never reads them). No view container." }
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
