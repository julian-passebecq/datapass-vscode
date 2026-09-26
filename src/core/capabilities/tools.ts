/**
 * Registry of native tools DataPass can probe. A probe says only whether a tool is present;
 * it never says whether an operation works on a given target.
 *
 * Extension IDs verified against the VS Code Marketplace on 2026-09-24:
 * - TMDL: analysis-services.TMDL is the Marketplace listing; CPIM.TMDL-language-support (linked from Microsoft docs) is kept as an alias.
 * - Fabric Data Engineering: SynapseVSCode.synapse (desktop), SynapseVSCode.vscode-synapse-remote (web).
 */

export type ToolKind = "extension" | "cli" | "desktop-app" | "workspace-file";

/**
 * How a person installs a tool (0.18). Shown to copy, never run: DataPass installs nothing. A
 * platform without a command shows the docs page only. Winget ids checked with `winget show` on
 * 2026-09-25; extensions install from VS Code itself (`code --install-extension <id>`).
 */
export interface InstallHint {
  windows?: string;
  macos?: string;
  linux?: string;
  /** Same command on every platform (pip, npm); a platform-specific command wins over it. */
  all?: string;
  /** Where the command runs when it is not a terminal on this computer (a Fabric notebook cell). */
  where?: string;
  docs?: string;
}

export interface ToolDefinition {
  id: string;
  label: string;
  kind: ToolKind;
  /** Extension IDs (first is canonical, rest are verified aliases/legacy IDs). */
  extensionIds?: string[];
  cli?: { command: string; windowsCommand?: string; args: string[] };
  publisher: "microsoft" | "vendor" | "community" | "workspace";
  note?: string;
  install?: InstallHint;
}

export const TOOLS: ToolDefinition[] = [
  { id: "ext.fabric", label: "Microsoft Fabric (core)", kind: "extension", extensionIds: ["fabric.vscode-fabric"], publisher: "microsoft" },
  { id: "ext.fabric-data-engineering", label: "Fabric Data Engineering", kind: "extension", extensionIds: ["SynapseVSCode.synapse", "SynapseVSCode.vscode-synapse-remote"], publisher: "microsoft",
    note: "Notebooks, Spark job definitions, environments and lakehouses. Fabric, not Azure Synapse Analytics." },
  { id: "ext.jupyter", label: "Jupyter", kind: "extension", extensionIds: ["ms-toolsai.jupyter"], publisher: "microsoft" },
  { id: "ext.python", label: "Python", kind: "extension", extensionIds: ["ms-python.python"], publisher: "microsoft" },
  { id: "cli.java", label: "Java (JDK)", kind: "cli", cli: { command: "java", args: ["-version"] }, publisher: "vendor", note: "Fabric Data Engineering local Spark development requires a JDK, not a JRE.",
    install: { windows: "winget install -e --id Microsoft.OpenJDK.21", macos: "brew install openjdk@21", docs: "https://learn.microsoft.com/java/openjdk/download" } },
  { id: "ext.fabric-studio", label: "Fabric Studio (community)", kind: "extension", extensionIds: ["GerhardBrueckl.fabricstudio"], publisher: "community" },
  { id: "ext.onelake", label: "OneLake explorer (community)", kind: "extension", extensionIds: ["GerhardBrueckl.onelake-vscode"], publisher: "community" },
  { id: "cli.fab", label: "Fabric CLI", kind: "cli", cli: { command: "fab", args: ["--version"] }, publisher: "microsoft",
    install: { all: "pip install ms-fabric-cli", docs: "https://microsoft.github.io/fabric-cli/" } },
  { id: "cli.python", label: "Python", kind: "cli", cli: { command: "python3", windowsCommand: "python", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id Python.Python.3.12", macos: "brew install python@3.12", docs: "https://www.python.org/downloads/" } },
  { id: "cli.az", label: "Azure CLI", kind: "cli", cli: { command: "az", args: ["version"] }, publisher: "microsoft",
    install: { windows: "winget install -e --id Microsoft.AzureCLI", macos: "brew install azure-cli", docs: "https://learn.microsoft.com/cli/azure/install-azure-cli" } },
  { id: "ext.databricks", label: "Databricks (official)", kind: "extension", extensionIds: ["databricks.databricks"], publisher: "vendor" },
  { id: "cli.databricks", label: "Databricks CLI", kind: "cli", cli: { command: "databricks", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install Databricks.DatabricksCLI", macos: "brew tap databricks/tap && brew install databricks", docs: "https://learn.microsoft.com/azure/databricks/dev-tools/cli/install" } },
  { id: "ext.tmdl", label: "TMDL language support", kind: "extension", extensionIds: ["analysis-services.TMDL", "CPIM.TMDL-language-support"], publisher: "microsoft" },
  { id: "app.pbi-desktop", label: "Power BI Desktop", kind: "desktop-app", publisher: "microsoft", note: "Windows desktop application; DataPass cannot reliably probe it.",
    install: { docs: "https://www.microsoft.com/power-platform/products/power-bi/desktop" } },
  { id: "app.tabular-editor", label: "Tabular Editor", kind: "desktop-app", publisher: "community",
    install: { docs: "https://tabulareditor.com/" } },
  { id: "cli.copilot", label: "GitHub Copilot CLI", kind: "cli", cli: { command: "copilot", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id GitHub.Copilot", all: "npm install -g @github/copilot", docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli" } },
  { id: "ws.mcp", label: "MCP registration file present (.vscode/mcp.json)", kind: "workspace-file", publisher: "workspace",
    note: "The file exists. It does not mean any MCP server is running, connected or signed in." },
  { id: "cli.gcx", label: "Grafana gcx", kind: "cli", cli: { command: "gcx", args: ["--version"] }, publisher: "vendor",
    install: { docs: "https://github.com/grafana/gcx" } },
  { id: "cli.tofu", label: "OpenTofu", kind: "cli", cli: { command: "tofu", args: ["version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id OpenTofu.Tofu", macos: "brew install opentofu", docs: "https://opentofu.org/docs/intro/install/" } },
  { id: "cli.terraform", label: "Terraform", kind: "cli", cli: { command: "terraform", args: ["version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id Hashicorp.Terraform", macos: "brew tap hashicorp/tap && brew install hashicorp/tap/terraform", docs: "https://developer.hashicorp.com/terraform/install" } },
  { id: "ext.containers", label: "Container Tools", kind: "extension", extensionIds: ["ms-azuretools.vscode-containers", "ms-azuretools.vscode-docker"], publisher: "microsoft",
    note: "vscode-docker is kept as a legacy alias." },
  { id: "ext.remote-ssh", label: "Remote - SSH", kind: "extension", extensionIds: ["ms-vscode-remote.remote-ssh"], publisher: "microsoft" },
  { id: "cli.ssh", label: "SSH client", kind: "cli", cli: { command: "ssh", args: ["-V"] }, publisher: "vendor",
    install: { docs: "https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse" } },
  { id: "ext.mongodb", label: "MongoDB for VS Code", kind: "extension", extensionIds: ["mongodb.mongodb-vscode"], publisher: "vendor" },
  { id: "cli.mongosh", label: "mongosh", kind: "cli", cli: { command: "mongosh", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id MongoDB.Shell", macos: "brew install mongosh", docs: "https://www.mongodb.com/docs/mongodb-shell/install/" } },
  { id: "ext.drawio", label: "Draw.io Integration (community)", kind: "extension", extensionIds: ["hediet.vscode-drawio"], publisher: "community" },
  { id: "cli.git", label: "Git", kind: "cli", cli: { command: "git", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id Git.Git", macos: "brew install git", docs: "https://git-scm.com/downloads" } },
  // V3: Azure data services and databases used as project destinations.
  { id: "ext.azure-functions", label: "Azure Functions", kind: "extension", extensionIds: ["ms-azuretools.vscode-azurefunctions"], publisher: "microsoft" },
  { id: "cli.func", label: "Azure Functions Core Tools", kind: "cli", cli: { command: "func", args: ["--version"] }, publisher: "microsoft",
    install: { windows: "winget install -e --id Microsoft.Azure.FunctionsCoreTools", macos: "brew tap azure/functions && brew install azure-functions-core-tools@4", docs: "https://learn.microsoft.com/azure/azure-functions/functions-run-local" } },
  { id: "ext.azure-storage", label: "Azure Storage", kind: "extension", extensionIds: ["ms-azuretools.vscode-azurestorage"], publisher: "microsoft" },
  { id: "ext.cosmosdb", label: "Azure Cosmos DB (Azure Databases)", kind: "extension", extensionIds: ["ms-azuretools.vscode-cosmosdb"], publisher: "microsoft",
    note: "Cosmos DB for NoSQL (and other Azure databases). Not the MongoDB Atlas client." },
  { id: "ext.azure-resources", label: "Azure Resources", kind: "extension", extensionIds: ["ms-azuretools.vscode-azureresourcegroups"], publisher: "microsoft",
    note: "Sign-in and resource tree shared by the Azure extensions." },
  { id: "ext.pgsql", label: "PostgreSQL (Microsoft)", kind: "extension", extensionIds: ["ms-ossdata.vscode-pgsql"], publisher: "microsoft" },
  { id: "ext.neon", label: "Neon (serverless Postgres)", kind: "extension", extensionIds: ["databricks.neon-local-connect"], publisher: "vendor" },
  { id: "cli.psql", label: "psql", kind: "cli", cli: { command: "psql", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id PostgreSQL.PostgreSQL.17", macos: "brew install libpq", docs: "https://www.postgresql.org/download/" } },
  // 0.15: tools of architecture alternatives (probed so a comparison can say what is installed here).
  { id: "cli.docker", label: "Docker CLI", kind: "cli", cli: { command: "docker", args: ["--version"] }, publisher: "vendor",
    note: "Docker Desktop is free for personal use and small businesses; larger companies need a paid subscription.",
    install: { windows: "winget install -e --id Docker.DockerDesktop", macos: "brew install --cask docker", docs: "https://docs.docker.com/get-started/get-docker/" } },
  { id: "ext.gcloud-data", label: "Google Cloud Data Agent Kit", kind: "extension", extensionIds: ["GoogleCloudTools.datacloud"], publisher: "vendor",
    note: "Browse BigQuery schemas and Cloud Storage files, query, build pipelines. Verified on the Marketplace on 2026-09-25." },
  { id: "cli.gcloud", label: "Google Cloud CLI (gcloud)", kind: "cli", cli: { command: "gcloud", args: ["--version"] }, publisher: "vendor",
    install: { windows: "winget install -e --id Google.CloudSDK", docs: "https://cloud.google.com/sdk/docs/install" } },
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
    note: "Opens a dashboard JSON file in an editor connected to your Grafana (its own URL and service-account token settings; DataPass never reads them). No view container." },
  // 0.18: Power BI community extensions and Microsoft's modeling MCP server, checked on the Marketplace on 2026-09-25.
  { id: "ext.powerbi-studio", label: "Power BI Studio (community)", kind: "extension", extensionIds: ["GerhardBrueckl.powerbi-vscode"], publisher: "community",
    note: "Power BI service from VS Code: workspaces, reports and semantic models, live TMDL editing of a published model (needs .NET 7+ and a Premium or Fabric capacity), DAX and REST notebooks." },
  { id: "pack.powerbi-gbrueckl", label: "Power BI extension pack (community)", kind: "extension", extensionIds: ["GerhardBrueckl.powerbi-vscode-extensionpack"], publisher: "community",
    note: "One install for Power BI Studio, Fabric Studio, OneLake, Data Table, DAX language, TMDL and the Power BI Modeling MCP server." },
  { id: "ext.powerbi-modeling-mcp", label: "Power BI Modeling MCP server", kind: "extension", extensionIds: ["analysis-services.powerbi-modeling-mcp"], publisher: "microsoft",
    note: "Listed as \"Power BI Authoring MCP Server\" on the Marketplace. It lets an agent change semantic models, so DataPass never configures it for you." }
];

export const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map(t => [t.id, t]));

export type ProbeState = "present" | "absent" | "unknown";
export interface ToolObservation {
  toolId: string;
  state: ProbeState;
  version?: string;
  via?: string;          // which extension ID / command matched
  observedAt: string;
  /**
   * ws.mcp (D-22): the server NAMES .vscode/mcp.json registers, nothing else of the file. Undefined
   * when the file is absent or not plain JSON. A name here means "registered in this workspace",
   * never "running", "connected" or "signed in".
   */
  entries?: string[];
}
