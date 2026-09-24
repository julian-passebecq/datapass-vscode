# 04 — portability and migration without a false universal converter

## 1. What the catalog really makes faster

The user is right that notebooks, pipelines, datasets and parameterized jobs recur across platforms. A shared catalog can reuse discovery, forms, prerequisite checklists, artifact references, diagrams, AI context, migration questions and verification receipts. It can also support small tested code transformations.

The wrong conclusion would be that an Airflow DAG, ADF pipeline or Databricks notebook can always be converted simply by selecting another provider. Identity, storage, expressions, native operators, compute versions and runtime semantics can change the result.

Use the label **Assess portability**, not **Convert anywhere**.

## 2. Levels of support

Record support per conversion route and target version:

| Level | Promise |
|---|---|
| Inspect/reference | Recognize native files and expose metadata without editing |
| Structural interchange | Transfer known file/cell structure while preserving source |
| Assisted adaptation | Produce a reviewed candidate with explicit unresolved mappings |
| Tested subset migration | Generate supported constructs and validate against fixtures |
| Runtime-qualified migration | Selected real workload passed defined equivalence/cutover checks |

None implies universal semantic equivalence. A rule can be valid for pure Python cells and unsupported for platform utilities. Unknown behavior is not classified as safe merely because it parsed.

## 3. Migration assessment contract

An assessment records:

```text
source item/artifact and exact revision(s)
target binding/provider/runtime versions
ruleset ID/version and assessment timestamp
supported mappings
required identity/storage/connection/parameter mappings
unsupported features and opaque native sections
possible semantic differences and data-loss risks
candidate file changes and paths
verification plan, golden fixtures and expected outputs
cutover/rollback plan; schedule owner
cost, licensing, retention and network prerequisites
status: blocked | needs-review | candidate-prepared | runtime-qualified
```

Do not copy secrets or cloud identities across providers. A target role/connection must be separately authorized. Data relocation and data-format compatibility are not implied by code conversion. Show expected copies, egress, retention and downstream consumers.

## 4. Notebooks: common representation, different context

Jupyter IPYNB is a structured format for cells/source/metadata/output, not a portable compute environment. Databricks also uses source formats with notebook/cell markers. Fabric offers native Git representation and item definitions with provider metadata. [S06–S09]

Inspect at least:
- language and cell boundaries, markdown, magic commands and notebook includes;
- packages, Python/Spark/Scala versions and native wheels/CPU architecture;
- `dbutils`, DBFS, widgets and secret scopes versus Fabric NotebookUtils and OneLake;
- Unity Catalog/catalog/schema/table identities versus Fabric lakehouse/warehouse bindings;
- default lakehouse and attached environment;
- MLflow/experiment/artifact-store identity;
- SQL dialects, table format features, permissions and data locations;
- checkpoints, streaming watermarks, partition assumptions and session settings;
- provider-supported cell types and metadata;
- output/attachment redaction and confidential data.

Do not globally replace `dbutils` with `notebookutils`. Similar method names do not prove equivalent behavior. A notebook that runs a standard versioned Python package with explicit parameters is more portable than one that embeds every cloud API and mutable global setting. Prefer extracting reusable scientific/ETL logic into a package; thin notebooks provide provider-specific entrypoints.

**V2.1 first notebook route:** inspect a simple Python/PySpark notebook, preserve source, report portability hazards, propose a parameter/storage/environment mapping. Only generate a target candidate for recognized constructs. Validate syntax/structure locally; real runtime testing requires separately approved target access.

'Azure notebook' is too vague. Require the exact service: Fabric, Azure Databricks, Synapse or Azure ML have different native contracts. Unsupported services remain visible/reference-only until an adapter is implemented.

## 5. ADF → Fabric Data Factory

Microsoft provides migration/assessment guidance and tools; DataPass should compose with them instead of inventing an independent complete transpiler. [S05]

Relevant differences include separate ADF datasets versus Fabric's connection/activity model, integration runtimes/gateways, activity/connector support, expressions/parameters, identity and trigger configuration. The official route reports compatibility categories and limitations. ADF pipeline migration support must not be interpreted as support for every ADF feature or an Airflow hosting migration.

A useful DataPass route:

1. Select the ADF item/repository and source revision.
2. Record official assessment/tool version and import the report where possible.
3. Display activities as supported, requires configuration, manual adaptation, unsupported or unknown.
4. Bind Fabric workspace/capacity and target connections without secrets in Git.
5. Generate/import target candidate in a separate location; keep source intact.
6. Validate trigger behavior, retries, failure branches, iteration/concurrency, connection credentials and expected outputs.
7. Compare with a golden dataset and inspect cost/runtime evidence.
8. Review cutover; avoid both old and new schedules running the same workload.

Mounting/connecting an existing factory is not the same as migrating its pipelines. Creating a Fabric-shaped JSON is not proof that it will run.

## 6. Airflow portability

Moving an Airflow DAG between self-hosted OCI and Fabric Airflow is closer to moving between hosting profiles of one engine than converting to a different orchestration model. It still requires version/package/operator/network/auth compatibility, DAG distribution, connection mapping and scheduling checks. Airflow 2/3 API/import differences are a real reason to pin profiles. [S01–S04]

Moving an Airflow DAG to an ADF/Fabric pipeline or Lakeflow Job is a semantic migration. Dynamic task mapping, sensors, timetables, branching, pools, task retries and external side effects may not map one-to-one. Do not statically execute arbitrary DAG code to discover it. Prefer an assessment or retain Airflow as the external orchestration owner.

## 7. Lakeflow Jobs versus declarative pipelines

Model Jobs as task orchestration and declarative pipelines as data processing/dependencies. A Job can invoke a pipeline or notebook; it is not the same object. A DAB contains deployment definitions for several kinds. [S10]

For a Databricks→Fabric candidate, preserve the logical experiment or ETL contract but assess execution differences separately. A materialized view, streaming table or managed incremental pipeline cannot be translated reliably just by copying SQL text. No default migration should create duplicate full Bronze/Silver/Gold stores solely to demonstrate more providers.

## 8. Verification before a portability claim

Define the equivalence scope explicitly:

- source structure preserved;
- parameter meaning and units preserved;
- schema/null/timezone/order semantics respected;
- output values match within stated exact/numerical tolerances;
- expected side effects and idempotency preserved;
- failures/retries/partial output handled;
- schedules/data intervals/backfills correct;
- secrets/IAM not broadened;
- performance/cost within approved envelope;
- runtime source/input hashes captured.

A successful schema validation is not execution equivalence. Runtime equivalence on one fixture is not a guarantee on arbitrary workloads. Store the fixture, source/target versions, ruleset and evidence receipt.

## 9. What to ship now and defer

**Now:** provider-aware catalog, compatibility report schema, explicit native-source preservation, tested inspection rules, one or two bounded preparation examples, source/target prerequisite differences and an AI export mode for migration review.

**Later:** larger deterministic conversion libraries, provider-certified migration bridges, automated environment matching, cross-runtime differential tests and agent-assisted repair. Do not block useful Airflow support or daily-work UX while attempting a universal compiler.

The strongest portability improvement for FOIL is the versioned common experiment schema and shared scientific package, not cloning its physics into every notebook.
