# 01 — baseline audit and design decisions

## Evidence and scope

Inspected repository main at `5af14e5e9a5e825b5c3e5d1854cde04b35be5e4b` on 2026-09-24. This is a docs-updated v0.8.0 codebase, not an implemented V2. The tree has Fabric, Databricks, Power BI, infrastructure and observability adapters; no dedicated Airflow adapter or generic artifact/run registry.

Relevant inspected source:
- `src/core/types.ts`: PlatformAdapter has `detect()`; platform state, project bindings and action labels, not typed executable item contracts.
- `src/adapters/infrastructure.ts`: OpenTofu/Terraform/Docker/kubectl/SSH detection; copy validate/plan and Remote SSH actions. No DAG discovery, Airflow deployment profile, run/task states or receipts.
- `src/adapters/databricks.ts`: official extension/CLI/bundle-root detection and copy validate/deploy. No separate logical notebook, Lakeflow Job or declarative-pipeline catalog.
- `src/core/projectManifestModel.ts`: V1 requires local repository paths; platform-specific fields; no remote-only repo, typed artifacts or target bindings. Hand-written runtime validation covers selected fields, particularly Fabric, rather than the complete editor JSON schema.
- Existing handoff/source map: single VSIX, no vendor source repackaging, Git/code authority, FOIL profile and guarded commands are already established.

Do not infer runtime success from these reads. The previous implementation-status document reports CI packaging; desktop and real-cloud qualification must be rechecked by the implementer. This pass does not claim a new VSIX or a completed desktop test.

## Keep / extend / do not duplicate

| Area | Existing value | V2.1 action |
|---|---|---|
| Galaxy | Health/attention, collapsible groups | Keep; add task-centered context and item views |
| Platform adapters | Detection/native handoff | Extend by capabilities; preserve existing command IDs |
| Project manifest | Portable JSON + schema | Add explicit migration; retain V1 reader |
| Infrastructure | Tool probes and safe command preparation | Add runtime/target bindings and Airflow workflows |
| Fabric | Tool composition and review-first setup | Add artifact/native item projections, not a Fabric clone |
| Databricks | Official extension and bundle-root routing | Model Jobs, notebooks, declarative pipelines separately |
| Grafana | As-code tooling direction | Add instance/datasource/run links and receipts; not a designer |
| AI snapshot | Redacted environment context | Generalize into a revision-anchored transactional exchange |
| Persistence | Local/Git, no required DB | Preserve |
| Optional MCP | Some helper configuration exists | Do not make mandatory or use for V2.1 autonomous execution |

## Decisions and rationale

### D21-01 — artifact-centered common model

Platform-first cards explain installed tools but not what the user is changing. A stable logical item plus immutable artifact revisions connects a notebook, its Git files, produced data, target workspace and run evidence. Use ordinary JSON and IDs, not an ontology framework or new graph database.

### D21-02 — orthogonal facets instead of rigid type paths

`notebook/databricks/ml` would make purpose and vendor part of identity. Moving the same analytical idea to Fabric should not rename every dependency. Keep kind, purpose, language, compute engine, native representation, provider and hosting independent. UI paths are projections, not identifiers.

### D21-03 — native source remains first-class

Most real assets contain vendor-specific metadata, expressions and permissions. DataPass should index and prepare native formats while preserving fields it does not understand. A small generic workflow projection is useful for navigation and AI context; it is not a replacement execution definition. Avoid two independently editable sources of truth.

### D21-04 — Airflow needs its own adapter

Airflow involves versioned DAG code, Python/provider packages, scheduling semantics, metadata DB, executor, deployment and runtime evidence. Docker is a packaging/runtime boundary, not sufficient Airflow support. Reuse the same logical Airflow descriptors across Docker, K3s and managed Fabric targets with explicit capability differences.

### D21-05 — bounded portability, not universal transpilation

Common structure lowers preparation costs. It does not make IAM, connectors, SQL dialects, retry/trigger rules or Spark environments equivalent. Assess first, preserve native source, generate a candidate only for tested mappings, then validate against a golden workload. Prefer official migration tools where they exist.

### D21-06 — declarative domain packs

The user needs a personalized FOIL parameter form. A namespaced pack can contribute schemas, field groups, templates and artifact roles without importing wind formulas into the core. Executable plugin code is a separate security/distribution decision, not arbitrary JavaScript read from project JSON.

### D21-07 — capabilities and evidence are separate

A provider may support an action while the installed adapter does not implement it or the current account lacks permission. A source may exist without deployment. A run may pass without scientific validity. Preserve these dimensions and render simple summaries, not one overloaded green badge.

### D21-08 — no runtime dependency on an open editor

Native orchestrators execute and retain state. DataPass prepares, requests explicitly, observes and records. Closing VS Code must not stop a remote campaign or remove its schedule. An AI handoff is optional guidance, not part of the production data path.

## Explicit corrections to historical handoffs

1. **Oracle code exists:** `reactoracle` has a `feat/initial-control-plane` history. An earlier default-branch/name search missed it. Do not repeat 'no Oracle repo exists'. Distinguish source availability from runtime verification.
2. **FOIL CAO code is branch-specific:** the uploaded dossier identifies `foil-3d-stream`, `feature/wind-cao-lab-v1`, PR #2, observed head `389ed282fb9319eebcff003688c6e91c5e1da84b`. That repository is not simply legacy; roles can vary by branch/path. Re-fetch before implementation.
3. **Airflow on Fabric is real provider functionality**, not the same thing as a Fabric Data Factory pipeline. Its current supported versions must be discovered/pinned. [S01–S02]
4. **VNext versus R0:** retain the broader Azure/Redis/Cosmos target; mark the smaller R0 circuit as a proposed implementation scope. Do not silently rewrite an Atlas ADR.
5. **Qualification gate:** DataPass-mediated operations need a qualified safe adapter; ordinary approved FOIL Git/CLI work need not wait for the entire extension. Reconcile any older organizational gate explicitly with the owner.
6. **Ready is not one state:** source, tests, approvals, deployment, runtime and domain evidence differ. Architecture approval can precede implementation; do not force everything into one lifecycle chain.
7. **A feature matrix is not deployment evidence:** whether a feature is included in v1/v1.5/v2 is separate from whether its implementation has been observed running.
8. **Local scope is not provider IAM:** DataPass cannot prevent a user invoking an unrelated official extension directly. Enforce its own actions and use least-privilege provider identities for real protection.

## Read-before-refactor risks

The V1 runtime validator and schema can drift. Use a single pinned schema/validation path or generate both from one definition, with tests rejecting malformed non-Fabric sections. Do not silently accept unknown fields as executable instructions. Unknown future namespaced metadata can be preserved inertly under an explicit extension area.

Existing actions use project-specific local roots. Introduce capability interfaces gradually rather than breaking every command at once. Current use of the first workspace folder is insufficient for deliberate multi-repo workspace bindings; each item/action needs an explicit resolved repository root and target.

No existing runtime code is changed by this handoff. The tests/implementation roadmap state what Claude must actually build and verify.
