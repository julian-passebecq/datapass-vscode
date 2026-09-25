# DataPass — global vision and readiness (2026-09-25, with 0.17.0)

Written after Julian's request to "have the global vision of the app", to compare architecture
alternatives, and to check whether every step of a real project is ready (DevOps, GitHub, Grafana,
Mongoku, DiagramCloud, windows and workspaces, AI exchange, backups, bugs). The repository wins over
this document when they disagree. Version line: 0.14.0 (environment readiness, manifest v4, PR #21),
0.15.0 (architecture options, project sheet, PR #22), 0.15.1 (AI exchange view, PR #23) and 0.16.0
(work and DevOps: board, Git hosts, CI profiles, Mongoku frozen, PR #24) are merged; **0.17.0
(windows and work views) is this pass**.

## 1. What DataPass is, in one picture

```text
  ChatGPT / Claude ──prepares──► Git host (GitHub · Azure DevOps · GitLab)
     ▲   (options, sheet, graph,        coordination repo (.datapass/*.json) + native repos
     │    native files, fixes)                 │ clone · fetch · fast-forward (explicit)
     │                                         ▼
     │  packs · JSON copy/import      DataPass VS Code ── observes disk + Git (read-only)
     └────────────── you ◄───────────── shows · compares · checks · routes
                      │                        │
                      ▼                        ▼
        official extensions / CLIs / portals (Databricks, Azure Functions, ADF Studio, Cosmos DB,
        MongoDB, Neon, Fabric, Power BI, Google Cloud Data Agent Kit, Remote - SSH, Container Tools…)
        + Power Ops (local vault for secrets; DataPass never reads a value)
                      │
                      ▼
        clouds and machines (Azure, Databricks, Fabric, Google Cloud, Oracle VM, Docker on the PC)
```

DataPass never decides an architecture, never computes a price or a formula, never deploys, never
pushes, holds no credential. The AI prepares; DataPass shows what exists, what is missing, what each
alternative would change, and routes to the official tool; the person decides and runs.

## 2. Julian's vocabulary and what VS Code really allows

| Julian says | What VS Code allows | DataPass today (0.17) | Next |
|---|---|---|---|
| **Entreprise** (FOIL, DataPass, a client) | One **window** per workspace. A multi-root `.code-workspace` puts every repository of a company in that window. A **VS Code Profile** can give the window its own extensions and settings; `workbench.colorCustomizations` in the workspace file can colour its title bar. Opening another workspace in the same window reloads it (extensions restart). | *Create the Company Workspace File (one window per company)…*: repositories found on this machine, folders relative to the file, a title-bar colour, an optional startup work view, kept up to date for Power Ops. **1 window = 1 company** is the recommended mapping, as Julian suggested; *Switch Project* still opens another project in a new window. | Its own PowerToy_UI task (section 6). |
| **Projet / workspace** (FOIL STUDY, wind lab) | Folders of the window. | A DataPass project (coordination repository) and its **sub-projects** in the Project tree; *Select Project Folder* when a window holds several; the status-bar switcher switches sub-project or project in one click. | — |
| **Onglet** = a whole screen (tree left, editor centre, right and bottom panes) | No such concept: a window has one layout. Inside it: editor **groups** and **tabs**; extensions can set the editor grid (`vscode.setEditorLayout`), open files in given groups, focus or hide views, maximise the panel. | **Work views**: named saved layouts (selected sub-project and component, editor grid and files per group, the Workbench tab, which DataPass views are shown, diagram orientation/grouping/preview), applied in one click from the status bar. *Save Work View…*, *Apply Work View…*, *Manage Work Views*. | — |
| **Nouvelle fenêtre en restant dans la même** | **Floating windows** (VS Code ≥ 1.85): an editor tab — a file or the Workbench tab — moves to its own window that stays part of the same VS Code window and workspace (*Move Editor into New Window*). Side bar and panel views cannot float. | *Open the Workbench in a Floating Window*, for a second screen; a work view can save it floating. | — |
| **Bouton en haut à gauche** pour changer d'entreprise | Extensions cannot add title-bar buttons. They can add **status-bar items** (bottom left) and view-title buttons. | `$(briefcase) <Company> · <Sub-project> ▾` status-bar switcher: work views, sub-projects, other projects, floating Workbench, create company workspace, export for Power Ops. | — |
| **Save state** reopened from **Power Ops** (PowerToy_UI) | Power Ops' Tool Launcher can run `code` with a `.code-workspace` file. `vscode://` links are routed to the last active window, not to a chosen workspace, so they are not reliable for this. | The workspace file carries `"datapass.startupView": "<work view>"`, applied when the window opens; *Export Company Workspaces for Power Ops* writes the machine-local, secret-free JSON list Power Ops reads, kept up to date afterwards. Full contract: [07_WINDOWS_AND_POWER_OPS.md](07_WINDOWS_AND_POWER_OPS.md). | Its own PowerToy_UI task: read the list, open a company or a view (section 6). |
| **Cliquer une tâche et aller au bon endroit** | Open a file in a group or a floating window, reveal a view, open a folder in a new window. | Components open their files; repositories and component folders open in a new window; since 0.16.0, board cards link to their components, files and environments and open them the same way. | — |

## 3. A real project, with its round trips

1. **Frame the need.** *Prepare AI context* (component or sub-project) or *Copy a DataPass File for
   the AI* gives ChatGPT/Claude the exact state, never local paths or secrets.
2. **Alternatives.** The AI writes `.datapass/options.json` (2–3 options per level, prices with source
   and date) in a PR or as a pasted JSON answer. DataPass compares them: tables, whole-architecture
   scenarios, a preview on the diagram (new / changed / removed), official tools to install, DataPass
   support, declared costs.
3. **Decide.** *Record an Architecture Decision* writes `chosen` + date + rationale in options.json
   (backup kept). Commit it.
4. **Apply.** *Ask the AI to apply this decision*: the AI changes graph.json (current option), the
   native files and options.json in one PR. Merge it → *Check for updates* → *Get updates*
   (fast-forward only). The Project view shows which files are there and which are missing.
5. **Prepare the machine.** Local environment (0.14.0): the env files and variable names the project
   declares, set or missing on this machine; secrets are filled from the Power Ops vault, never read
   by DataPass.
6. **Run with the official tools.** Install the extensions DataPass names, sign in, run test →
   validate → deploy **dev** → run in the official tool; *Record result* keeps what worked, bound to
   those files and that target (a changed file makes it stale).
7. **Bugs and back-and-forth (0.16).** A card on the board (bug, component, file, environment) →
   AI pack for that bug (with the error text you paste, scrubbed) → fix PR → merge → *Get updates* →
   run again → record → close the card. Versions are branches and tags in Git; DataPass shows branch
   and commit per repository; a rollback is a `git revert` in Source Control — DataPass never
   rewrites history.
8. **Production.** Declared environments; reviews and results never carry over from dev to prod.
9. **Operate (optional).** Grafana dashboards per sub-project (links today); resource/VM monitoring later.
10. **Document (optional, last).** DiagramCloud through the reviewed bridge.
11. **Steer (outside DataPass).** Mongoku reads the planning/board files the AI keeps in GitHub.

## 4. Readiness, step by step

✓ ready · ◐ partial · ✗ not yet · ⏸ frozen by decision

| Area | Status | What exists | What is missing (pass) |
|---|---|---|---|
| AI prepares the project in Git (manifest, graph, native files) | ✓ | contract, schemas, examples, packs | — |
| Getting the AI's work | ✓ | Check / Get updates (fast-forward only) | — |
| AI exchange without an API ("cheap MCP") | ✓ | packs; options compare/apply packs; copy a DataPass file + import the answer (validated, diff, backup) | real MCP server: optional, later |
| Local environment (env files, variable names, non-secret ids) | ✓ | 0.14.0: manifest v4 `localEnv` / `identifiers`, Local environment and Readiness sections, names and states only, *Open Power Ops* | — |
| Architecture options and scenarios | ✓ | options.json, comparison, preview, decision record | DiagramCloud export of scenarios (later) |
| Project sheet (volumes, key columns, formulas, runtimes) | ✓ | sheet.json, Sheet view, Details, packs | — |
| Diagram views | ✓ | horizontal / vertical, lanes (sub-project, repository, cloud, level), fold lanes and parents | manual reordering (only if needed) |
| Backups | ✓ | named backups of every DataPass write, restore; Git for the rest | — |
| GitHub repositories | ✓ | clone, locate, fetch, fast-forward; PR/Actions links and GitHub Pull Requests / GitHub Actions extension routes (0.16.0) | — |
| Azure DevOps (Azure Repos) | ✓ | the https-with-organization address Clone copies and the SSH form are accepted and recognised as one repository identity (0.16.0); web links (repository, pull requests, pipelines, boards); Azure Pipelines YAML via the official extension `ms-azure-devops.azure-pipelines` (0.16.0 profile). Azure Boards: Microsoft's VS Code extension was archived in 2023 → the web portal, or the DataPass board for what the project itself tracks. | — |
| GitLab | ✓ | Git works; web links (repository, merge requests, pipelines, issues); `gitlab-ci` profile (0.16.0). GitLab Workflow has no pipeline view: pipelines stay on GitLab. | — |
| Databricks, Azure Functions, ADF, Storage, Cosmos DB, MongoDB, PostgreSQL/Neon, Fabric, Power BI | ✓ interface / ✗ accounts | operations by phase, routing, preflight | account qualification by Julian (V1 gate 16) |
| Google Cloud (Storage, BigQuery) | ◐ | recognised; official tool named and probed (Data Agent Kit, gcloud) | no DataPass operations (only if a project adopts it) |
| VMs | ✓ | `vm` provider: Remote - SSH from the graph's `sshHost`; Work-view SSH resources | Remote-SSH window qualification |
| Docker on the PC | ◐ | `docker` provider, Container Tools view | compose run routes (if a project adopts it) |
| Board / bugs / sprints (kanban) | ✓ | 0.16.0: `board.json`, kanban view, filters, card → component/file/link, AI pack per card, moving a card writes only its status | — |
| Grafana | ◐ | dashboard links per sub-project; the "Edit in Grafana" route verified (0.16.0: `grafana-vscode.openUrl` on a dashboard file — its extension has no view container, so there is no side-bar route) | VM monitoring later (optional) |
| DiagramCloud | ◐ | reviewed bridge for the graph; optional companion in Readiness | options/sheet export (optional, last) |
| Mongoku | ⏸ | off by default for new manifests since 0.16.0 (`modules.mongoku: false`); reads `board.json`/`project.json` from GitHub; optional companion in Readiness (0.14.0) | nothing more in DataPass |
| Windows, work views, Power Ops launcher | ✓ in DataPass | company workspace file, work views, status-bar switcher, `datapass.startupView`, floating Workbench, Power Ops export (0.17.0) | Power Ops side: its own task (PowerToy_UI, section 6) |
| Restricted Mode, Remote-SSH/WSL desktop qualification | ✗ | policy implemented | qualification pass |

## 5. The board contract, implemented in 0.16.0

`.datapass/board.json` in the coordination repository, prepared by the AI and moved by the person;
Mongoku (or any other viewer) can read it from GitHub without talking to DataPass. Full contract, what
DataPass computes and what it writes: [docs/PREPARING_A_PROJECT.md](../../docs/PREPARING_A_PROJECT.md)
section 10.

```json
{
  "format": "datapass.board", "version": "1",
  "columns": [ { "id": "backlog" }, { "id": "todo" }, { "id": "doing" }, { "id": "review" }, { "id": "done" } ],
  "sprints": [ { "id": "s3", "title": "STUDY pilot", "start": "2026-10-01", "end": "2026-10-14", "goal": "First 100 PDFs extracted" } ],
  "milestones": [ { "id": "pilot", "title": "STUDY pilot reviewed", "due": "2026-10-31" } ],
  "items": [
    { "id": "bug-12", "type": "bug", "title": "Pages over 230 s time out in ADF", "status": "doing", "priority": "P1",
      "components": ["extract"], "files": [ { "repoRef": "study", "path": "functions/pdf_extract/function_app.py" } ],
      "environment": "dev", "sprint": "s3", "due": "2026-10-10",
      "links": [ "https://dev.azure.com/<org>/<project>/_workitems/edit/12" ] }
  ]
}
```

Types: task, bug, feature, decision, question. DataPass shows a kanban (columns, filters by
sub-project, sprint and type), opens a card's component or file, prepares an AI pack for a card, and
writes only the card's `status` (with a backup) when the person moves it.

## 6. Passes

| Pass | Content | State |
|---|---|---|
| 0.14.0 | environment readiness: manifest v4 `localEnv` / `identifiers`, Local environment and Readiness, *Open Power Ops*, *Copy Project ID* (parallel session) | merged, PR #21 |
| 0.15.0 | architecture options and scenarios, project sheet, diagram orientation / lanes / folding / preview, JSON exchange with backups, `vm` and `docker` providers, Google tools named | merged, PR #22 |
| 0.15.1 | AI exchange view in the secondary side bar, shown instead of Chat (parallel session) | merged, PR #23 |
| 0.16.0 — work and DevOps | board (kanban) + bug/task packs; Git hosts: Azure DevOps URL forms, GitHub/Azure DevOps/GitLab web links (repository, pull requests, pipelines, boards), CI profiles (`github-actions`, `azure-pipelines`, `gitlab-ci`); Mongoku frozen (module off by default, doc: it reads GitHub files); Grafana extension route (parallel session) | merged, PR #24 |
| **0.17.0 — windows and work views** | company workspace file, work views (save / apply), status-bar switcher, `datapass.startupView`, floating Workbench, the Power Ops launcher contract (PowerToy_UI in its own session) | this pass |
| Acceptance with Julian → **1.0.0** | testlab 4 to 7, FOIL on the real repositories, account qualification | — |
| Later, optional | DiagramCloud export of scenarios, Grafana VM monitoring, a read-only DataPass MCP server | — |

## 7. What stays out, on purpose

Automatic architecture choices, fetched prices, scientific computation in TypeScript, deployment,
push or merge by DataPass, credentials anywhere in DataPass files, any connection to Mongoku or
Mongo, AWS (out of scope for now).
