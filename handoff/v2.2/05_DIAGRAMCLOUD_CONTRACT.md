# 05 — DataPass ↔ DiagramCloud architecture-view contract

## What was actually inspected

Repository: https://github.com/julian-passebecq/diagramcloud
Inspected model: `src/core/model.ts` at `9a2741675de7f79a9aa3c5db7f17fa3a6d2b5cfa`; architecture documentation also read through the connector.

Its native schema is a strict `Project` document with schemaVersion 1, revision, rootViewId, nodes/edges/views, evidence blocks, assets/sources and story steps. It has relational validation and a 12 MiB import bound. Node IDs have a constrained format; node kinds and edge types are fixed enums. Visibility defaults to public, and the root view cannot be private. Those are significant constraints, not implementation details to ignore.

**A DataPass manifest or new interchange envelope is not accepted automatically by this schema.** Do not add unknown fields and claim native compatibility. A dedicated mapping adapter and round-trip fixtures are required.

## Ownership and semantic boundaries

DataPass carries selected project semantics and source references within its declared authority. DiagramCloud owns presentation layout, explanatory views/story and publication composition. FOIL architecture/PM authorities do not move merely because a graph is exported.

Keep semanticRevision, layoutRevision and native DiagramCloud document revision distinct. A layout edit is not a cloud change. A semantic edit coming back from DiagramCloud is a proposal against a base snapshot, not an automatic rewrite of provider files or FOIL authorities.

Data-flow graphs may contain feedback cycles; an Airflow DAG cannot. Hierarchical navigation must not create recursive view expansion. Validate each graph according to its purpose instead of applying one generic 'must be a DAG' check.

## ArchitectureView envelope

The design kit supplies `datapass.architecture-view/0.1-draft` with scope/base, sources, classification, semantic/layout revisions, stable nodes/edges and omissions. Production mapping also needs native document ID/revision, ID map, member views and a loss/unsupported-feature report.

Map DataPass `itemRef` to stable native node IDs through a sidecar mapping; do not derive identity only from the displayed title. Map typed data/control/dependency relations deliberately. Runtime status is separate evidence: DiagramCloud's illustrative status/speed must not be treated as measured latency, health or job state.

Put detailed provenance in a private, versioned sidecar or supported source/evidence projection. Do not overload native labels or append unknown properties that strict validation rejects. Source revisions, hashes and observedAt must survive the return path even if the viewer cannot display all of them.

## Confidentiality: current native defaults need special care

Never pass a confidential DataPass export into the current native document builder and rely on omitted visibility fields. Public defaults and a public root are not authorization to expose client content. For the first integration, export only a reviewed/redacted projection that is suitable for the current viewer, or keep a private interchange file unopened until a private authoring path is explicitly qualified.

Set every supported visibility field explicitly. Validate the projected graph after removing private nodes, edges, evidence and assets; remove dangling references and private locators. A public neutral root must not contain private titles/metadata. Verify final PPTX/SVG/HTML exports, not only what is visible on the canvas. 'Public' in a native document is still only a label until the owner approves distribution.

## Transport and UX

First path: Export architecture context → preview redaction/omissions → save/copy bounded file → open DiagramCloud → explicit import/map/review. No automatic cloud upload or publication.

Do not put project JSON, signed storage URLs or credentials in URL query strings. Opening the app URL and importing a local file are separate steps. A future authenticated API/IPC connector must preserve size bounds, source versions, origin validation and confirmation. Webview embedding is optional later, not a second bundled React application inside Galaxy.

Offer a small local Mermaid preview and 'Open .drawio' through a specialist extension. The supplied Draw.io diagram is an artifact/reference; dragging its boxes does not edit infrastructure. XML/SVG imports need active-content/external-reference controls, not browser trust by filename.

## Compatibility test contract

A mapping fixture must prove stable ID preservation; classification/redaction; duplicate/dangling-ref rejection; allowed data-flow cycles; no recursive view expansion; source/target revision conflicts; layout-only diff isolation; unsupported native kinds reported; and no publication/action permission gained from import. Native schema version changes require an explicit adapter migration.

The existing DiagramCloud example mentioning BigQuery/Kafka is explanatory sample content, not a newly approved FOIL topology. Import the selected architecture revision and label learning/portfolio reconstruction separately from active engineering.

Mongoku can later consume a sanitized status projection. It is not needed for this bridge and no Mongoku code or database is changed by this pass.
