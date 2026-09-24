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

## Implementation status (branch feat/diagramcloud-bridge-v1)

Implemented on top of the `claude0.9` code line (V2.2 Work view):

| Acceptance step (contract README) | Where |
| --- | --- |
| 2. Detect `.datapass/diagramcloud.json` | `src/core/diagramcloud/bridge.ts` `inspectSidecar` (identity and revision only; DiagramCloud validates the whole document) |
| 3. Open architecture | **DataPass: Open Architecture in DiagramCloud** opens the configured `datapass.diagramCloud.url` with no data in the URL, then DiagramCloud → JSON / AI → Open project folder… |
| 4. Copy AI context | **DataPass: Copy DiagramCloud AI Context (JSON)…**: `buildBridgeContext`, checked against `datapass-ai-context-v1` before copying |
| 5–7. Validate plan, check base revisions, review | **DataPass: Import DiagramCloud AI Plan…**: strict JSON → `planIssues` → `reviewPlan` (manifest + sidecar revisions) → per-operation approval (nothing pre-ticked) → confirmation |
| 8. Apply accepted changes | `applyApproved` + `applyWithJournal` against the reviewed bytes' SHA-256; only `set-project-metadata` and `link-node-workspace` in V1 |
| 9. DiagramCloud validates before opening | DiagramCloud `feat/diagramcloud-experience-pro-pass`: Open project folder / Reopen repository file |
| Copy current project/scope summary | **DataPass: Copy Project/Scope Summary** |

Tests: `tests/diagramcloudBridge.test.ts` checks that the runtime validators agree with the canonical JSON Schemas (ajv, dev-only) on positive and negative fixtures. It also covers sanitization (no paths, remote URLs, hosts or binding values), revision conflicts, selective apply, the journaled stale-base refusal, and byte-identical output against a DiagramCloud-generated golden file.

Not in V1: applying other plan actions, `project-manifest` operations, a VS Code webview host for DiagramCloud, and persisting the DiagramCloud folder link across browser reloads.
