# 08 — source register and evidence limits

Review date: 2026-09-24. URLs below are primary documentation or inspected repositories. Product docs may evolve. Recheck exact versions/editions/tenant rollout before implementing an operation. New architecture recommendations are design decisions, not vendor promises.

## External documentation consulted

- **S01 Fabric workspace/core extension and functions:** https://learn.microsoft.com/en-us/fabric/data-engineering/set-up-fabric-vs-code-extension and https://marketplace.visualstudio.com/items?itemName=fabric.vscode-fabric . Defines core workspace/item support and separate functions tooling; MCP is an optional path, not required for manual use.
- **S02 Fabric Data Engineering:** https://learn.microsoft.com/en-us/fabric/data-engineering/setup-vs-code-extension ; https://marketplace.visualstudio.com/items?itemName=SynapseVSCode.synapse ; https://learn.microsoft.com/en-us/fabric/data-engineering/manage-workspace-with-vs-code-vfs-mode . Distinct notebook/Spark/lakehouse/environment route; local-sync versus VFS; old name does not mean Azure Synapse support.
- **S03 Fabric Toolbox:** https://github.com/microsoft/fabric-toolbox . Collection of tools/accelerators/scripts; qualify each asset and license, not a single full-support extension.
- **S04 Existing CLI/deployment peers:** https://github.com/microsoft/fabric-cli and https://github.com/microsoft/fabric-cicd . Existing handoff references; current native item coverage and exact invocation remain per-version implementation checks, not runtime-qualified in this pass.
- **S05 ADF/Fabric migration:** https://learn.microsoft.com/en-us/azure/data-factory/how-to-upgrade-your-azure-data-factory-pipelines-to-fabric-data-factory ; https://learn.microsoft.com/en-us/fabric/data-factory/data-factory-limitations . Assessment and native differences; no universal conversion guarantee.
- **S06 RTI ingestion and CI/CD:** https://learn.microsoft.com/en-us/fabric/real-time-hub/add-source-azure-event-hubs ; https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/eventstream-cicd . Source modes/identities plus target activation, partial compatibility, destination rebinding and cross-workspace limits.
- **S07 Fabric Airflow:** https://learn.microsoft.com/en-us/fabric/data-factory/apache-airflow-jobs-concepts ; https://learn.microsoft.com/en-us/fabric/data-factory/apache-airflow-jobs-workspace-identity ; https://learn.microsoft.com/en-us/fabric/data-factory/cicd-apache-airflow-jobs . Managed DAGs are separate from pipelines; workspace identity/Git-Sync and ALM limitations require mode-specific checks. Retain upstream Airflow/KubernetesExecutor sources from V2.1.
- **S08 Databricks extension:** https://docs.databricks.com/gcp/en/dev-tools/vscode-ext ; https://docs.databricks.com/aws/en/dev-tools/vscode-ext/configure ; https://docs.databricks.com/aws/en/dev-tools/vscode-ext/notebooks ; https://docs.databricks.com/aws/en/dev-tools/vscode-ext/install . Bundles and notebook/Connect/Jobs paths differ. Installation and overview pages do not give one universal compute rule; qualify the selected operation, cloud and entitlement. SQL warehouse resources are not equivalent to Connect execution targets.
- **S09 Power BI project/report editing:** https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-external-editing ; https://learn.microsoft.com/en-us/power-bi/developer/embedded/projects-enhanced-report-format ; https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report . Native format/version and supported external edits matter; coordinate Desktop state/reload and preview features.
- **S10 TMDL:** https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-tmdl-view . Microsoft links `CPIM.TMDL-language-support`; fetching that Marketplace endpoint failed here. Treat the ID as documentation-linked and installation unqualified, not as evidence the extension is removed. Model metadata changes do not imply refresh or intact report visuals.
- **S11 Azure IaC:** https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-visual-studio-code . Native deployment pane, validate and what-if are distinct from deploy and depend on chosen Azure scope.
- **S12 VS Code runtime placement:** https://code.visualstudio.com/docs/remote/ssh ; https://code.visualstudio.com/docs/devcontainers/containers ; https://code.visualstudio.com/api/advanced-topics/remote-extensions ; https://code.visualstudio.com/docs/enterprise/extensions . Separate local/remote hosts; current Container Tools ID is ms-azuretools.vscode-containers. These APIs do not create a multi-machine lock or sandbox other extensions.
- **S13 Grafana:** https://grafana.com/docs/grafana-cloud/learn-and-build/as-code/observability-as-code/git-sync/usage-limits/ ; https://grafana.com/docs/grafana-cloud/learn-and-build/as-code/observability-as-code/git-sync/permissions-grafana/ ; https://grafana.com/docs/grafana-cloud/ai-tools/gcx/overview/ . Git Sync covers dashboards/folders; gcx has a broader capability surface with experimental commands and deployment-dependent availability. Permission/network/configuration ownership remains separate.
- **S14 Mongo:** https://www.mongodb.com/docs/mongodb-vscode/playgrounds/ ; https://www.mongodb.com/docs/mongodb-vscode/require-playgrounds/require-modules/ . Playgrounds can execute CRUD and Node code; not an automatic safe read-only connector.
- **S15 Draw.io:** https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio . Unofficial specialist integration, offline editor by default, native diagram file handling. It is not a cloud-deployment engine.

## Inspected source code

**S16 DataPass:** main `c0601c50fcf558a72647deb1e40b87e87d069996`; src/adapters/fabric.ts, src/adapters/powerbi.ts, the V2.1 source register, existing source/model audit and CLAUDE entry point. Current source is v0.8.0, with V2/V2.1 design files. This pass changes documentation/contract fixtures, not runtime integration code.

**S17 FOIL:** supplied latest ZIPs and report plus live README of `julian-passebecq/foil-streamlit-wind-3d-lcoe`. Latest report identifies a dedicated Design Lab and pending Mongo reconciliation. Local extracted bootstrap/reference reader and contract notes were inspected. Original payloads remain private. See VALIDATION.md for checks actually run.

**S18 DiagramCloud:** `julian-passebecq/diagramcloud`, src/core/model.ts at `9a2741675de7f79a9aa3c5db7f17fa3a6d2b5cfa`, docs/ARCHITECTURE.md and relevant search results. Native strict schema, IDs, public defaults, graph limits and revision checking were read. No new native importer, UI/browser qualification or deployment was performed.

## Explicit unresolved qualification

- Exact installed extension versions and supported command/API IDs for automated handoff.
- Local/Remote SSH/Dev Container/Fabric VFS behavior on the user's machine.
- Power BI Desktop/version/OS and the intended TMDL/PBIR edit/reload path.
- Native Fabric item support, tenant settings, identities, capacity and private networking.
- Databricks actual workspace/cloud/edition and authorized use profile.
- OCI actual shape/ARM64/RAM/storage; never equate a dated free-tier page with allocated capacity.
- Hosted Grafana instance, datasource access, permissions and paid/plugin entitlements.
- Mongo live namespace/read identity and whether a supplied snapshot remains current.
- DiagramCloud private-authoring compatibility and any newer importer on another branch.
- Private FOIL schema/package redistribution permission and publication rights.

No current live cloud/Mongo inventory was recreated in this pass. No commercial quota is hard-coded as a permanent architectural guarantee. Any previously quoted free-tier amount must be verified against the actual account and current official terms before use.


> **Implementation note (2026-09-24, v0.9.0):** the Marketplace lists the Microsoft TMDL extension as `analysis-services.TMDL`. DataPass detects that ID first and keeps `CPIM.TMDL-language-support` as an alias. Fabric Data Engineering is `SynapseVSCode.synapse` (web: `SynapseVSCode.vscode-synapse-remote`) and needs the Jupyter extension and a JDK. Installation remains unqualified until tested on a desktop.
