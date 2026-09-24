# 05 — optional company packs and the FOIL R0 pilot

## 1. Yes to a FOIL module; no to FOIL-specific core code

The user wants to parameterize wind experiments from DataPass, not only see URLs. Implement this as an optional **domain pack**, initially declarative and scoped to the selected project. It contributes terminology, schemas, parameter field groups, artifact roles, evidence labels, checklist templates and native-tool links. It does not make DataPass a CAD modeller, LCOE calculator, turbine controller or scientific authority.

A useful four-part FOIL panel:

1. **Case:** family/case/revision, classification, source references and candidate parameters with units.
2. **Artifacts:** resolved JSON, kernel version, CAD references, input dataset snapshot and result/briefing identities.
3. **Campaign:** selected cases, orchestration target, input hashes, limits, prerequisites and native run links.
4. **Impact:** which CAD/result/notebook/campaign consumers need revalidation after a change.

A generic JSON editor alone would miss the user's need. A complete duplicate Streamlit/CAD application would be excessive. A schema-backed form plus provenance and impact view is the middle ground.

## 2. Contribution contract

A pack descriptor should identify:

```text
namespace and pack ID; version; compatible DataPass contract versions
source repository/revision; integrity; publication/classification policy
domain types with schema ID/version/digest
field groups, labels, units and read/write rules
artifact roles and allowed relation types
checklist and AI-context templates
known external validation/materialization actions by ID
migration rules and native contract aliases
```

Use stable names such as `com.foil.experiment-case`; another organization can add a materials-test, finance-model or ETL-contract pack. Business navigation depth remains configurable. A pack must not override the platform's credential handling, approval checks or write scope.

V2.1 packs are declarative data. No downloaded JavaScript expressions, arbitrary shell, Python validators or untrusted remote schema resolution. Additional executable logic requires an explicitly trusted, versioned implementation with isolation/approval, preferably an existing CLI/package owned by the client. Unknown packs remain inspectable but inactive.

## 3. Safe parameter editing

Read the referenced source into a detached candidate. Apply edits to that copy, validate the complete document, show the diff and downstream effects, then accept a new revision. On failure, the original stays unchanged. This directly addresses the mutation-before-validation risk described in the uploaded FOIL dossier.

Field behavior should distinguish:
- accepted source-backed values: readonly reference or controlled change proposal;
- hypothesis values: editable candidate with explicit evidence class;
- computed values: derived by the external versioned kernel;
- measured values: tied to a measurement artifact/protocol, not editable into existence;
- unknown values: null/unknown, not silently defaulted to a plausible number.

Units must be explicit. A millimetre/metre or degree/radian conversion is a named validated transformation, not UI guesswork. Editing geometry invalidates derived CAD/result freshness; editing display labels need not invalidate a scientific run. Let the pack declare dependency/effect rules conservatively and explain the result.

Do not calculate physical/economic numbers twice in the form and in Streamlit. The external shared kernel remains the computational source. Render its results only with case/kernel/input identities and model-fidelity labels.

## 4. R0 source and classification

The user supplied `FOIL_Wind_R0_Launch_Pack_2026-09-24.zip`, a DataPass handoff Markdown note, a dossier and an HTML viewer. Treat these as an experimental development proposal, not accepted commercial machine specifications.

The pack organizes three P/A/B research families with nine D/N/F resolved cases. Within a family the D/N/F cases share geometry in R0. They are assumption scenarios, not P10/P50/P90 probabilities. CAD/STEP/GLB validity is not industrial/structural validation; L0 screening outputs are not measured performance.

The native contract is **`foil.experiment/1.0-rc1`**, using `schema_version` and its existing native fields. Do not rename/restructure it just to fit a generic TypeScript model. Wrap it with DataPass metadata. The legacy Streamlit importer needs an explicit migration; R0 proposal files are not currently accepted V1 DataPass or provider deployment payloads.

## 5. What this pass actually checked

On the uploaded archive, without executing scientific code or connecting any cloud:

| Check | Result |
|---|---|
| Archive byte SHA-256 | `7f74b1e894e2039ff1fa9699832562f04b8250abcbffd85e67742555bd501c6c` |
| File entries | 76 |
| Manifest-listed files checked | 75; all sizes and SHA-256 values matched |
| Experiment cases validated against supplied JSON schema | 9 |
| Replay records / unique event IDs | 540 / 540 |
| Replay case semantic-hash mismatches | 0 |
| Native Airflow DAG files in the pack | None found in DAG paths; cloud files are proposals |
| Upstream test report | Reports 51 passed; not rerun in this pass |
| Browser/CAD/scientific/cloud verification here | Not performed |

Relevant file digests:
- `contracts/experiment.schema.json`: `7375115ef4de9f2b97a52e127fe7f0c40a404b690b01aa24e8031131b652aaaa`
- `models/kernel.py`: `eebe3fdd052a1fe68c93b870e0e0073a6eb647828f8297c979855f75e0048d5f`
- `manifest.lock.json`: `9d7a19e169afbb8b61eef08c576916fc2f86206129799b781adcba2f4d4c355d`

The uploaded dossier reports 51 prior tests and explicitly excludes full browser, Streamlit migration and live cloud qualification. Preserve the distinction between reported evidence and checks repeated here.

**Publication boundary:** this public repository receives design metadata and structural examples only. Do not upload the raw case parameters, budgets, CAD, study text or complete launch pack without a separate audience/data decision. Claude needs authorized access to the original pack for native-contract implementation; the hash/reference is not a hosted downloadable copy.

## 6. Source locations and exact role

| Repository | Role / read scope |
|---|---|
| `julian-passebecq/datapass-vscode` | This generic developer control plane |
| `julian-passebecq/foil-3d-stream` | The uploaded dossier identifies CAO branch `feature/wind-cao-lab-v1`, PR #2, observed head `389ed282fb9319eebcff003688c6e91c5e1da84b`; refresh before writing |
| `julian-passebecq/foil_databrick_dab` | Native DAB lab implementation; read current scope/live-test docs, not only aspirational README |
| `julian-passebecq/reactoracle` | Oracle runtime/control prototype; historical feature branch `feat/initial-control-plane`; verify current source, do not infer from stale main README |
| `julian-passebecq/foil-control-v1` | Control/export/schema interfaces, not a replacement engineering authority |
| `julian-passebecq/foil2d3dmonitor` | Real-time lab app context; verify runtime separately |
| `julian-passebecq/foilnextjscloudflare`, `foil3dnextjs` | App lineage/deployment candidates; do not automatically promote a successor |

All repository links use `https://github.com/` plus the name. Private repositories require authorized access. A code repository can be remote-only; DataPass does not require a clone to display relationships and observed revisions.

Fabric implementation ownership is still to be bound. The R0 consumer proposes considering a scoped `fabric/` directory in an owning repo rather than automatically creating another repo. This is a proposal requiring ownership review, not an instruction to create or move sources now.

## 7. R0 minimal circuit versus broader VNext

Preserve both designs with explicit scope and status:

| Concern | Earlier VNext direction | New R0 first-circuit proposal |
|---|---|---|
| Edge | OCI/K3s, Airflow, MQTT, Polars/DuckDB | Retained, bounded shared-kernel experiment workload |
| Ingress | IoT Hub/Event Hubs candidates | Event Hubs primary for initial synthetic circuit; IoT Hub deferred |
| Fabric | Streaming, OneLake, data orchestration | Eventstream/Eventhouse plus Fabric Data Factory/notebook preparation |
| Azure Data Factory | External Azure integration | Conditional later need; no duplicate orchestrator on first path |
| Databricks | Statistics/ML/MLflow | Pinned snapshot campaigns, one scheduling owner |
| Redis | Ephemeral application cache | Deferred from first critical path; not confused with an Airflow broker |
| Cosmos/document search | Derived RAG/search | Deferred, not deleted from future architecture |
| MotherDuck/DuckLake/Azure SQL | Optional analytical/serving roles | Not additional mandatory warehouses |
| Monitoring | Grafana operational observability | Grafana Cloud + Alloy first, avoid full heavy local stack |
| Extension gate | Prior organizational DataPass qualification gate | Proposed distinction: qualify DataPass actions, but let approved direct CLI/Git work proceed independently |

Do not mark this refinement adopted just because it is newer. Link it to the existing `IT-ARCH-HYBRID-DATA-PLATFORM-VNEXT-20260924` proposal, explain changes, and require appropriate decision reconciliation outside this documentation-only task.

## 8. FOIL artifact/lineage slice

```text
Streamlit case editor
 → accepted candidate JSON revision + schema/semantic hash
 → shared kernel version + input snapshot
 → Airflow batch or explicitly triggered native campaign
 → OCI replay / archive manifest
 → Fabric ingestion/preparation
 → pinned Databricks campaign
 → result artifacts / report / candidate model
 → Power BI or Streamlit presentation
```

CAD STEP/GLB references remain external artifacts. Grafana observes runtime, transport and campaign integrity; it is not the scientific result authority. Existing Neon may receive approved compact summaries; it is neither mandatory DataPass storage nor automatically Airflow's database.

Nine logical cases are not nine real machines and do not require nine VMs. Never sum alternative-case output as if it were a physical farm. Timestamps distinguish simulated time, emitted time and ingested time. Delivery/replay tests cover duplicates, missing sequences, out-of-order events and recovery; do not promise global exactly-once delivery.

## 9. Acceptance use case for the pack

1. Open FOIL and enable its reviewed experiment pack.
2. Register the Streamlit repo as remote-only and attach a locally available/authorized R0 artifact bundle.
3. Select one case, inspect its schema, units, assumptions and source identity.
4. Export only that case's sanitized context, required dependencies and unresolved prerequisites to AI.
5. Import a candidate edit with matching expected hashes; reject stale/invalid edits without mutation.
6. Show CAD/results/campaign inputs requiring revalidation and preserve previous revisions.
7. Prepare native Airflow/Fabric/Databricks work; no automatic provisioning or scheduling.
8. Record a native run receipt and a separate domain-validation status.
9. Open detailed Streamlit/CAO/native UI when needed; close DataPass without disrupting external work.

## 10. Limits and future extension points

Scientific checks, CFD, fatigue, cost estimation and physical safety remain outside the core. A future trusted pack implementation may call the client's versioned validator, but cannot label a candidate as measured truth or silently modify Mongo evidence.

Other clients should be able to contribute similarly specialized schemas/forms with no changes to generic item/receipt machinery. This is the desired test of extensibility: FOIL is a strong pilot, not a reason to turn DataPass into a wind-only application.
