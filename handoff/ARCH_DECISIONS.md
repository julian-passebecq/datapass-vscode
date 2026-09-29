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
| ARCHQ1 | common | § 3b additive fields (realization, estimates, improvements, estimateModels), core-change K9 | 6 | Opus |
Order: ARCHQ0 → ARCHQ1 → ARCHCAT1 → ARCHB1 → ARCHV1; FAKEERP, FAKESCM start now (their logs validate against ARCHQ0 once merged); FOILARCH after ARCHQ0. Total ≈ 122 M.
