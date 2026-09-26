# 08 — implementation sequence and acceptance gates

## 1. Scope of this delivery

This is a documentation/contract design pass. It does not change runtime source, package version, cloud resources or Mongo state. The audited code is v0.8.0. Examples under this directory are marked design-only and are not accepted by the current V1 manifest reader.

Claude should inspect current main again before writing. If another developer has progressed, reconcile against actual code; do not blindly apply a design refactor or overwrite concurrent changes. Keep the working single-VSIX product and migrate incrementally.

## 2. Suggested internal organization

This is an architectural destination, not an instruction to move every file in one commit:

```text
src/
  core/
    model/          items, artifacts, bindings, repository refs, observations
    contracts/      schema registry, migration, safe parse and validation
    graph/          typed relations, impact and projection
    exchange/       bounded context, plan, approval and receipts
    workspace/      scope resolution, local registry and conflicts
  adapters/
    fabric/         native notebooks, pipelines, managed Airflow bindings
    databricks/     notebooks, Jobs, declarative pipelines, DAB
    airflow/        DAG inspection, profiles, native run observation
    infrastructure/ OCI/SSH/Compose/Kubernetes/IaC context
    observability/  hosted Grafana as-code/context
    apps/           app/source/deployment descriptors
  domains/          declarative pack loader, not FOIL physics
  views/            sidebar and editor panels over shared models
resources/
  types/            reviewed generic descriptors
  providers/        native capability/version descriptors
  domain-packs/     public sanitized examples only
```

Reuse existing services and commands. Split the large action dispatcher by supported capability as needed. Avoid creating a universal framework before the first vertical slice works.

## 3. Implementation batches

### B0 — baseline and qualification

Run current typecheck/tests/build/package in the developer environment; inspect the existing CI and perform desktop Extension Development Host smoke. Record actual results. Address obvious schema/runtime validation parity first. Do not describe a docs commit as a binary release.

Exit: current behavior preserved; implemented versus planned capability list; source and test baseline recorded.

### B1 — common contracts and repository support

Implement stable IDs, logical item, artifact revision, resource binding, repository observation and orthogonal status. Preserve V1 read/migration without overwriting files automatically. Allow remote-only repositories. Add descriptor/pack registry with inactive unknown types and safe schema resolution.

Exit: same logical notebook shown under project and type/provider views; resource referenced under Wind and Hydro once physically; no remote database needed.

### B2 — secure manual AI loop and daily work

Implement context preview/copy/export and JSON-first import. YAML is allowed only through a bounded safe parser. Enforce expected-base map/per-file hashes, scope checks, diff, selected-plan hash and explicit apply. Add persistent checklist/problem notes and receipts.

Exit: no secret export by default; stale plan rejected; failure leaves source unchanged; copied command is not an executed run; restart restores local checklist state.

### B3 — Airflow vertical slice

Add true DAG/workflow item discovery and target profiles. Start with conservative source inspection and native UI/deployment links; static extraction states its limits. Add one reviewed sample DAG/materializer and an isolated local validation route. Add OCI/K3s profile fields and prerequisites, but do not provision automatically.

Exit: a source-known DAG is inspectable, its target requirements visible, a controlled test receipt retained and a blocked setup exportable to AI. No DAG code executes at extension activation or discovery. Fabric-managed Airflow can be represented with explicit compatibility/availability status even before every management action exists.

### B4 — FOIL declarative pack

Use authorized R0 schema/fixtures privately. Implement safe detached parameter editing, source/evidence labels, artifact/hash references, upstream/downstream impact and handoff to the existing Streamlit/shared kernel. Keep science computation external and forbid silent Core Truth promotion.

Exit: one case can be selected/edited as a candidate, rejected without mutation on invalid input, exported with exact version, and linked to campaign consumers needing revalidation. No private raw scientific payload enters this public repo's test fixtures.

### B5 — Fabric/Databricks native integration

Add logical notebook/workflow/dataflow distinctions around current official-tool routing. Model target environment, paths/connections and native identities. Collect bounded native validation/run evidence with explicit approval. Preserve provider fields and one scheduling owner.

Exit: an item and its source can be handed off to the correct official extension/CLI without inventing a workspace ID or unsupported command. A runtime on an older revision is shown as such.

### B6 — bounded portability assessment

Implement compatibility reports for one supported route at a time. Start with notebook inspection and official ADF→Fabric assessment integration. Candidate generation is limited to tested constructs; unsupported/dynamic features block automatic transformation.

Exit: a report lists mappings, unknowns, native limitations and test plan; it never claims semantic equivalence from parsing alone. No schedule is enabled automatically during migration.

### B7 — finish operational context

Complete concise hosted-Grafana, VM/IaC/container, Apps/Streamlit and quick-access setup views using the common contracts. Validate desktop density, theme/accessibility, remote-host behavior, offline/unknown states and recovery.

Exit: the user can choose a work scope, see what to prepare, open a native tool, record a problem and return a useful bounded context to AI.

Do not postpone B3 until every provider exists. Do not make the complete product a prerequisite for separately authorized FOIL CLI work.

## 4. Required negative tests

| Area | Test |
|---|---|
| Parser | Oversized/deep payload, duplicate keys, unsafe YAML tags/alias expansion, malformed versions |
| Schema | Runtime/editor validator parity; unknown fields fail or remain explicitly inert |
| Files | Traversal, absolute path, unsafe symlink/junction, case collision, changed file between preview/apply |
| Scope | Excluded repo/resource, shared VM host-level impact, scope not mistaken for provider IAM |
| Plan | Wrong context ID/base commit/manifest hash/domain hash; selected operations break a dependency |
| Apply | Multi-file partial failure, recovery journal and no deletion of unrelated changes |
| Native code | DAG import would cause side effects; inspection must not import it |
| Secrets | Notebook output, `.env`, URL userinfo, interpolated Compose config and logs excluded/redacted |
| Remote Git | Branch moves remotely; local dirty files preserved; remote-only repo displayed without clone |
| Runtime | Provider timeout after accepted request; reconcile instead of duplicate resubmission |
| Evidence | User marks done but provider unknown; CI green but old deployment; schema-valid physics hypothesis |
| Versions | Airflow2 target with Airflow3-only code; unsupported provider packages/connector |
| Resources | ARM64 VM with x86-only image, missing PostgreSQL, insufficient measured RAM/disk |
| License/budget | Expired trial, forbidden use profile, null budget, excessive duration/sample count |
| Persistence | Crash/stale lock, process reuse, two windows same worktree, extension upgrade recovery |
| Portability | Unsupported magic/expression, unknown dynamic graph, data path/permission unresolved |
| Domain | Invalid candidate edit leaves original unchanged; changed geometry invalidates derived freshness |

A passing unit suite is not enough for provider interoperability. Separate pure tests, controlled local integration, desktop UX and explicitly approved live provider qualification in reports.

## 5. FOIL acceptance circuit

A successful V2.1 demonstration is small and concrete:

1. Add a remote-only Streamlit repo and a privately accessible R0 artifact bundle.
2. Select one experimental case and inspect source/schema/hash/classification.
3. Open the Airflow workflow definition and its proposed OCI or local binding.
4. Show missing target credentials/identity, engine version, image architecture and budget without exposing values.
5. Export scope to external AI; import a bounded candidate with matching base identities.
6. Review changes and propagate 'needs-revalidation' to affected consumers.
7. Open the appropriate native tool; run only after separate approval and environment qualification.
8. Capture native run/evidence refs; distinguish software execution from domain validation.
9. Export blockers/results to AI; closing VS Code does not own the external runtime's lifecycle.

## 6. V2.1 versus V3

| Capability | V2.1 | Later |
|---|---|---|
| Generic items/artifacts/bindings | Required | Extend types as needed |
| Airflow profiles and native workflow assistance | Required first slice | Broader managed providers |
| Manual AI exchange and safe receipts | Required | Agent/MCP transport reuses same controls |
| Domain packs | Declarative, opt-in | Trusted executable extensions only after security design |
| Portability | Assessment + bounded tested candidates | Broader differential testing/conversion library |
| Capability/version matrix | Lightweight and evidence-aware | Richer cross-project analytics |
| Architecture/free-tier guide | Preserve metadata seam, no hardcoded promises | Standalone reference-scenario library |
| Mongoku | Contract note only | Explicit sanitized projection/sync when resumed |

## 7. Deliverable discipline

Each implementation batch should update `IMPLEMENTATION_STATUS.md` with source revision, actual tests, unresolved limits and what remains unimplemented. Keep docs/examples separate from code that the extension recognizes. Use small reviewable commits; no vendor forks or undeclared new dependencies. Do not label an untested adapter 'Ready' because a CLI binary was found.
