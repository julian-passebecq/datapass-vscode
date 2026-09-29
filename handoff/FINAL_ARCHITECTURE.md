# DataPass — final engine architecture (PM DataPass 7, 2026-09-29, estimates are estimates)

Sources: datapass-vscode `origin/main` handoff/PLAN.md § V4-* and reviews 2026-09-29-*; dataprojects `pm/phase0-project-model` PROJECT_MODEL.md, PACKET_MAP_V1.md; ADR-0009; Common/Cloud/Hub `origin/main` at 15:46 UTC; datapass-data-xray 0.6.0 (local). "M" = millions of billed tokens, estimated per package. Julian ideas 19–22. **PLAN follows these slices from now on, instead of V1/V1.1 cuts.**

## 1. Engine vision
1. DataPass is a complete **static + observed semantic engine**: it understands every file of any modern cloud/data/ML Git repo (Spark, SQL, dbt, orchestrators, BI, IaC, containers, CI, APIs, streaming, ML/RAG, every data/table format) on any platform, and it never executes client code.
2. There is **one project model and one lineage graph**. Every node and edge records its origin (static, artifact, runtime, ai-proposed, ai-confirmed) and its evidence.
3. **The client's AI fills gaps** through the bridge (`lineage.gap.v1`): bounded, redacted and cited. A human confirms each answer, and nothing is promoted silently.
4. **Views are projections:** Hop and each VSIX (Cloud, IaC, Infra, Observe, Git companion, Home, Data X-ray) show the same graph. Observe compares what runs against what the code says.
5. **One project, several profiles:** local and cloud are two profiles of the same project, with a diff and a readiness check between them. Factory runs the local profile.

## 2. Stable core and extension points (frozen first; after that, additive only)
| # | Core contract / SPI | Content | Status | Package |
|---|---|---|---|---|
| K1 | Project model v1 | C5 identity, repos, environments, targets, realizations, `dp:` IDs; versioned schemas + CI check "additive only" | done (C5a/b, OBSC); freeze + CI missing | MODEL1 |
| K2 | Lineage graph schema v1 | lineage-core canonical IDs (incl. sub-column/JSON-path fields); node and edge kinds of the lineage design; origin; `extractor@ver`, span, confidence; AI overlay; `lineage.gap.v1` request/response | L1 done; LG0 missing | LG0 |
| K3 | Analyzer SPI (A0) | file-family signature (glob + content sniff) → extractor → facts **+ gaps** (unknown/partial reasons) → graph | A0 done (ADOPT-A); gap output + registry binding missing | ASPI |
| K4 | Provider / catalog SPI | Catalog → Database → Table (Doris multi-catalog pattern: Unity, OneLake, Glue, HMS, Iceberg REST/Polaris, Dataplex, Purview-read); one transport, replay (OBS3 cassette) or live; opt-in, read-only | transport done (API0/TRN1); SPI missing | PSPI, CAT1 |
| K5 | View SPI | headless GraphView/projection DTOs in Common, hosted by workbench-ui; each Hop view or VSIX is one projection | HOP1a/b renderer done; SPI missing | VSPI |
| K6 | Coverage registry + inventory | `coverage-registry.json` (family → extractor → fixture → golden graph → status), required `coverage:check`, per-repo unknown-files report | missing | INV1, COV1 |
| K7 | Client-AI bridge | `lineage.gap.v1` over the AI exchange; overlay `.datapass/lineage-overlay.json`; confirm queue | contract in LG0; runtime AIB1 | AI1, AIB1 |
| K8 | Data access layer (Doris philosophy, idea 22) | one file/table-format reader SPI (Parquet, ORC, Avro, CSV/JSON, Delta, Iceberg, Hudi, Paimon, DuckLake): metadata-first (footers, manifests, snapshots, schema evolution, partitions, deletion vectors), read-only, local; optional **engine SPI** for local sampling (DuckDB first; Doris as a pluggable adapter to a running instance, never embedded, never required) | Data X-ray readers exist outside Common | FMT1 (= XR1 extended), ENG1, ENG2 |

**Rule (enforced in CI):** adding dbt, Airflow, Kafka, a new cloud, a new format or a new BI tool requires one registry row, one implementation of K3/K4/K5/K8 and one fixture with a golden graph. It changes no K1–K8 file. An extractor MR that touches a core path fails CI. A core change needs a new additive schema version, decided by the PM.

**Doris position (PM, replaces § V4-PORT "inspire only"):** Doris is the architecture reference for K4 and K8 (unified internal/lake layers, one semantics across formats, VARIANT sub-column lineage). DataPass stays a semantic engine, not a query engine: no MPP, cache, federation. ENG2 (Doris adapter + Doris SQL dialect + Doris as a platform/IaC target) comes late and only for a real use case.

## 3. Components, status, dependencies
| Component | Repo / package | Done on main | In flight | Missing (package ids) | Depends on |
|---|---|---|---|---|---|
| Contracts | common semantic-core, analysis/exchange-protocol, capability-/project-contracts | C1, C2 partial, C3 (ADOPT-C), C5a/b, OBSC | — | MODEL1, LG0, C6, PROV1, C4 tool catalog | — |
| A0 dispatcher + Node host | common analyzers, analysis-host-node | ADOPT-A, ADOPT-B, IACA0 | — | ASPI, PY1 (Windows Python helper) | K1 |
| Analyzers: code/data | common analyzers | A1 SQL facts (dialect depth unverified) | — | A2 PySpark/ipynb (only in Codex's local worktree), SQLD, PY2, CFG1, STR1, JSONL1 (VARIANT/JSON-path lineage), FMT1/XR1 data/table formats | ASPI, LG0 |
| Analyzers: dbt/orchestration/BI/DQ | common | — | — | DBT1-3, A4a (Fabric items, `databricks.yml`), A5 Airflow, ORC1 (ADF/Fabric pipelines/Step Functions), ORC2, BI1-3, DQ1 | LG0, own fixture |
| Analyzers: infra/API/ML/security | common (+ cloud infra-analyzers) | IAC1/2/3/4, IACB/BF, IAC-EMIT; VM1a/b (cloud) | VM2 | IAC6/7, IAC11, K8S1, CICD1, APIX1, ML1, ML2, SEC1 | INV1 |
| lineage-core / semantic diff | common | L1, G1 | — | L1B (BI/ML/deploy relations) | LG0 |
| Coverage registry | common | — | — | INV1, COV1, COV2 (monthly sweep), DEPTH1, DOCLG | ASPI |
| AI bridge | datapass + common + cloud | V3 AI exchange | — | AI1, AIB1, AIB2 | LG0, INV1 |
| DataPass core VSIX | datapass-vscode | 1.1.x (V3) + P1 SQL journey | — | P1R, P1B, P1C, UI3, Q2, R1A | A2, AI1 |
| Provider readers / catalogs | cloud provider-readers, observe-providers | API0, TRN1, CAPM1, OBS2 | API1, API2, API3 | PSPI adoption, CAT1, OBS4, OL1, TBX1, GOV1 (optional API4 AWS, API5 GCP, API6 Snowflake/BigQuery) | K4 |
| Data engine (optional) | common | Data X-ray optional DuckDB | — | ENG1 (engine SPI + DuckDB), ENG2 (Doris adapter + dialect) | K8 |
| Observe | cloud vscode-observe, observe-runtime | OBS1, OBS3, OBSV1a/b, FAKE2 | — | OBSV2, OBSV3, APIX3, SINK1, OBS5 (trace store, Doris-inspired), R6 (live, Julian's tenant) | UIH3, LG0 |
| Views / Cloud VSIX | cloud workbench-ui, root VSIX | UIH1, UIH2, HOP1a/b | — | VSPI, UIH3a/b, P2, P3, P5, CVSIX (root still "Cloud Studio 0.2.1"), HOP3, HOP4, HOP5, APIX2, UI2, DQ3, MLV1, G2 | K5 |
| IaC VSIX | cloud iac-extension, iac-imports | IAC5, IAC8, IAC9-10 | IACW | IAC6/7 above | — |
| Infra VSIX | cloud vscode-infra | VM3a | VM3b | FIXVM | VM2 |
| Hub / Git companion | hub git-service, vscode-git | HG1a, SEAM1 | HG1b | H1 broker, H2 Home, PH1, PG1, HG2 (lineage history/blame) | G1 |
| **Data X-ray** | datapass-data-xray (local, 0.6.0, no remote) | Parquet/CSV/JSON/Excel/log X-ray, JSON Schema, conversions, DAG (dbt, OpenLineage, pipelines, DAB, GitLab CI), wrangling, Power BI, notebooks, quality, diff, Delta/Iceberg/DuckLake time travel, optional DuckDB | — | XR0, XR1, XR2, XR3 | ASPI, VSPI, LG0 |
| Fixtures (synthetic, `ids.json`) | cloud/hub fixtures | IACCORPUS, FAKE2 | FAKE1, FIXAPI, FIXPRJ | FIXIAC, FIXGOV, FIXMON, FIXLIN, FIXVM, FIXGIT, FIXVM2, FIXDBT, FIXORC, FIXBI, FIXREPO, FIXFMT | FAKE1 |
| Security / redaction | cloud + common | SEAM1 bundle vendoring | — | SEC2 (covers X-ray: values never enter graph or bridge), SEC1, CFG1 (names only) | — |
| Portability | common + cloud | 0.25.0 variants | — | PORT0, PORT1, PORT2 (profiles + local↔cloud diff, incl. T1), PORT3, PORT4, E1, T2 | K1, K4 |
| Factory | datapass-factory | ADR OPEN | — | F0, F0D, F1, F2, F3, F4, R3 | F0D (Julian), C2 |
| Packaging / release | all | 1.1.x releases | — | E2E1, RV1a/b/c, E2E2, RVF, PUB1 (GitLab npm) | all VSIXs |

**Data X-ray in the engine:** (a) the file/table-level inspector and the project-level data view, plugged in through VSPI; (b) one reader per format: XR1/FMT1 moves the Parquet, Delta, Iceberg, DuckLake readers into Common under K8 and adds ORC, Avro, Hudi, Paimon; its dbt-manifest, OpenLineage, pipeline-JSON and `databricks.yml` readers seed DBT1, OL1, A4a and ORC1; XR2 switches its DAG view to Common facts; (c) XR3 opens and inspects bridge JSON (AI exchange, `lineage.gap.v1`, overlay); data values stay local (SEC2).

Out of scope, unchanged: Studio, Contoso, the FOIL producer packets (S1, CT1, FO1, FT1, DQ2), Grafana as a dependency (SINK1 export only), provisioning, running client code, a DataPass query engine.

## 4. Remaining packages (est. M; Opus unless (S) = Sonnet)
| Group | Packages (M) | Total |
|---|---|---|
| G1 Stable core + SPIs | MODEL1 10 · LG0 12 · ASPI 12 · PSPI 15 · VSPI 15 · INV1 15 · COV1 12 · C6 20 · PROV1 15 · C4 20 · L1B 15 · PORT0 3 | 164 |
| G2 Coverage QA | COV2 6 (S) · DEPTH1 10 (S) · DOCLG 8 (S) | 24 |
| G3 Code/data analyzers | A2 25 · PY1 20 · SQLD 15 · PY2 18 · CFG1 12 · STR1 22 · JSONL1 15 · XR1/FMT1 25 | 152 |
| G3b Data access (idea 22) | FMT1 extension ORC/Avro/Hudi/Paimon 10 · CAT1 catalogs on PSPI 20 · ENG1 engine SPI + DuckDB 15 · ENG2 Doris adapter + dialect 15 · FIXFMT 8 (S) | 68 |
| G4 dbt/orchestration/BI/DQ | DBT1 25 · DBT2 12 · DBT3 20 · A4a 20 · A5 20 · ORC1 18 · ORC2 15 · BI1 25 · BI2 18 · BI3 12 · DQ1 15 | 200 |
| G5 Infra/API/ML/security | IAC6/7 20 · IAC11 25 · K8S1 20 · CICD1 15 · APIX1 25 · ML1 25 · ML2 15 · SEC1 20 | 165 |
| G6 AI bridge | AI1 15 · AIB1 25 · AIB2 20 | 60 |
| G7 DataPass core (R1A train) | P1R 15 · P1B 20 · P1C 25 · UI3 15 · Q2 15 · R1A 10 | 100 |
| G8 Provider readers | OBS4 10 · OL1 20 · TBX1 15 · GOV1 12 (optional API4 25 · API5 25 · API6 20 = 70, not in total) | 57 |
| G9 Observe | OBSV2 20 · OBSV3 20 · APIX3 12 · SINK1 10 (S) · OBS5 15 · R6 5 | 82 |
| G10 Views + Cloud VSIX | UIH3a 15 · UIH3b 15 · P2 30 · P3 25 · P5 20 · CVSIX 15 · HOP3 25 · HOP4 25 · HOP5 20 · APIX2 20 · UI2 20 · DQ3 15 · MLV1 15 · G2 15 | 275 |
| G11 Hub/Git | H1 20 · H2 20 · PH1 10 · PG1 10 · HG2 15 | 75 |
| G12 Data X-ray | XR0 8 (S: GitLab repo, `local-windows` CI, galaxy.json) · XR2 20 · XR3 10 | 38 |
| G13 Fixtures (S) | FIXIAC 15 · FIXGOV 12 · FIXMON 10 · FIXLIN 10 · FIXVM 8 · FIXGIT 10 · FIXVM2 10 · FIXDBT 8 · FIXORC 8 · FIXBI 8 · FIXREPO 12 | 111 |
| G14 Security/release | SEC2 12 · E2E1 20 · RV1a 15 · RV1b 10 (S) · RV1c 5 · E2E2 20 · RVF 15 · PUB1 8 | 105 |
| G15 Portability | PORT1 15 · PORT2 25 · PORT3 20 · PORT4 30 · E1 20 · T2 25 | 135 |
| G16 Factory | F0 15 · F0D 5 · F1 25 · F2 25 · F3 25 · F4 20 · R3 10 | 125 |
| In flight (remaining) | API1-3, FAKE1, FIXAPI, FIXPRJ, VM2, VM3b, HG1b, IACW, OBSV1b | ~75 |
| **Total** | ~120 new + in flight | **~2,010** (+15 % rework ≈ 2,300) |

## 5. Roadmap in 10-hour slices (8 coders at most)
Throughput: 41 packages (≈ 688 M est.) merged 12:00–15:46 UTC on 29 Sept (a burst: 10 coders, reused Codex code). Actual cost ≈ 22–26 M billed per Opus package. Assumed sustained 450–550 M est. per 10 h with 8 coders (low 300, high 800). Slices hold 220–390 M each because dependencies bind, not coder count. **6 slices** (5 if fast, 7–8 if slow).
Merge rules: Common merges serial by the PM (rebase → `local-windows` green → merge → next); one vendored-Common re-pin per slice in Cloud and Hub after the slice's Common train.

| Slice | Packages | Milestone users see | Integration check |
|---|---|---|---|
| **S1** (next 10 h) · ~340 | finish in-flight (75) · **Common core train in order:** MODEL1 → LG0 → ASPI → INV1 → PSPI contract · UIH3a, UIH3b, OBSV3, SEC2, H1 · A2 (after ASPI) · FIXDBT, FIXORC, FIXBI, FIXIAC, FIXGOV, FIXMON, FIXVM2, FIXREPO · XR0 | Stable core frozen (model v1, graph + `lineage.gap.v1`, analyzer and provider SPIs, inventory). Cloud workspace tree fed by replays. Data X-ray on GitLab | additive-only contract CI; one re-pin in Cloud/Hub; SEC2 bundle scan; `ids.json` check |
| **S2** · ~340 | VSPI → COV1 → C6 → PROV1 · P2, P3, CVSIX → RV1a/b/c · E2E1 · XR1/FMT1 · APIX1 · AI1 · P1R · OBSV2 · FIXLIN, FIXVM, FIXGIT, FIXFMT · F0 | **Installable V1 VSIX set** (DataPass, Cloud, IaC, Infra, Observe, Git companion, Hub broker, Data X-ray) + French guide per VSIX; `coverage:check` required; static-vs-observed diff in Hop; Julian's single test session | E2E1 journey on FOIL-synthetic (replay); install/activation smoke; Observe OFF by default |
| **S3** · ~390 | DBT1, A5, BI1, A4a, ORC1, CFG1, SEC1, IAC6/7 (serial Common) · CAT1, OL1, GOV1, TBX1, OBS4, SINK1 · HOP3, HOP5, AIB1, APIX2, APIX3 · XR2 · P1B · PORT0 · F0D (Julian reviews) | dbt + Airflow + DAB/ADF/Fabric pipelines + Power BI lineage end to end in Hop (source → model → measure → visual); coverage map + AI confirm queue; API explorer; catalogs browsable | no extractor MR touches a core path; golden graph per fixture; overlay never "certain" |
| **S4** · ~390 | DBT2, BI2, PY2, SQLD, K8S1, CICD1, IAC11, STR1, DQ1, L1B, C4 · ENG1 · HOP4, AIB2 (precision ≥ 0.8), UI2, P5 · P1C · COV2, DEPTH1 · XR3 · F1 · PORT1 | No red file on FIXREPO; impact split certain / AI-proposed; streaming, K8s, CI edges; local DuckDB sampling; lock-in / UniForm readiness | `coverage:check` on all fixtures; AIB2 evals |
| **S5** · ~320 | DBT3, BI3, ML1, ML2, ORC2, JSONL1 · PY1 → Q2 → R1A · UI3, DQ3, MLV1, G2, HG2, H2, OBS5 · PORT2 · F2 · DOCLG | DataPass core V4 qualified on Windows (R1A); ML/RAG lineage; VARIANT sub-column lineage; Home; local ↔ cloud profiles with diff | Q2 installed-VSIX qualification; profile resolution table → segment → project |
| **S6** · ~235 | PORT3, PORT4, E1, T2 · ENG2 · F3 → F4 → R3 · PH1, PG1 · R6 (live, Julian's tenant) · PUB1 · E2E2 → RVF | **Final engine release**: migration plans (no execution), cross-platform IaC diff, Factory local vertical, full-suite E2E | E2E2 all VSIXs + Factory; release SHA manifest; rollback VSIX |

Critical paths: Factory F0 (S2) → F0D (Julian, S3) → F1 → F2 → F3 → F4 → R3 (S6). Lineage LG0 → DBT1/BI1 → HOP3 → HOP4. Core MODEL1 → LG0 → ASPI → every extractor.

## 6. Quota (flagged, not decided)
~2,010 M est. (≈ 2,300 with margin); with actual/estimate ≈ 1.3 and role overhead ≈ 1.25 → **≈ 3.2–3.7 B billed tokens** over 6 slices. The weekly budget in M is not recorded anywhere; the assistant's quota cron (%) is the authority. Week 1 (to 1 Oct 12:00 UTC): the 90/98 % alarm likely fires **during S2**, and RV1 may wait for the reset. Week 2 carries S3–S6; if a week holds ~2–2.5 B (unverified), the limit hits again **in S5** and S6 slips to the week of 8 Oct.

## 7. Risks and decisions for Julian
Risks: (1) Common registry conflicts → serial Common merges, one re-pin per slice. (2) A2 PySpark exists only in Codex's local worktree (never pushed); a rebuild may cost > 25 M. (3) Estimates run ~1.3× low; sessions pass 180 K; wrong model titles seen. (4) Codex may revise contracts on return (ADR-0009 "R1A first"): K1–K8 are additive-only and every PM exception is recorded. (5) Preview provider formats (OBS4): one adapter + cassette each. (6) R6 and F0D need Julian. (7) Data X-ray reads real values locally: SEC2 covers it.

Product decisions (asked by the PM, answers recorded in PLAN):
1. Live readers for AWS, GCP, Snowflake/BigQuery (API4–6, +70 M), or static-only for those platforms?
2. Factory (125 M, runs code locally) inside the final engine (S2–S6), or a separate track after portability?
3. Does a human-confirmed client-AI edge count in "certain" impact, or stay a separate class?
4. ML/LLM-RAG depth (ML1, ML2, MLV1 = 55 M): full lineage or inventory only?
5. Data X-ray installed by default with optional local DuckDB, or opt-in?
