# 03 — workflows, Airflow and orchestration ownership

## 1. A real Workflows surface

The user needs to understand a pipeline as work, not as a vendor logo. Add a common surface with:

- source/revision and logical objective;
- engine, provider target and environment;
- inputs/outputs and configuration contract;
- tasks/dependencies, with dynamic/unknown sections marked;
- parameter set and trigger/schedule owner;
- prerequisites and native-tool link;
- last observed run, task attempts, logs and receipt;
- which downstream datasets/notebooks/apps will be affected.

Do not build another scheduler. DataPass can prepare files, open a native client and explicitly request a run; the remote runtime continues without VS Code.

## 2. Same family does not mean identical engine

| User-visible family | Native implementation | Important distinction |
|---|---|---|
| Batch orchestration | Apache Airflow DAG | DAG Python, timetable/data interval, task attempts, executor and metadata DB |
| Data integration orchestration | Azure Data Factory pipeline | Activities, connections/linked services, integration runtimes, expressions and triggers |
| Fabric orchestration | Fabric Data Factory pipeline | Fabric connections/items/capacity and native activity support |
| Managed Airflow | Fabric Apache Airflow Job | Airflow-based hosting, not a Fabric pipeline disguised as Python |
| Databricks orchestration | Lakeflow Job | Task dependencies, compute and trigger/concurrency settings |
| Declarative data processing | Lakeflow Spark Declarative Pipeline | Dataflow/table dependencies and incremental/streaming semantics |
| Streaming transport/processing | Eventstream / streaming service | Continuous lifecycle, checkpoints, buffering and replay |
| Software delivery | GitHub Actions / Azure Pipelines / GitLab CI | Builds/deployment automation, not the scientific data workflow itself |

A Databricks job started manually is still a job. 'Manual' and 'scheduled' are trigger modes. A bundle packages definitions for deployment; it does not execute tasks. A pipeline may call an external workload without owning its internal task graph. [S05, S10]

## 3. Airflow adapter: logical DAG plus deployment profile

The Airflow adapter must understand or expose:

```text
DAG source reference and observed code revision
DAG ID; declared/extracted graph; parse completeness
Airflow major/minor and Python version
provider package requirements and lock/constraints references
connections/variables as names and secret references only
schedule/timetable, timezone, catchup/backfill intent
parameters, input data interval and output artifact contract
retries, timeout, concurrency and pools
executor and deployment mode
native UI/API identity and authentication method
run ID, task ID, map index, try number, state and observation time
```

Different hosting profiles reuse this model:

| Profile | Packaging/runtime | DataPass responsibilities |
|---|---|---|
| Local development | Docker Compose | Identify compose project, image versions, DAG mount, dependency file and local UI; no implicit container start |
| OCI/K3s | Helm/manifests, KubernetesExecutor | Namespace/service account, DAG distribution, image architecture, metadata DB, pod/log access and runtime link |
| Fabric-managed | Fabric Apache Airflow Job | Workspace/capacity/identity, managed versions/packages, native item/UI and supported job operations |
| Other hosted Airflow | Provider-specific adapter later | Preserve native auth, API and deployment constraints |

## 4. Airflow on Fabric exists, but it is not assumed equivalent

Microsoft documents an Apache Airflow Job item in Fabric Data Factory. It provides managed Airflow development/monitoring and native integration. The documentation consulted during this handoff lists Airflow 2.10.5/Python 3.12, while the Apache stable Docker documentation describes a newer Airflow 3.x quickstart. These are dated observations, not permanent constants or a claim about the user's tenant. [S01–S03]

Consequences:
- pin target versions and re-check supported operators/provider packages;
- do not emit Airflow 3-only imports/API calls for a managed Airflow 2 target;
- do not assume the same REST API/auth contract across versions;
- managed networking restrictions can block calls to a private OCI endpoint;
- native permissions/workspace identity must be checked, not inferred from a URL;
- keep a safe fallback: open the native UI and export the precise missing requirement to the external AI.

Being able to represent an Airflow Job does not require a second UI for the entire managed service. V2.1 can start with metadata, prerequisite checks, source handoff and evidence links before adding proven API operations.

## 5. Docker, Kubernetes and Redis are separate concerns

The official Airflow Docker Compose quickstart is a learning/development starting point, not automatically a production deployment. It uses a Celery-oriented service stack including metadata PostgreSQL and a Redis broker. Its memory guidance applies to that quickstart, not all Airflow layouts. [S03]

The FOIL proposed OCI profile uses KubernetesExecutor and a separate metadata database. Tasks execute in pods; their images, namespace, service account, DAG/code distribution and dependencies must be reproducible. A Celery Redis broker is not an inherent requirement of KubernetesExecutor. [S04]

Do not conflate:
- optional FOIL application Redis cache;
- an Airflow Celery broker if that executor is selected;
- durable telemetry outbox/spool;
- Airflow metadata PostgreSQL;
- scientific result stores;
- DataPass's own local persistence.

Each has a separate resource role, retention, auth and backup policy. The local development profile and OCI target may deliberately use different executors; record the difference and test assumptions instead of assuming parity.

## 6. Discovery and validation are not permission to execute Python

Importing an Airflow DAG can execute arbitrary Python. Do not call DagBag, import DAG modules or evaluate annotations in the VS Code extension host merely to draw the graph.

Initial discovery can use filenames, manifests and a conservative static parser. It must say `partial` for dynamic factories, generated tasks or complex logic. An authorized native parse/test may run in an isolated, pinned environment with bounded time/resources and no production secrets; this is a separate user-approved action with a receipt.

Similarly, do not execute notebook cells, install requirements, pull images or run templated shell strings during inspection. A provider package can have installation side effects; installation belongs in the explicit environment-preparation flow.

## 7. Native actions and receipts

Suggested actions, implemented only when proven for the selected profile:

- Open DAG source at pinned revision.
- Open Airflow native UI / DAG / run / task log.
- Show requirements, image and target profile.
- Validate source in an approved environment.
- Prepare deployment diff (DAG files/image/Helm values), without applying it.
- Trigger a run with a reviewed parameter object and correlation ID.
- Observe run/task states and collect a bounded, redacted failure summary.
- Pause schedule or cancel work only with explicit effect/target confirmation.

`airflow dags test`, a parse, a scheduler run and a task retry have different effects. Do not label them all 'Validate'. Preserve Airflow-specific native state in receipts, even when a common UI maps it to running/succeeded/failed/unknown.

A copied command produces a `prepared`/`copied` observation, not a run receipt proving execution. After a timeout, check for an existing provider run before retrying. 'Unknown outcome' is safer than submitting duplicate campaigns.

## 8. One scheduling owner per logical trigger

Define a `triggerOwnerRef` and a native schedule reference per deployed workflow/environment. A campaign may be initiated manually by the user or by Airflow; an Airflow task can submit a Lakeflow Job and wait for its native receipt. That does not justify an independent Lakeflow schedule triggering the same campaign too.

Cross-platform orchestrator selection is a reviewed architecture decision:

```text
Airflow owns campaign schedule
  → generates/chooses immutable snapshot
  → submits one native Databricks Job with snapshot identity
  → observes completion and records native run ID
  → publishes approved summary
```

Alternatively, Lakeflow owns the campaign and Airflow only prepares upstream artifacts. Both are possible, but one trigger must not silently produce duplicate work. Include schedule migration/cutover/disable-old-trigger checks in portability plans.

Continuous telemetry is not one Airflow DAG run per event. Airflow can launch/manage a finite replay, archive a window or supervise periodic processing; the running stream has its own lifecycle and buffering.

## 9. FOIL first Airflow slice

The uploaded R0 pack contains experiment/configuration/kernel/replay artifacts and cloud proposals, not a native DAG implementation. A first reviewed DAG should operate on an already-pinned case bundle, with a small sequential path such as:

```text
verify_input_manifest
 → run_bounded_replay_or_batch
 → validate_event_identity_and_schema
 → write_immutable_archive_manifest
 → optionally_submit_approved_downstream_job
 → write_run_receipt
```

Keep physical-machine control outside this workflow. Model pause/stop/replay as simulation operations, not emergency-stop controls. No industrial actuation, live deployment or increased budget is authorized by this handoff.

Start with one source-known example, a controlled local test and native UI links. OCI deployment remains separate. Preserve current ReactOracle runtime tooling rather than replacing its control API or agent just to add DataPass.

## 10. Provider-neutral workflow view without false normalization

Expose a small common projection: task ID, label, referenced item, dependencies, declared input/output, effect class, native pointer. Retain provider-specific expressions and flags in the native source/typed provider metadata. For unsupported dynamic sections, show an opaque native node with a link, not fabricated edges.

A workflow display can be generic while validation/execution remains provider-specific. This is the central abstraction: reuse the user workflow and contracts, not pretend all orchestration engines are one engine.
