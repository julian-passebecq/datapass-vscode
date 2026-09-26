# DataPass V2.2 — connected project contracts and qualified cloud workflows

Design review: 2026-09-24. Audited DataPass main: `c0601c50fcf558a72647deb1e40b87e87d069996`; extension source baseline: v0.8.0.

**This is an implementation handoff, not a shipped V2.2 extension or a cloud-deployment claim.** It refines V2.1; do not restart the product. Read [the V2.2 index](v2.2/README.md), then [the Claude prompt](v2.2/CLAUDE_PROMPT.md). V2.1 remains the underlying items/artifacts/workflows design.

## The central decision

DataPass should understand a project's inputs, outputs, versions, responsibilities and evidence well enough to prepare the right cloud work. It should not absorb all the applications that produce that information.

> Programme objective → selected scope → contracted inputs → native items and artifacts → qualified tool handoff → execution observations → contracted outputs → reviewed reuse/publication.

There are four cooperating layers:

| Layer | Owns | Does not own |
|---|---|---|
| Generic DataPass core | Identity, scopes, versions, contracts, dependency impact, local execution checklists, review and receipts | Physics, accounting, cloud schedulers or every client's authoritative backlog |
| Provider adapters | Exact native file/operation/environment mappings and qualified tool routes | A universal Fabric/Databricks/Airflow transpiler |
| Optional domain packs | Company-specific parameter schemas, units, terminology, reference mappings and brief templates | A second implementation of the scientific kernel or a new implicit authority |
| External applications and authorities | Streamlit/React code and computation, Mongo domain truth, native cloud runtimes, DiagramCloud presentation | Permission to overwrite DataPass or publish private content merely by returning JSON |

## What this pass changes

1. **Task-specific tool qualification, not installed-extension counting.** Fabric workspace management, Fabric Data Engineering, PBIP/TMDL/PBIR, Fabric RTI, ADF, Airflow and Databricks execution modes need distinct capability records.
2. **Input/output contracts.** A file schema alone is insufficient. Record grain, identity, units, time semantics, delivery, quality, confidentiality, producer, consumers and compatibility.
3. **External App Exchange.** Streamlit and React can be developed outside VS Code by a user working with ChatGPT and GitHub. DataPass exports a bounded request and accepts a correlated result package; it does not need to host their UI.
4. **FOIL Programme pack.** Design, experiments, economics, studies, business/fundraising and publication are related views. Scientific and commercial authorities remain external. LCOE is a model-output contract, not a new TypeScript calculator.
5. **Selective invalidation.** A budget change can invalidate LCOE and a report without invalidating unchanged CAD. Geometry, pose and generator changes have different dependencies. Unknown dependencies invalidate conservatively.
6. **DiagramCloud bridge with actual schema constraints.** Its existing native schema is not the proposed DataPass exchange envelope. Map explicitly, retain private semantic provenance outside public projections, and never imply diagram animation is telemetry.
7. **Optional Mongo context adapter.** Start with reviewed snapshots and named bounded read queries. No full-database mirroring, mandatory Mongo backend, arbitrary Playground execution or automatic authority writes.
8. **Evidence and publication gates.** A copied command, submitted job, completed runtime and validated scientific result are separate observations. Generating a PPTX or website is not authorization to publish it.

## What remains unchanged

One VSIX; local-first preferences; Git-versioned configuration; manual ChatGPT/Claude copy/paste; no mandatory MCP, agent, Neon, Mongo or MotherDuck; flexible organizations/projects/workspaces; one active DataPass work scope per window; shared resources with distinct workload bindings; native provider files; generic notebooks/workflows/Airflow; version/capability planning without another Trello; hosted Grafana; VM/IaC/container context; Apps; quick links; scoped environment/access preparation. Mosaic remains separate. Mongoku remains a later read-model consumer.

A scope is a navigation/policy context, not a sandbox for independently installed extensions. DataPass cannot claim it blocks every action a user takes in Fabric, a terminal or an external application.

## Latest FOIL input incorporated

The Design Lab now targets the private repository `julian-passebecq/foil-streamlit-wind-3d-lcoe`, entrypoint `app.py`. The live README and supplied package describe a bootstrap/reference reader, not the finished editable scientific UI. The previous `foil-3d-stream` is a donor for this migration, not a repository to delete or globally reclassify without checking its other uses.

The R0 references remain frozen. Candidate edits use a separate envelope and explicit contract migration. The supplied supplement requires Python/JavaScript hashing agreement, CAD/2D pose dependencies, and the same case identity in calculations and Francis reports. This pass does not change FOIL geometry, budgets, conclusions, Mongo records or cloud resources.

The broader Atlas VNext remains a proposed long-term architecture. The R0 first circuit is smaller: Oracle simulation → MQTT/durable gateway → Azure Event Hubs → Fabric Eventstream/Eventhouse; immutable Parquet → OneLake/Fabric preparation → pinned Databricks campaigns; Grafana Cloud/Alloy for operations. Redis, Cosmos/RAG, extra SQL and MotherDuck/DuckLake remain possible later capabilities, not prerequisites for the first experiment. Azure Data Factory is conditional on an integration need; Fabric Data Factory handles the selected native Fabric workflow.

## Non-negotiable qualification boundary

No architecture can be made 'bulletproof' by enumerating extensions. This handoff records documented support, known restrictions, source-code gaps and tests to perform. Desktop extension command IDs, exact installed versions, tenant permissions, capacity, network and real end-to-end behavior still need qualification.

**A documented vendor feature is not yet an implemented DataPass feature.** Existing source detects some tools and copies commands; do not relabel that as fully managed PBIR, Airflow or RTI.

## Build a useful vertical slice first

Implement versioned contracts and safe context exchange; a remote-only App reference; an optional FOIL parameter/impact view; one real notebook/pipeline workflow with task-specific preflight; then publication and Mongo/DiagramCloud read bridges. A synthetic non-FOIL project must pass the same contract tests. Detailed cloud tests remain separately approval-gated.

FOIL must remain operable through ordinary Git and qualified native CLI workflows while DataPass is being implemented. Do not turn this handoff into a reason to postpone the laboratory or to provision everything at once.
