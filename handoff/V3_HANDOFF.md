> **Current entry point: [CURRENT.md](CURRENT.md)** (2026-09-26). This handoff stays here as the V3 record; release packages still update it.

# DataPass VS Code — V3 handoff (2026-09-25)

**Start here.** This replaces [V1_HANDOFF.md](archive/V1_HANDOFF.md) as the entry point for status and next
steps. V1 remains the record of passes 9–12; [V2.1](archive/V2_1_HANDOFF.md) and [V2.2](archive/V2_2_HANDOFF.md)
remain the architecture foundation that V3 builds on (items, artifacts, workflows, AI exchange,
security). What the code does today is in [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## 1. What V3 is, in one paragraph

DataPass is the workbench between **the AI that prepares a project in Git**, **GitHub** that stores
it, **the official VS Code extensions and CLIs** that do the cloud work, and **you**. A project is
described once, by an AI or by hand, in a coordination repository: `.datapass/project.json`
(manifest v5 since 0.18: repositories, sub-projects, environments, ID map, toolchain, connections) and `.datapass/graph.json` (graph 0.2:
components, the files each needs in which repository, operations per environment, links). DataPass
checks those declarations against the disk and Git, shows the architecture and what is missing,
opens the right file or official tool, prepares a bounded context for ChatGPT/Claude, and gets the
AI's merged work with an explicit fetch and fast-forward. It never deploys, never pushes and never
treats a declaration as proof.

## 2. Version chronology

| Version | What | State |
|---|---|---|
| 0.12.0 | Pass 12 tooling (qualification records) — the base the 2026-09-25 GPT audit inspected | main `91a0850` |
| **0.13.0** | **V3 pass 1: trust fixes, manifest v3 / graph 0.2, repository and file resolution, Project Workbench, Git update loop, AI preparation pack, catalog** | merged, PR #18 (main `c68f853`) |
| 0.13.1 | No `$schema` line in prepared `.datapass/*.json` (VS Code blocked the web schema and skipped validation); DataPass explains an existing one in Problems | merged, PR #19 (main `748c32b`) |
| **0.14.0** | **V3 pass 2: environment readiness + companion ergonomics — manifest v4 (`localEnv`, `identifiers`), Local environment / Readiness sections in the Project view, env-file and Power Ops commands, names-and-states-only in the snapshot and AI context** | merged, PR #21 (main `e48b4f2`) |
| **0.15.0** | **V3 pass 3: architecture options and scenarios (compare, preview, record a decision), project sheet, diagram views (vertical, lanes, folding), JSON exchange with an AI with backups, `vm`/`docker` providers, Google tools named** | merged, PR #22 (main `90cd817`) |
| 0.15.1 | AI exchange view in the secondary side bar, shown instead of Chat when a DataPass project opens (parallel session) | merged, PR #23 (main `c48bc81`) |
| **0.16.0** | **V3 pass 4: work and DevOps — board (kanban), Azure DevOps / GitHub / GitLab links and CI profiles, Mongoku frozen** | merged, PR #24 (parallel session) |
| **0.17.0** | **V3 pass 5: windows and work views — company workspace file, work views (save/apply), status-bar switcher, `datapass.startupView`, floating Workbench, the Power Ops launcher contract** | merged, PR #25 (main `8f16270`) |
| — | Proposal: toolkit, toolchain and agents ([v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md)) | merged, PR #26 |
| — | Design: AI work modes, work orders, Git module, with Julian's answers ([v3/09_AI_MODES_WORK_ORDERS_GIT.md](v3/09_AI_MODES_WORK_ORDERS_GIT.md)) | merged, PR #27 |
| **0.18.0** | **Toolchain, ID map, connections — manifest v5 (`toolchain`, identifier `values` per environment and `kind`, `connections`), Tools & versions and Connections in Readiness, read-only sign-in checks, `.vscode/extensions.json` comparison, AI pack fields, the 11 data-goblin plugins** | merged, PR #28 |
| **0.19.0** | **Pass AI-1: the Git module — Git view with Needs you, worktrees, PRs with CI, recent merges, Fetch all, other repositories in `D:\PROJ`, Workbench Git card** | merged, PR #29 (main `da0e168`) |
| **0.20.0** | **Pass AI-2: work orders — the AI view's three tabs (DataPass-guided / Agent / Manual), orders handed to the Claude or Codex desktop apps (or a terminal), project types dev / work / perso, results checked by receipt, PRs found by branch, Needs you rule 8, the Work orders view, `.datapass/work-log.json`** | merged, PR #30 (main `538a3d3`) |
| 1.0.0 | When the V3 acceptance with Julian passes on one real multi-repository project (section 6) | — |

"V3" names the architecture of this handoff; 0.13.0 is the first extension release that implements
it. A handoff version is not an extension release.

## 3. The audit, reconciled

The GPT audit of 0.12.0 (`DATAPASS_AUDIT_ET_HANDOFF_CLAUDE_2026-09-25.zip`) was checked against the
source before anything was changed. Every finding was confirmed; one more serious issue was found.
Detail per finding, fix and regression test: [v3/01_AUDIT_RECONCILIATION.md](archive/v3/01_AUDIT_RECONCILIATION.md).

| Finding | Fixed in 0.13.0 |
|---|---|
| F01 declared paths counted as present | yes — observed facts, "declared but not found" / "not checked" |
| F02 first workspace folder = project; siblings not inventoried | yes — project folder detection, repository resolution by Git origin |
| F03 fingerprint blind to untracked content | yes — untracked blob ids, binary diff, partial captures never match |
| F04 review reusable for another target | yes — reviews keyed by target digest (environment, names, facts, files) |
| F05 quoted JSON secrets not redacted | yes — JSON, Azure connection strings, function keys, SAS, bearer, PEM |
| F06 runtime accepted fields the schema rejects | yes — unknown fields read from the schema file; parity corpus test |
| F07 results overwritten across scopes | yes — per project, scope, operation and target; stale when files change |
| F08 Data Factory filed under Fabric | yes — `azure` module |
| F09 Azure Functions not recognised | yes — inventory and `azure-functions.python` profile |
| F10 graph references not resolved | yes — cross-document problems |
| F11 graph and operations not linked | yes — operations per component and environment |
| F12 no way to get the AI's work | yes — Check for updates / Get updates (fast-forward only) |
| F13 AI context without a preparation pack | yes — preparation pack per component or sub-project |
| F14 interface tested, accounts not qualified | unchanged by design — account qualification needs Julian |
| F15 Workspace Trust / remote hosts | Trust: yes (`limited`, no Git in Restricted Mode). Remote hosts: to qualify |
| F16 no multi-project catalog | yes — `datapass.catalog` + Switch Project |
| F17 FOIL DAB depends on an old extension to generate its jobs | documented and modelled (`generated` + producer); the producer decision stays FOIL's |
| **new** Windows: `git.exe` in an opened folder would run | yes — executables resolved from absolute PATH entries only |

## 4. What changed for you

- **Project** view (left): sub-projects → components → expected files (found / missing / not cloned
  / to generate), repositories (cloned, not cloned, planned, commits to get), problems. Since 0.14.0,
  also **Local environment** (declared env files and variable names, set/empty/missing, never a
  value) and **Readiness** (deterministic checks, plus Mongoku/DiagramCloud as optional companions) —
  see manifest v4's `localEnv`/`identifiers` in [docs/PREPARING_A_PROJECT.md](../docs/PREPARING_A_PROJECT.md).
- **Architecture** panel (bottom): the diagram of the selected sub-project; click a component.
- **Details** (right, secondary side bar): the selected component's files, what each step needs
  (read, develop, test, validate, deploy, run, publish), checklist, actions.
- The centre stays the editor: clicking a found file opens it; a missing file is explained, never
  created. *DataPass: Workbench Layout* shows all of it; *Open Project Workbench* gives the overview tab.
- **Check for updates** (`git fetch`) → **Get updates** (fast-forward only, commits listed first).
- **Prepare AI context**: the question, repositories, exact paths, what is missing and why.
- **Clone** (VS Code Git) / **Locate** (a clone whose origin is verified) for each repository.

Added in 0.15.0:

- **Options** view of the Workbench: `.datapass/options.json` lists, per level (storage, processing,
  staging, compute…), the current option and one or two alternatives; DataPass computes what each
  adds, removes or changes, the official tools it needs and whether they are installed, what DataPass
  supports, and sums the declared prices (each with its source and date). Scenarios compare whole
  architectures; *Preview on diagram* marks components new / changed / removed; nothing is written
  until *Record an Architecture Decision*.
- **Project sheet** view: `.datapass/sheet.json` holds volumes, key columns, the project's formulas
  (as its code computes them, with the file) and where code runs; also shown per component.
- **Diagram**: horizontal or vertical, lanes by sub-project / repository / cloud / level, fold a lane
  or a parent.
- **AI files without an API**: *Copy a DataPass File for the AI* → paste the answer → *Import the
  AI's Answer* (validated, diff, backup) → commit; *Restore a Backup*.

Added in 0.16.0:

- **Board** view of the Workbench: `.datapass/board.json` is a kanban (tasks, bugs, features,
  decisions, questions) with sprints and milestones; drag a card to another column, filter by
  sub-project/sprint/type, open a card's component, file or link from its panel. Moving a card
  rewrites only its `status` value — every other byte of the file is kept — with a backup; DataPass
  never commits or pushes. *Prepare AI pack for this card* builds a scoped context per card type, a
  bug's error text scrubbed of credentials and local paths.
- **Git hosts**: Azure DevOps' https-with-organization and SSH address forms are recognised as one
  repository identity, so a clone made with either form matches the manifest's declared remote;
  *Open a Repository on the Web…* opens GitHub, Azure DevOps or GitLab's repository, pull/merge
  requests, pipelines/Actions and boards/issues pages.
- **CI profiles**: `github-actions`, `azure-pipelines`, `gitlab-ci` components open their pipeline
  files and, with "See the runs", the host's runs page (or the GitHub Actions extension's view).
- **Mongoku frozen**: manifests DataPass prepares now set `"modules": { "mongoku": false }` by
  default; it reads `board.json`/`project.json` from GitHub and has no link with DataPass.

Added in 0.17.0:

- **Company workspace file**: *Create the Company Workspace File (one window per company)…* writes
  a multi-root `.code-workspace` (this window's DataPass projects, their repositories found on this
  computer, folders relative to the file, a title-bar colour, an optional startup work view) — the
  recommended mapping is **1 VS Code window = 1 company**.
- **Work views**: named saved layouts of the main window
  (`<project>/.datapass/local/views.json`, machine-local) — selected sub-project/component, editor
  grid and files per group, the Workbench tab (in a group or floating), which DataPass views were
  shown, diagram settings, previewed architecture. *Save Work View…*, *Apply Work View…* (one
  call), *Manage Work Views*.
- **Status-bar switcher**: `$(briefcase) <Company> · <Sub-project> ▾` opens work views (one click),
  sub-projects, other projects, and window actions (floating Workbench, create company workspace,
  export for Power Ops).
- **`datapass.startupView`**: a `.code-workspace`-only setting; DataPass applies that work view when
  the window opens.
- **Floating Workbench**: *Open the Workbench in a Floating Window* (VS Code's own
  `moveEditorToNewWindow`), for a second screen.
- **Power Ops launcher list**: *Export Company Workspaces for Power Ops* writes a machine-local,
  secret-free JSON of company workspace files and their work views, kept up to date afterwards.

Added in 0.18.0 (design: [v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md) sections 5.3 and 8):

- **Manifest v5**: `toolchain.tools[]` (tool id, version range, `optional`, `where`: local / ci /
  fabric), identifiers with one value per environment (`values`) and a `kind` — the **ID map** — and
  `connections[]` (`sign-in`, `git-binding`, `cloud-connection`). *Upgrade Project Manifest* moves
  v4 to v5 with a backup.
- **Tools & versions** (Project view, Workbench): each local tool against its range, from this
  computer's probes; install commands copied, never run; unknown ids run nothing; a version outside
  its range warns on the operations that use the tool, never on reading. `.vscode/extensions.json`
  is compared with the toolchain; *Show Recommended Extensions* is VS Code's own list.
- **Connections**: *Check Connections* runs `az account show`, `databricks auth profiles` and
  `fab auth status` read-only, without a prompt, from the home folder; credential files are never
  opened and no manifest value is passed to a CLI. Git bindings and cloud connections are "declared,
  not checked", with their portal page. Sign-in commands are copied for the person to run.
- **ID map** in daily use: *Copy Identifier* asks the environment; a hover on an id in any file and
  *Look Up an Id…* say which one it is. AI packs carry tools, the ID map and connection states — names
  and states only.
- The Power BI agentic catalogue lists the 11 plugins of `data-goblin/power-bi-agentic-development`,
  with Copilot CLI and Claude Code commands. Example: `examples/v3/sales-bi`.

Added in 0.19.0 (pass AI-1, [v3/09](v3/09_AI_MODES_WORK_ORDERS_GIT.md) section 6):

- **Git view** (left, under Project, with a badge): every repository of the project with its branch,
  ↓behind ↑ahead, changes, open PRs and last fetch; its worktrees (merged / PR closed, clean or
  dirty), PRs with their CI (✓ ✗ ●) and review, and the last three merges.
- **Needs you**: failed CI, green PRs waiting, merges not pulled, changes on the default branch,
  finished worktrees, unpushed work, detached HEAD — always in that order.
- **Routes only**: Source Control, a new window, the PR or failing check (web or the GitHub views),
  Check / Get updates, *Fetch all* (plain `git fetch`, explicit), copy a branch, **copy the cleanup
  command** — DataPass never deletes a worktree or branch.
- **Other repositories in D:\PROJ** (`datapass.projectsFolders`), read when opened; a **Git card**
  on the Workbench overview. PRs come from `gh` / `az` / `glab` when installed and signed in, else
  the 0.16 web links. No Git in Restricted Mode; 5 s per command, four at once.

Added in 0.20.0 (pass AI-2, [v3/09](v3/09_AI_MODES_WORK_ORDERS_GIT.md) sections 3.2, 4, 5, 8 and 13.1):

- **The AI view, three tabs**: **DataPass-guided** (the JSON exchange, default), **Agent** and
  **Manual**. The Agent tab writes **work orders** for Claude Code or Codex (goal, kind, scope,
  repositories to change or read, the agent and effort, who merges, an optional export JSON, the
  DataPass files to return by PR or for import) and shows what the agents did last on this project.
- **Off until you switch them on** (`datapass.ai.workOrders.enabled`, your machine only). **Project
  types**: `project.type` (dev / work / perso) or `datapass.ai.projectTypes`: dev and perso → on, the
  agent merges on green CI; work (FOIL, clients) → off unless `modules.workOrders: true`, you merge.
- **Launch, desktop apps first**: one confirmation, then the prompt is copied and the Claude app
  opens a new Code session (`claude://code/new`) — you pick the folder and paste; the Codex app the
  same way; or Claude Code / Codex in a VS Code terminal. Only an order DataPass wrote on this
  computer, unchanged, is launched; the base commits are checked against `origin` first.
- **What comes back**: `result.json` checked by its receipt; PRs found by the planned branch
  `dp/<id>`; the **Work orders** view of the Workbench and the order's **timeline in Details**;
  **Needs you rule 8** in the Git view; import of a proposed DataPass file (diff, backup); *Check the
  PR's DataPass files*; follow-up and revised orders. Entry points from a board card, a decision, a
  component's missing files and a failing PR.
- **Publish summary** writes `.datapass/work-log.json` (and your private log repository when set):
  ids, titles, dates, statuses, branches and PR links, never the goal or a path. You commit it.

Architecture detail: [v3/02_ARCHITECTURE.md](v3/02_ARCHITECTURE.md). Vision, what VS Code allows
for companies / workspaces / tabs, readiness per step and the next passes:
[v3/06_VISION_AND_READINESS.md](archive/v3/06_VISION_AND_READINESS.md). Windows and work views in full,
including the Power Ops launcher contract:
[v3/07_WINDOWS_AND_POWER_OPS.md](archive/v3/07_WINDOWS_AND_POWER_OPS.md). Toolkit, toolchain and agents
(community tools, recipes, the hub repository; its toolchain pass is 0.18.0): [v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md).
AI work modes, work orders and the Git module (Julian's answers and the order of passes in §13.1):
[v3/09_AI_MODES_WORK_ORDERS_GIT.md](v3/09_AI_MODES_WORK_ORDERS_GIT.md).
How an AI prepares a project: the step-by-step guide [docs/guide/](../docs/guide/README.md) and the
field reference [docs/PREPARING_A_PROJECT.md](../docs/PREPARING_A_PROJECT.md). Examples: [examples/v3](../examples/v3/).

## 5. FOIL as the first consumer

FOIL uses DataPass like any project; its private coordination repository is
`julian-passebecq/foil-v1-vscode-datapass`. A ready starter (manifest v3, graph 0.2, AGENTS.md) is in
the handoff ZIP, not in this public repository. The DAB stays in `foil_databrick_dab`; its campaign
jobs are generated by the FOIL Lab compiler of the `databricks-vscode-foil` fork (branch
`foil-lab-mvp`), which the starter declares as a producer. See
[v3/03_FOIL_CONSUMER.md](archive/v3/03_FOIL_CONSUMER.md).

## 6. Next, in order

1. ~~Review and merge 0.13.0 / 0.13.1~~ — merged (PR #18, #19); ~~0.14.0 environment readiness~~ — merged
   (PR #21); ~~0.15.0 architecture options, project sheet~~ — merged (PR #22); ~~0.15.1 AI exchange
   view~~ — merged (PR #23); ~~0.16.0 work and DevOps~~ — merged (PR #24); ~~0.17.0 windows and work
   views~~ — merged (PR #25); ~~0.18.0 toolchain, ID map, connections~~ — merged (PR #28);
   ~~0.19.0 the Git module (AI-1)~~ — merged (PR #29); ~~0.20.0 work orders (AI-2)~~ — merged (PR #30).
   **Guide for preparing a client project** (every file, in order, validated examples, what the
   person prepares, two-VM example, known limits): [docs/guide/](../docs/guide/README.md).
2. **Order of the next passes (Julian, [v3/09](v3/09_AI_MODES_WORK_ORDERS_GIT.md) §13.1):** ~~0.19.0 the
   Git module (AI-1)~~; ~~0.20.0 AI-2 work orders~~ — merged (PR #30); ~~Claude Control pass C-1~~;
   ~~0.22.0 trust repairs, modes, context, format checks, file versions~~ (PRs #34–#38, #40);
   ~~0.23.0 the **toolkit catalogue**~~ ([v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md)
   §5.1, 5.2, 5.4; PR #43) and variants (PR #39) — merged. ~~0.24.0 **AI-3** (the Claude & Codex panel,
   Control data in Work orders, Codex hand-off)~~ — merged (PR #46). Next **AI-4** (pilot mode, read-only first).
3. **Acceptance with Julian** — testlab project 8 (tools, ID map and connections with the real
   `az` / `fab` / `databricks`, 15–20 minutes, `D:\PROJ\datapass-testlab\8-outils-connexions`), testlab
   project 4 (the multi-repository AI loop, offline), testlab
   project 5 (options, sheet, AI files), testlab project 6 (board, Git hosts, CI, Mongoku frozen),
   testlab project 7 (windows and work views, offline, 20–25 minutes), testlab 7a (the Git view,
   offline with a stub gh, about 15 minutes, `D:\PROJ\datapass-testlab\7a-git`), testlab 7b (one real work
   order in the Claude app, 20–30 minutes, `D:\PROJ\datapass-testlab\7b-ordre-de-travail`), and the FOIL consumer on the
   real repositories (its options and sheet are merged in the private coordination repository, PR #3):
   [v3/04_NEXT_PASSES.md](v3/04_NEXT_PASSES.md).
4. **PowerToy_UI task** — read the Power Ops launcher list and let its Tool Launcher open a company
   or a work view: [v3/07_WINDOWS_AND_POWER_OPS.md](archive/v3/07_WINDOWS_AND_POWER_OPS.md) section 7 (a
   ready-to-paste prompt, effort "high"), a separate session in `D:\PROJ\PowerToy_UI`.
5. **Account qualification** (V1 gate 16, unchanged): Databricks validate, Fabric browse, Azure plan,
   VM over SSH — now also Azure Functions run-local/deploy and ADF Studio on a small STUDY slice.
6. Then 1.0.0. After 1.0: Restricted Mode and Remote-SSH/WSL desktop qualification, DiagramCloud and
   Grafana as optional modules (last, per Julian's priorities). Mongoku is frozen: it reads GitHub
   files and has no link with DataPass.

Ready-to-paste prompt: [v3/CLAUDE_PROMPT.md](archive/v3/CLAUDE_PROMPT.md).

## 7. Rules that do not change

Local-first; Git-versioned configuration; manual AI exchange with exact bases and explicit review;
official/specialist tools do the work; discovery never executes project code; imported labels never
approve themselves; no credentials, auto-push, auto-merge, provisioning or authority writes without
explicit approval; no FOIL private material in this public repository. Full list: [CLAUDE.md](../CLAUDE.md).

## 8. V3 consolidation — semantic project explorer, Airflow and Git evolution (2026-09-27)

> **Status:** accepted product direction from Julian's 2026-09-27 design session. This extends the
> existing V3 record; it does not restart DataPass, replace the V1 release gates, or make any cloud
> action implicit. Implementation should land incrementally after the current release baseline stays
> green.

### 8.1 Product boundary: DataPass and CloudDiagram stay separate

**CloudDiagram stays a standalone reconstruction/presentation product.** Its job is to reconstruct,
explain and present an existing project even when the original Git repository is unavailable. It can
work from documents, screenshots, supplied code, plans and human/AI reconstruction, and it owns
presentation concerns such as PPTX/PDF output.

**DataPass VS Code is Git-first.** Its job is to inspect and explain the project that actually exists
in the customer's repositories, at exact revisions, and to connect architecture, workflows, native
artifacts, code, execution evidence and Git history.

Therefore:

- DataPass has **no runtime dependency on CloudDiagram**.
- Do not make CloudDiagram's schema the canonical DataPass runtime model.
- Reuse useful concepts (nested detail, join/model/notebook/execution views, provenance discipline),
  but **reimplement them inside datapass-vscode** for the Git-first use case.
- Do not create a shared npm/library package now. The model and parsers will evolve quickly. Extract a
  library only later if two stable products genuinely need the same implementation.
- DiagramCloud/CloudDiagram remains optional and presentation-oriented; deleting it must not remove a
  DataPass engineering capability.

### 8.2 The V3 product promise

The next major DataPass development track is a **semantic, temporal, multi-repository explorer of the
real Git project**.

It must answer four questions continuously:

1. **What is this project?** — architecture and repository/component relationships.
2. **What does this element actually do?** — drill down from workflow to task, artifact, code and data
   operation.
3. **Where does DataPass know that from?** — exact repository, revision, path, line/cell and evidence
   basis.
4. **How did it become this?** — Git/PR evolution projected back onto the semantic project model.

The navigation ladder is:

| Level | Current view | Evolution view |
|---|---|---|
| G0 Repository | repositories, files, refs | commits, PRs, branches, worktrees |
| G1 Architecture | services/resources/components | nodes/edges added, removed or rewired |
| G2 Orchestration | Airflow/Lakeflow workflow DAG | tasks/dependencies/schedule changes |
| G3 Artifact | notebook/script/dbt model | cells/functions/models changed |
| G4 Logical dataflow | DataFrames/transforms | operations added, removed or changed |
| G5 Data semantics | schemas/columns/joins/keys | schema/key/join evolution |
| G6 Physical execution | Spark physical plan | operator/Exchange/partition-plan evolution |
| G7 Runtime evidence | observed metrics/results | run-to-run evidence evolution |

G0-G5 should come primarily from deterministic source analysis. G6 requires a captured physical plan.
G7 requires runtime evidence. Never infer G6/G7 from source syntax alone.

### 8.3 Two golden projects before Fabric

V3 should be driven by two real reference projects rather than by a universal abstract parser.

#### Golden project A — FOIL Databricks

Use the real FOIL Databricks repository as the complex Databricks fixture. The target drill-down is:

    Lakeflow job
      -> task
      -> Databricks notebook
      -> notebook cell / Python block
      -> PySpark DataFrame
      -> read / select / withColumn / filter / join / groupBy / agg / write
      -> Delta Bronze/Silver
      -> dbt staging/intermediate/marts
      -> Gold
      -> MLflow/evidence
      -> captured Spark plan when supplied

The first concrete workflow already gives a strong fixture: simulate -> gold_models -> verify.
02_run_experiment.py exercises real reads, cross joins, explicit broadcast, windows, groupBy/agg,
Delta writes, MLflow and Lakeflow task values. It should become a golden parser/semantic-diff test,
not a hard-coded FOIL feature.

#### Golden project B — Airflow Studies

Add a small real Airflow example because Airflow is a required first-class orchestration case before
Fabric:

    local PC: data/studies.csv
      -> Airflow DAG
      -> validate local CSV
      -> upload to a Databricks Unity Catalog Volume
      -> trigger/observe a Databricks Job
      -> ingest/clean to Delta
      -> build text/embedding data
      -> build/sync a Databricks AI Search (vector search) index
      -> run a small similarity-search verification

A useful CSV shape is study_id,title,abstract,domain,year,source, so the vector-search step is
meaningful rather than decorative.

The reference DAG should deliberately cross runtime boundaries:

    Airflow owns the schedule
      -> local validation
      -> local-to-cloud transfer
      -> Databricks native job
      -> Databricks remains owner of its internal execution
      -> Airflow observes the native job/result

This fixture validates local files, Airflow, cross-provider edges, Databricks, Delta and a vector
resource without forcing Fabric into the first implementation.

**Fabric comes after these two golden projects.** It should then arrive as another adapter over a
stable semantic model, not as another product redesign.

### 8.4 Airflow adapter: static and safe first

The existing airflow.dags artifact profile is not a genuine parser. V3 adds a real internal Airflow
adapter under datapass-vscode.

Initial static coverage should include:

- DAG(...) and @dag(...);
- DAG id, schedule/timetable references, timezone where statically visible, catchup and common retry
  defaults;
- task_id;
- PythonOperator, BashOperator, common sensors and Databricks operators needed by the golden
  fixture;
- TaskFlow @task where statically resolvable;
- dependencies expressed with >>, << and chain(...);
- TaskGroup boundaries where statically resolvable;
- operator -> referenced native artifact, especially an Airflow task invoking a Databricks Job;
- source revision/path/line provenance and parse completeness.

**Discovery must never import or execute DAG Python.** A DAG file is untrusted code. Dynamic factories,
loops driven by runtime data, generated tasks and unresolved imports are shown as partial/opaque
sections with exact source links, not fabricated edges. A separately approved native parse/test may
be added later in an isolated environment, but it is not discovery.

### 8.5 Databricks/PySpark analysis: move from lexical hints to semantic tracking

DataPass needs a real Python/PySpark analysis layer, not only token/regex hints.

Start with Python AST plus conservative DataFrame-variable tracking:

    spark.table/read...
      -> DataFrame variable
      -> select / selectExpr
      -> filter / where
      -> withColumn
      -> join / crossJoin
      -> broadcast(...)
      -> groupBy / agg
      -> repartition / coalesce
      -> union / distinct / dropDuplicates
      -> orderBy / sort / Window
      -> write / saveAsTable / insert target

Track where possible:

- input/output tables and files;
- DataFrame variable lineage;
- referenced/created columns;
- join left/right inputs, join type and keys/condition when statically expressible;
- group keys and aggregate outputs;
- notebook cell/block ownership and exact source ranges;
- write targets.

Do not pretend to resolve generated SQL, arbitrary Python metaprogramming or runtime-dependent
DataFrame aliases. Mark unresolved pieces honestly.

A supplied explain/Spark-plan capture is a **separate physical layer**. Source may declare
broadcast(...); only the plan can show the physical operator chosen. Actual rows/bytes/skew/duration
remain runtime evidence.

### 8.6 One internal model, implemented in this repository

Keep the implementation inside the single VSIX/repository for now. Suggested internal shape:

    src/
      analysis/
        model/
        provenance/
        python/
        semanticDiff/

      adapters/
        airflow/
        databricks/
        dbt/

      core/
        git/
          evolution.ts
          revisions.ts
          projectTimeline.ts

      views/
        detail/
        evolution/

This is a logical module boundary, not a package/distribution boundary.

The model must preserve stable identities for project/component/workflow/task/artifact/operation and
allow source bindings such as:

    repository + commit + path + line/cell range + evidence basis

Useful evidence bases include at least:

- parsed-source — deterministically extracted from native files;
- captured-plan — extracted from supplied execution/physical plan text;
- runtime — observed execution evidence with time/run identity;
- ai-inferred — AI correlation/explanation that is explicitly weaker than deterministic evidence.

AI may explain, label or correlate ambiguous cross-file meaning after deterministic extraction. It
must not silently turn an inference into source truth.

### 8.7 Git: keep the existing client, add semantic project history

Do **not** fork or rebuild GitLens.

DataPass already has the important generic Git foundation:

- multi-repository Git view;
- branch/upstream/ahead/behind and dirty state;
- worktrees;
- PRs with CI/review;
- recent merges and Needs you;
- explicit Fetch/Get Updates;
- Open Latest Version;
- Open Version...;
- Compare with Version...;
- Changed by the Last Update, already projected to DataPass components.

That remains the V1/D-18 decision: use native Git/VS Code for generic history and diff.

V3 adds a layer that GitLens and VS Code do not know: **semantic project history**.

Introduce the concept of a **Project Revision Vector**: one exact revision per repository that defines
a project state at a point in time.

Example:

    {
      "bridge": "a1832f...",
      "databricks": "920ab4...",
      "airflow": "b1201c...",
      "frontend": "780dd9..."
    }

This is not a new source of truth and need not be committed by default. It is a derived identity for
comparison, AI context, saved evidence and evolution views.

For a change A -> B, DataPass should combine native Git diff with the relevant adapters to produce a
**Semantic Diff**, for example:

    Git diff:
      2 lines changed

    Source semantic diff:
      broadcast() added to the right side of a crossJoin

    Dataflow diff:
      resource_norm edge: normal -> source-declared broadcast hint

    Project impact:
      Databricks / Simulation / Resource expansion

    Physical implication:
      unknown until a captured Spark plan confirms the selected operator

    Runtime implication:
      unknown until run evidence exists

The same mechanism should show Airflow DAG evolution, e.g. build_vector_index added between
Databricks processing and verify_search, and architecture evolution, e.g. an AI Search resource
added by a coordinated native + bridge change.

### 8.8 GitLens integration is optional routing, never a dependency

If GitLens is installed, DataPass may expose convenience routes such as:

- open the selected commit in GitLens;
- open file/line history or blame in GitLens;
- open a GitLens visual history/graph for the underlying native object.

Without GitLens, every DataPass semantic/evolution feature still works through native Git and VS Code.
Do not duplicate GitLens's commit graph, blame or generic history UI inside DataPass.

The DataPass-specific value is the mapping:

    commit / PR / file diff
            ->
    component / workflow / task / notebook / DataFrame / join / dataset

### 8.9 Evolution is a lens, not a fifth experience mode

Keep the existing presentation presets (vanilla, standard, datapass, advanced). Do not add an
"Evolution mode".

Evolution is a contextual lens on the same project model:

    Architecture: [ Current ] [ Evolution ]
    Details:      [ Structure ] [ Evolution ] [ Evidence ]

Selecting an evolution point must never check out a branch automatically. Historical source opens
read-only, like the existing file-version commands.

A target UI can combine:

- semantic/project tree on the left;
- native source in the editor;
- current architecture/dataflow/detail graph on the right/bottom;
- a compact Git/PR timeline for the selected semantic object;
- tabs for native file diff, semantic diff and evidence;
- optional Open in GitLens route.

### 8.10 Bridge responsibility in V3

Do not generate and persist a giant duplicated semantic graph in the customer bridge.

The bridge should primarily describe **where and how to inspect** the project: repository identities,
scopes/components, entry points and any adapter hints that cannot be discovered safely.

Conceptually:

    repositories:
      - foildbv

    entrypoints:
      - type: databricks-job
        file: deployment/manual/lakeflow_job_spec.yml

    artifacts:
      - type: databricks-notebooks
        root: databricks/notebooks
      - type: dbt
        root: dbt

DataPass then analyzes the actual native files at the actual Git revision. Derived semantic state can
be cached locally and invalidated by content/revision changes; it is not another manually maintained
copy of the customer's code.

### 8.11 Recommended implementation order

Do not mix this work into the current release candidate blindly. Keep the current baseline green and
land vertical slices with golden fixtures.

1. **Shared internal semantic model + provenance** inside datapass-vscode; no external package.
2. **FOIL Lakeflow adapter** — parse the real job YAML and map tasks/parameters/native artifacts.
3. **PySpark AST/DataFrame analyzer** — enough to reconstruct 02_run_experiment.py and the smaller
   interview-lab fixture with tests.
4. **dbt adapter** — source/ref/model dependencies and Silver -> staging -> intermediate -> Gold.
5. **Detail explorer** — source <-> semantic node bidirectional selection, with a lower evidence
   inspector.
6. **Airflow static parser** + the Airflow Studies golden project, including the cross-runtime edge to
   a Databricks Job.
7. **Git evolution engine** — project revision vector, selected-object commit timeline and
   A -> B semantic reparse.
8. **Semantic Diff UI** — file diff + semantic diff + project impact, read-only historical source.
9. **Physical/runtime overlays** — captured Spark plan first; runtime evidence only when actually
   supplied/observed.
10. **Fabric adapters** after the model works on both golden projects.
11. **Optional GitLens routes** after the native DataPass flow is complete.

### 8.12 Acceptance for the V3 semantic/evolution track

The track is useful only if a person unfamiliar with a project can answer concrete questions from
the real repositories.

Minimum end-to-end acceptance:

- Open FOIL and navigate Lakeflow -> simulate -> notebook -> PySpark operation -> dataset/join
  without manually maintained duplicate detail JSON.
- Click a semantic node and reach the exact native source; click relevant source and select the
  semantic node.
- Explain where each displayed fact came from, including commit/path/range and basis.
- Open the Airflow Studies project and see the real static DAG, the local CSV input, the Databricks
  boundary and the downstream Delta/vector-search resources.
- A dynamic/unresolved Airflow construct is visibly partial, never invented.
- Compare two commits and see both the native diff and a semantic change such as task added, join
  changed, write target changed or schema/column change.
- A source-level broadcast hint does not claim a physical broadcast until a captured Spark plan
  supports it.
- A previous result/check becomes stale when a relevant semantic input changes.
- The same semantic object can be reached from architecture, source, Git/PR change and evidence.
- All of the above works without CloudDiagram and without GitLens installed.

The central V3 principle is therefore:

> **DataPass understands the project in two dimensions: depth (what it does) and time (how Git made
> it become that), while every claim remains traceable to native source or explicit evidence.**

