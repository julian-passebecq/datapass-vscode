# DataPass ↔ DiagramCloud Bridge V1

Status: **draft contract for implementation review**  
Owner: `julian-passebecq/datapass-vscode`  
Consumer: `julian-passebecq/diagramcloud`  
Date: 2026-09-24

## Ownership rule

The bridge contract is canonical in **DataPass VS Code**, because DataPass is the project/control-plane producer.

DiagramCloud consumes the contract and pins the exact DataPass contract revision it was tested against. DiagramCloud must not silently redefine the DataPass project-context or AI-plan formats.

This contract does not make either product depend on the other's runtime.

## Canonical Git locations

### DataPass VS Code

```text
julian-passebecq/datapass-vscode

schemas/datapass-project.schema.json
    Existing project manifest contract.

contracts/diagramcloud/README.md
    This cross-product bridge specification.

contracts/diagramcloud/datapass-ai-context-v1.schema.json
    Sanitized project/scope export sent to ChatGPT/Claude.

contracts/diagramcloud/datapass-ai-plan-v1.schema.json
    Reviewed operations returned by ChatGPT/Claude.
```

### DiagramCloud

DiagramCloud owns its own document grammar:

```text
julian-passebecq/diagramcloud

src/core/model.ts
    Canonical DiagramCloud project/document model.

src/experience/model.ts
    Experience/task/workspace/item grammar.

public/diagramcloud.schema.json
public/experience/schema.json
    Generated schemas; do not hand-edit.

docs/contracts/datapass-diagramcloud-bridge.lock.json
    Pinned DataPass bridge revision and paths tested by DiagramCloud.
```

## Per-project Git files

For a repository managed by DataPass:

```text
<project-repository>/
└── .datapass/
    ├── project.json
    └── diagramcloud.json
```

### `.datapass/project.json`

Already owned by DataPass.

Contains:

- project identity;
- repository bindings;
- platform configuration;
- safe links;
- provider/project settings allowed by the DataPass schema.

It must not contain credentials, tokens, passwords or client secrets.

### `.datapass/diagramcloud.json`

Optional Git-tracked DiagramCloud sidecar.

Contains one validated DiagramCloud project document, including its optional embedded `experience` pack.

It is the **single DiagramCloud-side project source of truth** for that repository.

Do not split the canonical project into separate `architecture.json` and `experience.json` files in V1. The current DiagramCloud model already validates the experience pack as part of the project document.

The sidecar may contain private/internal presentation data only when the repository visibility and project policy allow it. Credentials and secrets are never permitted.

Images and large binaries must not be embedded unboundedly in this file. Use artifact references/storage once the asset layer is connected.

## AI exchange is not canonical project storage

DataPass V2's manual AI bridge should export/import bounded exchange envelopes.

Generated AI files should normally be temporary or explicitly exported by the user:

```text
.datapass/
└── ai/
    ├── context.json     # generated sanitized export
    └── plan.json        # reviewed AI return
```

These files are not required to be committed.

The user flow is:

```text
DataPass selected scope
        ↓
Copy / export AI context
        ↓
ChatGPT / Claude
        ↓
AI plan JSON
        ↓
DataPass schema validation
        ↓
base-revision check
        ↓
human diff / selective approval
        ↓
apply to project files
        ↓
DiagramCloud reflects the reviewed project/task/evidence changes
```

AI never writes directly to live cloud resources merely because an operation appears in a plan.

## V1 bridge responsibilities

### DataPass produces

1. Project identity.
2. Current selected scope.
3. Safe repository labels/identities.
4. Safe platform capability/configuration state.
5. Project/workstream/task IDs where known.
6. Current known blockers/status.
7. DiagramCloud sidecar path/revision when present.
8. Sanitized source revision information useful for conflict checking.

### DiagramCloud consumes

1. Project/scope identity.
2. Architecture/resource declarations.
3. Reviewed task mappings.
4. Source/provenance references.
5. Reusable evidence/workspace definitions.

DiagramCloud adds presentation/navigation context. It does not become the cloud-resource authority.

### DiagramCloud can return

DiagramCloud edits should be returned as reviewed AI-plan-style operations or a reviewed replacement of `.datapass/diagramcloud.json`.

DataPass remains responsible for project-level review, revision checks and safe file writes.

## Organization / company / project model

Do not hard-code company semantics into DiagramCloud.

DataPass V2.1 already defines the correct extension rule:

```text
generic core + provider adapter + optional domain pack
```

Examples:

- FOIL can have a domain pack with engineering-specific labels/forms/evidence semantics.
- A career/portfolio reconstruction can use a non-live project kind.
- Contoso can remain a local data-platform project without FOIL-specific concepts.

Company/project hierarchy is navigation context; resource identity remains reusable and typed.

Suggested project kinds:

```text
active-engineering
learning
portfolio-reconstruction
reference
archived
```

A portfolio reconstruction must never be presented as a currently connected production system.

## DiagramCloud project-side convention

DataPass should detect, by convention:

```text
.datapass/diagramcloud.json
```

before adding a new manifest schema dependency.

That allows Bridge V1 to work with the existing DataPass project manifest schema.

A future DataPass manifest schema version may add an explicit pointer such as:

```json
{
  "diagramCloud": {
    "documentPath": ".datapass/diagramcloud.json"
  }
}
```

Do not bump the DataPass manifest schema solely to ship the first bridge unless the implementation genuinely needs it.

## Revision/conflict rule

Every AI context must carry the source revision(s) it was generated from.

Every AI plan must carry matching base revisions.

If the project/DiagramCloud revision changed after the context was exported:

- reject direct apply;
- show a conflict;
- ask the user to regenerate context or manually reconcile.

Never silently overwrite newer project work.

## Security/redaction

The bridge must exclude:

- credentials;
- tokens;
- passwords;
- secret environment values;
- machine-specific private paths unless explicitly approved;
- generated commands that may contain sensitive values;
- private source text from a public export.

A declaration such as `platforms.fabric` does not prove that the Fabric workspace exists or is authenticated.

Keep these states distinct:

- declared;
- inferred;
- observed;
- verified-in-source;
- verified-at-runtime.

## Artifact boundary

Bridge V1 does not require cloud artifact storage.

Later target:

- GCS: reusable machine-facing image/object artifacts;
- Google Drive: final PDF/PPTX/CV/portfolio deliverables;
- BigQuery: optional artifact metadata/search projection.

Git stores schemas, manifests, stable IDs, source revisions and small structured presentation data.

Do not block the bridge on GCS, Drive, BigQuery, Canva or Penpot.

## First implementation acceptance

1. DataPass opens a project with `.datapass/project.json`.
2. DataPass detects optional `.datapass/diagramcloud.json`.
3. **Open architecture** launches/opens the DiagramCloud project.
4. **Copy AI context** exports a sanitized scope document conforming to `datapass-ai-context-v1.schema.json`.
5. AI returns `datapass.ai-plan`.
6. DataPass validates the plan and checks base revisions.
7. User reviews operations before any file mutation.
8. Accepted DiagramCloud/task/evidence changes update `.datapass/diagramcloud.json`.
9. DiagramCloud validates that document before opening it.
10. Neither product needs cloud credentials for this flow.

## Non-goals

Bridge V1 is not:

- automatic cloud inventory crawling;
- an autonomous AI agent;
- a universal cloud execution language;
- a second project database;
- a live query engine;
- a credential transport;
- a lossless Canva/Penpot document bridge.

## Compatibility

The DataPass manifest remains authoritative for project/control context.

The DiagramCloud document remains authoritative for interactive architecture/task/evidence presentation.

The bridge is the reviewed interface between them.
