# DataPass V4 — Architecture Correction and Completion Brief

**Date:** 30 September 2026 · Source: Julian (pasted into ASSISTANT DATAPASS 1, stored verbatim-in-substance for the PM)
**Purpose:** corrective architecture brief for the remaining ~50% of DataPass V4
**Scope:** Core, Common, Cloud, IaC, Observe, Git/Hub, Data X-ray, Factory, Fabric integration, Power BI, dbt, Spark, orchestration, tool routing.

## 0. Instruction to the implementing AI
Not a redesign. Preserve merged work unless there is a concrete semantic defect. No restart, no new universal framework, no mass renaming, no moving working features for aesthetics.
Task: **converge the existing implementation around a clearer lifecycle model and fill semantic/integration gaps without duplicating native tools.**
> DataPass understands, reasons, correlates, previews and verifies. Specialist/native tools author, access providers, deploy and execute. Observe brings reality back into DataPass.

DataPass owns: project understanding; static semantic extraction; architecture reasoning; alternatives/trade-offs; cross-repo lineage; architecture linting; Git impact; theoretical volumetry; readiness; intended-vs-deployed; static-vs-runtime reconciliation; evidence quality; data/BI/infra correlations; tool/capability routing. It must not duplicate a mature provider client just to look self-contained.

## 1. Current state: treat status files carefully
- **Architectural authority:** `handoff/ARCHITECTURE_LOCK.md`, newer ADRs in technical-common, project-model contracts in Common, current PM decisions, current contracts and tests. Keep the invariant: DataPass is a developer control plane, not a Fabric clone, Databricks fork, Power BI Desktop replacement, Grafana editor or project database.
- **Historical:** `handoff/FINAL_ARCHITECTURE.md` is useful but its status columns are stale (DBT3W, MODEL1/Kimball, BIPRAC1, PRACT2, RUNX1, MULTI1a, VOL1, SCHED1, IACSPI1a/b, APIX3/4, DASH1, Fabric item extraction, Spark Declarative Pipelines, coverage work have landed). Do not recreate a feature that landed.
- **Live status:** prefer repo `main`, current PM handoff, open MRs/worktrees, local laptop state (GitLab may lag: dev is local). Always check whether a package exists before starting a replacement.

## 2. Product definition
> DataPass is a local-first engineering intelligence and control plane for modern data projects.
Reconstructs across: Code, Git, Data, SQL, Spark, dbt, Orchestration, BI, IaC, Containers/infrastructure, Cloud artifacts, Provider configuration, Runtime observations, Cost/capacity evidence. Answers cross-boundary questions: what is this system; why designed this way; what depends on this; what if I change this; is the architecture appropriate; what should execute this workload; which native tool; what should exist in cloud; what exists; what ran; did reality validate or contradict the static assumption; what did the run consume; what next. This is the moat.

## 3. Layer taxonomy (not a flat tool list)
| Layer | Examples | Meaning |
|---|---|---|
| specification / transformation | dbt project, SQL, PySpark source | describes logic |
| workload artifact | Notebook, SJD, dbt Job, Dataflow | executable provider artifact |
| compute engine | Spark, Warehouse SQL, DuckDB, Polars | performs computation |
| orchestration | Fabric Pipeline, Airflow, Databricks Workflow | coordinates work |
| platform management | `fab`, REST, FabricStudio | manipulates provider resources |
| IaC | Terraform/OpenTofu/Bicep | declares desired state |
| deployment | fabric-cicd, Git integration, deployment pipeline | materializes source into environments |
| authoring environment | VS Code, Fabric DE extension, PowerBI-VSCode | developer interaction |
| observability | Capacity Metrics, Workspace Monitoring, Spark telemetry | what happened |
| reasoning/control | DataPass | connects all of the above |
Reflect this internally enough for correct reasoning.

## 4. Correct dbt model
dbt = project parser + Jinja compiler + DAG engine + test framework + materialization framework + adapter interface. CLI may run on laptop while compute is elsewhere: dbt+DuckDB → local controller/compute; dbt+Fabric Warehouse → local controller, SQL compute in Fabric; dbt+Fabric Spark → controller may be local, Spark in Fabric; Fabric dbt Job → runtime and compute managed by Fabric.
`fab` = platform-management interface (workspaces, items, deployment, jobs, schedules, files, OneLake, permissions, config). Not a transformation framework. Do not create a generic "CLI" abstraction: dbt = transformation spec/runtime option; fab = provider-control capability. DBT3W gives static understanding; the remaining gap is **dbt execution-mode modelling**, not another parser.

## 5. Execution Unit abstraction (most important remaining semantic abstraction)
Introduce/strengthen logical `ExecutionUnit` (additive facets, no breaking migration if avoidable). Kinds: Fabric Notebook, SJD, Fabric dbt Job, dbt Core invocation, Spark Declarative Pipeline, Fabric Data Pipeline activity, Airflow DAG/task, Databricks job/task, Warehouse stored proc/query job, Dataflow Gen2, UDF, scheduled Python process.
Normalized properties: logical code/source, provider artifact, runtime, compute engine, environment, dependencies/libraries, parameters, inputs, outputs, trigger, schedule, retry policy, timeout, concurrency, orchestrator, execution target, dev-vs-prod role, runtime observations, cost/capacity observations, Git revision, deployment binding.
Purpose: not to erase native differences but to answer "why a Notebook instead of an SJD?", "which actual route does this dbt model take in production?", "these three artifacts run on the same Fabric Spark environment".

## 6. Notebook vs SJD must be first-class reasoning
FABITEM1 closes recognition; V4 must close reasoning. Do not encode Notebook=bad/SJD=good; model context.
Notebook: interactive exploration, human-in-the-loop, narrative, intermediate results, debugging, ad-hoc (can be productionized, with scrutiny). SJD: packaged entry point, wheel/JAR, explicit args/dependencies, batch/streaming, reusable production app, automation, clearer contract.
Example detector: Notebooks A and B both `%run Helpers`/`%run Common`, daily production schedule, no human-consumed outputs, duplicated utility logic → Observation (production relies on chained notebook reuse); Alternative (Python wheel + SJD entry point); Benefits (explicit dependency boundary, unit-testable library, clearer args, less coupling); Trade-offs (packaging/build step, extra release artifact, less interactive convenience). CATMS1/PRACT should incorporate this.

## 7. Spark Declarative Pipelines
Keep SDP1. Model: `spark-pipeline.yml` + Python/SQL declarations + implicit DAG from table/flow definitions. Concepts: streaming tables, materialized views, temporary views, flows, sinks, decorators/declarative SQL, dry-run/static validation. Model declared tables, declared flows, inferred dependencies, external sinks, streaming/batch semantics. Do not flatten SDP into generic Python; it is a declarative alternative to imperative notebook, SJD application, dbt project.

## 8. Comparison matrix to support eventually
Notebook = interactive/exploratory; SJD = packaged Spark app; SDP = declarative Spark data pipeline; dbt = SQL/declarative transformation graph + testing; Warehouse SQL = SQL-native; Dataflow Gen2 = Power Query managed; Fabric Pipeline = orchestration of activities; Airflow = general external orchestration. No universal winner: use project constraints (volume, latency, skills, complexity, testing need, portability, interactive output need, streaming, existing codebase, operational ownership, SLA, cost). PRACT2 already goes this way; continue.

## 9. Cloud / IaC / Deploy / Observe separation
- **Cloud = architecture/design plane** (before execution): what should exist, which architecture, alternatives, consequences, expected topology, theoretical volume/cost. VOL1 belongs here.
- **IaC = desired-state plane**: what infra/platform state is declared, per-environment parameterization (Terraform/OpenTofu, Terragrunt, Bicep/ARM, providers, stacks, IaC SPI). Do not merge into Cloud UI conceptually. Cloud: "we need a Fabric Environment". IaC: "this Terraform resource declares it".
- **Deployment = transition plane**: how reviewed source becomes provider state (fabric-cicd, Fabric Git integration, `fab deploy`, deployment pipelines, Terraform apply, Databricks bundles). DataPass should preview, validate, show consequences/diff, route to native deployment, capture provenance; not silently perform destructive deployment.
- **Observe = reality plane**: what exists, what ran, what happened, what it consumed, does it match intent. RUNX1 is one of V4's strongest features; preserve its philosophy.

## 10. Observe vs Monitoring
Observation = broad reality/evidence (deployed resources, actual config, run instances, runtime lineage, Spark execution, job results, schema observations, provider metadata, runtime behavior). Monitoring = time-oriented telemetry (CU, CPU, memory, shuffle, spill, duration, failures, throttling, capacity utilization, refresh status, latency, alerts). Monitoring is a source/subdomain of Observe, not a peer plane. Observe → deployed state (config/items/drift), runtime (lineage/runs/outputs), monitoring (telemetry/performance/cost-CU). Keep visible in code and UI.

## 11. Fabric capacity/CU work should be promoted
Existing: CU operations, capacity utilization, item/workspace breakdown, CU heatmaps, Spark stage heatmaps, run timelines, synthetic capacity history, Capacity Metrics imports. Missing: a coherent Observe workflow correlating Capacity (utilization, throttling, smoothing, CU) → Workspace (operations, failures, refreshes, jobs) → Execution Unit (notebook/SJD/dbt/pipeline, run id, duration) → Spark (stages, executors, shuffle, spill, skew) → Architecture (source, transformations, outputs, BI consumers). Key question: "why did capacity consumption spike?" not "it was 83%".

## 12. Theoretical vs measured must close the loop
VOL1 is good; do not stop there. THEORETICAL (expected rows/bytes per run, data movement, frequency) versus OBSERVED (actual bytes, rows when available, duration, CU, Spark shuffle, refresh frequency). Example: assumed 10 GB/run, observed 142 GB avg over 10 runs → sizing assumption refuted. Static warning of expensive full refresh, observed 1.2 GB/18 s → not material. RUNX1 vocabulary: confirmed / not observed / refuted; extend carefully.

## 13. Spark logical ↔ physical correlation
`gbrueckl/Fabric.Toolbox` (`DataframeLineage.py`, `VisualizeExecutionPlan.py`) = reference implementations only: no dependency, never execute its code during static discovery; use the concepts. Logical view (table → DataFrame → join → aggregate → table) vs physical view (Scan → Exchange → Sort → SortMergeJoin → HashAggregate → Write). Observe correlates: logical transformation → execution unit → physical Spark plan → stages/shuffle/spill → CU/time. Proposed package `SPARKPLAN1`: import provider/runtime execution-plan evidence into Observe, explicit confidence/provenance. An execution plan is not automatically complete column-level lineage.

## 14. Fabric integration is not one capability
Official: Fabric VS Code core, Fabric Data Engineering extension, Fabric UDF extension, Fabric CLI, Fabric REST API, fabric-cicd, Power BI official tooling/MCP, Fabric Terraform provider. Community specialists: FabricStudio, PowerBI-VSCode, OneLake-VSCode. Microsoft accelerators: `microsoft/fabric-toolbox`. Reference/donor: `gbrueckl/Fabric.Toolbox`. Do not collapse categories.

## 15. FabricStudio: higher capability weight
More than an explorer: workspace browsing, item definitions, `fabric://` filesystem, create/update/delete, publish definitions, Fabric Git via VS Code SCM, REST API notebooks, remote Spark notebook execution, deployment pipeline management, metadata navigation, OneLake/Power BI integration. DataPass must NOT build another Fabric workspace explorer/filesystem/generic Fabric Git client/REST API notebook/deployment-pipeline GUI without a DataPass-specific reason. Use as optional community specialist route.

## 16. PowerBI-VSCode: higher capability weight
Handles workspace access, DAX, TMSL, TMDL (validation/deployment), PBIR editing, semantic-model and report operations. DataPass concentrates on PBIP/TMDL/PBIR semantic analysis, model quality, DAX dependencies, Power Query sources, measure lineage, visual bindings, architecture effects, runtime/refresh correlation; delegate specialist editing/deployment. BIPRAC1 is aligned.

## 17. OneLake-VSCode: read/write specialist
Not just a browser: `onelake:/` filesystem, read/write files, name↔GUID mapping, ETag concurrency protection, bounded file-size reads, timeouts, writes restricted to `/Files` by default. Do not build another OneLake filesystem. Data X-ray inspects files/tables/formats; OneLake-VSCode handles provider filesystem interaction.

## 18. Two "Fabric Toolboxes"
`microsoft/fabric-toolbox`: large accelerators (Cost Analysis, FUAM, Platform/Workspace/Spark Monitoring, security/audit, migration/assessment, CI/CD, RTI, MCP). `gbrueckl/Fabric.Toolbox`: small personal/reference repo (DataframeLineage.py, VisualizeExecutionPlan.py, LibraryManager, UC sync, utility notebooks). Classify the second as reference/donor.

## 19. Microsoft Fabric Toolbox integration too shallow
Currently: catalogued yes, discoverable yes, some guarded actions yes, deep evidence use partial, workflow integration incomplete. TBX1 must not create one giant "Toolbox page"; route assets to domains: Cost Analysis → Observe/FinOps; FUAM → Observe/Admin; Platform Monitoring → Observe; Workspace Monitoring → Observe; Spark Monitoring → Observe/Spark; CI/CD accelerators → Deploy/Git; Assessment Tool → Cloud/readiness; Security Audit → governance/security; RTI accelerators → architecture/materialization; MCP servers → capability/tool router. Keep the central catalog for provenance/discovery.

## 20. Capability router `CAPROUTE1`
Current Fabric readiness ≈ "extension installed? fab installed?" — insufficient. Additive model. Input: operation, project, artifact, environment, installed tools, provider state. Output: candidate providers, prerequisites, readiness, official/community status, side effects, preferred route, fallback route. Examples: "Edit Fabric notebook" → Fabric Data Engineering READY official / FabricStudio READY community / portal AVAILABLE fallback. "Deploy source-controlled Fabric workspace" → fabric-cicd READY / `fab deploy` READY / Fabric Git AVAILABLE / FabricStudio publish possible but not preferred for Git-authoritative project.

## 21. Tool provenance first-class (`TOOLPROV1`)
Every capability provider carries: official / community / fork / accelerator / sample-reference. Fabric VS Code, Fabric DE, `fab`, `microsoft/fabric-cicd` = official; FabricStudio, PowerBI-VSCode, OneLake-VSCode = community specialist; `microsoft/fabric-toolbox` = Microsoft accelerators (assets not necessarily supported products); `gbrueckl/Fabric.Toolbox` = reference/donor; `gbrueckl/fabric-cicd` = fork, canonical capability points upstream (never a competing deployment engine).

## 22. IaC needs provider semantics (`IACFAB1`)
Beyond HCL parsing (resource/dependsOn/provider/module): map Terraform declarations to Fabric semantic resources (`fabric_workspace` → Workspace, `fabric_environment` → Spark/Fabric Environment, `fabric_lakehouse` → Lakehouse). Enables three-way comparison: DESIGN (Cloud) / DESIRED (IaC) / ACTUAL (Observe). Additive on top of IaC SPI, no parser rewrite.

## 23. Desired-vs-actual provider configuration (`FABEVID1`)
Consume provider config read-only where supported (e.g. Fabric Spark workspace-settings API): runtime 2.x vs 1.x mismatch, environment prod vs default-env, high concurrency match, session timeout 20 vs 120, pool custom vs starter; explain architectural consequence. Belongs in Observe/reconciliation. Start read-only, no provider mutation yet.

## 24. Native Fabric VS Code integration (`FABINT1`)
Official Fabric VS Code ecosystem moves to core/satellite. Investigate a supported integration against the official extension API instead of duplicating: current workspace context, item identity, supported native handler, open native artifact, capability detection. Optional: without Fabric extensions, static analysis must still work. No private token stores or undocumented commands.

## 25. Correct the "one lineage graph" wording
FINAL_ARCHITECTURE.md's "one project model and one lineage graph" is too strong internally; the later ADR wording is better. Multiple authoritative typed semantic graphs: data lineage, control/orchestration, infrastructure, deployment, BI semantic dependencies, runtime execution, Git/history (table→table data flow; job→job control; workspace→item containment; Terraform resource→Fabric resource deployment binding; report visual→measure semantic binding; run→execution unit runtime instance). Do not put all relations in one undifferentiated edge vocabulary. Architecture: domain authorities (data, orchestration, infra, BI, runtime, Git) → normalized semantic contract → unified project query/projection. One graph experience for the user, typed internally. No disruptive refactor if current contracts already preserve relation types: fix docs and projections first.

## 26. Git is more than source control
FabricStudio and VS Code already do commit/checkout/stage/push/pull; do not compete. DataPass Git value = architecture-aware change understanding: `models/fct_orders.sql` changed → dbt model → Gold Orders → Semantic Model → 12 measures → 3 report pages. Answer: what semantic object changed, downstream impact, which architecture decision changed, which IaC resource changed, does observed deployment still match this revision. HG2/lineage history/blame remain valuable.

## 27. Git-first materialization
Flow: architecture candidate → generate candidate native files → validate → Git diff → human review → branch/MR → native deployment tool → Observe → verify result. No silent materialization into production cloud. Generated artifacts carry provenance: source logical id, source revision, generator version, target platform, hash, environment (`MAT1`).

## 28. dbt-to-native compiler is optional, not core
Default: dbt project → DataPass understands logical graph → supported dbt runtime. Optional future materializer: dbt → generated Fabric-native notebook/orchestration artifacts; dbt stays canonical, generated notebook is generated output, manual edits discouraged or explicitly detached, deterministic generation; avoid two sources of truth.

## 29. DataPass should NOT build
Generic Fabric workspace explorer, OneLake filesystem, Fabric authentication, Fabric REST client UI, Fabric notebook editor, remote Spark kernel manager, Fabric Git client, deployment pipeline GUI, Power BI report editor, TMDL editor, DAX Studio, Tabular Editor, generic Git client, generic terminal, dbt runtime, Spark runtime, Terraform engine, Grafana dashboard designer, another Airflow scheduler. Integration and routing are acceptable; semantic interpretation and cross-tool reasoning are DataPass's job.

## 30. What DataPass genuinely owns
Cross-repo project understanding; typed semantic extraction; cross-domain lineage; architectural alternatives; architecture linting; execution-unit reasoning; project-scale visualization; semantic Git diff; theoretical volumetry; readiness; IaC semantics; desired-vs-actual drift; static-vs-runtime reconciliation; logical-vs-physical Spark correlation; CU/cost correlation; provider evidence; tool/capability routing; client-AI gap confirmation; local↔cloud profile comparison.

## 31. Lifecycle UI
One lifecycle, not a bag of VSIXs: Understand (Core) / Design (Cloud) / Build (native tools) → IaC (desired state) + Git (change) → Deploy → Observe (state, runtime, monitoring) → Optimize → back to Design. Package boundaries stay implementation details.

## 32. Factory's role
Distinct from provider execution: fast local demonstrator, architecture prototype, sample-data execution, local reproducibility, teaching/demo. Engines: DuckDB, Polars, Python, local dbt, optional local Spark when justified, Docker/Compose where needed. No perfect Fabric/Databricks emulation. Factory = "can I demonstrate and validate the idea locally?"; Observe = "what happened in the real environment?".

## 33. Data X-ray's role
Not a second query platform. Inspect data/file/table artifact, understand format, profile, diff, time travel, validate, preview, bounded local SQL, data quality, wrangling/export. Delta/Iceberg/DuckLake/DuckDB work fits. Observations may feed semantic evidence. No unrestricted SQL execution, no full warehouse.

## 34. Evidence quality explicit
Every important claim keeps origin: static, declared, generated, provider-captured, runtime-observed, inferred, AI-proposed, AI-confirmed, simulated. Synthetic FOIL telemetry must never be indistinguishable from provider-observed evidence. Example: static "possible shuffle problem"; synthetic runtime "confirms fixture behaves as expected"; real runtime "not yet observed" — never report "production confirmed".

## 35. Operation-specific readiness
Replace "Fabric: READY" with per-operation: Edit Notebook READY; Run Spark remotely READY; Deploy via fabric-cicd MISSING AUTH; Read OneLake READY; Write OneLake /Files READY; Observe CU IMPORT ONLY; Observe Spark execution plan NOT CONFIGURED; Terraform Fabric deployment READY; Power BI PBIR editing POWERBI-VSCODE AVAILABLE.

## 36. Additive work packages (reconcile with existing local branches before creating)
| Capability | Purpose | Priority |
|---|---|---|
| `EXEC1` | normalized execution-unit facet (Notebook/SJD/dbt/SDP/Pipeline/Airflow/…) | highest |
| `CAPROUTE1` | operation-specific capability router | highest |
| `TBX1+` | deepen Microsoft Fabric Toolbox routing/evidence | high |
| `FABINT1` | supported bridge to official Fabric VS Code capabilities | high |
| `FABEVID1` | Fabric configuration/state evidence | high |
| `IACFAB1` | Fabric-specific Terraform/IaC semantics | high |
| `DBTRUN1` | dbt execution route separate from logical dbt DAG | high |
| `SPARKPLAN1` | runtime Spark plan import/evidence | high |
| `OBSFAB1` | unified Fabric Observe surface: capacity/workspace/job/Spark | high |
| `COSTACT1` | theoretical VOL1 ↔ observed CU/cost reconciliation | medium-high |
| `MAT1` | reviewed native artifact materialization/provenance | medium |
| `TOOLPROV1` | tool provenance official/community/fork/reference | small/high-value |
Search current local work first: parts may already exist after the GitLab snapshot.

## 37. FabricAdapter correction
Deriving a broad Fabric status from core extension + `fab` is too coarse. Keep tool detection; expose capability facts (Fabric core ext, Fabric Data Engineering, Jupyter, FabricStudio, OneLake-VSCode, PowerBI-VSCode, `fab` authenticated, fabric-cicd, Terraform, Fabric Toolbox clone configured) and derive operation readiness from requirements. Don't globally require Fabric Data Engineering for a Fabric project (a Warehouse/dbt project may not need it; Spark/notebook probably does).

## 38. Toolbox handling correction
Catalog architecture is right; do not vendor the whole Microsoft Fabric Toolbox. For important assets go beyond Open/Clone/Configure: what capability it provides, what evidence DataPass can ingest, what project condition makes it relevant, prerequisites, side effects, owning lifecycle domain. Example Fabric Spark Monitoring: domain Observe/Spark; useful when Spark workloads need engine-level telemetry; evidence CPU/memory/shuffle/spill/app comparison; side effects deploys monitoring resources, needs configuration, consumes capacity; DataPass action explain/route/ingest resulting evidence.

## 39. Observe correction
Not dashboards. Model: STATIC PROJECT → expected architecture → (DEPLOYED STATE → config drift) and (RUNTIME EVENTS → run evidence) → reconciliation → confirmed / refuted / not observed / unknown. Dashboards are views over the evidence model, not the model.

## 40. Monitoring correction
Use existing provider telemetry rather than a proprietary collector: Capacity Metrics, Workspace Monitoring Eventhouse, Fabric job APIs, Fabric Toolbox monitoring solutions, Spark diagnostics, Power BI refresh history, activity/admin data. Normalize enough to correlate; don't reproduce every Fabric monitoring dashboard.

## 41. Architecture reasoning (PRACT2 is strategic; continue)
Valuable detectors/decision cards: Spark for very small bounded workload; daily SLA backed by always-on streaming; production notebook with heavy `%run` coupling; Gold metrics reimplemented outside the semantic layer; full refresh inconsistent with declared volume; sensitive column exposed without expected policy; Spark runtime dependency incompatible with target environment; duplicated data movement into BI layer; IaC declaration differing from actual provider setting; orchestration duplicated between Airflow and Fabric Pipeline; dbt project executed through unclear/unsupported route. Every recommendation: evidence, assumption, alternative, benefit, cost/trade-off, confidence. No simplistic best-practice policing.

## 42. Preserve platform portability
Fabric is most developed but must not leak into Common semantics. Correct: `ExecutionUnit.nativeKind = FabricSparkJobDefinition`. Incorrect: all execution units have FabricEnvironmentId. Provider config attachment may hold Fabric-specific details while Common keeps portable fields. Databricks (Job, Lakeflow pipeline, cluster/serverless, Unity Catalog) must map onto the same higher-level concepts without pretending providers are identical.

## 43. Do not over-centralize runtime services
No mandatory Redis, graph database, Kubernetes, central FastAPI server, large MPP engine without demonstrated need. Common stays packages/libraries + bounded local state. DuckDB is an optional/local execution tool, not DataPass's permanent database.

## 44. What "finished V4" demonstrates
1 Open a multi-repo data project. 2 Discover Terraform, Fabric artifacts, dbt, PySpark, Airflow, semantic model, reports. 3 Assemble architecture and typed lineage. 4 Identify intended architecture, execution units, infrastructure, schedules, critical paths. 5 Show architecture findings (notebook production coupling, volume mismatch, redundant movement). 6 User explores an alternative (notebook chain → packaged wheel + SJD). 7 DataPass explains benefits/trade-offs. 8 IaC shows expected Fabric resources. 9 Git view shows what files/resources would change. 10 Native deployment tooling selected (fabric-cicd / Terraform / Fabric tooling). 11 Observe reads deployed state, runs, Spark metrics, CU. 12 Compare expected vs deployed, theoretical vs measured, static finding vs runtime evidence. 13 Finding is confirmed / refuted / not observed. 14 User returns to architecture view with evidence.

## 45. Priority for the remaining ~50%
finish/freeze current Common contracts → ExecutionUnit semantics → operation-specific capability routing → Fabric item + dbt + SDP + orchestration execution mapping → IaC desired-state semantics → Observe provider/deployed state → Spark/CU runtime evidence → static ↔ reality reconciliation → Git/materialization/deployment provenance → final lifecycle UI / E2E qualification. Avoid spending the second half mostly on dozens more parsers: coverage breadth is valuable, semantic coherence is now more valuable.

## 46. Final architectural invariant
> Native tools execute and author specialized provider resources; DataPass understands the whole project, reasons about architecture, selects the right capability, predicts impact, correlates Git/IaC/runtime evidence, and verifies whether reality matches intent.
A feature that merely reproduces a native tool without adding project semantics probably does not belong; one that connects several otherwise isolated domains probably does. High-value connections: dbt model → Fabric execution unit → Spark/SQL runtime → Gold table → semantic model → report → CU; Terraform resource → Fabric workspace setting → deployed state → drift; Git commit → changed transformation → affected tables → affected measures → observed performance difference; static Spark warning → physical Spark plan → shuffle/spill → CU → confirmed finding.

## 47. Immediate instructions to the V4 AI
1 Read local current state, not just GitLab. 2 Check whether the capability exists under another package name. 3 Do not revert merged V4 work to match stale FINAL_ARCHITECTURE.md. 4 Update stale architecture/status language rather than rebuilding working features. 5 Preserve typed domain relations; no undifferentiated mega-graph. 6 Notebook, SJD, dbt Job, SDP, Pipeline, Airflow are distinct native constructs but comparable execution choices. 7 Promote Observe/CU/runtime reconciliation to a first-class V4 outcome. 8 Cloud = design, IaC = desired state, Deploy = transition, Observe = reality. 9 Replace generic "Fabric ready" with operation-specific readiness. 10 Integrate FabricStudio, PowerBI-VSCode, OneLake-VSCode and official Microsoft tooling as capability providers, don't clone them. 11 Distinguish `microsoft/fabric-toolbox` from `gbrueckl/Fabric.Toolbox`. 12 `gbrueckl/fabric-cicd` is a fork; Microsoft upstream is canonical. 13 Continue PRACT/architecture-reasoning work. 14 Add runtime Spark-plan evidence without executing donor code during static discovery. 15 Final E2E story traverses Understand → Design → IaC/Git → Deploy → Observe → Optimize.
The product does not need another architectural reset: the second half of V4 must make the existing work behave like one coherent engineering intelligence system.
