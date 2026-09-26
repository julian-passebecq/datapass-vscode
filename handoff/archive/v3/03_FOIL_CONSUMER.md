# FOIL as the first V3 consumer

FOIL is a client project that uses DataPass like any other; it is not the product. Only its machine
configuration and science stay FOIL-specific, and they stay in FOIL's own repositories and tools.
Nothing private is copied into this public repository: the ready FOIL starter (manifest v3, graph 0.2,
AGENTS.md) is delivered in the handoff ZIP for the private coordination repository.

## Repositories

| Key | Repository | Role in DataPass | State to expect |
|---|---|---|---|
| (coordination) | `julian-passebecq/foil-v1-vscode-datapass` (private) | `.datapass/project.json`, `.datapass/graph.json`, `AGENTS.md`, architecture notes | the folder you open |
| `databricks` | `julian-passebecq/foil_databrick_dab` (private) | Databricks Asset Bundle of the wind lab, Neon export | clone it next to the coordination repository |
| `lab-producer` | `julian-passebecq/databricks-vscode-foil`, branch `foil-lab-mvp` | the FOIL Lab campaign compiler that generates the bundle's jobs | reference; clone only to inspect or extract it |
| `design-lab` | `julian-passebecq/foil-streamlit-wind-3d-lcoe` (private) | Design Lab bootstrap (`app.py`) | optional clone |
| `study` | not created yet | STUDY document pipeline (Data Factory, Function, Cosmos DB, MongoDB definitions) | **planned** |

A sub-project does not force a repository: STUDY can start as a folder of the coordination repository
during the pilot, then move to its own repository when its CI or permissions differ. The graph only
changes `repoRef`.

## Sub-projects

1. **STUDY — document pipeline (planned).** PDF archive → Azure Data Factory (orchestration) →
   extraction (Azure Function, Python) → Cosmos DB for NoSQL (staging of pages and chunks) → AI
   enrichment (explicit, separate) → human review of a candidate batch → publication to MongoDB Atlas
   STUDY (a separate, approved run) → ChatGPT reads Mongo and cites PDF, page and section.
   One orchestration authority for this flow (ADF); Fabric Data Factory stays with the simulation and
   analytics side. Cosmos is staging, not the AI model. GCS/BigQuery optional, AWS out of scope.
2. **Wind lab — Databricks.** The bundle's root `databricks.yml` only syncs `.foil-lab/build/**`; the
   campaign jobs are **generated** by the FOIL Lab compiler (compile, then apply the campaign), per the
   DAB repository's `docs/LIVE_TEST.md`. The starter declares `.foil-lab/build/**` as a generated output
   of that producer, so DataPass shows "to generate" and blocks validate/deploy until it exists, instead
   of calling a minimal bundle "ready".
3. **Design Lab (optional).** The Streamlit bootstrap stays in its repository.

## The producer decision (audit F17)

DataPass indexes the producer and routes to it; it does not absorb FOIL's compiler or physics. Two
options stay open for FOIL: keep the FOIL Lab inside the forked Databricks extension, or extract it
into a small FOIL CLI/package that writes `.foil-lab/build/**` from a frozen snapshot. Either way the
starter only changes the producer's name and `how`. Decide after inspecting the compiler's inputs
(snapshot, campaign id) and outputs; qualify generation, validation, deployment and run separately.

## What Julian does

1. Review the starter from the ZIP; commit it to `foil-v1-vscode-datapass` (DataPass never pushes).
2. Clone `foil_databrick_dab` next to it (or use *Clone* in the Project view; *Locate* if it is
   already elsewhere). Open the coordination repository in VS Code.
3. The Project view shows: Wind lab → bundle found, `.foil-lab/build/**` to generate; STUDY → repository
   planned, every component planned. *Prepare AI context* on STUDY gives ChatGPT/Claude the exact list
   of files to prepare and where.
4. After an AI pull request is merged: *Check for updates* → *Get updates*.
