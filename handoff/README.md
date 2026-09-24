# DataPass handoff index

## Start here — v1 status (2026-09-25)

- [V1 handoff](V1_HANDOFF.md): what is what, version chronology, v1 gates with their status, next passes, cross-repository follow-ups.
- [Next-pass prompt for Claude](v1/CLAUDE_PROMPT.md).
- Runtime truth: [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## Architecture reference — V2.2

1. [V2.2 decisions and scope](V2_2_HANDOFF.md)
2. [V2.2 complete Claude implementation prompt](v2.2/CLAUDE_PROMPT.md)
3. [V2.2 chapter index](v2.2/README.md)
4. [Native tool qualification inventory](v2.2/02_TOOLCHAIN_QUALIFICATION.md)
5. [I/O and external application contracts](v2.2/03_IO_AND_EXTERNAL_APPS.md)
6. [FOIL Programme/business/publication](v2.2/04_PROGRAMME_AND_PUBLICATION.md)
7. [DiagramCloud bridge](v2.2/05_DIAGRAMCLOUD_CONTRACT.md)
8. [Optional Mongo context](v2.2/06_MONGO_CONTEXT.md)
9. [Executable draft contract kit](v2.2/contracts/README.md) and [actual validation scope](v2.2/VALIDATION.md)
10. [DiagramCloud bridge V1 handoff](DIAGRAMCLOUD_BRIDGE_V1.md) — cross-product contract for project context, AI exchange and `.datapass/diagramcloud.json` (canonical spec: [contracts/diagramcloud](../contracts/diagramcloud/README.md)).

V2.2 extends rather than replaces the V2.1 foundation. It adds current FOIL repository reconciliation, operation-specific tooling, external-app/data/publication contracts and explicit integration boundaries. These are design fixtures, not inputs already accepted by the current v1 runtime manifest.

## Retained V2.1 foundation

- [V2.1 handoff](V2_1_HANDOFF.md)
- [Baseline audit](v2.1/01_BASELINE_AND_DECISIONS.md)
- [Items/artifacts/bindings/catalog](v2.1/02_ITEMS_ARTIFACTS_AND_CATALOG.md)
- [Workflows/Airflow](v2.1/03_WORKFLOWS_AND_AIRFLOW.md)
- [Portability](v2.1/04_PORTABILITY_AND_MIGRATION.md)
- [Domain packs and R0](v2.1/05_DOMAIN_PACKS_AND_FOIL.md)
- [AI exchange/security](v2.1/06_AI_EXCHANGE_AND_SECURITY.md)
- [Workspace/Git/UX](v2.1/07_WORKSPACE_GIT_AND_UX.md)
- [Implementation/acceptance](v2.1/08_IMPLEMENTATION_AND_ACCEPTANCE.md)
- [Sources/open questions](v2.1/09_SOURCES_AND_OPEN_QUESTIONS.md)

## Historical context

[V2 discussion](V2_HANDOFF.md), [architecture lock](ARCHITECTURE_LOCK.md), [source map](SOURCE_MAP.md), [original master prompt](PRO_MASTER_PROMPT.md) and [Pass 1 acceptance](PASS1_ACCEPTANCE.md) remain preserved. [Runtime implementation status](../IMPLEMENTATION_STATUS.md) is separate from handoff versions.

Use live source for implemented behavior; V2.2 for the newest requested deltas; owning client authorities for accepted facts/decisions. Newer attachments can be proposals rather than accepted architecture. Do not silently promote them. No native client, Mongo database, private scientific package or cloud deployment was changed by this handoff update.
