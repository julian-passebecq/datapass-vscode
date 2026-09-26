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

## Done in 0.15.1

AI exchange view in the secondary side bar, shown instead of Chat when a DataPass project opens (PR #23).

## Done in 0.16.0 (V3 pass 4)

Board (`.datapass/board.json`: columns, sprints, milestones, cards; kanban view with drag-and-drop
and filters; moving a card rewrites only its `status`; AI pack per card). Git hosts: Azure DevOps
https-with-organization and SSH addresses recognised as one repository identity, web links for
GitHub/Azure DevOps/GitLab (repository, pull/merge requests, pipelines/Actions, boards/issues). CI
profiles `github-actions`, `azure-pipelines`, `gitlab-ci` routed to the official extensions or the
host's runs page. Mongoku frozen (`modules.mongoku: false` in prepared manifests). Grafana's "Edit in
Grafana" route. Unit 249, desktop 172 (8 fixtures, new `v3-devops`). Design and readiness:
[06_VISION_AND_READINESS.md](06_VISION_AND_READINESS.md).

## Done in 0.17.0 (windows and work views)

Company workspace file (one window per company), work views (save / apply / manage, machine-local),
the status-bar switcher, `datapass.startupView`, the Workbench in a floating window, and the Power
Ops launcher list — on top of 0.16.0. Unit 268, desktop 200 (9 fixtures). Full detail and the launcher contract:
[07_WINDOWS_AND_POWER_OPS.md](07_WINDOWS_AND_POWER_OPS.md).

## Done in 0.18.0 (toolchain, ID map, connections)

Manifest v5: `toolchain` (tools, version ranges, where they run), identifiers with a value per
environment and a kind (the ID map), `connections` (sign-ins checked read-only on request with
`az account show`, `databricks auth profiles`, `fab auth status`; Git bindings and cloud connections
declared, not checked). Tools & versions and Connections in the Project view and the Workbench,
`.vscode/extensions.json` comparison, AI pack fields, the 11 data-goblin plugins, example
`examples/v3/sales-bi`. Design: [08_TOOLKIT_AND_AGENTS.md](08_TOOLKIT_AND_AGENTS.md) section 8;
contract: `docs/PREPARING_A_PROJECT.md` section 12.

## Done in 0.24.0 (2026-09-26)

Pass AI-3 (PLAN row AI-3, PR #46): the Claude & Codex panel (quick links, Claude Control on/off with
the off message, plan usage, this project's conversations, PRs, urgent alerts, À faire; surface
`view.agentPanel` in DataPass and Advanced), Claude Control's conversation, link type (exact,
/desktop, marker) and tokens in the Work orders view through `GET /api/work-orders`, and the Codex
hand-off (`codex app <folder>` when a Codex CLI exists). Control is read over loopback only, while
someone looks. Unit 418, desktop 325. Next: AI-4 (pilot, read-only). See IMPLEMENTATION_STATUS.md.

## Done in 0.23.0 (2026-09-26)

The toolkit catalogue (PLAN T1–T4, PR #43): `datapass.toolkit` 1 files in the hub repository over a
built-in baseline that dates the free tier and prices of every known tool (read 2026-09-26, *unknown*
when not confirmed); the Workbench's Toolkit view, tools and recipes in Details, `recipe` / `route` on
board items with the steps on the card, prices in Options, Readiness links; "Needs a newer DataPass"
from `datapassRequests` and from files written for a newer DataPass; mode surfaces `workbench.toolkit`,
`project.toolkit`, `badge.hubChanged`. Variants (package G, PR #39). Unit 409, desktop 319 on 15
fixtures. See IMPLEMENTATION_STATUS.md.

## Done in 0.22.0 (night of 2026-09-26)

Five packages of [10_GLOBAL_IMPROVEMENT_PLAN.md](10_GLOBAL_IMPROVEMENT_PLAN.md): A trust repairs
F01–F08 (#36), B modes Vanilla / Standard / DataPass / Advanced (#37), C Copy Context for My AI from
any file (#34), D format checks without execution (#35), F file versions (#38). No 0.21.0: the toolkit
catalogue moves to 0.23. Detail: IMPLEMENTATION_STATUS.md.

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

### B3. Testlab project 6 — board and DevOps, offline (25 minutes)

`D:\PROJ\datapass-testlab\6-board-devops\` — `setup.ps1` copies the public `research-library` and a
new `shop-platform` example (one repository per Git host, with two neighbour clones whose origin uses
a different address form than the manifest declares) into fresh Git repositories. Follow its own
`LISEZ-MOI.md`: the Board view (kanban, filters, drag a card, AI pack for a bug with a scrubbed error,
`Shift+←`/`Shift+→`, Project tree section), the Details side bar's board count, Git host links per
repository and per CI pipeline (GitHub, Azure DevOps declared with the Clone address but cloned over
SSH, GitLab), the official CI extensions when installed, Mongoku frozen on a freshly initialized
manifest, and, optionally, the real FOIL Azure DevOps repository's Clone address.

### B4. Testlab project 7 — windows and work views, offline (20–25 minutes)

`D:\PROJ\datapass-testlab\7-fenetres-vues\` — `setup.ps1` builds a small "GitHub" on disk and two
companies (Research Co: `research-hub` + a cloned `research-pipeline`; Catalogue Co:
`catalog-import`). Create the company workspace file (relative folders, a title colour), build two
work views and switch between them from the status bar, a startup view applied on reopen, the
Workbench in a floating window (drag to a second screen is the one physical check), a second
company with its own colour, export the Power Ops list, then `simulate-power-ops.ps1` opens a
company and applies one of its work views without installing Power Ops. Guide:
`D:\PROJ\datapass-testlab\7-fenetres-vues\LISEZ-MOI.md`.

### B5. Testlab project 8 — tools, ID map and connections (≈ 20 minutes)

`D:\PROJ\datapass-testlab\8-outils-connexions\` — `setup.ps1` copies the public `sales-bi` example
into a fresh Git repository. Tools & versions before installing anything (`az` and `fab` missing,
install commands copied), `.vscode/extensions.json` and VS Code's Recommended list, the ID map (copy
per environment, hover on a GUID in `parameter.yml`, Look Up an Id), Connections before and after
installing `az` / `fab` and signing in (another tenant first, then the real tenant and subscription
ids put in the lab's ID map), a secret pasted as an identifier refused without being echoed, the AI
pack's names-and-states section, and optionally a Databricks CLI profile. Guide:
`D:\PROJ\datapass-testlab\8-outils-connexions\LISEZ-MOI.md`.

### B6. Testlab project 9 — modes, context from any file, format checks, file versions, variants, offline (≈ 25 minutes)

`D:\PROJ\datapass-testlab\9-modes-contexte-versions\` — `setup.ps1` builds the research project from
scratch as two repositories with offline GitHub origins (bare repositories on disk, `insteadOf`):
`research-hub` (bridge, `notes/decisions.md` with three commits, a `checks-demo/` folder) and
`research-pipeline` (code); `simule-mise-a-jour.ps1` plays an AI merging one PR in each. Steps: the
four modes (Standard on a new install, the status item, switch, customize and reset, no file written,
a manifest error still shown in Vanilla); Copy Context for My AI on a native-repository file, a
selection in an unsaved buffer (secret redacted) and an untitled buffer; format checks (a broken
`databricks.yml`, a Dockerfile `COPY` of a missing folder, broken YAML → Problems; fixed → cleared;
the copy-only `databricks bundle validate` quick fix); file versions (Open Version…, Compare, Open
Latest Version before and after Check for updates, Get updates, Changed by the Last Update…); variants
(preview banner pill in Standard, Selected architecture / All variants in DataPass mode, coding state
following files created in the pipeline clone). Section 7 "Toolkit (0.23)" is a placeholder filled at
the 0.23.0 release. Steps without human judgement were replayed in a desktop VS Code on a throwaway
profile (`verification-claude/run.ts`, run from a built checkout) and are marked "vérifié par Claude".
Guide: `D:\PROJ\datapass-testlab\9-modes-contexte-versions\LISEZ-MOI.md`.

### B7. Testlab project 10 — client journeys, the FOIL/MCP review acceptance (D-28), offline (≈ 20 minutes)

`D:\PROJ\datapass-testlab\10-parcours-client\` — `setup.ps1` builds the public `examples/v3/doc-pipeline`
from scratch, split the way a client project is: a bridge `doc-pipeline` (only `.datapass/`: manifest
with two native repositories, graph, options A/B/C) and two native repositories cloned next to it,
`doc-orchestration` (A's script, B's Function without `host.json`) and `doc-processing` (declared in SSH,
cloned in https); C's `factory` repository is planned. Offline GitHub origins (bare repositories on
disk, `insteadOf`); one extra component, a Google Drive report (unsupported provider).
`ouvre-depuis-bridge.ps1` is the manual equivalent of V1-ON's *Open a Client Project…* (clone the
bridge, read the manifest, clone the declared non-planned repositories, write a 3-root workspace file;
idempotent) until that command is on main. Steps: (2) a plain client repository works with DataPass
disabled, no DataPass file in native repositories; (3) open from the bridge, both clones found
(SSH/https equivalence); (4) preview A → B → C: status bar, tree, Details, Copy Context line, C's
planned repository, nothing written; (5) missing clone → `unbound`, files never `missing`; (6) a clone
without origin, *Locate an Existing Clone* → `unverified`, still browsable; (7) a modified file → the
repository counts one change and the pack says "modified, not committed"; (8) unsupported tool → "not
supported yet", no operation; (9) B with every file present → "files present", "not a decision, not a
deployment", "Live route: not observed" (0.25.0, R-04); (10) `.vscode/mcp.json` → "MCP registration file
present", never connected; the MCP evidence card (E1, PR #67) and the *Open a Client Project…* command
(V1-ON, PR #68) are marked 0.27+. Every non-visual step ran in a desktop VS Code on a throwaway profile
(`verification-claude/run.ts`; 10/10 on the installed 0.25.0 VSIX and on main 2026-09-26; set
`DATAPASS_EXT_DIR` to an unzipped VSIX to test a published build) and is marked "vérifié par Claude";
findings for V1-STAB are listed at the end of the guide and in `handoff/v3/night/v1-t10.md`.
Guide: `D:\PROJ\datapass-testlab\10-parcours-client\LISEZ-MOI.md`.

### C. Account qualification (V1 gate 16, extended)

Databricks `bundle validate` (with the generated build), Azure Functions `func start` then a deploy to
a dev Function App, ADF Studio open with Git integration, Cosmos DB browse, MongoDB browse — each
recorded with *Record result*. Only the steps Julian can do on their accounts; nothing is inferred.

## Next implementation passes

**2026-09-26: [10_GLOBAL_IMPROVEMENT_PLAN.md](10_GLOBAL_IMPROVEMENT_PLAN.md) wins over this list.**
0.22.0 is done (A, B, C, D, F; see above). **0.23** = G variants (coding state per option and
scenario, the architecture-scoped tree with *All variants*; PR #39) **and the toolkit catalogue**
(item 0 below; it missed the 0.22 cut-off and there is no 0.21.0). V2 from the plan's §3: the bridge
recommends a preset and surfaces (manifest v6 `presentation`), presets and checklists shipped from the
hub, check plans with evidence rows, coordinated change sets shown linked (native PR ↔ bridge PR),
cost lines linked to toolkit ids, a vetted Python syntax check, a company-level diagram, Remote-SSH /
WSL qualification, variants on another branch or tag (J5). The items below stay as the V2/V3 backlog.

0. **Order (Julian, [09](09_AI_MODES_WORK_ORDERS_GIT.md) §13.1):** 0.19.0 the Git module (AI-1, its
   own session), AI-2 work orders, then the **toolkit catalogue** (now 0.23)
   ([08_TOOLKIT_AND_AGENTS.md](08_TOOLKIT_AND_AGENTS.md) sections 5.1, 5.2, 5.4): the catalogue and
   recipes as dated data in the hub repository (`.datapass/toolkit/tools.json`, `recipes/*.json`)
   over the built-in baseline of 0.18, with each tool's free tier and pricing (`freeTier`,
   `pricingUrl`, `tiers[]`, `checkedAt`), shown in Details, board cards and Options; `recipe` on
   board items (a board contract change); the "Needs a newer DataPass" list from `datapassRequests`.
   The toolchain of 0.18 already names tools by the ids the catalogue will describe.
1. **PowerToy_UI task (Power Ops launcher), separate repository.** Read the company-workspaces list
   DataPass exports (contract: [07_WINDOWS_AND_POWER_OPS.md](07_WINDOWS_AND_POWER_OPS.md) section 7),
   show companies (with their colour) and their work views in the Tool Launcher, open a company or a
   view exactly as the contract says, refresh when the file changes. Never writes anything else in a
   DataPass folder. Effort: high. A ready-to-paste prompt is in section 7.
2. **From acceptance feedback.** Fix what A/B/B2/B3/B4/B5/B6/C reveal; desktop tests for Restricted Mode
   (launch without `--disable-workspace-trust`) and for the catalog quick pick.
3. **Remote hosts.** Qualify the Project view in Remote-SSH and WSL windows (paths, Git, probes on the
   remote host); document what runs where.
4. **Producer routes.** When FOIL decides (keep the forked FOIL Lab or extract a CLI), add a
   `generate` operation that routes to it with the snapshot/campaign inputs named (still run by Julian).
5. **Diagram editing (optional).** Only if the tree+diagram prove insufficient: reorder or group, never
   a canvas that rewrites native pipelines.
6. **Optional modules last.** DiagramCloud export of the V3 graph and Mongoku links per sub-project.
