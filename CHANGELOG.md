# Changelog

DataPass Control Plane (VS Code extension). Detail per pass: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md);
status and next steps: [handoff/V3_HANDOFF.md](handoff/V3_HANDOFF.md).

## 0.20.0 — work orders (pass AI-2, 2026-09-25)

Design and Julian's answers: [handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md)
sections 3.2, 4, 5 and 13.1. Project files: the manifest (still v5) gains the optional `project.type`
and the `modules.workOrders` / `modules.pilot` switches (DataPass ≤ 0.19 reports them as unknown);
new committed file `.datapass/work-log.json` (format `datapass.work-log` 1). Only an order DataPass
wrote on this computer, unchanged since, can be launched.

- **AI view, three tabs**: **DataPass-guided** (the existing JSON exchange, still the default tab),
  **Agent** (work orders for Claude Code or Codex) and **Manual** (routes to Project, Git,
  readiness, Workbench, the official tool, Check for updates). Pilot mode stays a later option.
- **Work orders**: off by default (`datapass.ai.workOrders.enabled`, a machine setting a workspace
  can never turn on). Project type — `project.type` in the manifest, or `datapass.ai.projectTypes`
  by project id, which wins — decides the default: **dev** and **perso** have orders on and the
  agent merges its own PRs when CI is green; **work** (FOIL, clients) has them off unless the
  project sets `modules.workOrders: true`, and the person merges. `modules.workOrders: false`
  always turns a project off.
- **Writing an order**: goal, kind, scope (sub-project, component, board card, decision),
  repositories to change or read, agent (Claude Code or Codex) and effort, merge policy, an
  optional export-JSON attachment and which DataPass files the agent should return (in its pull
  request, or as files to import). DataPass writes `order.md` (the prompt) and `order.json` (a
  strict schema) under `.datapass/local/work-orders/<id>/` in the coordination repository
  (git-ignored), with a receipt the result must repeat.
- **Launch**: one modal, then the default is the **Claude desktop app** (prompt copied to the
  clipboard, `claude://code/new` opened, you pick the folder and paste); the **Codex app**
  (`codex:`) the same way; **Claude Code** or **Codex** in a VS Code terminal when configured.
  Pre-launch checks: trust, the setting, the project type, clones with a verified origin, the base
  commit still on `origin` after a fetch (else DataPass asks for a new revision), and a warning
  when another open order already changes the same repository.
- **Results**: a watcher plus a receipt check; pull requests are found by the planned branch
  (`dp/<id>` by default) through the Git module. **Needs you** in the Git view gains rule 8: a
  work order whose result names no pull request, or with neither a result nor a PR a day after
  launch. The Work orders view (5th Workbench view) lists every order with filters; its Details
  panel has the timeline, **Check the PR's DataPass files**, **Import a proposed file** (diff,
  confirm, backup), **Follow-up**, **Revise**, **Mark done**, **Abandon**, **Archive** (moved,
  never deleted) and **Copy for a chat**.
- **Entry points**: a board card ("Work order for this card"), an architecture option ("Apply this
  decision as a work order"), a component ("Prepare the missing files as a work order", in Details
  and the Project tree), and a failing PR in the Git view ("Work order to fix this").
- **Publish summary** writes `.datapass/work-log.json` (format `datapass.work-log` v1: ids,
  titles, dates, statuses, planned branches, PR links — never goal text, the agent's summary,
  paths or secrets) and, when `datapass.ai.workLog.privateRepository` is set, the same entry to
  `<private repository>/work-logs/<project id>.json` (refused for the public DataPass repository
  or a repository of the project; `gh` must say the repository is private, else DataPass asks).
  DataPass never commits or pushes either file.
- No MCP server in this pass (Julian's answer Q6 in section 13.1: kept as a later option).

## 0.19.0 — the Git module (pass AI-1, 2026-09-25)

Design and Julian's answers: [handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md)
sections 6, 8.6, 9 and 13.1. No project-file format change.

- **Git view** (left side bar, under Project, badge = items that need you): per repository of the
  project, the branch or detached HEAD, ↓behind ↑ahead, staged / unstaged / untracked changes, the
  last fetch, worktrees (clean or dirty, merged or PR closed), open PRs with their CI rollup and
  review, and the last three merges.
- **Needs you**, deterministic and ordered: failed CI, a green PR waiting, a merge not pulled here,
  changes on the default branch, a finished worktree (cleanup candidate, or work at risk), unpushed
  work, a detached HEAD.
- **Routes only**: Source Control, open in a new window, the PR or its failing check (web or the
  GitHub views), Check / Get updates, **Fetch all** (plain `git fetch`, never automatic, never
  `--prune`), copy a branch, and **copy the cleanup command** of a finished, clean worktree —
  DataPass never deletes.
- **Other repositories** under `datapass.projectsFolders` (at most 60), read when the section opens;
  a **Git card** on the Workbench overview.
- PRs from `gh` (`datapass.git.ghPath`, machine-level), `az` or `glab` when installed and signed in,
  read-only; otherwise the host's web pages. Read-only Git with `core.fsmonitor=false`, no optional
  locks, 5 s per command, four at once, nothing in Restricted Mode.

## 0.18.0 — toolchain, ID map, connections (2026-09-25)

Manifest **v5** (`schemaVersion: 5`). Design: [handoff/v3/08_TOOLKIT_AND_AGENTS.md](handoff/v3/08_TOOLKIT_AND_AGENTS.md)
sections 5.3 and 8; contract: [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) section 12.

- **Toolchain**: `toolchain.tools[]` (tool id, optional version range, `optional`, `where`: local, ci,
  fabric). New **Tools & versions** section in the Project view and the Workbench: each local tool
  is compared with this computer's probe (ok, outside the range, missing, version not read); CI,
  Fabric-notebook, desktop-app and Python-library tools are shown, not checked. Install commands
  (winget, Homebrew, pip, `code --install-extension`) are copied, never run. Unknown ids run nothing
  and get a "did you mean". A version outside its range is a warning on the operations that use the
  tool, never a blocker and never on reading.
- **`.vscode/extensions.json`** compared with the toolchain's extensions; *Show Recommended
  Extensions* opens VS Code's own list. DataPass never writes the file or installs anything.
- **ID map**: identifiers get `values` (one id per declared environment) and `kind`; every value
  follows the no-secret rules (the error names the environment, never the value). *Copy Identifier*
  asks which environment; a hover on any declared id in any file, and *DataPass: Look Up an Id…*,
  say which identifier and environment it is.
- **Connections**: `connections[]` of kind `sign-in`, `git-binding` or `cloud-connection`. New
  **Connections** section and *DataPass: Check Connections*: read-only, no prompt, only when asked —
  `az account show` (tenant and subscription compared with the ID map), `databricks auth profiles`
  (profile exists and is valid), `fab auth status` (signed in, tenant). Fixed commands run from the
  home folder with stdin closed and a timeout; no manifest value is ever an argument; credential
  files are never opened; the CLIs' output is reduced to a few fields (the account name and masked
  token prefixes are dropped). Bindings DataPass cannot observe are "declared, not checked", with the
  portal page to verify them. Sign-in commands are copied for the person to run.
- **AI packs** (preparation pack, Copy AI context, card packs), the environment snapshot and the
  readiness report carry the toolchain state, the ID map as logical ids and the connection states —
  names and states only.
- **Upgrade Project Manifest** moves v1–v4 to v5 with a backup copy (a v4 file only changes version).
- **Tool registry**: install hints for every CLI (winget ids checked with `winget show`), Power BI
  Studio, the Power BI extension pack and the Power BI Modeling MCP server added; probes now store
  the version number (`az version`'s JSON no longer shows as "{").
- **Power BI agentic plugins**: the 11 plugins of `data-goblin/power-bi-agentic-development`
  (custom-visuals, etl, fabric-admin, fabric-cli, goblin-mode, paginated-reports, pbi-desktop, pbip,
  reports, semantic-models, tabular-editor), with install commands for Copilot CLI and Claude Code.
- New example `examples/v3/sales-bi` (Fabric + Power BI, fabric-cicd, manifest v5).

## 0.17.0 — windows and work views

Company workspace file (one window per company), work views (save / apply), status-bar switcher,
`datapass.startupView`, floating Workbench, the Power Ops launcher list. PR #25.

## 0.16.0 — work and DevOps

`.datapass/board.json` and the Board (kanban) view, Azure DevOps / GitHub / GitLab address forms and
web pages, CI profiles, Mongoku frozen. PR #24.

## 0.15.1

AI exchange view in the secondary side bar, shown instead of Chat when a DataPass project opens. PR #23.

## 0.15.0 — architecture options and project sheet

`options.json` (compare, preview, record a decision), `sheet.json`, diagram orientation / lanes /
folding, JSON exchange with an AI (validated import, diff, backups), `vm` and `docker` providers. PR #22.

## 0.14.0 — environment readiness

Manifest v4 (`localEnv`, `identifiers`): Local environment and Readiness sections, names and states
only, *Open Power Ops*. PR #21.

## 0.13.1

No `$schema` line in prepared `.datapass/*.json`; DataPass explains an existing one. PR #19.

## 0.13.0 — V3 pass 1: the Project Workbench

Trust fixes from the 2026-09-25 audit, manifest v3 / graph 0.2, repository and file resolution,
Project tree, Architecture panel, Details, Workbench tab, Git update loop, preparation pack, catalog.
PR #18.

Earlier passes (0.8–0.12): see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
