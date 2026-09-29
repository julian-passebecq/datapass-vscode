# Modern cloud data stack × DataPass V4 coverage (2026-09-29, read-only audit)

Sources: `git grep origin/main` on common, cloud and hub (GitLab), datapass-vscode origin/main (V3 extension, `src/`) and `handoff/PLAN.md` §V4-*. This was a keyword-level sweep, so a "covered" cell means the code exists. It does not mean the feature was checked for depth.

## 1. Matrix
| Category | Covered on main (evidence) | Planned | Missing |
|---|---|---|---|
| dbt Core (models, sources, tests, docs, exposures, metrics, manifest/catalog import) | No parser in common or cloud. Mentions only in `project-contracts/src/realization.ts`, `semantic-core/src/identity.ts`, cloud `observe-runtime/src/databricks.ts` (dbt task in a run). V3 `src/analysis/backend.ts` mentions manifest.json. | none | **Missing**: dbt_project, Jinja/ref/source, schema.yml tests, exposures, semantic layer, manifest/catalog import |
| Airflow DAGs | V3 extension: V3-AIRFLOW, static DAG view (#158). Common: only `examples/etl-demo` | A5 Airflow deferred to V1.1 (§V4-GAP) | V4 analyzer |
| Databricks Workflows / DAB `databricks.yml` | Resource pack `iac-resource-packs/src/packs/databricks.ts`. Observe replays (FAKE2 cassette) | A4a native formats: V1 if slack after W2 | DAB bundle parser |
| Fabric pipelines / ADF | Fabric pack `packs/fabric.ts`, cloud readers (API1-3), ADF resources via Terraform/Bicep | A4a | Pipeline JSON activity lineage |
| Dagster / Prefect | not found | none | Missing |
| Warehouse SQL (Fabric WH, Databricks SQL, Synapse) | common `packages/analyzers/src/sql/*` (A1, qualified against sqlglot). Synapse only in cloud resources | ADR-0009 R1A | Per-dialect depth not verified |
| Snowflake / BigQuery | 1 and 6 mentions, dialect only | none | No provider or resources |
| Power BI PBIP/TMDL | V3 `src/core/powerbi/pbipGraph.ts`, `adapters/powerbi.ts`. Cloud: API3 PBI reads, refresh-history fixtures (FAKE2) | TBX1 toolbox | TMDL measures→columns lineage in V4 Common: not found. No reports/visuals mapping |
| Streaming: Eventstream / Eventhouse / KQL | Fabric pack inventory (`inventory.ts`, `fabric.ts`) | none | KQL query parsing |
| Kafka / Redis Streams / Structured Streaming | Redis only in Helm/compat fixtures. `readStream`: 1 mention | FIXVM2 Redis on the VM (§V4-API) | **Missing**: streaming lineage |
| Unity Catalog / Purview / OpenLineage | UC in databricks pack and `observe-runtime/platforms.ts`. Purview/OpenLineage: design docs only (cloud `docs/handoff/...04_LINEAGE`) | PORT2 connector SPI (Unity, Hive, Iceberg REST) | OpenLineage event import, Purview |
| Delta / Iceberg | Delta implicit. Iceberg: 0 hits | PORT (UniForm rules), V1.1 | Iceberg |
| IaC: Terraform/OpenTofu, Bicep, K8s/Helm | common `iac-hcl`, `iac-bicep`, `iac-model`, `iac-readiness`, `iac-resource-packs`. Cloud `infra-analyzers` (Helm charts) | IAC4-10, VM1b | CloudFormation, Pulumi |
| Notebooks / PySpark | R1A scope, compat-v3, analysis-host-node (Python parser host) | R1A | none |
| Data quality (GE, dbt tests, DQX) | DQX: 1 fixture mention. GE: 0 | DQ1 deferred to V1.1 | **Missing** |
| CI/CD (GitLab CI, Azure Pipelines, GH Actions) | 13 common and 7 cloud mentions, mostly the repos' own CI | none | CI-as-resource parsing |
| APIs (FastAPI, OpenAPI) | openapi: 0 hits | §V4-API (FIXAPI + API packages) | Covered once §V4-API lands |
| Secrets | Key Vault in IaC packs (29 and 28 files). SEC2 redaction | SEC2 | Secret-reference lineage |
| Cost | CU metrics (CAPM1 Capacity Metrics), 20 and 28 mentions | CAPM1, FIXMON | Cost per pipeline or model |

## 2. Gaps as proposed packages
| id | Content | Repo | est. M | Model | Gate | Target |
|---|---|---|---|---|---|---|
| DBT1 | dbt manifest.json + catalog.json import → models, sources, tests, exposures, metrics, column lineage. No Jinja execution | common analyzers | 20 | Opus | after A0 dispatcher | **V1 if slack after W2** (highest value, FOIL-like repos) |
| DBT2 | Static dbt_project.yml / schema.yml / ref/source parse without a manifest | common | 20 | Opus | after DBT1 | V1.1 |
| FIXDBT | Synthetic dbt project + manifest/catalog in foil-synthetic | cloud fixtures | 8 | Sonnet | now | V1 (with DBT1) |
| A5 | Port V3 Airflow static DAG into a V4 analyzer | common | 15 | Opus | after A0 | V1.1 (already decided) |
| BI1 | TMDL/PBIR model → measures/columns/visuals lineage in Common (port of V3 pbipGraph) | common | 20 | Opus | after A0 | V1.1 |
| STR1 | Structured Streaming + Kafka/Eventstream source/sink lineage, KQL basic | common | 20 | Opus | after R1A | V1.1 |
| OL1 | OpenLineage event import into Observe (replay) | cloud | 12 | Opus | after OBSV1b | V1.1 |
| DQ1 | DQX/GE/dbt-test checks as project resources | common | 15 | Opus | after DBT1 | V1.1 (already deferred) |
| ORC2 | Dagster/Prefect static assets | common | 15 | Opus | — | V2 |

## 3. Direct answers
- **dbt Core coverage?** None in V4. No parser and no manifest import on main. The V3 extension only touches manifest.json. Nothing is planned yet (DBT1 is proposed above).
- **Analytics/BI layer in cloud?** Partial. Warehouse SQL is parsed (A1). Power BI is covered by V3 PBIP and V4 API/refresh reads, but there is no dbt and no V4 TMDL semantic lineage, so the chain SQL → dbt → semantic model → report is not joined.
- **Airflow DAGs?** Yes in the V3 extension (#158). Not in V4 Common/Cloud: A5 is deferred to V1.1.

## 3 recommendations
1. Staff FIXDBT + DBT1 (28 M) as the first slack package after W2. The dbt gap is the largest for FOIL-like repos.
2. Keep A5, BI1, STR1, OL1 and DQ1 in V1.1 and list them in the next Codex digest as one "modern stack" milestone.
3. Before tagging V1, write a depth check (one fixture per row) for the rows marked "covered". This sweep was keyword-level.
