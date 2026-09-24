# 02 — cloud and BI integration qualification

Sources S01–S20 are in 08_SOURCES_AND_EVIDENCE.md. Documentation consulted 2026-09-24. The table is a scoped integration inventory, not a claim to have installed or tested every extension.

## Replace tool-count health with operation-specific readiness

The inspected Fabric adapter computes readiness from integration-tool detection and Toolbox binding. The Power BI adapter includes Copilot CLI in its tool set and primarily detects filename markers. This can conflate an optional companion with a prerequisite for a manual workflow.

Introduce an internal capability record keyed by:

`provider + nativeItemType + operation + authoringMode + clientVersion + targetEnvironment`

Record required versus optional tools, supported source representations, allowed typed action, authentication scope, capacity/network constraints, docs source/date, adapter implementation state, smoke-test evidence and safe fallback. Distinguish `documented`, `implemented`, `desktop-qualified`, `account-qualified`, `runtime-observed`. Unknown is not false and documentation is not a runtime receipt.

Required checks are scoped to the selected action. A missing Copilot, MCP server, community extension, .NET SDK or Toolbox clone must not block a plain notebook/source workflow that does not require it. A missing artifact or permission that the action actually needs must block it.

## Native tool routing inventory

| Surface | Native route | DataPass responsibility and boundary |
|---|---|---|
| Fabric workspaces/items | Microsoft `fabric.vscode-fabric` | Bind account/tenant/workspace/item; open supported native definitions; do not assume a complete local designer for every item [S01] |
| Fabric notebook/Spark/environment/lakehouse | Microsoft `SynapseVSCode.synapse`, Python/Jupyter as required | Add the Data Engineering path missing from current detector. Despite old Synapse naming, this is Fabric, not Azure Synapse Analytics. Local-sync and remote VFS are distinct [S02] |
| Fabric User Data Functions | Microsoft's separate extension/toolchain | Optional selected workload; resolve exact extension ID/version at implementation, not a universal Python/.NET requirement [S01] |
| Fabric Studio | Community `GerhardBrueckl.fabricstudio` | Optional specialist peer; feature/command negotiation, never label it Microsoft official |
| OneLake explorer | Community `GerhardBrueckl.onelake-vscode` | Optional file/data companion; read/write scope and remote URI handling |
| Fabric Toolbox | microsoft/fabric-toolbox repository | Curated asset registry, version/license/prerequisites per asset; not one installed extension or blanket-supported deployment engine [S03] |
| Fabric CLI / fabric-cicd | Official CLI/library | Version-pinned native actions, supported item matrix, target mapping, explicit mutation; credentials remain provider-owned [S04] |
| ADF pipelines | Azure Data Factory native authoring/ARM/CLI and qualified migration tools | Model triggers, integration runtime, linked services/connections, parameterization and native activities; portal fallback rather than invented VS Code designer [S05] |
| Fabric pipelines / Dataflow Gen2 | Fabric native item definitions/portal and supported APIs | Keep orchestration separate from Power Query transformations, connection binding and refresh; capability support checked per item/action |
| Fabric RTI | Eventstream/Eventhouse/KQL native definitions and portal/API | Source/destination/mapping/retention/ingestion identity. Do not treat RTI as notebook tooling [S06] |
| Airflow | Local Docker, OCI/K3s or Fabric Apache Airflow Jobs | DAG/source/executor/dependency/metadata DB/log profiles; one scheduler owner; no Python execution during discovery [S07] |
| Databricks | Official `databricks.databricks`, CLI and DAB | Active bundle/target/auth/compute, job/pipeline/app resources, validate/deploy/run separated; no vendor fork [S08] |
| Databricks notebook development | Connect/local notebook versus Jobs execution | Track different execution semantics, dependencies and supported languages; local %pip is not remote runtime installation [S08] |
| Power BI project | PBIP entrypoint + semantic model + report | Discover relationships and formats, not just '*.pbip'/'*.tmdl'/'*.pbir'; model-to-report dependencies and tests [S09] |
| Semantic model | TMDL files, Microsoft TMDL extension, Desktop/TOM/XMLA where appropriate | Official docs link `CPIM.TMDL-language-support`; marketplace fetch failed in this audit, so installation/commands remain to verify. Do not mark unavailable merely from that fetch [S10] |
| Report | PBIR versioned JSON and Desktop/service | Per-file schema allowlist; not all JSON is safe for external edits; no silent legacy conversion [S09] |
| Specialist BI clients | Power BI Desktop, Tabular Editor, DAX Studio; optional community Power BI Studio | Keep advanced modelling/report rendering external; OS/license/XMLA permission qualification; none universally required |
| Azure resources/IaC | Azure CLI, Azure resource tools, Bicep/OpenTofu | Separate tenant/subscription/resource group and data-plane roles; plan/what-if is not apply; no duplicate IaC owner for a resource [S11] |
| SQL/KQL | MSSQL/KQL native clients when selected | SQL dialect, endpoint, read role, query budget and engine specified; Fabric SQL, Eventhouse KQL and Databricks SQL are not interchangeable |
| Containers/remote | Container Tools, Kubernetes, Remote SSH, Dev Containers | Current docs use `ms-azuretools.vscode-containers`; preserve legacy Docker detection as an alias after verification. Host-local/SSH/container probes are distinct [S12] |
| Grafana | gcx/Foundation SDK/Git Sync/provider/API | Separate dashboard source, datasource/alert configuration and live telemetry; no custom designer [S13] |
| Mongo | Official MongoDB VS Code / mongosh / qualified read adapter | Native Playground may write and run Node code. A read-only DataPass snapshot requires its own authorization and restricted query contract [S14] |
| Diagram files | Optional `hediet.vscode-drawio`, Mermaid and DiagramCloud | Existing specialist editor for .drawio; selected-scope semantic exchange separately; diagrams never authorize execution [S15] |
| Streamlit/React | Ordinary Git, native Python/Node toolchain and external app | No bespoke Streamlit IDE required. Contracted requests/results, not an embedded full application |

## Power BI work is more than a report-file detector

Represent semantic model and report as separate native items. Record PBIP root, model representation (TMDL/TMSL), report representation/version, source queries, relationships, measures, storage mode, endpoint bindings, sensitivity and access role. PBIP is project packaging, PBIR is report definition, TMDL describes semantic models. They are not three synonymous artifact types.

For FOIL, semantic correctness includes unit/currency/year, scenario-versus-machine grain, time basis, classification and approved aggregation. Nine counterfactual cases are not nine installed machines whose energy can be added. This rule belongs in the domain/data contract, then in tests for measures and visuals.

Current external-editing documentation excludes some files from arbitrary edits, warns about unapplied Power Query changes and requires reload coordination. The Desktop Bridge is preview and must be opt-in/version-qualified. Protect unsaved Desktop work, preserve lineage identities, show report impact after model renames, and use the native application for unsupported transformations. Dataset refresh, report rendering and authorization tests are distinct from schema validity. [S09–S10]

## Fabric RTI deployment has operational side effects

The current Eventstream CI/CD documentation says target resources become active after deployment unless configuration fails. Pause/resume state is not preserved as a deploy-safe guarantee. Treat promotion/import as potentially billable/active work, not merely writing JSON. Direct-ingestion Eventhouse destinations can need rebinding; cross-workspace support is limited. Match source type against the current CI/CD support table. [S06]

Acceptance: a proposed Eventstream change shows target workspace, connection refs, activation consequences, budget/retention, source offsets/consumer group and rollback/rebinding work before any apply. No claim of end-to-end exactly-once delivery; preserve event identity, replay and deduplication tests.

## Fabric Airflow: two kinds of Git must not be conflated

Native Fabric workspace Git/ALM and Airflow DAG Git-Sync are distinct. Current docs describe restrictions around connection/workspace identity with Git-Sync, omitted secret/Git-Sync configuration during export/import and target rebinding. Record the selected mode and reject incompatible combinations instead of promising a portable DAG from a Python filename alone. [S07]

## Grafana: separate configuration owners

Git Sync currently covers dashboards and folders, not datasources/alerts/library panels or permission replication. Choose a qualified gcx/API/IaC path for those resources. gcx may support additional resources; that does not expand Git Sync's resource coverage. Experimental commands must be flagged and version-qualified. A hosted datasource also needs a network route from Grafana, not just from the user's laptop. [S13]

## Things not qualified by this review

No native extensions were installed in a desktop VS Code here. Exact command IDs, extension APIs, running CLI versions, OS support, account entitlements, tenant feature flags, private networking and cloud execution must be tested. Documentation links and source detection are evidence only for their stated scope. Use a manifest-based compatibility register with lastCheckedAt and a repeatable smoke test, not a promise to know every present/future vendor feature.
