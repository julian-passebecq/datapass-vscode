# Project model v1: can it replicate a multi-cloud project? (idea 24, 2026-09-29)

Scope: common origin/main `packages/project-contracts/schemas/v1/` (12 schemas), FINAL_ARCHITECTURE G15 (PORT0-4, E1, T2), FOIL-synthetic fixtures (Fabric + Databricks + OCI VM, OpenTofu dev/prod stacks). Read-only, schema property and enum level (no deep semantic read of every $def).

**Verdict:** v1 can *inventory* a multi-cloud project (repos, targets, environments, resources, pipelines, secrets by name) from either side, but cannot *replicate* it: no cross-profile mapping, no schedules, no identities/network, no volumetry in the model. 8 holes, 5 partial. All fixable additively (v1.1) or by existing G15 packages.

| # | Need | v1 coverage | Status | Fix |
|---|---|---|---|---|
| 1 | Repos on several hosts, multi-Git ownership | `repository` (host enum gitlab/github/azure-devops/other, role, bindings), `git-binding` (folder, deployedRevision) | Covered | owner/team: add `repository.owner` (v1.1) |
| 2 | Providers Fabric + Databricks + Oracle VM | `target.provider` enum fabric/powerbi/databricks/azure/oci/local/generic | Covered | - |
| 3 | Workspaces / capacities / SKU | `resource` (resourceType free string, parentId, provider); capacity/sku only in `observation-batch` | Partial | v1.1 `resource.declared.sku`; controlled resourceType vocabulary |
| 4 | Catalogs / schemas / tables | `resource` aliases (uc-name, fabric-logical-id), `datasets` in model | Partial | table schema/columns live in lineage-core (v4/lg0), not linked: add `datasetRef` to lineage node ids |
| 5 | Compute (clusters, Spark pools, VM size) | resourceType string only; `target.engineVersion` | Partial | v1.1 `resource.declared.compute{engine,version,size}` |
| 6 | Pipelines / jobs | `pipeline-facet` (activities, edges, invokes, condition, definedBy) | Covered | - |
| 7 | Schedules / triggers | `trigger` only in observation-batch (observed runs) | **Missing** | v1.1 `pipeline.schedule{cron,tz,event}`; ORC1/ORC2 |
| 8 | Connections (JDBC, Oracle, linked services) | no kind; can be a generic resource | **Missing** | v1.1 `resource.kind=connection` + `secretRefIds` (exists) + endpoint by name |
| 9 | Secrets by name only | `secret-ref` (8 kinds, locator, valuePresentInSource) | Covered | add `oci-vault-secret` kind (VM side) |
| 10 | Identities / roles / grants | nothing (roleClaimIds are data roles, not IAM) | **Missing** | new `principal` + `grant` facets (v1.1); GOV1 |
| 11 | Networking (VNet, private endpoints, OCI VCN, firewall) | nothing beyond generic resource | **Missing** | v1.1 `resource.network{zone,privateEndpoint}`; IAC11 |
| 12 | Environments dev/test/prod + promotion | `environment` (stage enum, promotesTo, sources tfvars/bundle-target/...) | Covered | - |
| 13 | Local equivalents (DuckDB, Spark local, Postgres) | `target.provider=local` + capabilityProfile | Partial | no engine enum for duckdb/postgres/spark-local: v1.1 `capabilityProfile.engine`; PORT1 |
| 14 | Profile mapping local <-> cloud (resource A <-> B, type substitutions) | none; "profiles" exist only in FINAL_ARCH §1.5 prose | **Missing** | new `profile` + `profile-mapping` schema (PORT0/PORT2); core of idea 24 |
| 15 | Volumetry (rows, bytes, growth) for sizing/sampling | observation-batch only (utilizationPercent, duration) | **Missing** | v1.1 `dataset.volume{rows,bytes,asOf}`; F1 DuckDB sampling |
| 16 | Variants (feature/sandbox copies, tenant variants) | stage enum has feature/sandbox; 0.25.0 variants not in schema | Partial | v1.1 `environment.variantOf`; PORT3 |
| 17 | Direction "beyond local" (cloud->other cloud, migration plan) | none | **Missing** | PORT4 / E1 / T2 (plans, no execution) need a `migration-plan` schema |
| 18 | Definition side (cloud-declared vs local-declared) and round-trip | `resource.sides` + declared/intended/observed, `acquisition`, `origin` | Covered | - |
| 19 | Reproducible state (data seeds, IaC state import) | IaC via aliases (terraform-address), no seed/fixture notion | **Missing** | v1.1 `dataset.seed{method: sample/synthetic/empty}`; F1 |

Totals (19 needs): 6 covered, 5 partial, 8 missing (#7, 8, 10, 11, 14, 15, 17, 19).

## Holes (priority)
1. **Profile mapping (#14)**: no object says "Fabric lakehouse X = DuckDB file Y in profile local". Blocks every move. New `profile-mapping` schema in PORT0 (3 M today; re-size to ~15 M).
2. **Identities/grants (#10)**: a replica without IAM is not complete. New principal/grant facet, names only.
3. **Schedules (#7)**: pipelines replicate without their trigger. Additive `pipeline.schedule`.
4. **Connections + network (#8, #11)**: Oracle VM <-> Databricks JDBC path is invisible. Additive `connection` kind + network block.
5. **Volumetry + seeds (#15, #19)**: local profile cannot be sized or filled. Additive `dataset.volume` / `dataset.seed`.

## Julian questions (product choices)
- Should a local replica copy data (sampled, masked) or only structure plus synthetic seeds? (recommend: structure + synthetic seeds by default, sampling opt-in; matches "no client execution during discovery")
- Is "beyond local" (cloud A -> cloud B, e.g. Fabric -> Databricks) in scope for V4 or plan-only? (recommend: plan-only, per S6)

## 3 recommendations
1. Freeze a v1.1 additive batch now (schedule, connection kind, compute/sku, volume, seed, variantOf, oci-vault-secret, repository.owner): ~1 package, no breaking change.
2. Grow PORT0 from 3 M to ~15 M and make it own `profile` + `profile-mapping` schemas before PORT1/PORT2 start.
3. Add a FIXPRJ replication golden test: FOIL-synthetic cloud profile -> local profile, `coverage:check` fails on any unmapped resource.
