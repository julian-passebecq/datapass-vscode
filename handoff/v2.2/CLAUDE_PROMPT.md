# Claude takeover prompt — DataPass V2.2

You are implementing `julian-passebecq/datapass-vscode`, not Mosaic. Start from current main and inspect its actual state. The audited baseline for this handoff was c0601c50fcf558a72647deb1e40b87e87d069996; source runtime v0.8.0. V2.2 is a design/acceptance revision, not a shipped extension.

Read `handoff/V2_2_HANDOFF.md` and the numbered documents in `handoff/v2.2/`. Preserve the V2.1 item/artifact/binding/workflow model, Airflow adapter, native portability assessment and security requirements. Consult older V2 history only for context or unresolved details; do not reintroduce superseded assumptions.

## Product purpose

I want to select a real project and work scope, see its architecture/version, understand contracted inputs/outputs and prerequisites, and quickly open the right official Fabric/Databricks/BI/SSH/IaC tool. I use external ChatGPT/Claude chat for detailed explanations and screenshots. The extension prepares and retains structured context, not a mandatory paid agent.

The normal loop is: choose objective → preflight → preview/copy bounded context → external AI proposes files/plan → paste/import candidate → validate and review exact changes → accept selected files → separately launch qualified native operations → attach receipts/problems → export current status to chat. No autonomous cloud execution or required MCP in V2.2.

## Preserve these boundaries

One VSIX. Generic core + provider adapters + optional declarative domain packs. Local preferences/session state; Git for durable code/config/contracts; no mandatory Neon/Mongo/MotherDuck backend. Native vendor definitions and tools remain authoritative for their behavior. One active DataPass scope per window is a UX/policy rule, not a security sandbox over other extensions.

Resources may be shared through workload bindings. Remote-only repositories/apps are valid. Never force clones, auto-pull over dirty work, auto-merge/push, silently install plugins or create paid cloud resources. DataPass checklists do not replace client PM backlogs.

## What must improve

1. Replace readiness based on installed-tool counts with operation-specific required/optional capabilities, evidence and fallback. Read the tool qualification matrix. In particular add the Fabric Data Engineering route, distinguish core Fabric, RTI, pipeline and Airflow paths, and remove mandatory Copilot/MCP assumptions from manual Power BI workflows.
2. Model PBIP project packaging, TMDL semantic models and PBIR report definitions separately, including native version/edit limitations, dependencies and Desktop reload protection. Do not invent full VS Code report rendering.
3. Add generic I/O contracts: schema/grain/keys/units/time/quality/classification/compatibility and producer/consumer ports. These connect external apps, datasets, workflows, BI and deliverables.
4. Implement external App request/result exchange for Streamlit or React developed outside DataPass. Correlate exact input/base revisions and frozen request bytes. File receipt is not proof of execution or publication.
5. Provide optional Programme/domain-pack views. FOIL needs Design, Experiments, Economics, Studies/Francis, Business/Funding and Publications as views of references. No TypeScript clone of FOIL physics/LCOE; computations remain in the reviewed external kernel.
6. Implement facet-specific invalidation. Budget changes need not stale CAD; geometry/pose/generator changes can. Unknown dependencies invalidate conservatively. Preserve historical outputs and native hashes.
7. Use reviewed PublicationBriefs to send approved facts/assets to external PPTX/document/website tools. Preserve assumptions/uncertainty/rights; generating a deliverable is not permission to publish it.
8. Add a DiagramCloud mapping adapter, not a blind JSON handoff. Its current schema is strict and has public defaults; do not leak private context or treat diagram animation as runtime evidence.
9. Mongo is an optional context input. Start with versioned sanitized snapshot import and named bounded read queries. Never auto-run an AI Playground or duplicate deep client truth. Direct writes remain a separate reviewed authority workflow.

## FOIL inputs

The new Design Lab is `julian-passebecq/foil-streamlit-wind-3d-lcoe`, app.py. It is a reference bootstrap, not a completed editable lab. Reuse its private R0 package only with authorized access. The original reference schema/IDs are frozen; candidate revisions require an envelope/migration. Preserve Python-native case hashing, separate byte digests and do not assume JSON.stringify equivalence.

Use FOIL as the first consumer: app → candidate/config/artifacts → Oracle simulation → MQTT/gateway → Event Hubs → Fabric RTI; immutable snapshots → Fabric preparation → Databricks campaign → analytical outputs; Grafana for operations. Broader VNext options are later scopes, not prerequisites. No cloud deployment or Mongo reconciliation is authorized by this prompt alone.

Also test a synthetic retail BI project with no FOIL pack or Mongo. Generic value is mandatory.

## Implementation instructions

First report existing versus missing behavior and a short sequence of small passes. Then implement contracts and safe exchange before adding every UI card. Run the draft contract kit, but do not mistake it for the production importer: implement filesystem/URI safety, revision races, action permissions, native validation and recovery tests in the real codebase.

Use typed actions; never evaluate code or free shell from clipboard. Treat imported artifacts, schemas and source text as untrusted. Separate approval, apply, submitted job, observed runtime, scientific validation and publication. Keep confidentiality audience-specific. Read capability limits for Eventstream activation, Airflow Git modes, Databricks execution modes and Grafana Git Sync coverage.

Keep current tests/build working. Add migration, negative, non-FOIL and desktop/native acceptance tests; report skips/unknowns. Do not claim 'bulletproof', universal conversion, complete vendor support or live deployment from documentation/CI alone. Update implementation status with exact evidence. DataPass must accelerate the project, not become a prerequisite for every independently approved native CLI workflow.
