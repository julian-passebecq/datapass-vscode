# Prompt for Claude — implement DataPass V2.1

You are taking over `julian-passebecq/datapass-vscode`, the **DataPass Control Plane** extension. Read `handoff/V2_1_HANDOFF.md`, then the numbered documents under `handoff/v2.1/`, before changing code. `handoff/README.md` provides the read order. The old `V2_HANDOFF.md` remains historical context; V2.1 explicitly corrects its conflicts.

## Your task

Improve the existing extension incrementally. Do not start again, merge with Mosaic, add a central database, create an autonomous AI agent or turn DataPass into a cloud/runtime replacement. The audited source remains v0.8.0; V2.1 is the requested design, not already implemented functionality. Inspect current main and actual tests first, because other work may have occurred.

The product lets me choose a real project and work scope, understand its artifacts/pipelines/resources, prepare credentials/configuration/files, and use official VS Code extensions/CLIs much faster. I ask detailed questions in external ChatGPT/Claude and manually exchange JSON/YAML/Markdown using practical copy/import buttons. DataPass keeps structure, context, concise checklist/progress/problems and evidence; the chat supplies detailed explanations and screenshot troubleshooting.

## The major refinement

Organize around **logical items and versioned artifacts**, then adapt to providers. Do not just add more unrelated cloud cards.

- A notebook has a kind, purpose, language, compute engine, native representation, source revision and target binding. `notebook/databricks/ml` is a useful filtered view, not a rigid identity/type hierarchy.
- A workflow coordinates work. Airflow DAGs, ADF/Fabric pipelines and Lakeflow Jobs share some concepts but differ in native semantics.
- A Lakeflow declarative data pipeline is not a Job. DAB packages deployment resources; it is not the execution engine. Manual is a trigger mode.
- A streaming flow is not one batch task per event. Azure Pipelines CI is not Azure Data Factory.
- Artifacts are pinned source/data/config/model/report/CAD revisions with schemas, hashes, producer/consumer relations and evidence.
- Resources are declared once and used through bindings. The same OCI VM can appear under Wind and Hydro with separate configurations, while rebooting the host has shared impact.

Keep native files authoritative. The generic graph/projection helps navigation and AI context; it is not a lossy universal execution DSL. Preserve native metadata you cannot interpret.

## Airflow is a required first-class slice

The current Infrastructure adapter detects Docker/kubectl/SSH; that is not an Airflow module. Build a real workflow adapter covering DAG source, deployment profile, versions/packages, connections/variable references, schedule owner, prerequisites, native UI links, run/task observation and receipts.

Profiles include local Docker Compose, OCI/K3s and a managed Fabric Airflow binding. Microsoft Fabric has Apache Airflow Jobs; they are not the same as Fabric pipelines. Verify versions/packages/network/identity against current documentation and the actual target. Do not assume a local Airflow 3 DAG works unchanged on a managed Airflow 2 service.

Never import arbitrary DAG Python in the extension host for discovery. Use conservative static inspection with `partial/unknown` results; explicit isolated validation is a separate approved action. Airflow's own runtime remains the scheduler. Closing VS Code must not stop external jobs.

Keep one scheduling owner per campaign. Airflow may submit a native Lakeflow Job and observe its receipt; do not independently schedule the same work twice. Distinguish a Celery Redis broker from an optional FOIL API cache. KubernetesExecutor's metadata database is an operational service, not DataPass storage or scientific truth.

## Domain specialization without hard-coding FOIL

Add opt-in declarative company/project packs. A FOIL experiment pack can expose a parameter form with units, evidence labels, case revisions, kernel/CAD/input/result links and downstream impact. It should allow useful project-specific work, not just bookmark a JSON file.

But the core does not implement turbine physics, CAD, LCOE, or company scientific decisions. Delegate to the client's existing versioned schema/kernel/Streamlit tools. Packs cannot load arbitrary executable code or bypass approval. Edit detached candidates, validate completely, show the diff, accept a new revision and preserve historical artifacts.

The private uploaded R0 pack has three P/A/B research families and nine D/N/F cases, shared geometry within a family, external CAD and a `foil.experiment/1.0-rc1` native contract. These are hypotheses/synthetic L0 scenarios, not nine certified machines or probability quantiles. Do not publish exact raw scientific/commercial payloads into this public repo without a separate decision. `05_DOMAIN_PACKS_AND_FOIL.md` records artifact digests and what was actually checked.

## Preserve the V2 user experience

- Flexible company/project/domain/workstream/workspace depth and stable IDs.
- One active DataPass workspace per managed VS Code window; multiple tabs; a workspace may span several related technologies.
- Project view and type/provider view over the same items.
- Managed, assisted, reference-only, external and disabled modes.
- GitHub/Azure Repos/GitLab/generic Git per repository; remote-only repositories are valid.
- Quick links to native cloud workspaces, apps, Git/CI, Grafana, Airflow, OCI, billing/IAM and docs.
- Environment requirements and `.env.example` comparison without exporting values; distinguish local and actual remote configuration.
- Account/credential requirements through vendor auth/SSH/vault/SecretStorage; not a new password manager.
- Daily objective, preflight, concise checklist, done/blocked/problem/notes and exportable progress.
- Hosted Grafana context/as-code, generic VM/IaC/Docker/K3s, Apps including Streamlit/React and reference-only projects.
- Small architecture diagrams/lineage views with safe Mermaid rendering; avoid an oversized canvas/editor before the basic workflow is usable.

## AI exchange is transactional

Provide a collapsible Export/Import panel with preview, bounded scope, redactions and convenient buttons. JSON first, safe YAML optional, Markdown for humans. No autonomous model calls.

A context must carry repository base maps, file/config/schema/pack identities and artifact hashes. A plan must reference its context and exact bases. Reject stale/unsupported/unsafe plans. Review diffs and downstream impact. Approval binds to the hash of the selected plan. Separate writing files from environment preparation, deployment and execution.

No arbitrary shell from AI. Use typed action IDs and controlled arguments. Defend against traversal, symlinks/junctions, YAML constructors/alias expansion, untrusted remote schema refs, command injection and secrets in notebook outputs/logs/Compose interpolation. Multi-repo application is not globally atomic: stage, journal and report partial failure honestly.

## Evidence model

Keep architecture approval, source existence, local/CI validation, configuration/access, deployment, run status and domain/scientific validity separate. A copied command or opened UI is not execution. A failed network observation is not proof the provider rejected a run. Reconcile before retrying to avoid duplication. Preserve native IDs, source/input hashes, observation time, performed checks and limits in receipts.

## Portability

Build an assessment layer, not a universal converter. Reuse official ADF→Fabric migration tooling when available. For notebooks, preserve cells/source and assess dependencies, utilities, paths, catalogs, secrets and runtime differences. Only generate candidates for a tested subset; unknown/dynamic constructs require manual review. A schema-valid file is not semantic equivalence or a deployed workload.

Prefer a reusable Python package plus thin provider notebooks for shared FOIL science. Do not copy its formulas into several provider templates.

## FOIL architecture versions

The older VNext includes Azure/Fabric, Cosmos and Redis. The newer uploaded R0 proposes a smaller first circuit: OCI/shared kernel → MQTT/gateway → Event Hubs → Fabric Eventstream/Eventhouse; immutable archives → OneLake/Fabric preparation → pinned Databricks campaigns; Grafana Cloud/Alloy. Extra Redis/RAG/Azure SQL/MotherDuck/ADF orchestration are deferred from that path, not deleted from the longer-term plan.

Record proposal/decision lineage rather than silently rewriting Mongo ADRs. Approved ordinary Git/CLI FOIL work can continue while DataPass develops. Only DataPass-mediated actions require its adapter qualification; don't make completion of the whole extension a technical blocker.

Existing code pointers are in 05 and the older source map. Reinspect `reactoracle` feature history and `foil-3d-stream`'s CAO branch, not only their default README. Never infer deployment or current repo role from a name.

## Implementation order and expectations

1. Audit baseline and tests; summarize retained code versus actual gaps.
2. Fix schema/runtime parity and add item/artifact/binding/remote-repo contracts with migration tests.
3. Implement secure manual AI exchange, checklist and receipts.
4. Build one practical Airflow vertical slice and target profiles.
5. Add the optional declarative FOIL form/lineage pack using authorized fixtures.
6. Extend native Fabric/Databricks preparation/observation without duplicating their clients.
7. Add bounded portability assessment and finish operational UX.

Use `08_IMPLEMENTATION_AND_ACCEPTANCE.md` for positive and negative tests. Validate Windows/remote behavior, not just pure TypeScript. Keep UI focused, expandable and keyboard-accessible. Preserve existing commands and behavior. Record test scope and unresolved provider limitations; update implementation status honestly.

Do not spend this pass on Mongoku, an agent/MCP runtime, a pricing crawler, a universal converter, a plugin marketplace or a physics/CAD rewrite. Keep their future contract seams only. You may improve implementation organization with an explicit rationale, but do not discard the product boundaries or silently treat proposals as truth.

Start with the code audit and the first coherent implementation batch. Missing cloud identities should appear as useful setup blockers, not cause a redesign or fabricated defaults.
