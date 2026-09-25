# V3 — next passes and acceptance

## Done in 0.13.0 (V3 pass 1)

Trust fixes (F01, F03–F07, Windows executable search), manifest v3 and graph 0.2 with editor/runtime
parity, repository and file resolution across repositories, the Project tree, Architecture panel,
Details side bar and Workbench tab, component operations by phase and environment, the Git update
loop, the preparation pack, the catalog and project switching, Restricted Mode policy, Azure/databases
modules and profiles. Unit tests 200+, desktop 125/125 (6 fixtures, VS Code 1.138, Windows).

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

### C. Account qualification (V1 gate 16, extended)

Databricks `bundle validate` (with the generated build), Azure Functions `func start` then a deploy to
a dev Function App, ADF Studio open with Git integration, Cosmos DB browse, MongoDB browse — each
recorded with *Record result*. Only the steps Julian can do on his accounts; nothing is inferred.

## Next implementation passes

1. **V3 pass 2 — from acceptance feedback.** Fix what A/B/C reveal; desktop tests for Restricted Mode
   (launch without `--disable-workspace-trust`) and for the catalog quick pick.
2. **Remote hosts.** Qualify the Project view in Remote-SSH and WSL windows (paths, Git, probes on the
   remote host); document what runs where.
3. **Producer routes.** When FOIL decides (keep the forked FOIL Lab or extract a CLI), add a
   `generate` operation that routes to it with the snapshot/campaign inputs named (still run by Julian).
4. **Diagram editing (optional).** Only if the tree+diagram prove insufficient: reorder or group, never
   a canvas that rewrites native pipelines.
5. **Optional modules last.** DiagramCloud export of the V3 graph and Mongoku links per sub-project.
