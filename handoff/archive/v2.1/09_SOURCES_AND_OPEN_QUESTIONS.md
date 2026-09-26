# 09 — source register, verification and unresolved decisions

## Evidence conventions

Design recommendations in this folder are proposed DataPass behavior. External references establish provider capabilities, not this extension's implementation or the user's account state. Sources were consulted on 2026-09-24; mutable URLs must be rechecked at implementation/activation. Repository branches and uploaded reports are separate evidence streams.

## Primary-source register

### S01 — Fabric Airflow Jobs
- https://learn.microsoft.com/en-us/fabric/data-factory/apache-airflow-jobs-concepts
- https://learn.microsoft.com/en-us/fabric/data-factory/create-apache-airflow-jobs

Supports managed Python DAG/Airflow item distinction from Fabric pipelines. At consultation the concepts page listed Airflow 2.10.5, Python 3.12 and networking restrictions. Treat these as dated documentation facts; probe actual tenant/region/capability before activation.

### S02 — Fabric identity for Airflow integration
- https://learn.microsoft.com/en-us/fabric/data-factory/apache-airflow-jobs-workspace-identity

Supports a native identity/integration path. It does not eliminate permission/capacity setup or guarantee private endpoint access.

### S03 — Apache Airflow Docker quickstart
- https://airflow.apache.org/docs/apache-airflow/stable/howto/docker-compose/index.html

Learning/development Compose topology, executor/services, DAG mounts and memory guidance. Not a blanket production specification or a universal minimum for every Airflow profile. Pin a release rather than copying a moving stable file into a deployment.

### S04 — Airflow KubernetesExecutor
- https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/kubernetes_executor.html

Task pods, provider package, non-SQLite metadata DB, DAG distribution/log persistence and differences from Celery. Redis is not intrinsically required by KubernetesExecutor.

### S05 — ADF/Fabric migration and differences
- https://learn.microsoft.com/en-us/azure/data-factory/how-to-upgrade-your-azure-data-factory-pipelines-to-fabric-data-factory
- https://learn.microsoft.com/en-us/fabric/data-factory/migrate-planning-azure-data-factory
- https://learn.microsoft.com/en-us/fabric/data-factory/data-factory-limitations

Supports assessment-first workflow and capability differences. Check supported connectors/activities, integration runtime, expressions and trigger behavior for the exact source/target. Do not confuse mounting with migration.

### S06 — Jupyter notebook format
- https://nbformat.readthedocs.io/en/5.6.1/format_description.html

Cells/source/metadata/outputs and namespaced metadata. A shared file representation is not a shared execution environment.

### S07 — Fabric notebook source/control
- https://learn.microsoft.com/en-us/fabric/data-engineering/notebook-source-control-deployment
- https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/notebook-definition

Native Git and item-definition representations, including FabricGitSource/IPYNB support. Preserve platform metadata and default environment/lakehouse context.

### S08 — Databricks notebook interchange
- https://docs.databricks.com/gcp/en/notebooks/notebook-export-import

Native notebook import/export formats. Runtime/storage/secret compatibility still requires assessment; consult the correct hosting-cloud documentation for target-specific operations.

### S09 — Fabric NotebookUtils
- https://learn.microsoft.com/en-us/fabric/data-engineering/notebook-utilities
- https://learn.microsoft.com/en-us/fabric/data-engineering/notebookutils/notebookutils-notebook-management

Provider-specific notebook utilities and limitations. Not a justification for textual substitution of all Databricks or Synapse APIs.

### S10 — Databricks Jobs / bundles / pipelines
- https://docs.databricks.com/aws/en/jobs/configure-job
- https://docs.databricks.com/aws/en/dev-tools/bundles
- https://docs.databricks.com/gcp/en/ldp/source-controlled

Jobs coordinate tasks; declarative data pipelines have their own definition; bundles package/deploy resources. Manual versus scheduled is a trigger distinction. Use the actual cloud/runtime documentation for execution.

### S11 — VS Code local/remote storage and capabilities
- https://code.visualstudio.com/api/extension-capabilities/common-capabilities
- https://code.visualstudio.com/api/advanced-topics/remote-extensions
- https://code.visualstudio.com/api/references/vscode-api

State/storage/SecretStorage and remote extension-host considerations. These APIs do not magically implement distributed locks or make source scope a security boundary for other extensions.

### S12 — OCI Always Free limits
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

The page consulted lists an A1 free aggregate of 2 OCPU/12 GB. The actual account allocation, available shape/capacity and runtime load were not inspected. Do not assume the historical 4/24 figure, and do not treat a documentation limit as provisioned capacity.

### S13 — Databricks Free Edition limitations
- https://docs.databricks.com/aws/en/getting-started/free-edition-limitations

The consulted page restricts Free Edition to non-commercial use. A synthetic dataset does not automatically make client/commercial R&D non-commercial. Record the use profile and resolve entitlement before activating a paid/client workload.

### S14 — Fabric trial
- https://learn.microsoft.com/en-us/fabric/fundamentals/fabric-trial

Trial duration is finite; the consulted page describes 60 days. Actual allocation and expiration are unknown here. Capacity, expiry and export/retention plan are prerequisites, not immutable free-tier promises.

### S15 — Existing composition references
- https://github.com/microsoft/fabric-toolbox
- https://github.com/microsoft/fabric-cicd
- https://github.com/gbrueckl/FabricStudio
- https://github.com/gbrueckl/OneLake-VSCode
- https://github.com/grafana/grafana-foundation-sdk
- https://github.com/grafana/terraform-provider-grafana

These are the existing handoff's donor/peer-tool references, not newly audited runtime installations. Reuse public interfaces, retain licenses, and verify command IDs/versions. Fabric Toolbox is a set of tools/accelerators/scripts rather than one integrated project UI. The community FabricStudio/OneLake tools are not mislabeled as the official Microsoft extension.

## Repository audit references

Audited DataPass main: `5af14e5e9a5e825b5c3e5d1854cde04b35be5e4b`.
Inspect these paths at that commit or current successors:
- `src/core/types.ts`
- `src/core/projectManifestModel.ts`
- `src/adapters/infrastructure.ts`
- `src/adapters/databricks.ts`
- `handoff/SOURCE_MAP.md`
- `handoff/V2_HANDOFF.md`

The existing V2 document is valuable history but includes earlier statements corrected by 01. No new Atlas write/read claim is made by this V2.1 docs pass; historical Atlas IDs are pointers requiring authorized re-read before promotion.

## Uploaded source register

- `DataPass_FOIL_R0_Handoff.md` (duplicate uploaded with `(1)`): generic artifact/receipt requirements, manual AI loop, remote-only Git, preflight and authority boundaries.
- `FOIL_Wind_R0_Dossier.md` (duplicate `(1)`): R0 P/A/B × D/N/F proposal, limitations, smaller first cloud circuit, current CAO branch reference and integration tests required.
- `FOIL_Wind_R0_Launch_Pack_2026-09-24.zip`: archive byte hash recorded in 05; contains native schemas/cases/kernel, CAD and proposal files. Integrity/schema/replay checks were performed; no new physics/CAD/browser/cloud execution.
- `FOIL_WIND_3D_R0.html`: supplied viewer, not executed or published in this pass.
- The user supplied Mermaid source directly. Its external Mermaid edit URL is a navigation reference, not proof of a deployed topology.

The full private/raw materials are not vendored into this public handoff. A future implementation uses authorized private fixtures or clearly synthetic sanitized public equivalents.

## Unresolved decisions to surface rather than invent

1. Final schema split between project manifest, item records, binding profiles and artifact indexes. Keep readable files and avoid a giant single ever-growing JSON.
2. Exact V1→V2.1 migration contract, unknown-field policy and schema library choice. Existing hand-written validation is not sufficient by assumption.
3. First Airflow deployment/version: local test target, existing OCI profile and managed Fabric support may differ. Pin each independently.
4. Which provider API/official-extension commands are supported for native item deep links and run observation; use honest UI fallback when not available.
5. How DAG source reaches OCI task pods, including image digest, code revision, mounts, metadata database and log persistence.
6. Which scheduler owns each campaign; do not enable both Airflow and native Job schedules by default.
7. Location/ownership of FOIL Fabric code and whether a new repo is actually necessary.
8. Adoption of the R0 reduced critical path versus the older Atlas VNext proposal and existing organizational gate. Documentation here does not update the ADR.
9. Approval to use exact R0 scientific data/schema in public tests. Default: no raw payload publication.
10. Domain pack authoring/trust workflow and which external native validator/kernel invocation is qualified.
11. Distinction between scientific schema validation and actual cross-field scientific checks; the pack must not claim physics validation from JSON Schema.
12. Local exclusivity boundary across Windows/macOS/Linux, SSH, containers, multiple profiles and worktrees. No global exclusivity promise without tested coordination.
13. Precise retention/privacy of local notes, receipts and AI exports; explicit commit/export only for sensitive context.
14. Multi-repo partial-apply recovery design and native action idempotency where the provider lacks an idempotency mechanism.
15. First portability route with a small enough tested subset; full arbitrary workflow translation is not a V2.1 gate.
16. Actual OCI shape/architecture/memory/disk, Fabric capacity/expiry, Databricks license profile and budget. All remain account-specific.
17. Hosted Grafana instance/datasources/permissions and plugin entitlement, not guaranteed by a diagram.
18. Long-term R0 artifact hosting/backup and source retention; an uploaded attachment is not a permanent production artifact registry.
19. Future Mongoku snapshot authority and transport when that project resumes. No current sync, database mutation or duplicate backlog.

Claude may adjust names, folder partitioning and implementation order with a documented reason. Preserve user intent, source limits and security boundaries. Avoid reopening settled questions such as merging Mosaic, forcing a backend, or adding an autonomous agent to V2.1.
