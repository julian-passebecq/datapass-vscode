# DataPass VS Code — v1 handoff (2026-09-25)

**Start here.** For *status and next steps*, this replaces every earlier "start here" (the V2.2
handoff's status notes, the claude.ai v0.9.0 notes, and the GPT 2026-09-25 handoff and
"0.9.3 review kit"). The [V2.1](V2_1_HANDOFF.md) and [V2.2](V2_2_HANDOFF.md) documents remain the
**architecture reference**. What the code does today is in
[IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## 1. What is what

| Name | What it is | Where |
|---|---|---|
| **DataPass VS Code** (this repo) | VS Code control plane for real cloud projects: scopes, per-operation preflight, routing to the official tools (Fabric, Databricks, Power BI, Grafana, IaC, SSH), contracted exchanges with AI and external apps | `julian-passebecq/datapass-vscode`, `D:\PROJ\datapass-vscode` |
| `D:\PROJ\datapass-vscode-bridge` | **Not a separate repo.** A git *worktree* of this repo with PR #11's branch checked out. Its content is now integrated here; the folder can be removed after the 0.9.3 PR merges (`git worktree remove`) | same repo |
| DataPass Mosaic / Workbench | A different extension (learning, notebooks, local data lab) | `datapass-mosaic-vscode` |
| DiagramCloud | Visual architecture/task editor; owns the grammar of `.datapass/diagramcloud.json` | `julian-passebecq/diagramcloud` |
| Mongoku (DataPass fork) | Multi-organization portfolio / project-resume cockpit over the DATAPASSCONTROL Mongo data | `julian-passebecq/Mongoku-datapass` |
| Power Ops | Windows launcher, separate product | `PowerToy_UI` |
| FOIL | A client with its own authorities (science, business, Mongo PM). DataPass supports it through an optional pack; it is not the product | `foil-*` repositories |

## 2. Version chronology

| Version | What | State |
|---|---|---|
| 0.8.0 | Pass 8 (Codex): health-first Galaxy | main, superseded |
| 0.9.0 | Pass 9 by claude.ai chat: V2.2 contracts, preflight, Work view | merged into main in PR #10. **The `datapass-vscode-v0.9.0.*` files in Downloads are obsolete; do not install that VSIX** |
| 0.9.1 | Pass 9.1 (Claude Code): Windows fixes, real desktop test harness | PR #10 |
| 0.9.2 | Pass 9.2: blank Galaxy fixed, whole-project scope fixed, end-to-end flows | PR #12, main `6bce8b8` |
| "0.91" | Requested in a chat after 0.9.2 already existed | superseded, nothing to build |
| GPT "0.9.3 review kit" | Overlay proposal (Mongoku/Grafana companions) | reviewed; ideas kept, design corrected (see IMPLEMENTATION_STATUS) |
| 0.9.3 | DiagramCloud bridge (PR #9 + #11) on main, Grafana links, Mongoku Lite, Open-in-DataPass link | PR #13, main `83c41e0` |
| **0.10.0** | Pass 10a: per-project modules (Choose Project Modules) | branch `claude/pass-10a-modules` |
| 1.0.0 | When the gates in section 3 pass | — |

## 3. What "v1" means, and where we are

v1 = one dependable engineering cockpit for a real project: which scope is active, what is next,
which native tools/accounts an operation needs and why it is blocked, which outputs a change makes
stale, and what bounded context to hand to Claude/ChatGPT. Local-first, useful without any
database or paid AI API, and equally usable for a non-FOIL project.

| # | Gate | Status | Evidence, or what is left |
|---|---|---|---|
| 1 | One VSIX on current main, consistent versions, old tests kept | Done | 0.9.3; 151 unit and 82 desktop tests |
| 2 | Work and Galaxy coherent; whole project selectable; empty/invalid workspaces useful | Done | desktop fixtures `empty`, `broken`, `v1-foil`, `v2-retail` |
| 3 | Manifest v1/v2, scopes, graph, declarative packs, journaled migration | Done | |
| 4 | **Shared resource vs workload binding** (one Oracle VM serving Wind and Hydro with different repos, Compose files, env names, SSH folders) | **Open** | not modeled yet: each platform holds one binding. Design: [v2.1/02 §7](v2.1/02_ITEMS_ARTIFACTS_AND_CATALOG.md) |
| 5 | Repositories: local/remote-only, branch, base, dirty; unknown stays unknown; no auto-clone | Partial | base capture and remote observation exist; no per-repository status rows in the Work view |
| 6 | Readiness per operation, identical in Work and Galaxy | Done | 21 registry operations; desktop suite asserts equality |
| 7 | Native assets routed, never executed (notebooks, pipelines/DAGs, PBIP, bundles) | Partial | PBIP/PBIR/TMDL graph, bundle detection, Fabric deploy config exist; **no static notebook or Airflow DAG inventory yet** |
| 8 | AI / external-app loop: bounded context, exact base, preview, candidate/quarantine, journal | Done | app exchange, AI context, bridge AI plan (desktop-tested) |
| 9 | Contracts and output impact | Done in core | FOIL pack stays a draft until FOIL declares facets and dependencies |
| 10 | DiagramCloud bridge | Done in code | a manual open/save round trip in DiagramCloud is still to do |
| 11 | Mongoku Lite | Done in code | try it with real Mongoku data |
| 12 | Grafana | Done in code | try one real stack/dashboard; datasource/alert IaC stays documented-only |
| 13 | FOIL boundaries (no physics/LCOE/accounting in TypeScript; generated ≠ accepted) | Done | |
| 14 | Non-FOIL portability | Done on fixtures | try one real non-FOIL project |
| 15 | Delivery: VSIX, full source archive, status | Done for 0.9.3 | |
| 16 | **Signed-in qualification**: Fabric browse/capture, Databricks `bundle validate`, Power BI Desktop with a PBIP, Grafana, Mongoku | **Open — needs Julian** | record each result as an observation per capability |

## 4. Next passes, in order

1. ~~Merge 0.9.3~~ — done: PR #13 merged, #9/#11 closed, bridge worktree removed, DiagramCloud lock re-pin in diagramcloud PR #7.
2. ~~Pass 10a — per-project modules~~ — done in 0.10.0: `modules` block + *Choose Project
   Modules*; Galaxy, Work, Links and health follow it. The cloud core (Fabric, Databricks, Azure,
   notebooks) comes first; Mongoku and DiagramCloud are optional add-ons.
3. **Pass 10b — resources and bindings (gate 4).** Manifest v2 `resources` (e.g. an Oracle VM:
   SSH host alias, OS, owner) and `bindings` (resource × workload/scope: repository, working
   folder, Compose file, *names* of required env variables, processes). Work view "Resources"
   rows; the Remote-SSH hand-off opens the right host and folder (today the Galaxy "Remote SSH"
   action only opens VS Code's generic remote menu and ignores `platforms.oracle.sshHost`);
   preflight facts per binding;
   a host-level operation (reboot, upgrade) shows its impact on every binding of that resource.
   Never store secrets or env values.
4. **Pass 11 — static inventory (gates 5, 7).** Per-repository status rows (branch, HEAD, dirty,
   remote-only); a static list of notebooks (`.ipynb`, Fabric `*.Notebook/`), Airflow DAG files
   (file names and ids only; Python is never imported or run), Fabric/ADF pipelines and bundle
   resources, each routed to its native editor.
5. **Pass 12 — qualification with Julian (gate 16).** Walk the signed-in checklist in
   IMPLEMENTATION_STATUS, fix what breaks, record observations. Then **1.0.0**.

After 1.0 (P1): project chooser and onboarding; starter projects; Mongoku "Open in DataPass"
button (Mongoku side); richer Grafana as-code routes; reviewed live read adapters.

## 5. Cross-repository follow-ups (owned by the other repositories)

- **DiagramCloud**: re-pin `docs/contracts/datapass-diagramcloud-bridge.lock.json` to the merged
  datapass-vscode commit. The contract schemas are unchanged (same git blobs); no re-vendoring.
- **Mongoku**: add an "Open in DataPass VS Code" button linking to
  `vscode://julian-passebecq.datapass-vscode/open?entity=<entity_id>` (drop `&mongoku=`: DataPass
  ignores it by design). Its record of the DataPass runtime version (v0.8.0) is stale; update it
  only through Mongoku's reviewed write path, with Julian's approval.
- **FOIL**: native case schema and facet JSON pointers, declared output dependencies, Python/JS
  `case_hash` test vectors, agreement on candidate and Design Lab request/result manifests.

## 6. How to try 0.9.3

1. Install: `code --install-extension <folder>\datapass-vscode-0.9.3.vsix --force`, then reload.
2. Open a project folder containing `.datapass/project.json` (or run *DataPass: Initialize
   Project Manifest*). Add `platforms.grafana.url` / `companions.mongoku.entityId` if you use them
   (examples in the README).
3. Work view → **Links**. For Mongoku: start it (`npm run dev` → `http://localhost:3100`), open the
   project → *Developer context* → *JSON* → *Copy*, then *DataPass: Import Mongoku Context…*.

## 7. Rules that do not change

Local-first; Git-versioned configuration; manual AI exchange with exact bases and explicit review;
official/specialist tools do the work; discovery never executes project code; imported labels never
approve themselves; no credentials, auto-push, auto-merge, provisioning or authority writes without
explicit approval; no FOIL private material in this public repository. Full list: [CLAUDE.md](../CLAUDE.md).
