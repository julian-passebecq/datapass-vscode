# DataPass V2.1 — artifact-centered project control

Design date: 2026-09-24. Repository: `julian-passebecq/datapass-vscode`.
Audited main: `5af14e5e9a5e825b5c3e5d1854cde04b35be5e4b`; runtime source baseline: v0.8.0.
Status: **implementation specification, not a shipped V2.1 extension**.

## The decision

Do not add another unrelated Airflow card beside an ever-growing list of cloud cards. Give DataPass a common vocabulary for the things users work on, then specialize their representation and actions for each engine/provider.

> Project context → logical item → versioned artifacts → target binding → supported native tool → execution receipt.

A second extension point supplies company-specific meaning:

> Generic core + provider adapter + optional domain pack.

This preserves the original value: prepare a real project in VS Code so the user can work faster with official Fabric, Databricks, SSH, Git and other tools, guided by an external AI through deliberate copy/paste. It does not create a cloud replacement, a runtime scheduler or a physics engine.

## Answers to the new questions

**Airflow is a first-class orchestration adapter in the next implementation.** It was discussed under infrastructure but the current extension does not model DAGs/runs. Docker CLI detection is not an Airflow module. Fabric Data Factory also has managed Apache Airflow Jobs, so one Airflow logical workflow may have an OCI/K3s, local Docker or Fabric-managed target. The engines, supported versions, packages, identities and available actions must still be checked separately. [S01–S04 in the source register]

**A notebook is not `notebook/databricks/ml`.** That string mixes type, provider and purpose. Store independent facets: kind=notebook, purpose=ML, language=Python, compute=Spark, native dialect=Databricks, representation=source/IPYNB, source revision, environment and target binding. Group by any of these in the UI. A notebook can have several derived targets without becoming several unrelated conceptual projects.

**Pipelines share useful concepts, not all semantics.** Airflow DAGs, ADF pipelines, Fabric pipelines, Lakeflow Jobs, Lakeflow declarative data pipelines, Eventstreams and Azure Pipelines CI are not synonyms. Common inspection, lineage, parameters, prerequisites, review and receipts are valuable. A universal lowest-common-denominator execution language would lose important behavior. Preserve native definitions; implement bounded migration assessment and reviewed candidates. [S05–S10]

**Company-specific modules are appropriate as opt-in domain packs.** A FOIL pack can expose a parameter form, units, evidence labels, case revisions, CAD/model artifact links, campaign inputs and downstream impact. It delegates computations and detailed visualization to the versioned FOIL kernel/Streamlit/CAO tools. The core need not know how wind power or LCOE is calculated.

## What V2.1 must deliver

1. A typed item/artifact/binding model and versioned descriptor catalog, without replacing native source.
2. A Workflows surface and genuine Airflow adapter: DAG source, deployment profile, prerequisite checks, safe native-tool links, run/task evidence and logs.
3. Provider-aware notebook, workflow and dataflow descriptors; explicitly separate scheduling from transformations and streaming.
4. A generic artifact contract including byte integrity, schema identity, producer/consumer lineage and observed validation.
5. A safe, practical clipboard/file AI exchange with bounded context, precise base revisions, preview, selective approval and receipts.
6. An opt-in FOIL experiment pack as a consumer of the generic contracts, not a hard-coded wind product.
7. Git remote-only projects, deterministic workspace preparation, environment/access checklists, daily work and hosted Grafana/VM/app context.
8. A realistic portability assessment that says what is transferable, requires adaptation, is unsupported, or is unknown.

## Retained V2 requirements

Keep flexible organizations/projects/workstreams/workspaces; resource + binding reuse; one active DataPass work scope per window; multiple tabs inside it; management modes; native tool handoff; quick links; local preferences; Git multi-provider; no secrets in Git/AI context; typed review-first operations; concise checklists with problems/notes; version/capability comparison; hosted Grafana; generic VM/IaC/containers; Apps including Streamlit and React.

Do not make V2.1 depend on autonomous agents, MCP, Neon, Mongo, MotherDuck or a backend service. Existing optional MCP helpers may remain behind explicit opt-in; do not confuse the developer's current tooling with a shipped extension requirement.

## Scope limits

V2.1 is not a new notebook editor, visual pipeline authoring suite, Airflow scheduler, generic Git client, password manager, Grafana designer, cloud inventory crawler, auto-deployer or scientific simulator. Initial migration support is assessment plus a tightly bounded candidate generator, not arbitrary cross-cloud conversion. V3 can expand proven contracts to agents/MCP, a reference-architecture/cost guide, advanced portability and Mongoku export.

## FOIL: version the proposal, do not overwrite history

The earlier Atlas VNext adds Azure/Fabric, Redis and Cosmos to the Oracle/Databricks landscape. The uploaded R0 dossier proposes a smaller first experiment circuit: shared kernel → OCI simulation → MQTT/gateway → Event Hubs → Fabric Eventstream/Eventhouse; immutable Parquet → OneLake/Fabric → pinned Databricks campaigns; Grafana Cloud/Alloy for operations. Redis, Cosmos/RAG, extra Azure SQL, MotherDuck/DuckLake and duplicate ADF orchestration are deferred from that first critical path, not erased from the longer-term vision.

Store these as related architecture revisions/scopes with explicit decision status. A diagram, config or green CI is not a deployed resource. A completed synthetic experiment is not measured engineering evidence.

The uploaded R0 bundle is a valuable acceptance fixture: three P/A/B families, nine D/N/F cases, external CAD assets and a common experiment contract. This pass checked archive integrity, nine JSON cases and 540 replay identities/hashes; it did not rerun physics/CAD/browser/cloud qualification. No private raw R0 payload is committed here.

## Practical build order

First audit/preserve v0.8. Then implement the core contracts and safe import/export; one useful end-to-end Airflow workflow; FOIL's optional form/lineage pack; provider-aware Fabric/Databricks handoffs; then bounded migration assessment. Do not wait for every possible provider or a perfect graph canvas to make the first daily workflow usable.

FOIL must remain operable by ordinary Git and approved official CLI workflows even while DataPass evolves. DataPass-mediated actions require their own qualified adapter and permission checks, but finishing the entire extension is not an intrinsic technical prerequisite for the underlying laboratory.

## Where to continue

Read the numbered documents in [the index](README.md). Give Claude [this prompt](v2.1/CLAUDE_PROMPT.md). They include implementation interfaces, safety requirements, migration pitfalls, UI behavior, acceptance scenarios, source references and unresolved decisions. The old V2 handoff is preserved for history; do not concatenate another incompatible model onto it.
