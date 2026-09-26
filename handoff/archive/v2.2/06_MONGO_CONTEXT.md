# 06 — optional Mongo and other authority context inputs

## Goal

Help the user export useful study, decision, architecture and work-status context without loading every database, copying deep truth into Git or requiring a paid agent. The generic abstraction is an **AuthoritySource + QuerySpec + ContextSnapshot**. Mongo is one adapter; reviewed JSON files, Git records or another service can implement the same contract.

FOIL's existing division remains: PM routes/backlog; Core Truth owns accepted engineering facts; IT DEV owns software/cloud architecture; FRONT owns approved visual/product state; lab authorities own lab metadata; Work Archive owns provenance/checkpoints. A Programme view can reference them without becoming a competing database.

## Three levels, in implementation order

**A — File exchange, no connection required.** Import an authorized, sanitized external snapshot with source namespace, record IDs, revision/asOf, query intent and coverage. Preview what will be included in AI context. This is the V2.2 minimum.

**B — Native navigation.** Open the official MongoDB extension or an authorized console, help the user select the correct connection and inspect/save a bounded result. Do not scrape another extension's stored credentials. Use explicit snapshot import until a supported API bridge is qualified.

**C — Optional bounded read adapter.** A separately configured read-only identity executes approved named QuerySpecs with a stable namespace allowlist, query hash, parameters, projection, row/byte limits and timeout. It must be optional and off by default. No generic arbitrary-JavaScript evaluator.

## QuerySpec contract

Fields: id/version; source binding; exact database/collection roles; purpose; allowed operation; parameter schema; fixed projection; stable sort/pagination; maxTimeMS; result/byte limits; sensitivity rules; expected shape; owner and reviewed query revision.

Suggested intents, not claims these query files already exist:
- architecture summary for a registered project revision;
- selected study claim summaries and unresolved evidence;
- one campaign's inputs/outputs;
- selected PM blockers/next gate;
- approved business or publication claims.

Resolve namespaces from authorized bindings. No cross-company fallback, no wildcard collection sweep, no connecting to a similarly named cluster when the intended binding fails. Query result strings can contain prompt injection; they are untrusted source data, not instructions to the AI or extension.

For the first native read path, use an allowlisted find/projection model. Additional aggregations require explicit qualification. Reject write-capable stages and server-side JavaScript, including $out, $merge, $where, $function and unreviewed nested pipelines. Driver-level read-only credentials and server privileges remain necessary; a UI 'read-only' switch is not sufficient enforcement.

Mongo Playgrounds are executable JavaScript and can run CRUD and require Node modules, including filesystem APIs. Opening one does not make it a safe DataPass read adapter. Never execute an imported Playground automatically. [S14]

## ContextSnapshot contract

Record source/query identity and digest; asOf/observedAt; exact refs; data encoding; artifact pointer; result status; omissions/truncation/pagination and redaction performed. Preserve Mongo BSON types with an explicit Extended JSON encoding when needed; do not silently coerce ObjectIds, dates, Decimal128 or large integers into lossy JavaScript values.

Distinguish complete, partial, successful empty, error, not-authorized, unbound and stale. An error is not an empty collection. A timestamp is not a globally consistent snapshot across multiple clusters. Export per-source revisions/watermarks and identify cross-source inconsistencies rather than invent a single atomic FOIL revision.

Read results are local/ephemeral by default with a retention control. Durable approved snapshots may be stored by reference or explicitly committed in the appropriate private repo. Never commit credentials, raw connection strings, private account emails by default, bulk study content or secret-bearing query output into this public handoff.

## Writes are a separate future contract

A read snapshot or AI recommendation cannot update Mongo. Reconciliation requires a reviewed change batch through the owning authority, base revisions/preconditions, permissions, conflict reporting and read-back verification. Do not introduce dual-write Git/Mongo synchronization or a generic upsert from clipboard.

The latest FOIL package states that its new-repository reconciliation is not applied. This review does not apply it and does not claim to have re-read all live Mongo authorities. The current source of that statement is the supplied package; refresh the exact records before an authorized reconciliation.

## AI experience

Scope → choose query intent or imported snapshot → show sources/age/coverage → preview redacted summary → Copy for AI. Return proposals/notes to the local checklist or owning authority's reviewed work route, not directly to a database. A missing source produces a precise prerequisite, not a fabricated answer.
