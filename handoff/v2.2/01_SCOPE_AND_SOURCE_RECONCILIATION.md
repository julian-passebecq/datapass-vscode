# 01 — scope, source reconciliation and architecture decisions

## Evidence classes

Keep four labels in the implementation notes: **source-reported**, **inspected in code**, **checked in this pass**, **new proposal**. They are not interchangeable. External documentation establishes vendor behavior, not the user's account configuration. A repository README establishes declared scope, not successful runtime execution.

Inputs: FOIL_DataPass_Claude_Supplement_2026-09-24.zip; FOIL_Cloud_Francis_Suite_2026-09-24.zip; FOIL_Wind_Consolidation_2026-09-24.zip; the latest FOIL response; DiagramCloud proposal text; live DataPass, Design Lab and DiagramCloud repository reads. Source digests and validation scope are in VALIDATION.md.

## Reconciliation ledger

| Subject | Source-supported fact | V2.2 treatment |
|---|---|---|
| Design Lab repository | Latest FOIL report and live README name foil-streamlit-wind-3d-lcoe, app.py | Prefer that binding for the new Design Lab; preserve old donor/source provenance |
| Design Lab completeness | Bootstrap reader/importer, editable UI and synchronized CAD/2D not yet fully qualified | Show source available separately from editing/runtime/visual qualification |
| R0 references | Nine fixed P/A/B × D/N/F cases, three geometries; immutable rc1 reference contract | No silent edits or new IDs inserted into the frozen schema |
| Candidates | Supplement requires a detached candidate envelope and migration | Validate candidate, preview diff, accept revision, then revalidate consumers |
| Hashes | Legacy Python canonicalization differs from JSON.stringify | Version algorithms, keep byte hashes distinct, require cross-language vectors |
| Programme view | Source explicitly requests links to Design/Cloud/studies/Francis/observations | Projection of references, not migration of PM/Core/IT ownership |
| Business/fundraising | User now requests richer business outputs | New optional proposal, not a claim that a full business module already exists |
| Mongo reconciliation | FOIL says its reconciliation package is unapplied | Preserve source record refs and report pending reconciliation; do not assert live Mongo rerouting |
| DiagramCloud | Supplied bridge proposal plus inspected native schema | Implement explicit adapter; proposed exchange JSON is not a native document |
| BigQuery/Kafka in DiagramCloud sample | Illustrative sample/older planning model | Never automatically add them to the selected FOIL R0 or VNext baseline |
| VNext versus first experiment | Earlier proposal broader; R0 narrows critical path | Separate architecture revision, decision status and milestone scope |

## Updated FOIL source map

- Design Lab: https://github.com/julian-passebecq/foil-streamlit-wind-3d-lcoe — private, app.py, reference bootstrap. Latest supplied report cites 5f3064dce7d496561e128b4cbae5026e69a978df; re-resolve branch head before changes.
- Databricks implementation: https://github.com/julian-passebecq/foil_databrick_dab — native DAB repository; do not infer live success from source.
- Oracle lab: https://github.com/julian-passebecq/reactoracle — inspect the qualified feature branch and current ADRs, not only an older main README.
- Wind monitoring app: https://github.com/julian-passebecq/foil2d3dmonitor — separate runtime/presentation context.
- FOIL control/export: https://github.com/julian-passebecq/foil-control-v1 — code and authority interfaces, not another mutable engineering database.
- Website/3D predecessors: foil-3d-stream, foil3dnextjs, foilnextjscloudflare — roles and successor decisions require explicit reconciliation; do not choose by lexical version number.
- DiagramCloud: https://github.com/julian-passebecq/diagramcloud — explanatory/presentation product, independently versioned.

Do not publish private scientific packages or copy client source into this public repository. Public acceptance fixtures must be synthetic, structurally equivalent and explicitly labelled.

## Two architecture horizons, one lineage

FOIL R0 is a proposed first experiment circuit. Oracle hosts the lightweight simulation and batch processing; MQTT/gateway provides bounded replayable transport; Event Hubs feeds Fabric Eventstream/Eventhouse; immutable archives feed OneLake preparation and fixed Databricks campaigns. Grafana observes operations; Power BI and Streamlit explain analytical results.

The earlier VNext includes optional Cosmos document retrieval, Redis cache, additional integration/serving and portable analytical experiments. These remain future candidates, not silently deleted and not counted as built. Preserve exclusions and rationale in each release scope.

The latest FOIL note proposes not waiting for completion of all DataPass features. That is a workflow improvement, not an automatic rewrite of a Mongo approval gate. Flag the gate conflict for the project owner; permit independently approved native-tool work without falsely asserting an ADR has changed.

## What not to add

No new generic CRM, accounting ledger, business Kanban, scientific solver, Streamlit clone, React page builder, diagram editor, Mongo admin console or LLM agent is required. Add contracts and a compact Programme projection first. The cloud authoring workflow remains the product's center.

## Version identity

Keep software release, schema version, architecture revision, company programme milestone, domain case revision, code commit, binary hash and runtime observation separate. 'V2.2' here is a handoff revision; it must not be substituted for any native provider version or FOIL case revision. Superseding a draft is not deployment, and superseding a source does not erase historical evidence.
