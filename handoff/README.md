# DataPass handoff index

## Start here

1. [V2.1 handoff and decisions](V2_1_HANDOFF.md)
2. [V2.1 implementation prompt for Claude](v2.1/CLAUDE_PROMPT.md)
3. [Baseline audit and explicit corrections](v2.1/01_BASELINE_AND_DECISIONS.md)
4. [Items, artifacts, bindings and catalog](v2.1/02_ITEMS_ARTIFACTS_AND_CATALOG.md)
5. [Workflows, Airflow and provider integration](v2.1/03_WORKFLOWS_AND_AIRFLOW.md)
6. [Portability and migration](v2.1/04_PORTABILITY_AND_MIGRATION.md)
7. [Company packs and FOIL R0 pilot](v2.1/05_DOMAIN_PACKS_AND_FOIL.md)
8. [AI exchange, receipts and security](v2.1/06_AI_EXCHANGE_AND_SECURITY.md)
9. [Workspace, Git, storage and daily UX](v2.1/07_WORKSPACE_GIT_AND_UX.md)
10. [Implementation sequence and acceptance](v2.1/08_IMPLEMENTATION_AND_ACCEPTANCE.md)
11. [Sources, verification and unresolved questions](v2.1/09_SOURCES_AND_OPEN_QUESTIONS.md)

The [examples](v2.1/examples/) and [contracts](v2.1/contracts/) are **design fixtures**, not input accepted by the current V1 runtime schema. The [Mongoku note](v2.1/MONGOKU_LATER.md) is a compatibility reservation only; that product is paused.

## Historical context

- [V2 discussion/handoff](V2_HANDOFF.md) retains the original full product vision and FOIL VNext snapshots.
- [Architecture lock](ARCHITECTURE_LOCK.md) retains the single-VSIX, peer-tool, authority and safety boundaries.
- [Source map](SOURCE_MAP.md) records donor repositories and licensing boundaries.
- [Original master prompt](PRO_MASTER_PROMPT.md) and [Pass 1 acceptance](PASS1_ACCEPTANCE.md) describe earlier implementation stages.
- [Runtime implementation status](../IMPLEMENTATION_STATUS.md) is separate from a design document's version.

## Reading precedence

Use the live source to establish implemented behavior. Use V2.1 for the requested next design and its explicit deltas. Use owning FOIL authorities for accepted scientific/project decisions, not a code handoff. Preserve disagreements as decision records; a newer attachment is a proposal unless its acceptance is established.

No scientific fixtures, provider credentials, private study binaries or paid deployments are introduced by this documentation pass.
