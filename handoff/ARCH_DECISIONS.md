# Architecture decisions engine — Julian ideas 25 (PM DataPass 9, 2026-09-29)

**Principle (Julian):** DataPass is not a Git viewer. It shows **how a senior cloud data engineer thinks**, from A to Z: data warehousing, data engineering, analytics, ERP, ML. No fixed "architecture A/B/C and variants". For every place in an architecture DataPass knows the **questions to ask**, the constructive **alternatives**, their **consequences** (data movement, performance, cost, complexity, operations, lock-in), and the **invariants** that come from the business need. Same spirit as the Doris exercise (idea 15): nothing is fixed from A to Z; formats, transfer modes and engines are choices. The V1 must not work for one client only.

## 1. Concepts
- **Business case (archetype):** the need that fixes the invariants. V1 set: *scientific / real-time* (FOIL: Oracle VM → Fabric real-time → Databricks ML), *finance P&L on an ERP* (daily refresh, audit, month close), *supply chain / logistics* (refresh every 2 h, incremental, many small files). Each states freshness, volume, latency, audit, cost ceiling, team skills, platform constraints.
- **Decision point:** a question at one place of the architecture, platform-agnostic first, then specialised per provider (Fabric and Databricks first). Families: ingestion mode (batch, CDC, streaming, copy activity), transform engine (SQL procedure, Data Factory / Fabric pipeline, Spark notebook, SQL notebook, dbt with or without, pandas / polars in the pipeline, functions / lambdas), storage (Parquet, Delta, Iceberg, table, view, materialized view), layout (partitioning, clustering, file size, shuffle and skew risks), metadata-driven vs hand-written pipelines, orchestration, BI connection and refresh (Power BI import / Direct Lake / DirectQuery, on the Databricks lake or on a Fabric copy refreshed every 2 days), ML placement (Fabric vs Databricks), monitoring (what to watch, where).
- **Options and criteria:** every option carries its consequences on the same criteria: data movement, performance (shuffle, skew, partitions, file sizes), price, complexity, operations, portability / lock-in, skills, governance. Small comparison tables are first-class output.
- **Invariants:** what does not change whatever the choice (business rules, grain, SLAs, audit trail).
- **Sub-decisions:** decisions nest (ETL in Spark → partitioning → file format → …).
- **Senior checklist:** per decision, "when to choose", "what to monitor", "what goes wrong" (skew, small files, refresh storms).

## 2. Contracts (Common, additive, core path K9 when merged)
- `arch.decision.v1` — catalogue entry: decision point, questions, options, criteria values, invariants hints, provider specialisations, checklist, sub-decisions.
- `arch.choice.v1` — the project's **decision log**, written by the client AI in its own Git (`.datapass/decisions/*.json` + readable ADR markdown): decision point, chosen option, why, alternatives considered and why not, status `built | considered-not-built | proposed`, confidence, links to graph nodes (lineage / infra ids). "I considered ML here but did not build it; the client does not want ML yet" is a valid `considered-not-built` entry.
- Bridge selection state: the user selects / deselects architectures, sub-architectures and variants in DataPass; the bridge passes the selection and questions to the client AI, which may build only one realization and explain the rest.

## 3. Flow
Catalogue (DataPass engine, versioned) → bridge exposes it to the client AI → the AI builds one realization (or two parts to compare when Julian asks) and writes the decision log → DataPass reads the log, links each choice to graph nodes → views: decision overlay on Hop and Cloud views, comparison tables, variant filter, "ask the AI to build alternative X" action. Client AI only, never an embedded LLM; no client code execution; synthetic data only.

## 3b. The senior mind (Julian, 2026-09-29 ~22:20 local)
DataPass shows a **super brain doing a project**, not a Git tree. The client AI does **not** create 10 repos for 10 architectures: it builds **one fixed repo**, then, proactively, explains its thinking and supports it:
- **Proactive alternatives with value:** "I did X; here you should use Iceberg / polars / DuckDB because…"; when an alternative is useful and when it is not; once alternatives are known, evaluate them (in general, not only for this client).
- **Partial alternative realizations:** "I built part of that architecture so you can compare; it is not complete" (`realization: partial`).
- **Theoretical metrics:** cost, runtime, data scanned, data moved, storage, latency, freshness, each baseline vs alternative with the basis (`theory | measured`) and the assumptions: "partitioning here by date saves ~x % scanned data per run, so ~y cost".
- **Proactive improvements:** where to save cost doing what, which partition key is more judicious, where Spark is overkill (polars / DuckDB on one node), when a Fabric copy activity, an ETL tool or Airflow fits better, when a lakehouse table format (Iceberg, Delta, DuckLake) brings value (multi-engine reads, time travel, schema evolution, small-team local work) and when plain Parquet or a warehouse table is enough.
- The catalogue covers data engineering **and** warehousing best practice: Spark vs SQL, polars, DuckDB, DuckLake, Iceberg / Delta / Parquet, pipelines vs notebooks vs dbt vs copy activities vs Airflow, modelling (star schema, SCD, incremental), cost control (capacity, autoscale, file sizes, caching, refresh cadence).
- DataPass must **support that vision**: show the reasoning, the alternatives, the partial realizations and the metric deltas clearly (ARCHV1), and the bridge asks the client AI for this senior mode by default (ARCHB1).
Contract impact (additive, K9 v1 minor): ARCHQ1 adds optional `realization: full | partial | none`, `estimates[]` {metric, baseline, alternative, delta, unit, basis `theory | measured`, assumptions} and `improvements[]` {where, action, expected gain, estimate refs} to `arch.choice.v1`, and `estimateModels[]` (how to reason a metric theoretically) to `arch.decision.v1`.

## 3c. Problem solver at every scale (Julian, 2026-09-29 ~22:15 local)
Julian: "my first logic (archi A, B, C) was not so good; now we expand how we think." The bridge does **not** hand the client AI a menu of architectures. It hands it a **problem-solving method**, and the catalogue is its knowledge, not its menu. Knowledge digest: `handoff/reviews/2026-09-29-senior-patterns-digest.md`.

**Problem first.** Every reasoning starts from the customer's problem and value (which decision the data serves, how fresh, how trusted, at what cost, who maintains it), then works down the scales; a technical choice that serves no stated need is flagged as over-engineering.

**Five scales** (every decision point and every detector is tagged with one; views can zoom through them):
| Scale | Question | Examples |
|---|---|---|
| macro-macro | Does this data platform exist for the right reason? What value, for whom, at what total cost? | business case, build vs buy, one platform vs two (Fabric + Databricks), data mesh vs central team, "do we need a lakehouse at all?" |
| macro | Which architecture shape? | medallion or not (and how many layers), lakehouse vs warehouse vs both, ELT vs ETL, batch vs streaming, where ML lives, where BI reads, data movement between platforms |
| medium | How is each flow built and run? | pipeline vs notebook vs dbt vs copy job vs Airflow, metadata-driven vs hand-written, orchestration, SCD type per dimension, incremental vs full, CDC, data quality gates, monitoring, cost control |
| micro | How is each table / job laid out? | table format, partition key, clustering, file size, maintenance (compaction, vacuum, expiry), merge strategy, Spark vs polars / DuckDB for this volume, broadcast, skew |
| super-micro | Is each line right? | hash normalisation of NULLs, inclusive vs exclusive EndDate, UDF vs built-in, `collect()` / `cache()` misuse, join on IsCurrent vs event date |

**Medallion as a decision, not a default.** When it helps: several consumers, replay and audit needs, heterogeneous sources, a team that benefits from clear contracts between layers. How to improve one: explicit contracts and quality gates per layer; Bronze append-only and replayable; Silver = cleaned source truth (history kept), Gold = business meaning (star schema, SCD choices, aggregates); no copies without a consumer; incremental everywhere; maintenance scheduled per layer; lineage and cost per layer visible. When **not** to: one source and one report (a view or a single transform is enough), very small data (DuckDB / polars / a warehouse table), strict real time (streaming path, no hop-by-hop batch), or layers that only copy data with no new guarantee (each layer must add a guarantee, otherwise it is cost and latency).

**Value lens.** Every proposal the AI makes and DataPass shows states what the customer gains: cost (money, capacity), time (freshness, runtime), trust (quality, audit, reproducibility), simplicity (fewer moving parts, skills the team has), or new capability (ML, self-service BI). No gain stated → no proposal.

**Pattern families to carry** (ARCHCAT1 content, platform-agnostic then Fabric / Databricks): data engineering (incremental, CDC, idempotent reruns, schema drift, data contracts, quality gates, backfills), warehousing (star schema, SCD 1/2/3, conformed dimensions, facts as-was vs as-is, OBT when justified), lake / lakehouse (file vs table formats, partitioning, compaction, catalogs, open formats and multi-engine access), medallion (above), ML (feature tables, training vs serving freshness, model placement, "considered-not-built"), BI (import vs Direct Lake vs DirectQuery, refresh cadence vs cost), operations (monitoring, alerting, cost attribution, retention).

## 4. Packages (S2, before less central S2 work; est. M)
| Id | Repo | Scope | M | Model |
|---|---|---|---|---|
| ARCHQ0 | common | `arch.decision.v1` + `arch.choice.v1` schemas, validator, `contracts:additive`, K9 in core-paths.json | 15 | Opus |
| ARCHCAT1 | common | catalogue content: platform-agnostic decision points (§ 1 families) + Fabric / Databricks specialisations, criteria tables, checklists | 25 | Opus |
| FAKEERP | cloud | synthetic ERP P&L world (GL, cost centres, daily refresh, month close) as a Git project + its decision log | 15 | Sonnet |
| FAKESCM | cloud | synthetic supply-chain world (orders, shipments, stock, 2 h refresh, small files) + its decision log | 12 | Sonnet |
| FOILARCH | cloud | critical review of the FOIL DAB; ML part as a Fabric notebook too; decision log and comparison tables (data movement, perf, price, complexity) | 20 | Opus |
| ARCHB1 | common + hub | bridge: exposes catalogue + selection to the client AI, reads `arch.choice.v1` logs | 15 | Opus |
| ARCHV1 | cloud | decision overlay, comparison tables, select / deselect variants in Hop and Cloud views | 20 | Opus |
| ARCHLINT1 | common | senior-pattern detectors over Git + lineage facts (`handoff/reviews/2026-09-29-senior-patterns-digest.md` § 6), findings linked to catalogue entries, shown as proposals with their why (S3) | 20 | Opus |
| ARCHQ1 | common | § 3b additive fields (realization, estimates, improvements, estimateModels), core-change K9 | 6 | Opus |
Order: ARCHQ0 → ARCHQ1 → ARCHCAT1 → ARCHB1 → ARCHV1; FAKEERP, FAKESCM start now (their logs validate against ARCHQ0 once merged); FOILARCH after ARCHQ0. Total ≈ 122 M.

## Lineage graph conventions (PM DataPass 12, architect, 2026-09-30)
- **Flow edge direction:** `reads`, `writes`, `derives` point in data-flow direction: `from` = upstream, `to` = downstream. `reads`: dataset/field/topic/endpoint → job/task/model/measure/visual; `writes`: job/task/model → dataset/field/topic. DBT1/DBT2 follow it; core dispatch and BI1 were reversed → FLOWDIR1 (go/FLOWDIR1.md) flips them and adds a repo-level golden test.
- **Semantic model (BI1M):** lineage-graph/1 is frozen, so a Power BI semantic model is an `infra-resource` node with scope `powerbi-semantic-model`; tables take it as `parentId`, `serves` → reports, `exposes` → measures.
- **lineage-graph/2 candidates** (decided by the PM when a v2 is cut, not tonight): `semantic-model` node kind, `contains` edge kind.

## Codex ADR-0009 reconciliation (PM DataPass 12, architect, 2026-09-30; Julian: no more Codex, its feedback is an input)
Check: 31 Codex items, 19 integrated. Decisions on the rest:
- **Origin vocabulary (ADR §4/§10):** two orthogonal fields, both kept. lineage-graph/1 `origin` (static | artifact | runtime | ai-proposed | ai-confirmed) is the ADR's *method/acquisition*; the ADR's data origin (real | simulated | synthetic | fixture | unknown) is the input's `dataClass`/provenance, carried by analysis-protocol snapshots and cassettes. No rename in v1 (frozen); lineage-graph/2 candidate: rename `origin` → `acquisition`.
- **Schema owner (ADR §10):** analysis-protocol stays the sole owner of CheckResult and data-origin schemas; the evidence-origin enum in project-contracts (OBSC) is a re-export and converges at the next contract version.
- **UI owner (ADR §2/§7) — amended:** the UI lives in Cloud `workbench-ui` (React Flow; PM decision Q7); Studio is a donor only.
- **R1A-first (ADR §1, AGENTS.md) — amended:** overridden by Julian's 29 Sept scope (PLAN § V4-RUN); a note is added at the top of the workspace AGENTS.md.
- **HCL (ADR §10) — amended:** the Common TypeScript `iac-hcl` package (IAC1, merged) replaces python-hcl2 in the host; the no-execution rule is unchanged.
- **Sources:** PROJECT_MODEL.md and PACKET_MAP_V1.md (dataprojects branch `pm/phase0-project-model`) are reference inputs; PLAN.md and this file take precedence.
- **Missing items → backlog packages (GO when their slice starts):** SEAM2 C1 dual CJS/ESM + `typesVersions` + 4 consumer probes + sync-prune fixture (8 M, S6); **PY1C** Windows containment proof for the Python host (Job Object/AppContainer, "trusted local host only" caveat, ≤ 25 MiB / ≤ 2 s) (10 M, **release-candidate gate**); ADOPT-D audit of Codex branches IACFIX0 (`wind-lab-fabric-iac`) + IACBRIDGE vs FIXIAC/IAC-EMIT (5 M); ADOPT-E audit of the C4 `tool-catalog` branch + `catalog-migration.json` (5 M); **DQ2** DuckDB read-only preview safeguards (8 M, gate before Data X-ray ships DuckDB on by default); R1A train rows (P1R, AI1, Q2) re-checked at S5. Name clash: PACKET_MAP DQ1 ≠ PLAN DQ1 (DQ checks as test nodes); PACKET_MAP's is renamed DQP1 in our docs.

## Practice engine rules (PM DataPass 13, architect, 2026-09-30; Julian ideas 30–30d)
Critical reading of the 9 sources Julian pasted: good for **coverage** (which topics a senior is questioned on), weak as **answers**. Several claims are outdated or wrong and must not enter the catalogue as truth: OLTP ↔ star / OLAP ↔ snowflake pairing (inverted and false); "CA systems" as a real distributed choice (partitions are not optional); blanket fixes such as "switch DirectQuery to Import", "use Lambda for fraud + reporting", "use MOLAP", "bitmap indexes on facts"; Hadoop MapReduce/NAS-DAS, Oracle rollback segments, Informatica/Ab Initio/BO internals are legacy. Rules:
1. **Conditional, never absolute.** A practice is a decision rule over constraints (SLA/freshness, volume, cost, security, skills, platform, consumer) and repo evidence. The same pattern can be right in one repo and wrong in another; the card says which and why. Textbook answers without repo facts are a chatbot, not DataPass.
2. **Evidence first.** Every finding and every answer cites files/spans or runtime evidence; class A questions (need owner context) are asked, not guessed; AI output stays `ai-proposed` until confirmed.
3. **Precision gate.** Each detector ships positive and negative fixtures; precision ≥ 0.8 on the synthetic corpus before it is on by default; severity calibrated by blast radius (scale level × downstream consumers).
4. **Accepted by design.** An owner-stated or confirmed `decision-rationale/1` can mark a finding "accepted-by-design" (with its revisit trigger) instead of re-raising it on every run. Rationale and findings are the same loop.
5. **One format.** Catalogue entry (CONCEPT1) → rationale applied to a subject (RATIO1) → reasoning card on a finding (PRACT1) → answer card (PRACT3) share fields and vocabulary.
6. **Platform priority.** Fabric/OneLake, Databricks/UC, dbt, Power BI, SQL Server/Oracle as sources first (V1 live readers + FOIL reality); Snowflake/BigQuery/Redshift/AWS/GCP next; legacy tech only as detectors when found in a repo, no catalogue effort.
7. **Merge hygiene.** arch-lint detectors live in one folder per family (clean, practice, model, incr, bi, layer) with a generated registry; CLEAN1 → PRACT1 → MODEL1/INCR1 → LAYER1/BIPRAC1/PRACT2 merge serially; each merges main in and regenerates the registry.

### Concept entry schema (PM 15, 2026-09-30 ~02:10)
- One concept format: `datapass.concept-entry/1` + its taxonomy (CONCEPT1b, Common !91) is the only arch-catalog concept schema. `arch.concept.v1` (CONCEPT1a !93) is dropped; its 47 entries are ported onto concept-entry/1. Fields concept-entry/1 lacks are added to it additively in !93, not as a second schema.
- Merge order: !91, then !93 rebased on it, then RATIO1.
- `CONSTRAINT_KINDS` is exported once by arch-catalog; RATIO1's `decision-rationale/1` imports it (its `why` kinds = CONSTRAINT_KINDS + data-profile) and never keeps a copy.
