# DataPass handoff index

## Start here

**[CURRENT.md](CURRENT.md)**: what DataPass is now and what to read, in order (PLAN, ROADMAP, v3/10, v3/11). Everything below is the archived record, kept for decisions that refer to it.

## Archived — V3 (2026-09-25)

- [V3 handoff](V3_HANDOFF.md): what V3 is, the audit reconciled, what changed, FOIL as first consumer, next steps.
- [Audit reconciliation](archive/v3/01_AUDIT_RECONCILIATION.md) · [Architecture](v3/02_ARCHITECTURE.md) · [FOIL consumer](archive/v3/03_FOIL_CONSUMER.md) · [Next passes and acceptance](v3/04_NEXT_PASSES.md) · [Sources](archive/v3/05_SOURCES.md)
- [Next-pass prompt for Claude](archive/v3/CLAUDE_PROMPT.md).
- The contract for AIs preparing a project: [docs/PREPARING_A_PROJECT.md](../docs/PREPARING_A_PROJECT.md).
- Runtime truth: [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## Archived — V1 (passes 9–12)

- [V1 handoff](archive/V1_HANDOFF.md) and its [prompt](archive/v1/CLAUDE_PROMPT.md): superseded as "start here" by V3, kept as the record of 0.9.x–0.12.0.

## Archived architecture reference — V2.2

1. [V2.2 decisions and scope](archive/V2_2_HANDOFF.md)
2. [V2.2 complete Claude implementation prompt](archive/v2.2/CLAUDE_PROMPT.md)
3. [V2.2 chapter index](archive/v2.2/README.md)
4. [Native tool qualification inventory](archive/v2.2/02_TOOLCHAIN_QUALIFICATION.md)
5. [I/O and external application contracts](archive/v2.2/03_IO_AND_EXTERNAL_APPS.md)
6. [FOIL Programme/business/publication](archive/v2.2/04_PROGRAMME_AND_PUBLICATION.md)
7. [DiagramCloud bridge](archive/v2.2/05_DIAGRAMCLOUD_CONTRACT.md)
8. [Optional Mongo context](archive/v2.2/06_MONGO_CONTEXT.md)
9. [Executable draft contract kit](archive/v2.2/contracts/README.md) and [actual validation scope](archive/v2.2/VALIDATION.md)
10. [DiagramCloud bridge V1 handoff](DIAGRAMCLOUD_BRIDGE_V1.md) — cross-product contract for project context, AI exchange and `.datapass/diagramcloud.json` (canonical spec: [contracts/diagramcloud](../contracts/diagramcloud/README.md)).

V2.2 extends rather than replaces the V2.1 foundation. It adds current FOIL repository reconciliation, operation-specific tooling, external-app/data/publication contracts and explicit integration boundaries. These are design fixtures, not inputs already accepted by the current v1 runtime manifest.

## Retained V2.1 foundation

- [V2.1 handoff](archive/V2_1_HANDOFF.md)
- [Baseline audit](archive/v2.1/01_BASELINE_AND_DECISIONS.md)
- [Items/artifacts/bindings/catalog](archive/v2.1/02_ITEMS_ARTIFACTS_AND_CATALOG.md)
- [Workflows/Airflow](archive/v2.1/03_WORKFLOWS_AND_AIRFLOW.md)
- [Portability](archive/v2.1/04_PORTABILITY_AND_MIGRATION.md)
- [Domain packs and R0](archive/v2.1/05_DOMAIN_PACKS_AND_FOIL.md)
- [AI exchange/security](archive/v2.1/06_AI_EXCHANGE_AND_SECURITY.md)
- [Workspace/Git/UX](archive/v2.1/07_WORKSPACE_GIT_AND_UX.md)
- [Implementation/acceptance](archive/v2.1/08_IMPLEMENTATION_AND_ACCEPTANCE.md)
- [Sources/open questions](archive/v2.1/09_SOURCES_AND_OPEN_QUESTIONS.md)

## Historical context

[V2 discussion](archive/V2_HANDOFF.md), [architecture lock](ARCHITECTURE_LOCK.md), [source map](SOURCE_MAP.md), [original master prompt](archive/PRO_MASTER_PROMPT.md) and [Pass 1 acceptance](archive/PASS1_ACCEPTANCE.md) remain preserved. [Runtime implementation status](../IMPLEMENTATION_STATUS.md) is separate from handoff versions.

Use live source for implemented behavior; V2.2 for the newest requested deltas; owning client authorities for accepted facts/decisions. Newer attachments can be proposals rather than accepted architecture. Do not silently promote them. No native client, Mongo database, private scientific package or cloud deployment was changed by this handoff update.
