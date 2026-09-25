/**
 * Component providers (V3): which service or tool a component of the architecture belongs to.
 * Pure data. A provider is a role in the architecture (where a piece runs or where data lives);
 * capabilities are the operations DataPass knows for it.
 *
 * `support` is honest about what DataPass does:
 * - "operations": DataPass knows operations (preflight, routing to the official tool);
 * - "files": DataPass shows and opens the component's files, nothing more;
 * - "unsupported": recognised name, no operations yet (shown as such, never as ready).
 */
import type { CapabilityRecord } from "../capabilities/registry";
import type { ModuleId } from "../modules";

export const COMPONENT_PROVIDERS = [
  "azure-functions", "azure-data-factory", "azure-storage", "cosmos-nosql", "mongodb-atlas", "postgres", "neon",
  "databricks", "fabric", "powerbi", "airflow", "grafana", "python", "jupyter", "terraform", "bicep", "sql",
  "google-cloud-storage", "google-drive", "bigquery", "aws-s3", "manual", "other"
] as const;
export type ComponentProvider = typeof COMPONENT_PROVIDERS[number];

export interface ProviderInfo {
  id: ComponentProvider;
  label: string;
  /** One sentence for a beginner: what this is. */
  about: string;
  support: "operations" | "files" | "unsupported";
  /** Capability provider whose operations apply to this component. */
  capabilityProvider?: CapabilityRecord["provider"];
  module?: ModuleId;
  /** Codicon for trees; short glyph for diagrams. */
  icon: string;
  glyph: string;
  /** The official tool that does the real work, and where it lives. */
  nativeTool?: { label: string; extensionIds?: string[]; url?: string };
  docs?: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: "azure-functions", label: "Azure Functions", about: "Serverless Python (or other) code that runs in Azure when called or triggered.", support: "operations", capabilityProvider: "azure-functions", module: "azure", icon: "symbol-method", glyph: "ƒ",
    nativeTool: { label: "Azure Functions extension + Core Tools", extensionIds: ["ms-azuretools.vscode-azurefunctions"] }, docs: "https://learn.microsoft.com/azure/azure-functions/functions-reference-python" },
  { id: "azure-data-factory", label: "Azure Data Factory", about: "Azure's pipeline orchestrator: copies data between clouds and calls processing steps on a schedule or trigger.", support: "operations", capabilityProvider: "adf", module: "azure", icon: "git-merge", glyph: "⇉",
    nativeTool: { label: "ADF Studio (browser) with Git integration", url: "https://adf.azure.com/" }, docs: "https://learn.microsoft.com/azure/data-factory/source-control" },
  { id: "azure-storage", label: "Azure Blob Storage", about: "File storage in Azure (containers of blobs), for example the original PDFs.", support: "operations", capabilityProvider: "azure-storage", module: "azure", icon: "archive", glyph: "▤",
    nativeTool: { label: "Azure Storage extension", extensionIds: ["ms-azuretools.vscode-azurestorage"] }, docs: "https://learn.microsoft.com/azure/storage/blobs/storage-blobs-introduction" },
  { id: "cosmos-nosql", label: "Azure Cosmos DB for NoSQL", about: "A JSON document database in Azure, used for staging and derived documents.", support: "operations", capabilityProvider: "cosmos", module: "azure", icon: "database", glyph: "◈",
    nativeTool: { label: "Azure Cosmos DB extension", extensionIds: ["ms-azuretools.vscode-cosmosdb"] }, docs: "https://learn.microsoft.com/azure/cosmos-db/nosql/" },
  { id: "mongodb-atlas", label: "MongoDB Atlas", about: "A managed MongoDB database (not Cosmos DB), for example the compact knowledge read by ChatGPT.", support: "operations", capabilityProvider: "mongodb", module: "databases", icon: "database", glyph: "◉",
    nativeTool: { label: "MongoDB for VS Code", extensionIds: ["mongodb.mongodb-vscode"] }, docs: "https://www.mongodb.com/docs/mongodb-vscode/" },
  { id: "postgres", label: "PostgreSQL", about: "A relational SQL database.", support: "operations", capabilityProvider: "postgres", module: "databases", icon: "database", glyph: "▦",
    nativeTool: { label: "PostgreSQL extension or psql", extensionIds: ["ms-ossdata.vscode-pgsql"] }, docs: "https://www.postgresql.org/docs/" },
  { id: "neon", label: "Neon (serverless PostgreSQL)", about: "Hosted PostgreSQL with branches per environment.", support: "operations", capabilityProvider: "postgres", module: "databases", icon: "database", glyph: "▦",
    nativeTool: { label: "Neon extension or psql", extensionIds: ["databricks.neon-local-connect"] }, docs: "https://neon.com/docs" },
  { id: "databricks", label: "Databricks", about: "Spark notebooks and jobs, deployed with Databricks Asset Bundles.", support: "operations", capabilityProvider: "databricks", module: "databricks", icon: "package", glyph: "◆",
    nativeTool: { label: "Databricks extension + CLI", extensionIds: ["databricks.databricks"] }, docs: "https://docs.databricks.com/dev-tools/bundles/" },
  { id: "fabric", label: "Microsoft Fabric", about: "Lakehouses, notebooks and pipelines in a Fabric workspace.", support: "operations", capabilityProvider: "fabric", module: "fabric", icon: "symbol-namespace", glyph: "▲",
    nativeTool: { label: "Fabric extensions + CLI", extensionIds: ["fabric.vscode-fabric"] }, docs: "https://learn.microsoft.com/fabric/" },
  { id: "powerbi", label: "Power BI", about: "Reports and semantic models (PBIP projects).", support: "operations", capabilityProvider: "powerbi", module: "powerbi", icon: "graph", glyph: "▥",
    nativeTool: { label: "Power BI Desktop" }, docs: "https://learn.microsoft.com/power-bi/developer/projects/projects-overview" },
  { id: "airflow", label: "Apache Airflow", about: "DAG-based workflow scheduler.", support: "operations", capabilityProvider: "airflow", module: "airflow", icon: "type-hierarchy-sub", glyph: "⟳",
    docs: "https://airflow.apache.org/docs/" },
  { id: "grafana", label: "Grafana", about: "Dashboards and alerts.", support: "operations", capabilityProvider: "grafana", module: "grafana", icon: "pulse", glyph: "◔",
    docs: "https://grafana.com/docs/" },
  { id: "python", label: "Python", about: "Python scripts or packages run locally, in CI or by another service.", support: "operations", capabilityProvider: "python", icon: "file-code", glyph: "py",
    nativeTool: { label: "Python extension", extensionIds: ["ms-python.python"] }, docs: "https://docs.python.org/3/" },
  { id: "jupyter", label: "Jupyter notebook", about: "Notebooks (.ipynb) opened in VS Code's notebook editor.", support: "files", icon: "notebook", glyph: "nb",
    nativeTool: { label: "Jupyter extension", extensionIds: ["ms-toolsai.jupyter"] } },
  { id: "terraform", label: "Terraform / OpenTofu", about: "Infrastructure as code.", support: "operations", capabilityProvider: "infrastructure", module: "infrastructure", icon: "server-process", glyph: "tf",
    docs: "https://opentofu.org/docs/" },
  { id: "bicep", label: "Bicep", about: "Azure infrastructure as code.", support: "files", icon: "server-process", glyph: "bi",
    nativeTool: { label: "Bicep extension", extensionIds: ["ms-azuretools.vscode-bicep"] }, docs: "https://learn.microsoft.com/azure/azure-resource-manager/bicep/" },
  { id: "sql", label: "SQL scripts", about: "SQL files kept in the repository.", support: "files", icon: "database", glyph: "sql" },
  { id: "google-cloud-storage", label: "Google Cloud Storage", about: "Google's object storage (not Google Drive).", support: "unsupported", icon: "cloud", glyph: "gcs" },
  { id: "google-drive", label: "Google Drive", about: "Files in Google Drive (not Google Cloud Storage).", support: "unsupported", icon: "cloud", glyph: "gd" },
  { id: "bigquery", label: "BigQuery", about: "Google's data warehouse.", support: "unsupported", icon: "cloud", glyph: "bq" },
  { id: "aws-s3", label: "Amazon S3", about: "AWS object storage.", support: "unsupported", icon: "cloud", glyph: "s3" },
  { id: "manual", label: "Manual step", about: "A human step: review, approval, a decision.", support: "files", icon: "person", glyph: "✎" },
  { id: "other", label: "Other", about: "A service DataPass does not know; its files can still be shown.", support: "unsupported", icon: "question", glyph: "?" }
];

export const PROVIDER_INDEX: ReadonlyMap<string, ProviderInfo> = new Map(PROVIDERS.map(p => [p.id, p]));

export function providerInfo(id: string | undefined): ProviderInfo | undefined {
  return id ? PROVIDER_INDEX.get(id) : undefined;
}
