/**
 * Artifact profiles (V3): the conventional files of a native unit (an Azure Functions app, a
 * Databricks bundle, a Data Factory Git folder…), which phase needs each file, and the operations
 * that usually apply. Pure data plus small helpers.
 *
 * A profile saves the AI from listing every file, and lets DataPass say "host.json is expected
 * here". It never creates files and never claims a file exists: resolution observes the disk.
 *
 * Path syntax (relative to the component root):
 *   "host.json"          one file
 *   "pipeline/"          a folder that contains at least one file
 *   ".foil-lab/build/**" same as a folder: at least one file somewhere below
 *   "*.sql", "db/*.sql"  at least one matching file in that folder (not recursive)
 */
import type { Phase } from "../capabilities/registry";
import type { ComponentProvider } from "./providers";

export const FILE_ROLES = ["entry", "config", "dependencies", "code", "test", "contract", "infrastructure", "packaging", "data", "docs", "other"] as const;
export type FileRole = typeof FILE_ROLES[number];

/** Phases a missing file of this role blocks, unless the file declares its own `requiredFor`. */
export const ROLE_REQUIRED_FOR: Readonly<Record<FileRole, readonly Phase[]>> = {
  entry: ["read", "develop", "test", "validate", "deploy", "run", "publish"],
  config: ["develop", "test", "validate", "deploy", "run"],
  dependencies: ["develop", "test", "deploy", "run"],
  code: ["develop", "test", "deploy", "run"],
  test: ["test"],
  contract: ["validate", "deploy", "publish"],
  infrastructure: ["validate", "deploy"],
  packaging: ["deploy"],
  data: ["run"],
  docs: [],
  other: []
};

export interface ProfileFile {
  path: string;
  role: FileRole;
  /** Overrides ROLE_REQUIRED_FOR. */
  requiredFor?: readonly Phase[];
  /** Recommended only: shown when missing, never blocks. */
  optional?: boolean;
  about?: string;
}

export interface ArtifactProfile {
  id: string;
  label: string;
  provider: ComponentProvider;
  about: string;
  /** Default entry file, relative to the component root. */
  entry?: string;
  files: ProfileFile[];
  /** Files that must never be committed (local secrets): a warning when Git tracks them. */
  mustNotCommit?: Array<{ path: string; why: string }>;
  /** Capabilities that usually apply, in phase order. */
  operations: string[];
  /** Command templates for copy-command operations, run from the component root. {target} = environment's target. */
  commands?: Readonly<Record<string, string>>;
  docs?: string;
}

export const PROFILES: readonly ArtifactProfile[] = [
  { id: "azure-functions.python", label: "Azure Functions app (Python)", provider: "azure-functions",
    about: "A Function App is deployed as a whole folder: function_app.py declares the functions, host.json configures the host, requirements.txt lists the packages.",
    entry: "function_app.py",
    files: [
      { path: "function_app.py", role: "entry", about: "Declares the functions (Python v2 programming model)." },
      { path: "host.json", role: "config", about: "Host settings; required to run or deploy." },
      { path: "requirements.txt", role: "dependencies", about: "Python packages installed in Azure at deployment." },
      { path: ".funcignore", role: "packaging", optional: true, about: "Keeps tests, virtual environments and local settings out of the deployed package." },
      { path: "tests/", role: "test", optional: true, about: "Unit tests (pytest)." }
    ],
    mustNotCommit: [{ path: "local.settings.json", why: "holds local secrets and connection strings" }],
    operations: ["generic.files.open", "python.tests.run", "azure-functions.run-local", "azure-functions.deploy"],
    commands: { "azure-functions.run-local": "func start", "python.tests.run": "python -m pytest" },
    docs: "https://learn.microsoft.com/azure/azure-functions/functions-reference-python" },
  { id: "databricks.bundle", label: "Databricks Asset Bundle", provider: "databricks",
    about: "databricks.yml declares the bundle, its targets and (directly or through include) its jobs and notebooks.",
    entry: "databricks.yml",
    files: [{ path: "databricks.yml", role: "entry", about: "Bundle definition: name, targets, resources or includes." }],
    operations: ["generic.files.open", "databricks.bundle.validate", "databricks.bundle.deploy", "databricks.bundle.run"],
    commands: { "databricks.bundle.validate": "databricks bundle validate -t {target}", "databricks.bundle.deploy": "databricks bundle deploy -t {target}" },
    docs: "https://docs.databricks.com/dev-tools/bundles/" },
  { id: "adf.factory", label: "Azure Data Factory (Git folder)", provider: "azure-data-factory",
    about: "The folder ADF Studio's Git integration reads: pipelines, datasets, linked services and triggers as JSON. Saving to Git is not publishing.",
    files: [
      { path: "pipeline/", role: "code", requiredFor: ["read", "validate", "deploy"], about: "Pipeline definitions (JSON)." },
      { path: "linkedService/", role: "config", requiredFor: ["validate", "deploy"], about: "Connections to storage, functions and databases (no secrets: use Key Vault)." },
      { path: "dataset/", role: "config", optional: true, about: "Dataset definitions used by copy activities." },
      { path: "trigger/", role: "config", optional: true, about: "Schedules and event triggers." }
    ],
    operations: ["generic.files.open", "adf.studio.open", "adf.validate", "adf.publish"],
    docs: "https://learn.microsoft.com/azure/data-factory/source-control" },
  { id: "azure-storage.container", label: "Azure Blob Storage container", provider: "azure-storage",
    about: "Where files live in Azure. The repository usually holds only its layout description or infrastructure code.",
    files: [{ path: "README.md", role: "docs", optional: true, about: "Folder layout and naming rules." }],
    operations: ["azure-storage.browse"] },
  { id: "cosmos-nosql.container", label: "Cosmos DB (NoSQL) container", provider: "cosmos-nosql",
    about: "Container definitions (partition key, indexing) and saved queries kept as files.",
    files: [
      { path: "containers/", role: "config", optional: true, about: "Container definitions (JSON)." },
      { path: "queries/", role: "code", optional: true, about: "Saved queries (.sql)." }
    ],
    operations: ["generic.files.open", "cosmos.browse", "cosmos.query"],
    docs: "https://learn.microsoft.com/azure/cosmos-db/nosql/" },
  { id: "mongodb.database", label: "MongoDB Atlas database", provider: "mongodb-atlas",
    about: "Collection schemas, indexes and reviewed playgrounds kept as files; the data stays in Atlas.",
    files: [
      { path: "schemas/", role: "contract", optional: true, about: "JSON Schemas of the published documents." },
      { path: "playgrounds/", role: "code", optional: true, about: "Reviewed MongoDB playgrounds (*.mongodb.js); they can write data." }
    ],
    operations: ["generic.files.open", "mongodb.browse", "mongo.playground.run"],
    docs: "https://www.mongodb.com/docs/mongodb-vscode/" },
  { id: "postgres.migrations", label: "PostgreSQL migrations", provider: "postgres",
    about: "Numbered SQL files applied in order to a database (or a Neon branch).",
    files: [{ path: "*.sql", role: "code", requiredFor: ["read", "validate", "deploy"], about: "Migration files, applied in name order." }],
    operations: ["generic.files.open", "postgres.browse", "postgres.migrations.apply"],
    docs: "https://www.postgresql.org/docs/current/ddl.html" },
  { id: "python.script", label: "Python script", provider: "python",
    about: "A Python entry script, its dependencies and its tests.",
    files: [
      { path: "requirements.txt", role: "dependencies", optional: true, about: "Packages to install." },
      { path: "tests/", role: "test", optional: true, about: "Unit tests (pytest)." }
    ],
    operations: ["generic.files.open", "python.tests.run"],
    commands: { "python.tests.run": "python -m pytest" } },
  { id: "python.package", label: "Python package", provider: "python",
    about: "A Python package described by pyproject.toml.",
    entry: "pyproject.toml",
    files: [
      { path: "pyproject.toml", role: "entry", about: "Package metadata and dependencies." },
      { path: "tests/", role: "test", optional: true, about: "Unit tests (pytest)." }
    ],
    operations: ["generic.files.open", "python.tests.run"],
    commands: { "python.tests.run": "python -m pytest" } },
  { id: "jupyter.notebook", label: "Jupyter notebook", provider: "jupyter",
    about: "A notebook opened in VS Code's notebook editor. Opening it never runs it.",
    files: [], operations: ["generic.files.open"] },
  { id: "fabric.item", label: "Fabric item (Git format)", provider: "fabric",
    about: "A Fabric item folder synchronised by Fabric Git integration (.platform plus its definition files).",
    files: [{ path: ".platform", role: "config", requiredFor: ["read", "deploy"], about: "Item type and logical id." }],
    operations: ["generic.files.open", "fabric.workspace.browse"] },
  { id: "terraform", label: "Terraform / OpenTofu root", provider: "terraform",
    about: "Infrastructure as code; plan shows changes, apply makes them.",
    files: [{ path: "*.tf", role: "infrastructure", requiredFor: ["read", "validate", "deploy"], about: "Terraform files." }],
    operations: ["generic.files.open", "infra.tofu.plan"] },
  { id: "bicep", label: "Bicep deployment", provider: "bicep",
    about: "Azure infrastructure as code (what-if shows changes before deploying).",
    entry: "main.bicep", files: [{ path: "main.bicep", role: "entry" }], operations: ["generic.files.open"] },
  { id: "json-schema", label: "JSON contract", provider: "other",
    about: "A JSON Schema describing data exchanged between steps.", files: [], operations: ["generic.files.open"] },
  { id: "docs", label: "Documentation", provider: "other",
    about: "Documentation files.", entry: "README.md", files: [{ path: "README.md", role: "entry" }], operations: ["generic.files.open"] },
  { id: "powerbi.pbip", label: "Power BI project (PBIP)", provider: "powerbi",
    about: "A Power BI project saved as files (report and semantic model folders).",
    files: [{ path: "*.pbip", role: "entry", about: "The project file opened by Power BI Desktop." }],
    operations: ["generic.files.open", "powerbi.project.open-desktop"] },
  { id: "airflow.dags", label: "Airflow DAG folder", provider: "airflow",
    about: "DAG files. DataPass never imports them.",
    files: [{ path: "*.py", role: "code", requiredFor: ["read"], about: "DAG definitions." }], operations: ["generic.files.open"] },
  { id: "generic", label: "Files", provider: "other",
    about: "Files without a known convention.", files: [], operations: ["generic.files.open"] }
];

export const PROFILE_INDEX: ReadonlyMap<string, ArtifactProfile> = new Map(PROFILES.map(p => [p.id, p]));
export const PROFILE_IDS: readonly string[] = PROFILES.map(p => p.id);

/** Default profile for a provider when the component declares files but no profile. */
export function defaultProfileFor(provider: string | undefined): ArtifactProfile {
  const byProvider: Record<string, string> = {
    "azure-functions": "azure-functions.python", "azure-data-factory": "adf.factory", "azure-storage": "azure-storage.container",
    "cosmos-nosql": "cosmos-nosql.container", "mongodb-atlas": "mongodb.database", postgres: "postgres.migrations", neon: "postgres.migrations",
    databricks: "databricks.bundle", python: "python.script", jupyter: "jupyter.notebook", terraform: "terraform", bicep: "bicep", powerbi: "powerbi.pbip", airflow: "airflow.dags"
  };
  return PROFILE_INDEX.get(byProvider[provider ?? ""] ?? "generic")!;
}

/** Role guessed from a declared file name, so an AI can list plain paths. */
export function guessRole(path: string): FileRole {
  const p = path.toLowerCase();
  const name = p.split("/").pop() ?? p;
  if (/(^|\/)tests?\//.test(p) || /^test_.*\.py$|_test\.py$/.test(name)) return "test";
  if (/^requirements.*\.txt$|^pyproject\.toml$|^package\.json$|^environment\.ya?ml$/.test(name)) return "dependencies";
  if (/\.schema\.json$/.test(name) || /(^|\/)contracts?\//.test(p)) return "contract";
  if (/^readme(\.|$)|\.md$/.test(name) || /(^|\/)docs?\//.test(p)) return "docs";
  if (/\.(tf|bicep)$/.test(name)) return "infrastructure";
  if (/^\.funcignore$|^\.dockerignore$|^dockerfile$/.test(name)) return "packaging";
  if (/^host\.json$|\.ya?ml$|^\.platform$|(^|\/)(linkedservice|dataset|trigger)s?\//.test(p)) return "config";
  if (/\.(csv|parquet|jsonl)$/.test(name)) return "data";
  return "code";
}

/** Phases a missing file blocks. Optional files never block. */
export function requiredPhases(file: Pick<ProfileFile, "role" | "requiredFor" | "optional">): readonly Phase[] {
  if (file.optional) return [];
  return file.requiredFor ?? ROLE_REQUIRED_FOR[file.role];
}

/** How a profile path is observed: one file, a non-empty folder, or a single-folder wildcard. */
export function pathKind(path: string): "file" | "dir" | "glob" {
  if (path.endsWith("/") || path.endsWith("/**")) return "dir";
  if (path.includes("*")) return "glob";
  return "file";
}
