/**
 * Operation-specific capability records. Readiness is evaluated for the action the user
 * selected, keyed by provider + native item type + operation + authoring mode.
 *
 * `implementation` says what DataPass itself does; `qualification` says what evidence exists
 * that the operation works. Documentation is not a runtime receipt.
 */

export type Qualification = "documented" | "implemented" | "desktop-qualified" | "account-qualified" | "runtime-observed";
/**
 * What kind of step an operation is, in the order a beginner meets them. Each phase has its own
 * prerequisites: reading a .py needs no cloud account; deploying needs a confirmed target.
 */
export const PHASES = ["read", "develop", "test", "validate", "deploy", "run", "publish"] as const;
export type Phase = typeof PHASES[number];
export const PHASE_LABELS: Readonly<Record<Phase, string>> = {
  read: "Read", develop: "Develop", test: "Test", validate: "Validate", deploy: "Deploy", run: "Run", publish: "Publish"
};
export type SideEffect = "reads-local" | "reads-remote" | "writes-local" | "writes-remote" | "executes-code" | "activates-resources" | "billable" | "credential-prompt";
export type ActionMode = "open-native" | "copy-command" | "run-readonly" | "manual-in-native-tool" | "reference-only";

/** One requirement is satisfied by any of its tools. */
export interface Requirement {
  anyOf: string[];
  need: "required" | "optional";
  why: string;
}

/** A project fact the operation depends on (resolved from the manifest/bindings). */
export interface FactRequirement {
  fact: string;
  why: string;
}

/** Things a human must explicitly confirm for this exact target before the operation. */
export interface ReviewRequirement {
  id: string;
  prompt: string;
}

export interface ConfigConstraint {
  /** All listed binding facts equal these values => the combination needs attention. */
  when: Record<string, string | boolean>;
  outcome: "unsupported" | "needs-config";
  message: string;
}

export interface CapabilityRecord {
  id: string;
  provider: "fabric" | "databricks" | "powerbi" | "grafana" | "infrastructure" | "mongo" | "diagram" | "apps" | "airflow" | "adf"
    | "azure-functions" | "azure-storage" | "cosmos" | "mongodb" | "postgres" | "python" | "generic" | "devops";
  nativeItemType: string;
  operation: string;
  authoringMode: string;
  /** read / develop / test / validate / deploy / run / publish. */
  phase: Phase;
  /**
   * false: the operation works on the remote service (browse a database, open a studio), not on the
   * component's local files, so an uncloned repository does not block it. Default true.
   */
  localFiles?: boolean;
  label: string;
  requirements: Requirement[];
  facts: FactRequirement[];
  reviews: ReviewRequirement[];
  constraints: ConfigConstraint[];
  sideEffects: SideEffect[];
  actionMode: ActionMode;
  datapassActionId?: string;
  covers?: string[];
  doesNotCover?: string[];
  warnings: string[];
  fallback: string;
  sources: string[];
  implementation: "implemented" | "documented-only";
  qualification: Qualification;
}

const cap = (c: Omit<CapabilityRecord, "facts" | "reviews" | "constraints" | "warnings"> & Partial<Pick<CapabilityRecord, "facts" | "reviews" | "constraints" | "warnings">>): CapabilityRecord =>
  ({ facts: [], reviews: [], constraints: [], warnings: [], ...c });

export const CAPABILITIES: CapabilityRecord[] = [
  // ---- Fabric core ----
  cap({ id: "fabric.workspace.browse", provider: "fabric", nativeItemType: "workspace", operation: "browse", authoringMode: "vscode-extension", phase: "read", localFiles: false,
    label: "Browse Fabric workspace items",
    requirements: [{ anyOf: ["ext.fabric", "cli.fab"], need: "required", why: "Official Fabric extension or CLI lists workspace items." },
      { anyOf: ["ext.fabric-studio"], need: "optional", why: "Community explorer with extra views." }],
    facts: [{ fact: "fabric.workspace", why: "Which workspace to open." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "open-native", datapassActionId: "fabric.open",
    fallback: "Open the Fabric portal and select the workspace.", sources: ["S01"], implementation: "implemented", qualification: "documented" }),
  cap({ id: "fabric.workspace.capture-summary", provider: "fabric", nativeItemType: "workspace", operation: "capture-summary", authoringMode: "cli", phase: "read", localFiles: false,
    label: "Capture read-only workspace summary",
    requirements: [{ anyOf: ["cli.fab"], need: "required", why: "Uses `fab get` and `fab ls -l`." }],
    facts: [{ fact: "fabric.workspaceName", why: "The CLI addresses workspaces by name." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "run-readonly", datapassActionId: "fabric.captureSummary",
    fallback: "Run `fab ls -l <workspace>.Workspace` yourself.", sources: ["S04"], implementation: "implemented", qualification: "documented" }),
  // ---- Fabric Data Engineering: the route the v0.8 detector missed ----
  cap({ id: "fabric.notebook.edit-local-sync", provider: "fabric", nativeItemType: "notebook", operation: "edit-and-run", authoringMode: "local-sync", phase: "develop",
    label: "Develop a Fabric notebook locally (sync to workspace)",
    requirements: [
      { anyOf: ["ext.fabric-data-engineering"], need: "required", why: "Fabric Data Engineering extension owns notebook sync and remote Spark runs." },
      { anyOf: ["ext.jupyter"], need: "required", why: "Listed prerequisite of the Data Engineering extension." },
      { anyOf: ["cli.java"], need: "required", why: "Local PySpark environment preparation needs a JDK." },
      { anyOf: ["ext.fabric-studio", "ext.onelake"], need: "optional", why: "Community companions; never required for notebook work." },
      { anyOf: ["cli.copilot", "ws.mcp"], need: "optional", why: "AI helpers; a manual notebook workflow does not need them. A .vscode/mcp.json only registers servers: it never means one is connected or signed in." }],
    facts: [{ fact: "fabric.workspace", why: "Notebook sync is scoped to one workspace." }],
    sideEffects: ["writes-local", "writes-remote", "executes-code", "credential-prompt"], actionMode: "open-native",
    warnings: ["Local sync and remote VFS are different modes: never write a remote VFS notebook through a local path.",
      "Local %pip installs do not change the remote Fabric environment."],
    fallback: "Edit the notebook in the Fabric portal.", sources: ["S02"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "fabric.notebook.edit-remote-vfs", provider: "fabric", nativeItemType: "notebook", operation: "edit-and-run", authoringMode: "remote-vfs", phase: "develop",
    label: "Edit a Fabric notebook in place (remote file system)",
    requirements: [{ anyOf: ["ext.fabric-data-engineering"], need: "required", why: "Provides the remote notebook file system." },
      { anyOf: ["ext.jupyter"], need: "required", why: "Notebook editor." }],
    facts: [{ fact: "fabric.workspace", why: "Which workspace to mount." }],
    sideEffects: ["writes-remote", "executes-code", "credential-prompt"], actionMode: "open-native",
    warnings: ["Saves apply to the workspace immediately; there is no local staging copy."],
    fallback: "Use local-sync mode or the Fabric portal.", sources: ["S02"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "fabric.items.deploy", provider: "fabric", nativeItemType: "workspace-items", operation: "deploy", authoringMode: "cli", phase: "deploy",
    label: "Deploy item definitions with fab deploy",
    requirements: [{ anyOf: ["cli.fab"], need: "required", why: "Deployment is performed by the official CLI." }],
    facts: [{ fact: "fabric.workspace", why: "Target workspace." }, { fact: "fabric.deployConfig", why: "Reviewed deployment config." }],
    reviews: [{ id: "target-confirmed", prompt: "Target workspace identity re-checked for this deployment" }],
    sideEffects: ["writes-remote", "credential-prompt"], actionMode: "copy-command", datapassActionId: "fabric.copyDeployCommand",
    warnings: ["Item types supported by the CLI change between versions; check the current support list."],
    fallback: "Use Fabric Git integration or deployment pipelines in the portal.", sources: ["S04"], implementation: "implemented", qualification: "documented" }),
  // ---- Fabric RTI ----
  cap({ id: "fabric.eventstream.deploy", provider: "fabric", nativeItemType: "eventstream", operation: "deploy", authoringMode: "git-or-deployment-pipeline", phase: "deploy",
    label: "Promote an Eventstream definition",
    requirements: [{ anyOf: ["ext.fabric", "cli.fab"], need: "required", why: "Native item deployment path." }],
    facts: [{ fact: "fabric.workspace", why: "Target workspace." }],
    reviews: [
      { id: "activation-acknowledged", prompt: "Target resources may become active after deployment (pause state is not preserved)" },
      { id: "connections-rebound", prompt: "Source connections, consumer group and offsets reviewed for the target" },
      { id: "eventhouse-rebind", prompt: "Direct-ingestion Eventhouse destinations checked for rebinding" },
      { id: "budget-retention", prompt: "Capacity budget and retention reviewed" }],
    sideEffects: ["writes-remote", "activates-resources", "billable"], actionMode: "manual-in-native-tool",
    warnings: ["Deployment is not an inert configuration import.", "Cross-workspace support is limited; check the source-type support table.",
      "No end-to-end exactly-once guarantee: keep event identity, replay and deduplication tests."],
    fallback: "Deploy through the Fabric portal with the same review checklist.", sources: ["S06"], implementation: "documented-only", qualification: "documented" }),
  // ---- Airflow ----
  cap({ id: "airflow.fabric-job.git-sync", provider: "airflow", nativeItemType: "apache-airflow-job", operation: "sync-dags", authoringMode: "fabric-git-sync", phase: "deploy",
    label: "Sync DAGs into a Fabric Apache Airflow job",
    requirements: [{ anyOf: ["cli.git"], need: "required", why: "DAG source lives in Git." }],
    facts: [{ fact: "airflow.gitSync.repo", why: "Repository the Airflow job syncs from." }],
    constraints: [
      { when: { "airflow.mode": "fabric-git-sync", "airflow.workspaceGitAlm": true }, outcome: "needs-config",
        message: "Workspace Git/ALM and Airflow DAG Git-Sync are different mechanisms; decide which owns the DAG files." },
      { when: { "airflow.mode": "fabric-git-sync", "airflow.identity": "workspace-identity" }, outcome: "needs-config",
        message: "Current docs restrict connection/workspace-identity combinations with Git-Sync; verify the combination before relying on it." }],
    sideEffects: ["writes-remote", "executes-code"], actionMode: "manual-in-native-tool",
    warnings: ["Export/import omits secrets and Git-Sync configuration; the target needs rebinding.", "Discovery never imports DAG Python."],
    fallback: "Upload DAG files through the Airflow job UI.", sources: ["S07"], implementation: "documented-only", qualification: "documented" }),
  // ---- Databricks ----
  cap({ id: "databricks.bundle.validate", provider: "databricks", nativeItemType: "asset-bundle", operation: "validate", authoringMode: "cli", phase: "validate",
    label: "Validate a Databricks Asset Bundle",
    requirements: [{ anyOf: ["cli.databricks"], need: "required", why: "`databricks bundle validate`." },
      { anyOf: ["ext.databricks"], need: "optional", why: "Official extension adds UI; not needed to validate." }],
    facts: [{ fact: "databricks.bundleRoot", why: "Folder containing databricks.yml." }],
    sideEffects: ["reads-local", "reads-remote", "credential-prompt"], actionMode: "copy-command", datapassActionId: "databricks.copyValidate",
    fallback: "Run `databricks bundle validate` in the bundle folder.", sources: ["S08"], implementation: "implemented", qualification: "documented" }),
  cap({ id: "databricks.bundle.deploy", provider: "databricks", nativeItemType: "asset-bundle", operation: "deploy", authoringMode: "cli", phase: "deploy",
    label: "Deploy a Databricks Asset Bundle to a target",
    requirements: [{ anyOf: ["cli.databricks"], need: "required", why: "`databricks bundle deploy -t <target>`." }],
    facts: [{ fact: "databricks.bundleRoot", why: "Bundle folder." }, { fact: "databricks.target", why: "Deploy target must be explicit." }],
    reviews: [{ id: "target-confirmed", prompt: "Bundle target and workspace host re-checked" }],
    sideEffects: ["writes-remote", "billable", "credential-prompt"], actionMode: "copy-command", datapassActionId: "databricks.copyDeploy",
    warnings: ["Validate, deploy and run are separate steps; deploying does not run the job."],
    fallback: "Deploy from the official Databricks extension.", sources: ["S08"], implementation: "implemented", qualification: "documented" }),
  cap({ id: "databricks.notebook.connect", provider: "databricks", nativeItemType: "notebook", operation: "develop", authoringMode: "databricks-connect", phase: "develop",
    label: "Develop a notebook locally with Databricks Connect",
    requirements: [{ anyOf: ["ext.databricks"], need: "required", why: "Configures cluster and Databricks Connect." },
      { anyOf: ["ext.python", "cli.python"], need: "required", why: "Local Python environment." }],
    facts: [{ fact: "databricks.bundleRoot", why: "Project configuration." }],
    sideEffects: ["executes-code", "reads-remote", "billable"], actionMode: "open-native",
    warnings: ["Local %pip is not a remote runtime installation; Jobs execution semantics differ from Connect."],
    fallback: "Develop in the Databricks workspace notebook editor.", sources: ["S08"], implementation: "documented-only", qualification: "documented" }),
  // ---- Power BI: PBIP, TMDL, PBIR are separate ----
  cap({ id: "powerbi.semantic-model.edit-tmdl", provider: "powerbi", nativeItemType: "semantic-model", operation: "edit", authoringMode: "tmdl-text", phase: "develop",
    label: "Edit a semantic model as TMDL",
    requirements: [{ anyOf: ["ext.tmdl"], need: "optional", why: "Language support and diagnostics; plain text editing works without it." },
      { anyOf: ["app.pbi-desktop", "app.tabular-editor"], need: "optional", why: "Reload/validate the model in a native client." },
      { anyOf: ["cli.copilot", "ws.mcp"], need: "optional", why: "AI helpers are never prerequisites for manual editing. A .vscode/mcp.json only registers servers: it never means one is connected or signed in." }],
    facts: [{ fact: "powerbi.semanticModel", why: "A *.SemanticModel folder with TMDL definition." }],
    reviews: [{ id: "desktop-closed", prompt: "Power BI Desktop has no unsaved changes to this project (close or save first)" }],
    sideEffects: ["writes-local"], actionMode: "manual-in-native-tool",
    warnings: ["Renames break report visuals: check report impact.", "Unapplied Power Query changes in Desktop can overwrite external edits.",
      "Schema validity is not refresh success, rendering correctness or correct analytical results."],
    fallback: "Edit in Power BI Desktop TMDL view or Tabular Editor.", sources: ["S09", "S10"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "powerbi.report.edit-pbir", provider: "powerbi", nativeItemType: "report", operation: "edit", authoringMode: "pbir-json", phase: "develop",
    label: "Edit a PBIR report definition",
    requirements: [{ anyOf: ["app.pbi-desktop"], need: "optional", why: "Render and verify visuals; DataPass does not render reports." }],
    facts: [{ fact: "powerbi.reportPbir", why: "Report must use the PBIR folder format; PBIR-legacy report.json is not edited as PBIR." }],
    reviews: [{ id: "desktop-closed", prompt: "Power BI Desktop has no unsaved changes to this project" }],
    sideEffects: ["writes-local"], actionMode: "manual-in-native-tool",
    warnings: ["Only files documented for external editing are safe; not all JSON is.", "No silent conversion from PBIR-legacy."],
    fallback: "Edit in Power BI Desktop.", sources: ["S09"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "powerbi.project.open-desktop", provider: "powerbi", nativeItemType: "pbip", operation: "open", authoringMode: "desktop", phase: "read",
    label: "Open a PBIP project in Power BI Desktop",
    requirements: [{ anyOf: ["app.pbi-desktop"], need: "required", why: "PBIP is opened by Desktop." }],
    facts: [{ fact: "powerbi.pbip", why: "A .pbip entry file." }],
    sideEffects: ["reads-local"], actionMode: "open-native",
    fallback: "Open the .pbip file from the OS file explorer.", sources: ["S09"], implementation: "documented-only", qualification: "documented" }),
  // ---- Grafana ----
  cap({ id: "grafana.dashboards.git-sync", provider: "grafana", nativeItemType: "dashboard", operation: "sync", authoringMode: "git-sync", phase: "deploy",
    label: "Sync dashboards and folders with Grafana Git Sync",
    requirements: [{ anyOf: ["cli.git"], need: "required", why: "Dashboards live in a Git repository." }],
    facts: [{ fact: "grafana.repo", why: "Repository connected to Git Sync." }],
    covers: ["dashboards", "folders"], doesNotCover: ["datasources", "alert rules", "library panels", "permissions"],
    sideEffects: ["writes-remote"], actionMode: "manual-in-native-tool",
    warnings: ["Connecting the repository does not configure datasources or alerts."],
    fallback: "Import dashboards through the Grafana UI.", sources: ["S13"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "grafana.datasources.configure", provider: "grafana", nativeItemType: "datasource", operation: "configure", authoringMode: "gcx-or-iac", phase: "deploy",
    label: "Configure Grafana datasources/alerts as code",
    requirements: [{ anyOf: ["cli.gcx", "cli.tofu", "cli.terraform"], need: "required", why: "A qualified configuration path outside Git Sync." }],
    facts: [{ fact: "grafana.instance", why: "Target Grafana stack." }],
    sideEffects: ["writes-remote", "credential-prompt"], actionMode: "copy-command",
    warnings: ["A hosted datasource needs a network route from Grafana, not just from your laptop.", "Experimental gcx commands must be version-qualified."],
    fallback: "Configure in the Grafana UI.", sources: ["S13"], implementation: "documented-only", qualification: "documented" }),
  // ---- Infrastructure ----
  cap({ id: "infra.tofu.plan", provider: "infrastructure", nativeItemType: "infrastructure-definition", operation: "plan", authoringMode: "cli", phase: "validate",
    label: "Plan infrastructure changes (OpenTofu/Terraform)",
    requirements: [{ anyOf: ["cli.tofu", "cli.terraform"], need: "required", why: "Plan is computed by the IaC CLI." }],
    facts: [{ fact: "infrastructure.root", why: "IaC root folder." }],
    sideEffects: ["reads-remote", "executes-code", "credential-prompt"], actionMode: "copy-command", datapassActionId: "infra.copyTofuPlan",
    warnings: ["Plan runs provider plugins. A plan is not an apply."],
    fallback: "Run plan in CI.", sources: ["S11"], implementation: "implemented", qualification: "documented" }),
  cap({ id: "infra.remote.ssh", provider: "infrastructure", nativeItemType: "vm", operation: "open-remote", authoringMode: "remote-ssh", phase: "read", localFiles: false,
    label: "Open a VM over Remote - SSH",
    requirements: [{ anyOf: ["ext.remote-ssh"], need: "required", why: "Remote SSH extension host." }, { anyOf: ["cli.ssh"], need: "required", why: "OpenSSH client." }],
    facts: [{ fact: "vm.sshHost", why: "SSH config alias (no credentials in DataPass)." }],
    sideEffects: ["credential-prompt"], actionMode: "open-native", datapassActionId: "infra.openRemoteSsh",
    fallback: "ssh <alias> from a terminal.", sources: ["S12"], implementation: "implemented", qualification: "documented" }),
  // ---- Mongo ----
  cap({ id: "mongo.snapshot.import", provider: "mongo", nativeItemType: "authority-snapshot", operation: "import", authoringMode: "file", phase: "read", localFiles: false,
    label: "Import a sanitized authority snapshot",
    requirements: [], sideEffects: ["reads-local"], actionMode: "run-readonly", datapassActionId: "datapass.importAuthoritySnapshot",
    fallback: "Export a bounded query result from the MongoDB extension and import the file.", sources: ["S14"], implementation: "implemented", qualification: "implemented" }),
  cap({ id: "mongo.playground.run", provider: "mongodb", nativeItemType: "playground", operation: "run", authoringMode: "mongodb-extension", phase: "run",
    label: "Run a MongoDB Playground",
    requirements: [{ anyOf: ["ext.mongodb"], need: "required", why: "Playgrounds run inside the MongoDB extension." }],
    reviews: [{ id: "playground-read", prompt: "I have read this Playground and it performs no writes or require() calls I did not intend" }],
    sideEffects: ["executes-code", "writes-remote", "reads-remote"], actionMode: "manual-in-native-tool",
    warnings: ["Playgrounds are executable JavaScript that can write data and require Node modules. DataPass never runs them automatically."],
    fallback: "Use a reviewed named QuerySpec instead.", sources: ["S14"], implementation: "documented-only", qualification: "documented" }),
  // ---- Diagrams / apps ----
  cap({ id: "diagram.diagramcloud.export", provider: "diagram", nativeItemType: "architecture-view", operation: "export-projection", authoringMode: "file", phase: "read",
    label: "Export a reviewed DiagramCloud projection",
    requirements: [], sideEffects: ["writes-local"], actionMode: "run-readonly", datapassActionId: "datapass.exportDiagramCloud",
    warnings: ["DiagramCloud defaults to public visibility; only reviewed projections are exported."],
    fallback: "Draw the view manually in DiagramCloud.", sources: ["S18"], implementation: "implemented", qualification: "implemented" }),
  cap({ id: "apps.remote-repo.observe", provider: "apps", nativeItemType: "application", operation: "observe-revision", authoringMode: "remote-only", phase: "read", localFiles: false,
    label: "Observe a remote-only app repository revision",
    requirements: [{ anyOf: ["cli.git"], need: "required", why: "`git ls-remote` reads the branch head without cloning." }],
    facts: [{ fact: "app.repoUrl", why: "Remote repository URL." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "run-readonly", datapassActionId: "datapass.observeAppRevision",
    warnings: ["An observed commit is not proof of what is deployed."],
    fallback: "Check the branch on GitHub.", sources: ["S16"], implementation: "implemented", qualification: "implemented" }),
  // ---- V3: generic, Python ----
  cap({ id: "generic.files.open", provider: "generic", nativeItemType: "files", operation: "open", authoringMode: "editor", phase: "read",
    label: "Open the component's files in the editor",
    requirements: [],
    sideEffects: ["reads-local"], actionMode: "open-native", datapassActionId: "datapass.openComponentEntry",
    warnings: ["Reading a file needs no cloud account, extension or sign-in."],
    fallback: "Open the folder in the Explorer.", sources: ["S16"], implementation: "implemented", qualification: "implemented" }),
  cap({ id: "python.tests.run", provider: "python", nativeItemType: "python-project", operation: "test", authoringMode: "cli", phase: "test",
    label: "Run the Python tests locally (pytest)",
    requirements: [{ anyOf: ["cli.python"], need: "required", why: "Tests run with your local Python interpreter." },
      { anyOf: ["ext.python"], need: "optional", why: "Test Explorer, debugging and interpreter selection." }],
    sideEffects: ["executes-code", "reads-local"], actionMode: "copy-command", datapassActionId: "datapass.copyComponentCommand",
    warnings: ["Tests run the project's own code on your machine: read what they do first.", "Install the dependencies in a virtual environment, not in the system Python."],
    fallback: "Run `python -m pytest` in the component folder.", sources: ["S31"], implementation: "implemented", qualification: "implemented" }),
  // ---- V3: Azure Functions ----
  cap({ id: "azure-functions.run-local", provider: "azure-functions", nativeItemType: "function-app", operation: "run-local", authoringMode: "core-tools", phase: "test",
    label: "Run the Function App locally (Core Tools)",
    requirements: [{ anyOf: ["cli.func"], need: "required", why: "Azure Functions Core Tools host the app locally (`func start`)." },
      { anyOf: ["cli.python"], need: "required", why: "Python functions run on your local interpreter." },
      { anyOf: ["ext.azure-functions"], need: "optional", why: "Official extension: run, debug and deploy from VS Code." }],
    sideEffects: ["executes-code", "reads-local"], actionMode: "copy-command", datapassActionId: "datapass.copyComponentCommand",
    warnings: ["local.settings.json holds local secrets and connection strings: keep it out of Git.",
      "A local run uses your Python version, not the one of the Azure plan: check the supported versions."],
    fallback: "Open the folder and run `func start`.", sources: ["S20", "S21"], implementation: "implemented", qualification: "documented" }),
  cap({ id: "azure-functions.deploy", provider: "azure-functions", nativeItemType: "function-app", operation: "deploy", authoringMode: "vscode-extension", phase: "deploy",
    label: "Deploy the Function App to Azure",
    requirements: [{ anyOf: ["ext.azure-functions", "cli.func"], need: "required", why: "The official extension (Deploy to Function App) or Core Tools (`func azure functionapp publish`)." },
      { anyOf: ["cli.az"], need: "optional", why: "Azure CLI to check the subscription and resource group." }],
    reviews: [{ id: "target-confirmed", prompt: "Function App, subscription and resource group re-checked for this environment" },
      { id: "cost-reviewed", prompt: "Hosting plan and expected cost reviewed" }],
    sideEffects: ["writes-remote", "billable", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["A Function App is deployed as a whole project (host.json, requirements.txt, every function), not as one .py file.",
      "Settings and secrets live in the Function App configuration or Key Vault, never in the repository.",
      "Work called over HTTP by Data Factory must answer within about 230 seconds; long jobs need the asynchronous pattern."],
    fallback: "From the project folder: `func azure functionapp publish <function-app-name>`.", sources: ["S20", "S21", "S23"], implementation: "documented-only", qualification: "documented" }),
  // ---- V3: Azure Data Factory (its own service, not Fabric) ----
  cap({ id: "adf.studio.open", provider: "adf", nativeItemType: "data-factory", operation: "open", authoringMode: "adf-studio", phase: "read", localFiles: false,
    label: "Open Azure Data Factory Studio",
    requirements: [],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "open-native", datapassActionId: "datapass.openAdfStudio",
    warnings: ["There is no official VS Code designer for Data Factory: pipelines are JSON in Git and are edited, validated and published in ADF Studio."],
    fallback: "Browse to https://adf.azure.com and pick the factory.", sources: ["S22"], implementation: "implemented", qualification: "implemented" }),
  cap({ id: "adf.validate", provider: "adf", nativeItemType: "data-factory", operation: "validate", authoringMode: "adf-studio", phase: "validate",
    label: "Validate the Data Factory definitions",
    requirements: [],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Validation checks the definitions, not that linked services can reach their data."],
    fallback: "ADF Studio → Validate all, or the ADF utilities package in CI.", sources: ["S22"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "adf.publish", provider: "adf", nativeItemType: "data-factory", operation: "publish", authoringMode: "adf-studio", phase: "deploy",
    label: "Publish the Data Factory definitions to the factory",
    requirements: [],
    reviews: [{ id: "factory-confirmed", prompt: "Target factory and its linked services point to this environment" },
      { id: "triggers-reviewed", prompt: "Triggers and schedules reviewed: nothing starts on its own by mistake" }],
    sideEffects: ["writes-remote", "activates-resources", "billable", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Saving to Git is not publishing: the factory runs what was published from the collaboration branch.",
      "A MongoDB Atlas upsert replaces the document with the same _id; it does not merge fields."],
    fallback: "ADF Studio → Publish, or ARM/Bicep templates in CI.", sources: ["S22", "S24"], implementation: "documented-only", qualification: "documented" }),
  // ---- V3: Azure Storage, Cosmos DB ----
  cap({ id: "azure-storage.browse", provider: "azure-storage", nativeItemType: "storage-account", operation: "browse", authoringMode: "vscode-extension", phase: "read", localFiles: false,
    label: "Browse the storage account (containers, blobs)",
    requirements: [{ anyOf: ["ext.azure-storage", "cli.az"], need: "required", why: "Azure Storage extension or Azure CLI." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Never make a container public or share a long-lived SAS URL to make a test pass."],
    fallback: "Azure portal → Storage account → Containers.", sources: ["S25"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "cosmos.browse", provider: "cosmos", nativeItemType: "cosmos-nosql", operation: "browse", authoringMode: "vscode-extension", phase: "read", localFiles: false,
    label: "Browse the Cosmos DB (NoSQL) account",
    requirements: [{ anyOf: ["ext.cosmosdb"], need: "required", why: "Azure Cosmos DB extension (NoSQL API)." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Cosmos DB for NoSQL, Cosmos DB for MongoDB and MongoDB Atlas are three different services and tools."],
    fallback: "Azure portal → Cosmos DB → Data Explorer.", sources: ["S26"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "cosmos.query", provider: "cosmos", nativeItemType: "cosmos-nosql", operation: "query", authoringMode: "vscode-extension", phase: "run", localFiles: false,
    label: "Run a Cosmos DB (NoSQL) query",
    requirements: [{ anyOf: ["ext.cosmosdb"], need: "required", why: "Queries run in the Cosmos DB extension." }],
    reviews: [{ id: "query-reviewed", prompt: "The query reads only, on the intended container" }],
    sideEffects: ["reads-remote", "billable", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Queries consume request units (RU) on the account."],
    fallback: "Data Explorer in the Azure portal.", sources: ["S26"], implementation: "documented-only", qualification: "documented" }),
  // ---- V3: databases as destinations ----
  cap({ id: "mongodb.browse", provider: "mongodb", nativeItemType: "mongodb-database", operation: "browse", authoringMode: "vscode-extension", phase: "read", localFiles: false,
    label: "Browse the MongoDB Atlas database",
    requirements: [{ anyOf: ["ext.mongodb", "cli.mongosh"], need: "required", why: "MongoDB for VS Code or mongosh." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Never paste a connection string into a file of the repository or into an AI context."],
    fallback: "Atlas UI → Browse collections.", sources: ["S14", "S27"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "postgres.browse", provider: "postgres", nativeItemType: "postgres-database", operation: "browse", authoringMode: "vscode-extension", phase: "read", localFiles: false,
    label: "Browse the PostgreSQL database (Neon or other)",
    requirements: [{ anyOf: ["ext.pgsql", "ext.neon", "cli.psql"], need: "required", why: "PostgreSQL extension, Neon extension or psql." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "manual-in-native-tool",
    fallback: "Neon console or any SQL client.", sources: ["S28", "S29"], implementation: "documented-only", qualification: "documented" }),
  cap({ id: "postgres.migrations.apply", provider: "postgres", nativeItemType: "postgres-database", operation: "apply-migrations", authoringMode: "sql", phase: "deploy",
    label: "Apply the SQL migrations to the database",
    requirements: [{ anyOf: ["ext.pgsql", "ext.neon", "cli.psql"], need: "required", why: "Runs the reviewed SQL on the target database." }],
    reviews: [{ id: "target-confirmed", prompt: "Database (or Neon branch) identity re-checked: not production by mistake" },
      { id: "sql-reviewed", prompt: "SQL reviewed; destructive statements (DROP, TRUNCATE, DELETE without WHERE) are intended" }],
    sideEffects: ["writes-remote", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["DataPass never creates, resets or deletes a database or a Neon branch."],
    fallback: "Run the migration files in order with psql.", sources: ["S28", "S29"], implementation: "documented-only", qualification: "documented" }),
  // ---- V3: Databricks run ----
  cap({ id: "databricks.bundle.run", provider: "databricks", nativeItemType: "asset-bundle", operation: "run", authoringMode: "cli", phase: "run",
    label: "Run a job of the deployed bundle",
    requirements: [{ anyOf: ["cli.databricks"], need: "required", why: "`databricks bundle run -t <target> <job>`." },
      { anyOf: ["ext.databricks"], need: "optional", why: "Run and watch jobs from the official extension." }],
    facts: [{ fact: "databricks.bundleRoot", why: "Bundle folder." }, { fact: "databricks.target", why: "The target the job was deployed to." }],
    reviews: [{ id: "target-confirmed", prompt: "Target workspace and job re-checked" }, { id: "cost-reviewed", prompt: "Compute and cost of this run reviewed" }],
    sideEffects: ["executes-code", "writes-remote", "billable", "credential-prompt"], actionMode: "manual-in-native-tool",
    warnings: ["Running uses what was deployed, not the files on your disk: deploy first after a change."],
    fallback: "Run the job from the Databricks extension or the workspace UI.", sources: ["S08", "S30"], implementation: "documented-only", qualification: "documented" }),
  // ---- 0.16: CI/CD on the Git hosts. A run starts on the host (push, pull request); DataPass opens where to see it. ----
  cap({ id: "ci.github-actions.runs", provider: "devops", nativeItemType: "github-workflow", operation: "view-runs", authoringMode: "git-host", phase: "read", localFiles: false,
    label: "See the workflow runs (GitHub Actions)",
    requirements: [{ anyOf: ["ext.github-actions"], need: "optional", why: "Lists workflows and runs in VS Code and validates the YAML; github.com works without it." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "open-native", datapassActionId: "datapass.openCiRuns",
    warnings: ["Runs start on GitHub when you push or open a pull request; DataPass never starts, re-runs or cancels one.", "A green run is evidence for that commit only."],
    fallback: "github.com → the repository → Actions.", sources: ["S32"], implementation: "implemented", qualification: "implemented" }),
  cap({ id: "ci.azure-pipelines.runs", provider: "devops", nativeItemType: "azure-pipeline", operation: "view-runs", authoringMode: "git-host", phase: "read", localFiles: false,
    label: "See the pipeline runs (Azure Pipelines)",
    requirements: [{ anyOf: ["ext.azure-pipelines"], need: "optional", why: "Validation and completion of azure-pipelines.yml; the runs are in the Azure DevOps portal." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "open-native", datapassActionId: "datapass.openCiRuns",
    warnings: ["The pipeline is created once in Azure DevOps from this YAML file; pushing changes the pipeline, DataPass never starts a run.", "A pipeline can build a GitHub repository: then its Azure DevOps project is not derived from the remote; name it in the component's docs."],
    fallback: "dev.azure.com → organization → project → Pipelines.", sources: ["S33"], implementation: "implemented", qualification: "implemented" }),
  cap({ id: "ci.gitlab.pipelines", provider: "devops", nativeItemType: "gitlab-pipeline", operation: "view-runs", authoringMode: "git-host", phase: "read", localFiles: false,
    label: "See the pipelines (GitLab CI/CD)",
    requirements: [{ anyOf: ["ext.gitlab"], need: "optional", why: "GitLab's official extension brings merge requests and pipeline status into VS Code; GitLab's web pages work without it." }],
    sideEffects: ["reads-remote", "credential-prompt"], actionMode: "open-native", datapassActionId: "datapass.openCiRuns",
    warnings: ["Pipelines start on GitLab when you push or open a merge request; DataPass never starts, retries or cancels one."],
    fallback: "GitLab → the project → Build → Pipelines.", sources: ["S34"], implementation: "implemented", qualification: "implemented" })
];

export const CAPABILITY_INDEX: ReadonlyMap<string, CapabilityRecord> = new Map(CAPABILITIES.map(c => [c.id, c]));
