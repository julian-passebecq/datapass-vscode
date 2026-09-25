# V3 — next passes and acceptance

## Done in 0.13.0 (V3 pass 1)

Trust fixes (F01, F03–F07, Windows executable search), manifest v3 and graph 0.2 with editor/runtime
parity, repository and file resolution across repositories, the Project tree, Architecture panel,
Details side bar and Workbench tab, component operations by phase and environment, the Git update
loop, the preparation pack, the catalog and project switching, Restricted Mode policy, Azure/databases
modules and profiles. Unit tests 200+, desktop 125/125 (6 fixtures, VS Code 1.138, Windows).

## Done in 0.14.0 (V3 pass 2, parallel session)

Environment readiness (manifest v4 `localEnv` / `identifiers`, Local environment and Readiness in the
Project view, env-file and Power Ops commands): PR #21, see IMPLEMENTATION_STATUS.md.

## Done in 0.15.0 (V3 pass 3)

Architecture options and scenarios (options.json: compare, preview on the diagram, record a decision,
AI contexts to compare or apply), project sheet (sheet.json), diagram orientation / lanes / folding,
JSON exchange with an AI (copy, validated import with diff and backup, restore), `vm` and `docker`
providers, Google tools named and probed. Unit 234, desktop 151 (7 fixtures). Design and readiness:
[06_VISION_AND_READINESS.md](06_VISION_AND_READINESS.md).

## Acceptance with Julian (before 1.0.0)

Run by Julian, reported with *Export Qualification Report* and a short note per step.

### A. Testlab project 4 — the multi-repository loop, offline (20 minutes)

`D:\PROJ\datapass-testlab\4-workbench-multi-repo\` — a script creates a small "GitHub" on disk, a
coordination repository, a sibling clone and an "AI" clone.

1. Open `research-hub` in VS Code. *DataPass: Workbench Layout*.
2. Check: Project view shows Papers pipeline, PDF extraction "missing requirements.txt", Simulation
   lab "not cloned", Archive infrastructure "planned".
3. Click PDF extraction in the diagram: the Details side bar shows the files and "Test: blocked".
   Click `function_app.py`: it opens in the editor. Click `requirements.txt`: explained, not created.
4. *Prepare AI context* → "Prepare the missing files" → Copy; read it: repository, folder, file, rules.
5. Run `simulate-ai-push.ps1` (plays the AI's merged pull request).
6. *Check for updates* → "Get updates" → confirm. `requirements.txt` is now found; Test moves on.
7. *Locate* the lab: pick `elsewhere/lab-clone`; then pick `elsewhere/not-the-lab` and see it refused.

### B. FOIL consumer on the real repositories

1. Commit the FOIL starter (ZIP) to `foil-v1-vscode-datapass`; clone `foil_databrick_dab` next to it.
2. Wind lab shows the bundle found and `.foil-lab/build/**` to generate; validate blocked with the
   producer named. STUDY shows its planned repository and components.
3. Prepare AI context on STUDY; ask ChatGPT for the first slice (extraction Function + tests) as a PR.

### B2. Testlab project 5 — architecture options, sheet and AI files, offline (25 minutes)

`D:\PROJ\datapass-testlab\5-options-architecture\` — `setup.ps1` copies the public research-library
example into a fresh Git repository. Scenarios table and preview, diagram toolbar, one decision recorded
(only options.json changes, a backup is kept), the Project sheet, an AI answer imported (and one with a
credential refused), a backup restored. Then the same views on the FOIL coordination repository.

### C. Account qualification (V1 gate 16, extended)

Databricks `bundle validate` (with the generated build), Azure Functions `func start` then a deploy to
a dev Function App, ADF Studio open with Git integration, Cosmos DB browse, MongoDB browse — each
recorded with *Record result*. Only the steps Julian can do on his accounts; nothing is inferred.

## Next implementation passes

0. **0.16.0 — work and DevOps.** `.datapass/board.json` (tasks, bugs, sprints, milestones; kanban view;
   cards open their component, file or environment; AI pack per card; DataPass writes only a card's
   status, with a backup). Git hosts: accept Azure DevOps https addresses with `<org>@`, recognise the
   https and ssh forms of one Azure DevOps repository as the same, web links (repository, pull
   requests, pipelines, boards) for GitHub, Azure DevOps and GitLab, CI profiles `github-actions`,
   `azure-pipelines`, `gitlab-ci` routed to the official extensions. Mongoku frozen (module off by
   default; doc: it reads board.json / project.json from GitHub). Grafana extension route.
   Then **0.17.0 — windows and work views** (06_VISION_AND_READINESS.md, section 2).
1. **From acceptance feedback.** Fix what A/B/B2/C reveal; desktop tests for Restricted Mode
   (launch without `--disable-workspace-trust`) and for the catalog quick pick.
2. **Remote hosts.** Qualify the Project view in Remote-SSH and WSL windows (paths, Git, probes on the
   remote host); document what runs where.
3. **Producer routes.** When FOIL decides (keep the forked FOIL Lab or extract a CLI), add a
   `generate` operation that routes to it with the snapshot/campaign inputs named (still run by Julian).
4. **Diagram editing (optional).** Only if the tree+diagram prove insufficient: reorder or group, never
   a canvas that rewrites native pipelines.
5. **Optional modules last.** DiagramCloud export of the V3 graph and Mongoku links per sub-project.
