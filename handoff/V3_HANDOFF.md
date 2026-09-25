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
| **0.15.0** | **V3 pass 3: architecture options and scenarios (compare, preview, record a decision), project sheet, diagram views (vertical, lanes, folding), JSON exchange with an AI with backups, `vm`/`docker` providers, Google tools named** | merged, PR #22 (main `90cd817`) |
| 0.15.1 | AI exchange view in the secondary side bar, shown instead of Chat when a DataPass project opens (parallel session) | merged, PR #23 (main `c48bc81`) |
| **0.16.0** | **V3 pass 4: work and DevOps — board (kanban), Azure DevOps / GitHub / GitLab links and CI profiles, Mongoku frozen** | merged, PR #24 (parallel session) |
| **0.17.0** | **V3 pass 5: windows and work views — company workspace file, work views (save/apply), status-bar switcher, `datapass.startupView`, floating Workbench, the Power Ops launcher contract** | merged, PR #25 (main `8f16270`) |
| — | Proposal: toolkit, toolchain and agents ([v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md)) | merged, PR #26 |
| — | Design: AI work modes, work orders, Git module, with Julian's answers ([v3/09_AI_MODES_WORK_ORDERS_GIT.md](v3/09_AI_MODES_WORK_ORDERS_GIT.md)) | merged, PR #27 |
| **0.18.0** | **Toolchain, ID map, connections — manifest v5 (`toolchain`, identifier `values` per environment and `kind`, `connections`), Tools & versions and Connections in Readiness, read-only sign-in checks, `.vscode/extensions.json` comparison, AI pack fields, the 11 data-goblin plugins** | merged, PR #28 |
| **0.19.0** | **Pass AI-1: the Git module — Git view with Needs you, worktrees, PRs with CI, recent merges, Fetch all, other repositories in `D:\PROJ`, Workbench Git card** | merged, PR #29 (main `da0e168`) |
| **0.20.0** | **Pass AI-2: work orders — the AI view's three tabs (DataPass-guided / Agent / Manual), orders handed to the Claude or Codex desktop apps (or a terminal), project types dev / work / perso, results checked by receipt, PRs found by branch, Needs you rule 8, the Work orders view, `.datapass/work-log.json`** | **this pass, branch `claude/work-orders-ai2`, on 0.19.0** |
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
[v3/06_VISION_AND_READINESS.md](v3/06_VISION_AND_READINESS.md). Windows and work views in full,
including the Power Ops launcher contract:
[v3/07_WINDOWS_AND_POWER_OPS.md](v3/07_WINDOWS_AND_POWER_OPS.md). Toolkit, toolchain and agents
(community tools, recipes, the hub repository; its toolchain pass is 0.18.0): [v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md).
AI work modes, work orders and the Git module (Julian's answers and the order of passes in §13.1):
[v3/09_AI_MODES_WORK_ORDERS_GIT.md](v3/09_AI_MODES_WORK_ORDERS_GIT.md).
How an AI prepares a project:
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
   (PR #21); ~~0.15.0 architecture options, project sheet~~ — merged (PR #22); ~~0.15.1 AI exchange
   view~~ — merged (PR #23); ~~0.16.0 work and DevOps~~ — merged (PR #24); ~~0.17.0 windows and work
   views~~ — merged (PR #25); ~~0.18.0 toolchain, ID map, connections~~ — merged (PR #28);
   ~~0.19.0 the Git module (AI-1)~~ — merged (PR #29); **0.20.0 work orders (AI-2) — this pass**.
2. **Order of the next passes (Julian, [v3/09](v3/09_AI_MODES_WORK_ORDERS_GIT.md) §13.1):** ~~0.19.0 the
   Git module (AI-1)~~; ~~0.20.0 AI-2 work orders~~ — this pass; in parallel, **Claude Control pass
   C-1** (v3/09 §10: link conversations to orders by the marker, CLI-only and Codex sessions,
   `GET /api/work-orders`) in `D:\PROJ\claude-control`; next the **toolkit catalogue**
   ([v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md) sections 5.1, 5.2, 5.4: catalogue and
   recipes as dated data from the hub repository over the built-in baseline of 0.18, with each tool's
   free tier and pricing — `freeTier`, `pricingUrl`, `tiers[]`, `checkedAt`; `recipe` on board items;
   the "Needs a newer DataPass" list), then AI-3 and AI-4.
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
   or a work view: [v3/07_WINDOWS_AND_POWER_OPS.md](v3/07_WINDOWS_AND_POWER_OPS.md) section 7 (a
   ready-to-paste prompt, effort "high"), a separate session in `D:\PROJ\PowerToy_UI`.
5. **Account qualification** (V1 gate 16, unchanged): Databricks validate, Fabric browse, Azure plan,
   VM over SSH — now also Azure Functions run-local/deploy and ADF Studio on a small STUDY slice.
6. Then 1.0.0. After 1.0: Restricted Mode and Remote-SSH/WSL desktop qualification, DiagramCloud and
   Grafana as optional modules (last, per Julian's priorities). Mongoku is frozen: it reads GitHub
   files and has no link with DataPass.

Ready-to-paste prompt: [v3/CLAUDE_PROMPT.md](v3/CLAUDE_PROMPT.md).

## 7. Rules that do not change

Local-first; Git-versioned configuration; manual AI exchange with exact bases and explicit review;
official/specialist tools do the work; discovery never executes project code; imported labels never
approve themselves; no credentials, auto-push, auto-merge, provisioning or authority writes without
explicit approval; no FOIL private material in this public repository. Full list: [CLAUDE.md](../CLAUDE.md).
