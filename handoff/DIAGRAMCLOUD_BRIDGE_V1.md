# DataPass ↔ DiagramCloud Bridge V1 — implementation handoff

Date: 2026-09-24  
Status: draft bridge contract, docs/schema only on this branch.

## Read first

Canonical bridge specification:

`contracts/diagramcloud/README.md`

Schemas:

- `contracts/diagramcloud/datapass-ai-context-v1.schema.json`
- `contracts/diagramcloud/datapass-ai-plan-v1.schema.json`

Existing DataPass project schema remains:

- `schemas/datapass-project.schema.json`

## Product boundary

DataPass VS Code owns:

- project/control context;
- organization/project/work-scope selection;
- repository and provider bindings;
- readiness/status;
- safe AI context export;
- reviewed AI plan import;
- explicit file/cloud action review.

DiagramCloud owns:

- interactive architecture;
- project/task storytelling;
- task workspaces;
- reusable evidence items;
- portfolio composition;
- publication views.

Do not merge the two applications.

## Project repository convention for Bridge V1

```text
.datapass/
├── project.json
└── diagramcloud.json
```

`.datapass/diagramcloud.json` is one validated DiagramCloud project document. Its optional `experience` member contains task/workspace/item content.

Do not create separate canonical architecture and experience files in V1.

Generated AI context/plan documents are exchange artifacts and are not another source of truth.

## Company-specific behavior

Use the DataPass V2.1 rule:

```text
generic core + provider adapter + optional domain pack
```

FOIL-specific forms/units/evidence semantics belong in a FOIL domain pack.

DiagramCloud receives reviewed generic entities/tasks/evidence and does not execute domain-pack code.

## First implementation slice

1. Detect `.datapass/diagramcloud.json` by convention.
2. Add project-level actions:
   - Open architecture
   - Copy AI context
   - Import AI plan
   - Copy current project/scope summary
3. Export a context envelope conforming to `datapass-ai-context-v1.schema.json`.
4. Validate returned `datapass.ai-plan`.
5. Enforce base-revision checks.
6. Preview operations before apply.
7. Apply accepted file changes only.
8. Open DiagramCloud on the updated sidecar.
9. No cloud mutation is implied by this bridge.

## Do not block this on

- DataPass manifest schema V2;
- MCP;
- autonomous agents;
- GCS;
- Google Drive;
- BigQuery;
- Canva;
- Penpot;
- full CodeWiki execution.

Those are later integrations.

## DiagramCloud consumer

The corresponding DiagramCloud Pro branch must pin the exact contract commit it was tested against in:

`docs/contracts/datapass-diagramcloud-bridge.lock.json`

That lock prevents the two repos from silently drifting.
