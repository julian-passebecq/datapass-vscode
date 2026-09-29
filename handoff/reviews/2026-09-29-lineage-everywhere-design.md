# Lineage everywhere: DataPass V4 design study (2026-09-29, read-only)
Goal from Julian: any modern cloud repo on any platform (Azure/Fabric, Databricks, AWS, GCP, OCI, on-prem), every layer, no holes. Input: `2026-09-29-modern-stack-coverage.md`. On V4 main today there is no dbt support, no V4 TMDL support and no Airflow support. SQL (A1), the Python host (ADOPT-B) and IaC HCL/Bicep are covered. Cloud has the Hop renderer and observe-runtime.

## (a) Architecture: one graph, many extractors
- **One graph.** Nodes use `canonicalDatasetIdentity` / `canonicalFieldId` (lineage-core). Node kinds: dataset, field, job/task, dbt model, measure, visual, dashboard, test, topic, API endpoint, ML model/feature, infra resource, secret-ref. Edge kinds: `reads`, `writes`, `derives(field→field, transform)`, `orchestrates`, `tests`, `exposes`, `deploys`, `serves`, `configures`.
- **Evidence on every edge.** Each edge carries OBSC origin: `static-parse | artifact-import | runtime-observed | ai-proposed`. It also carries `extractor@ver`, `file:line` or JSON path, and `confidence`. Evidence from different origins is merged under one canonical edge id. Display precedence: runtime > artifact > static > ai.
- **Extractors plug into the A0 dispatcher** by file signature. Every embedded SQL fragment (dbt compiled, M native query, Superset virtual dataset, Airflow/ADF SQL, Lambda/Glue scripts) goes to **A1**, so there is exactly one column-lineage engine.
- **Every file lands in the inventory** (INV1) with a status: `understood | partial | unknown | ignored`. Nothing is silently skipped. That inventory is the basis of the coverage map.

## (b) Per layer (lineage)
| Layer | Files | Technique | Reuse |
|---|---|---|---|
| dbt | `manifest.json` (nodes, sources, exposures, metrics, semantic_models, saved_queries, unit_tests, contracts, groups/access, compiled_code), `catalog.json`, `run_results.json`, `sources.json`, `semantic_manifest.json` | Same approach as canva: sqlglot on compiled SQL + catalog columns. Here that is A1 + catalog as the schema. Fallback: static `ref()/source()` + yml, **no Jinja execution** (dbt-feature-lineage does execute it) | A1, lineage-core |
| Orchestration | Airflow `dags/*.py`, Cosmos, DAB `databricks.yml`, Fabric `pipeline-content.json`, ADF `pipeline/*.json`, Step Functions ASL, GCP Composer/Workflows, Dagster/Prefect | Static AST (Python host): operators, `>>`, schedule, Dataset/Asset outlets. Operator→IO via the OpenLineage provider map. JSON/YAML activities + dependsOn | Python host, V3 Airflow port |
| BI | PBIP TMDL + PBIR `visual.json`, Superset export ZIP, LookML, Tableau `.twb`, Metabase API | M `let` source chain, DAX tokenizer (measure→column), PBIR projections (visual→field), Superset SQL → A1 | V3 pbipGraph, A1 |
| Python non-Spark | `*.py`, `*.ipynb` | pandas/polars read/write, SQLAlchemy, `requests` (API node), constant-folded config paths. Dynamic SQL is partial, and the gap is flagged | Python host, A1 |
| Streaming | readStream/writeStream, Kafka, Kinesis, Pub/Sub, Eventstream, KQL | Topic identity + basic KQL table references | Python host, fabric pack |
| Runtime/catalogs | OpenLineage events, UC/Glue/Dataplex/Purview lineage, Spark event logs | Import as runtime-observed, then diff against static | observe-runtime |

## (c) Hop views
1. **End-to-end chain.** source → Spark → dbt → semantic model → measure → visual.
2. **Orchestration overlay** drawn as swimlanes.
3. **Column drill-down** with the transform text.
4. **Impact analysis**, split into certain and ai-proposed.
5. **Test/DQ coverage** badges.
6. **dbt docs-like explorer.**
7. **Coverage map per repo.** A treemap of folders and files coloured understood (green), partial (amber: parsed with gaps, dynamic SQL, unresolved `ref`), unknown (red: no extractor), AI-pending (dashed) or ignored (grey). Each tile shows its owning extractor, gap reasons and a count of pending AI proposals. A header gives the % of files and % of edges by origin. Clicking a tile opens the confirm queue, and the "no holes" KPI is 0 red among relevant files.

## (d) Repo-inventory taxonomy (C = covered on main, P = planned, M = missing)
| Family | File signatures | State | Owner extractor |
|---|---|---|---|
| Spark / notebooks | `*.py` (pyspark), `*.ipynb`, Databricks `.py` source, Fabric notebook `.py` | C (R1A) | analyzers-python, compat-v3 |
| SQL | `*.sql` (T-SQL, Spark, Snowflake, BQ, PG), stored procs | C (A1; depth per dialect unverified) | A1 |
| dbt | `dbt_project.yml`, `models/**/*.sql,yml`, `target/*.json`, `packages.yml` | M | DBT1-3 |
| Orchestrators | Airflow, Cosmos, DAB, ADF, Fabric pipelines, Step Functions, Dagster, Prefect, Argo Workflows | V3 only / M | A5, ORC1, ORC2 |
| IaC | Terraform/OpenTofu `.tf`, Bicep, ARM | C | iac-hcl, iac-bicep |
| IaC | CloudFormation/SAM, CDK (ts/py), Pulumi, OCI Resource Manager (tf), Crossplane | M | IAC11 |
| Containers | `Dockerfile`, `compose*.yml` | M (Helm only in cloud) | K8S1 |
| Kubernetes | manifests, Helm, Kustomize, ArgoCD/Flux apps | P partial (cloud infra-analyzers, Helm) | K8S1 |
| CI/CD | `.github/workflows`, `.gitlab-ci.yml`, `azure-pipelines.yml`, Jenkinsfile | M | CICD1 |
| ML | `MLproject`, MLflow runs/registry refs, training pipelines (Azure ML/SageMaker/Vertex YAML, Kubeflow), feature stores (Feast `feature_store.yaml`, Databricks FE), serving endpoints | M | ML1 |
| LLM/RAG | prompt files, LangChain/LlamaIndex configs, vector DB (Pinecone, pgvector, AI Search, Qdrant) index defs, embedding jobs | M | ML2 |
| Streaming | Kafka/Kinesis/Pub/Sub/Event Hubs configs, Eventstream, KQL, Flink SQL | M | STR1 |
| APIs | OpenAPI/AsyncAPI, FastAPI/Flask routes, GraphQL schema | P (§V4-API) | API pkgs |
| BI | PBIP/TMDL/PBIR, Superset, LookML, Tableau, Metabase | V3 only / M | BI1-3 |
| Catalogs/metadata | UC, Glue, Dataplex, Purview, OpenLineage JSON, Iceberg metadata | M (UC in pack only) | OL1, PORT2 |
| Contracts/DQ | ODCS `*.odcs.yaml`, dbt contracts, GE suites, Soda `checks.yml`, DQX | M | DQ1 |
| Secrets/config | `.env*`, `*.yaml/json/toml` config, Key Vault/Secrets Manager refs, `appsettings.json` | C partial (KV in IaC, SEC2 redaction) | CFG1 (values never stored) |
| Docs/other | README, ADR, `CODEOWNERS` (→ owners), `.gitignore` | M | INV1 (owner/ignored) |

## (e) AI fill-in through the client's AI (existing R1A AI-exchange bridge; no embedded LLM)
- **Request** (DataPass → bridge, `lineage.gap.v1`, schema in project-contracts next to AI exchange): `{requestId, gapId, layer, question kind: resolve-edge|classify-file|resolve-attribute, target canonical ids, allowed answer enum/schema, evidence: [{path, startLine, endLine, sha, text (≤ 200 lines, SEC2-redacted)}], context: neighbouring known edges (ids only), budget {maxSpans, maxTokens}}`. The request is bounded: no whole repo, no secrets, no client data values, and nothing is ever executed.
- **Response** (client AI → bridge): `{requestId, proposals: [{kind node|edge|attribute, ids, value, confidence 0–1, citedSpans (must be a subset of sent spans), rationale ≤ 3 lines}], model id (as reported), responder}`. DataPass validates it against the schema. It **rejects** uncited or out-of-scope answers and unknown ids, and records the prompt hash plus response hash.
- **Storage and flow.** Accepted proposals go into the overlay `.datapass/lineage-overlay.json` with origin `ai-proposed`, never into facts. The Hop confirm queue offers confirm, reject or edit, which records `ai-confirmed` with `confirmedBy` and a date. A proposal becomes stale when an evidence sha changes, and later static or runtime evidence supersedes it. Proposals are excluded from "certain" impact. The bridge is opt-in, and with no client AI configured gaps simply stay amber.
- **Gaps per layer.** Spark: dynamic paths and UDFs. SQL: EXEC strings. dbt: macros and `var()`. Orchestration: PythonOperator bodies and sensors. BI: complex DAX/M. Python: requests→table and config indirection. IaC/K8s: which app uses which resource. ML: data→feature→model→endpoint. RAG: docs→index. Unknown file: proposed family (feeds the registry, below).

## (e2) Zero holes, enforced: coverage registry
- **File.** `datapass-vscode-common/coverage-registry.json` (schema in project-contracts). Each row has `{family, signatures (glob + content sniff), extractor id@ver, fixture path, golden graph, status: understood|partial|planned|ignored, package id}`.
- **CI check (`coverage:check`, required).**
  1. Every signature has an owner extractor or an explicit `planned` package id with a wave.
  2. Every `understood` row has a fixture and a golden graph that pass.
  3. The union of all FIX* repos contains no file matching no row, so an unowned file type **fails CI**.
  4. Owners declared by the A0 dispatcher equal the owners in the registry.
- **Per-repo unknown-files report.** Each scan produces `.datapass/coverage-report.json` plus a Hop view 7 table: unknown file types ranked by count and size. Each type gets an optional client-AI "classify-file" proposal and a one-click "propose registry row" draft for the PM.
- **Hole hunting.** A monthly sweep (Sonnet, docs-level) runs INV1 over 10 public reference repos: Databricks/Fabric/AWS/GCP samples, dbt jaffle-shop, Airflow examples, a FastAPI template, and a Terraform/CDK sample. Every new unknown signature becomes a registry row. The IaC and FastAPI holes that Julian found himself would have surfaced this way first.

## (f) Packages (M = billed tokens, 5–30 each)
| id | Content | Repo | M | Model | Gate | Wave |
|---|---|---|---|---|---|---|
| LG0 | Graph contract + evidence origin + AI overlay contract | common | 12 | Opus | Codex ADR | 1 |
| INV1 | Repo inventory: signature classifier for every family in (d), statuses, CODEOWNERS | common | 15 | Opus | A0 | 1 |
| FIXDBT | Synthetic FOIL-like dbt project + real manifest/catalog/run_results | cloud fixtures | 8 | Sonnet | none | 1 |
| FIXORC | Airflow (classic, TaskFlow, Assets, Cosmos), DAB, ADF, Fabric pipelines | cloud fixtures | 8 | Sonnet | none | 1 |
| FIXBI | PBIP (TMDL+PBIR) + Superset ZIP on FIXDBT marts | cloud fixtures | 8 | Sonnet | none | 1 |
| FIXREPO | Multi-cloud "kitchen-sink" repo: CFN, CDK, Pulumi, Docker, Helm/Kustomize, 3 CI flavours, MLflow/Feast, RAG config, ODCS, Soda | cloud fixtures | 12 | Sonnet | none | 1 |
| DBT1 | dbt artifact import + column lineage via A1 | common | 25 | Opus | LG0, FIXDBT | 2 |
| DBT2 | Semantic manifest, contracts, access, unit tests | common | 12 | Opus | DBT1 | 3 |
| DBT3 | No-manifest static fallback | common | 20 | Opus | DBT1 | 4 |
| A5 | Airflow static + OL operator map + Cosmos | common | 20 | Opus | LG0, FIXORC | 2 |
| ORC1 | DAB, ADF, Fabric, Step Functions | common | 18 | Opus | A5 | 3 |
| ORC2 | Dagster, Prefect, Argo, GCP Workflows | common | 15 | Opus | ORC1 | 5 |
| BI1 | TMDL/M/DAX + PBIR visual→field | common | 25 | Opus | LG0, FIXBI | 2 |
| BI2 | Superset, LookML, Tableau basic | common | 18 | Opus | BI1 | 3 |
| BI3 | PBI operational metadata (RLS, refresh, gateways, endorsement, usage) | cloud | 12 | Opus | BI1 | 4 |
| PY2 | pandas/polars/SQLAlchemy/requests + config folding | common | 18 | Opus | R1A | 3 |
| STR1 | Streaming (Kafka/Kinesis/PubSub/EH/Eventstream/KQL/Flink SQL) | common | 22 | Opus | R1A | 4 |
| IAC11 | CloudFormation/SAM, CDK synth output, Pulumi YAML/state, OCI | common | 25 | Opus | INV1 | 4 |
| K8S1 | Docker/Compose, K8s, Kustomize, ArgoCD → deploys/configures edges | common | 20 | Opus | INV1 | 4 |
| CICD1 | GH Actions, GitLab CI, Azure DevOps, Jenkins → jobs deploying resources | common | 15 | Opus | INV1 | 5 |
| ML1 | MLflow, training pipelines, feature stores, registry/serving | common | 25 | Opus | INV1, PY2 | 5 |
| ML2 | LLM/RAG configs, vector indexes, embedding jobs | common | 15 | Opus | ML1 | 6 |
| DQ1 | ODCS, dbt tests, GE, Soda, DQX as test nodes | common | 15 | Opus | DBT1 | 4 |
| CFG1 | Env/config/secret-ref resolution (names only) | common | 12 | Opus | INV1, SEC2 | 3 |
| OL1 | OpenLineage + UC/Glue/Dataplex/Purview import, drift | cloud | 20 | Opus | LG0, OBSV1b | 3 |
| AIB1 | Gap detector + `lineage.gap.v1` request/response on the existing AI-exchange bridge, overlay, confirm API | common + cloud | 25 | Opus | LG0, INV1, R1A AI exchange | 3 |
| COV1 | coverage-registry.json + schema + required `coverage:check` CI + unknown-files report | common | 12 | Opus | INV1 | 1 |
| COV2 | Monthly reference-repo hole sweep + registry-row drafts | common | 6 | Sonnet | COV1 | 2 |
| AIB2 | Per-layer gap question templates + evals on fixtures (precision ≥ 0.8 target) | cloud | 20 | Opus | AIB1 | 4 |
| HOP3 | Views 1–3 | cloud | 25 | Opus | DBT1, BI1, A5 | 3 |
| HOP4 | Views 4–6 | cloud | 25 | Opus | HOP3 | 4 |
| HOP5 | Coverage map + confirm queue (view 7) | cloud | 20 | Opus | INV1, AIB1 | 3 |
| DOCLG | Docs + golden expected graphs per fixture | common | 8 | Sonnet | each wave | 2–6 |

Total ≈ 571 M across 33 packages. Wave 1 is 75 M (with COV1): contract, inventory and fixtures, all parallel. All fixtures follow V4-FIX: real formats, synthetic IDs, no FOIL data.

## (g) Possibly forgotten
dbt snapshots, seeds, incremental branches, SQL-generating macros, dbt Mesh cross-project refs, model versions. BI: RLS/OLS, calculation groups, field parameters, DirectQuery/Direct Lake, Dataflows Gen2, semantic link (sempy), endorsement, gateways, paginated reports. Airflow: dynamic task mapping, sensors, Variables/Connections. PII tags propagated along lineage. Reverse ETL (Hightouch/Census). Iceberg/Delta sharing. Cross-repo identity aliases (the same table under different names). Git history (who changed the lineage). Monorepo vs multi-repo linking. Generated or vendored files (mark ignored, not unknown). Cost per lineage node (CAPM1).

Sources: [canva dbt-column-lineage-extractor](https://github.com/canva-public/dbt-column-lineage-extractor) · [dbt-feature-lineage](https://github.com/negativexq/dbt-feature-lineage) · [dbt-superset-lineage](https://github.com/slidoapp/dbt-superset-lineage) · [dbt artifacts](https://docs.getdbt.com/reference/artifacts/dbt-artifacts) · [Airflow OpenLineage provider](https://airflow.apache.org/docs/apache-airflow-providers-openlineage/stable/) · [Cosmos](https://astronomer.github.io/astronomer-cosmos/) · [PBIP](https://learn.microsoft.com/power-bi/developer/projects/projects-overview) · [DAB](https://docs.databricks.com/dev-tools/bundles/) · [ODCS](https://bitol-io.github.io/open-data-contract-standard/).

## 3 recommendations
1. Start wave 1 now (75 M): LG0 + INV1 + COV1 + 4 fixtures. The required `coverage:check` turns "no holes" into a failing CI job.
2. Route every SQL fragment through A1, and every gap through the single AIB overlay (never auto-promoted). Build no second parser and no per-layer AI path.
3. Build DBT1 + BI1 + HOP3 + HOP5 first (95 M): the visible chain from source to visual, plus the coverage map that shows Julian what is still red.
