# DataPass VS Code — V3 handoff (2026-09-25)

**Start here.** This replaces [V1_HANDOFF.md](V1_HANDOFF.md) as the entry point for status and next
steps. V1 remains the record of passes 9–12; [V2.1](V2_1_HANDOFF.md) and [V2.2](V2_2_HANDOFF.md)
remain the architecture foundation that V3 builds on (items, artifacts, workflows, AI exchange,
security). What the code does today is in [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## 1. What V3 is, in one paragraph

DataPass is the workbench between **the AI that prepares a project in Git**, **GitHub** that stores
it, **the official VS Code extensions and CLIs** that do the cloud work, and **you**. A project is
described once, by an AI or by hand, in a coordination repository: `.datapass/project.json`
(manifest v3: repositories, sub-projects, environments) and `.datapass/graph.json` (graph 0.2:
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
| **0.15.0** | **V3 pass 3: architecture options and scenarios (compare, preview, record a decision), project sheet, diagram views (vertical, lanes, folding), JSON exchange with an AI with backups, `vm`/`docker` providers, Google tools named** | branch `claude/v3-options` |
| 0.16.0 | Work and DevOps: board (kanban), Azure DevOps / GitHub / GitLab links and CI profiles, Mongoku frozen | next |
| 0.17.0 | Windows and work views: company workspace file, saved layouts, status-bar switcher, Power Ops launcher | after |
| 1.0.0 | When the V3 acceptance with Julian passes on one real multi-repository project (section 6) | — |

"V3" names the architecture of this handoff; 0.13.0 is the first extension release that implements
it. A handoff version is not an extension release.

## 3. The audit, reconciled

The GPT audit of 0.12.0 (`DATAPASS_AUDIT_ET_HANDOFF_CLAUDE_2026-09-25.zip`) was checked against the
source before anything was changed. Every finding was confirmed; one more serious issue was found.
Detail per finding, fix and regression test: [v3/01_AUDIT_RECONCILIATION.md](v3/01_AUDIT_RECONCILIATION.md).

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

Architecture detail: [v3/02_ARCHITECTURE.md](v3/02_ARCHITECTURE.md). Vision, what VS Code allows
for companies / workspaces / tabs, readiness per step and the next passes:
[v3/06_VISION_AND_READINESS.md](v3/06_VISION_AND_READINESS.md). How an AI prepares a project:
[docs/PREPARING_A_PROJECT.md](../docs/PREPARING_A_PROJECT.md). Examples: [examples/v3](../examples/v3/).

## 5. FOIL as the first consumer

FOIL uses DataPass like any project; its private coordination repository is
`julian-passebecq/foil-v1-vscode-datapass`. A ready starter (manifest v3, graph 0.2, AGENTS.md) is in
the handoff ZIP, not in this public repository. The DAB stays in `foil_databrick_dab`; its campaign
jobs are generated by the FOIL Lab compiler of the `databricks-vscode-foil` fork (branch
`foil-lab-mvp`), which the starter declares as a producer. See
[v3/03_FOIL_CONSUMER.md](v3/03_FOIL_CONSUMER.md).

## 6. Next, in order

1. ~~Review and merge 0.13.0 / 0.13.1~~ — merged (PR #18, #19); ~~0.14.0 environment readiness~~ — merged
   (PR #21). 0.15.0 (architecture options, project sheet) — this pass.
2. **Acceptance with Julian** — testlab project 4 (the multi-repository AI loop, offline), testlab
   project 5 (options, sheet, AI files), and the FOIL consumer on the real repositories (its options
   and sheet are merged in the private coordination repository, PR #3): [v3/04_NEXT_PASSES.md](v3/04_NEXT_PASSES.md).
3. **0.16.0 work and DevOps**, then **0.17.0 windows and work views**: [v3/06_VISION_AND_READINESS.md](v3/06_VISION_AND_READINESS.md) section 6.
4. **Account qualification** (V1 gate 16, unchanged): Databricks validate, Fabric browse, Azure plan,
   VM over SSH — now also Azure Functions run-local/deploy and ADF Studio on a small STUDY slice.
5. Then 1.0.0. After 1.0: Restricted Mode and Remote-SSH/WSL desktop qualification, DiagramCloud and
   Grafana as optional modules (last, per Julian's priorities). Mongoku is frozen: it reads GitHub
   files and has no link with DataPass.

Ready-to-paste prompt: [v3/CLAUDE_PROMPT.md](v3/CLAUDE_PROMPT.md).

## 7. Rules that do not change

Local-first; Git-versioned configuration; manual AI exchange with exact bases and explicit review;
official/specialist tools do the work; discovery never executes project code; imported labels never
approve themselves; no credentials, auto-push, auto-merge, provisioning or authority writes without
explicit approval; no FOIL private material in this public repository. Full list: [CLAUDE.md](../CLAUDE.md).
