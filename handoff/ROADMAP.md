# DataPass roadmap — V1 (fast, stable, usable), V2 (80 %), V3 (100 %)

Owner: ARCHI DataPass 1 (high), 2026-09-26, on main after 0.24.0 (0.25.0 and 0.26 in flight).
Julian's brief: "a detailed plan of everything we must code; V1 fast and stable, V2 intermediate with
80 % of the features, V3 100 % and longer; if a usable V1 can come fast, go." This file is the single
answer; `handoff/PLAN.md` tracks the packages in flight; design decisions stay in `handoff/v3/10_`
(D-01…D-18) and `11_` (D-19…D-28).

## 0. Diagnosis in five lines

1. **Features are not the gap.** 0.13 → 0.25 shipped the whole V3 model: bridge repository, manifest v5,
   graph, options/variants, sheet, board, readiness, toolchain/ID map/connections, Git module, AI
   exchange, work orders, Claude & Codex panel, modes, context from any file, format checks, file
   versions, toolkit catalogue. 352 commands, 9 views, 418 unit + 325 desktop tests.
2. **Nobody has used it end to end on a real project yet.** FOIL's bridge is still in review (PR #5/#6),
   and no Azure/Fabric/Databricks account run has happened (V1 gate 16).
3. **Starting is hard:** no "open this client project" path (clone bridge + every native repository +
   workspace in one go), no walkthrough; 352 palette entries.
4. **Honesty gaps are being closed** (0.25 selected-variant wording, 0.26 MCP writer, D-22 evidence).
5. **So V1 = make the existing product easy to start, stable and qualified on one real flow**, not
   add surfaces. V2 fills the 80 % that real use will ask for. V3 is the long tail and automation.

## 1. V1 — "usable on FOIL and one plain client project" → 1.0.0

Target: **2–3 days of parallel coders + Julian's ~2 h of checks.** Definition of done: Julian opens
FOIL from its bridge URL in a few clicks, lands in Standard mode on the architecture, switches
A/B/C, opens files from several repositories, copies context to the FOIL AI, gets its PR back with
*Get updates*, runs the native test of the selected component, and sees honest states everywhere;
the same on the public `doc-pipeline` example; no crash or silent failure in the testlabs.

### 1.1 Already shipped and kept as is (V1 surface)

Bridge + native multi-root Explorer + company workspace · Architecture panel and Details · Git view
(Needs you, worktrees, PRs, CI, Fetch all, Get updates fast-forward) · AI exchange (copy / validated
import / backup / restore) · Copy Context for My AI from any file · format checks → Problems · file
versions · options, scenarios, variants, selected variant (preview) · readiness, toolchain, ID map,
connections (az / fab / databricks read-only checks) · toolkit catalogue · modes (Standard default) ·
work orders (opt-in) · Claude & Codex panel.

### 1.2 In flight (finish, no new scope)

| Id | What | State |
|---|---|---|
| 0.25.0 | selected variant (preview), "files present" badges, preview / test / activate wording, repository layout contract | release by TAMPON 9 |
| AI-4a | pilot stage 1 without Azure sign-in (pilot folder, requests/responses, Pilot tab, stubs) | TAMPON 11 |
| M1 | lossless MCP settings writer, HTTP servers, `ws.mcp` = "registration file present" | TAMPON 14 |
| K1 | toolkit: Fabric Core/local/IQ MCP, Power BI Authoring MCP + Microsoft `powerbi-authoring`, Azure MCP | TAMPON 15 |
| X1 | Mongoku removed from visible scope (old configs still load) | TAMPON 16, merges last |
| C1 | options cost lines: `shared` counted once, `use: learning-only` | TAMPON 19 |
| 0.26.0 | release of the above | TAMPON 20 |

### 1.3 New V1 packages (all independent of Julian's accounts)

| Id | Package | What exactly to code | Size · effort | Owned files | Acceptance |
|---|---|---|---|---|---|
| **V1-ON** | **Open a client project** | Command *DataPass: Open a Client Project…* (also on the welcome page): paste the bridge's Git URL (GitHub, Azure DevOps, GitLab; https or SSH) → pick a parent folder → clone the bridge → read its manifest → list declared native repositories with their role → clone the missing ones (checkbox list, default all non-planned), locate existing clones instead of recloning (same remote identity) → write the company workspace file (0.17) → open it; Standard mode lands on the Architecture panel. Idempotent (re-run = "all present"). Never clones a planned repository; stops on the first auth failure with the host's own message and a *Retry*. Plus a VS Code **walkthrough** "Get started with DataPass" (5 steps: open a client project, the architecture, a file → context for my AI, Get updates, switch mode). | M · medium | new `src/work/openClientProject.ts`, `src/core/project/cloneplan.ts`, `resources/walkthrough/**`, its package.json entries | Unit: clone plan from a manifest (planned skipped, existing clone located by remote identity incl. SSH/https equivalence, Azure DevOps forms); desktop flow on a local "GitHub on disk" fixture with 3 repositories: one command → workspace with 3 roots open, Architecture shown; second run clones nothing |
| **V1-P1** | **Stamped packs and orders** (D-23) | Every pack and work order records selected variant, environment and bridge HEAD; the AI view marks a copied pack stale when any of them changes; launching an order stamped for another variant asks first | S–M · medium | `src/core/exchange/stamp.ts`, stamp lines in the pack builders, the order `stamp` field (schema additive), the AI-view stale badge | Unit: stamp content; stale after variant / HEAD change; order launch confirmation. Desktop: switch A→B, pack shows stale |
| **V1-STAB** | **Stabilisation sweep** | Run, as a user would, every testlab (4, 5, 6, 7, 7a, 8, 9, and 10 when it exists) and the full desktop suite on a clean profile with the latest VSIX; list every error, dead button, wrong label, unhandled rejection in the extension host log, stale doc; fix the small ones in place, file the big ones as V1 packages to the ARCHI | M–L · medium (high if > 10 bugs) | fixes in place, each small; a report `handoff/v1/STABILISATION.md` | Report with every testlab step PASS/FAIL; zero unhandled errors in the extension host log for the testlab flows; fixes merged |
| **V1-PERF** | **Activation and refresh budget** | Measure activation time and first refresh on a FOIL-sized fixture (8 repositories, 5,000 files, graph 60 components); lazy-load the heavy modules (webviews, toolkit, work orders) behind their views; budget: activation < 500 ms, first project refresh < 3 s on this PC; no refresh storm on `git fetch` | M · medium | activation paths in `src/extension.ts` (lazy imports only), a perf fixture and `scripts/perf.ts` | Numbers before/after in the PR; a CI job that fails above 2× the budget |
| **V1-T10** | **Testlab 10 = acceptance journeys** (D-28) | `D:\PROJ\datapass-testlab\10-parcours-client\`: plain client project works with DataPass disabled; open from bridge (V1-ON); preview A/B/C with the right packs; missing clone, unverified remote, dirty file, unsupported tool, variant with files never run; MCP card with unknown states | M · medium | testlab folder, `04_NEXT_PASSES.md` B7 | setup twice clean; coder runs every non-visual step; Julian's visual steps in todo.md |
| **V1-DOC** | **Docs you can read** | (a) `docs/DEMARRER.md` in French, one page: install, open a client project, the daily loop, the four modes, where things are; (b) consolidate the handoff forest: `handoff/CURRENT.md` (what DataPass is now, links to 10/11/ROADMAP/PLAN), move V1/V2.1/V2.2 handoffs and superseded V3 docs to `handoff/archive/`, shorten `CLAUDE.md` to the boundaries + pointers; (c) README top section for 1.0 | M · medium (docs-writer) | those files | Links checked; CLAUDE.md < 60 lines; nothing deleted, only moved with redirects |
| **V1-PAL** | **Command palette diet** (revises D-03's palette rule) | Commands that need a context argument (a card, a component, a file, an order) and fail from the palette get `commandPalette: when false`; the palette keeps ~60 top-level commands, grouped by a consistent prefix ("DataPass: Git…", "DataPass: AI…", "DataPass: Project…"); menus unchanged; presets still never hide safety commands. UI wording "bridge repository" everywhere (J4) | S–M · medium | package.json `menus.commandPalette` and titles only | A test lists palette-visible commands (snapshot, reviewed); each hidden one has a context menu or view entry; merges **last** before 1.0.0-rc |
| **V1-FOIL-A** | **FOIL PDF route A runs from DataPass** (client side + one DataPass hook if missing) | After Julian merges bridge PRs #5/#6 and foil-study S1: the Details of `study-core` offers *Test* = the native `pytest` task of foil-study (a VS Code task run on click, D-19 "test"); the result is shown with commit and time; nothing deployed | S · medium | foil-study tasks.json (native repo, no DataPass file), DataPass only if a route is missing | Julian clicks Test on the study component and sees the result with its commit |
| **QA-1…QA-3, HUB-1** | **Codex test mode** (Julian, 2026-09-26) | An external tester, Codex, runs batteries of tests on a fake client "Codex Wind Lab" prepared by an outside AI. `npm run qa` plus the auto repository and the audit repository, and the hub and common repositories seeded. Full design: [v3/12_CODEX_TEST_MODE.md](v3/12_CODEX_TEST_MODE.md) §8 | M–L total · medium | see 12 §8 | see 12 §8 |
| **1.0.0-rc** | Release candidate | bump, CHANGELOG, status, VSIX installed, todo.md checklist for Julian | S · medium | release files | full suites green |

### 1.4 Julian's part of V1 (≈ 2 h, in `todo.md`)

1. Review and merge FOIL bridge PRs #5 then #6; answer Q2 (Azure names) and Q3 (the two VMs) in #6 (20 min).
2. Review foil-study PR julian-passebecq/foil-study#1 (S1: core + route A, 38 tests, CI green) and its 3 flagged choices (pypdf version outside `result_id`; derived paths keyed by `extraction_run_id`; `blob_ref` rejected until a Blob implementation) (15 min).
3. Machine: `az`, `func`, `az login`, Reader on the dev resource group, Storage Blob Data Reader (20 min).
4. Testlab 9 visual steps + Claude & Codex panel (40 min); testlab 10 visual steps (20 min).
5. 1.0.0-rc: open FOIL with *Open a Client Project*, run the loop once (20 min) → say "1.0".

### 1.5 V1 order (parallel lanes)

- Lane A (now): V1-ON · V1-DOC · V1-T10 (T10 uses ON when it lands).
- Lane B (after AI-4a merges): V1-P1.
- Lane C (after 0.26.0): V1-STAB, then V1-PERF.
- Lane D (client, after Julian's reviews): V1-FOIL-A.
- Last: V1-PAL → 1.0.0-rc → Julian's check → 1.0.0.

## 2. V2 — "80 %": what real use will ask for (1.1 → 1.4)

Grouped by theme; each item is a package of S–M unless marked L. Order inside V2 follows what FOIL
needs first.

### 2.1 Evidence and trust (1.1)
- **E1 integration evidence chain** (D-22): known → installed → registered → connected → authenticated →
  authorized target → operation verified, per tool and MCP server, in Readiness and Details; `unknown`
  by default. M.
- **Receipts with separated outcomes**: CLI exit / CI green / deployed / runtime success / scientific
  validity as distinct fields; agent claims labelled as claims; check plan rows NOT_RUN / UNKNOWN /
  FAIL / STALE; result reuse keyed by input identity (plan 10 §3 V2). M–L.
- **Coordinated change sets shown**: native PR ↔ bridge PR linked, "prepared vs landed". M.
- **AI-4b pilot qualification** with Julian's read-only sign-in; then **R5** one MCP-assisted read-only
  pilot on an approved Fabric sample. S + S (Julian present).

### 2.2 Model limits from guide 07 (1.2)
- Resources with an environment and a role key (dev/prod VM of one role). M.
- Graph `vm` target cross-checked against `resources[]`. S.
- Unknown `toolchain` ids fail validation (with suggestion) instead of passing (limit 7.2 #7). S.
- FOIL-specific settings (`datapass.foil.*`) moved behind the FOIL domain pack or retired (limit #10). S.
- Planned repositories may hold a pilot `path` (limit #11). S.
- Identifier values checked where a read-only CLI can (resource group, workspace id). M.

### 2.3 Variants and architecture (1.2–1.3)
- Variants on another branch or tag (file refs with a Git `ref`, opened read-only) — J5, graph schema change. M–L.
- Side-by-side variant diff of the same component's files. M.
- Company-level global view (all projects of a company on one diagram). M.
- Bridge recommends a mode and surfaces (manifest v6 `presentation`) — J3; presets from the hub. M.

### 2.4 Checks and tools (1.3)
- Python syntax check through a vetted parser (no execution); notebook format checks. M.
- Native check runner: *Test* per component = a VS Code task declared in the native repository or the
  toolkit recipe, run on click, receipt recorded (generalises V1-FOIL-A). M.
- Pilot stage 2 (validate / plan: `bundle validate` for YAML bundles, `tofu plan`) with per-target review. L.

### 2.5 Environments and platforms (1.3–1.4)
- Restricted Mode, Remote-SSH and WSL desktop qualification. M.
- VM card (D-27): declared vs observed, IaC root, SSH alias, links. M.
- French UI via `vscode.l10n` (package.nls.fr.json + webview strings). L.
- Distribution: VSIX attached to a GitHub release by CI on tag; *Check for DataPass updates*. S (publishing needs Julian's yes).

### 2.6 Client side (FOIL, not DataPass code)
- foil-study adapter B (Blob event + Function), then C (ADF, async accepted/poll pattern). Client AI + coder.

## 3. V3 — "100 %": long tail and automation (2.x)

- Pilot stage 3: deploy to `dev` with per-target review, never prod (09 §3.3). L, max effort design.
- Read-only DataPass context MCP server (D-21 M2), only after a measured need. M.
- Recipes exported as agent skills (Claude / Codex / Copilot). M.
- DiagramCloud semantic mapping and freshness (D-26); scenario/sheet export (optional module). M.
- Grafana VM monitoring links and states (optional module). S–M.
- FOIL producer routes (generate campaign jobs through the FOIL fork), diagram editing. L, depends on FOIL.
- Hub-shipped cost refresh (toolkit prices dated, linked to cost lines by tool id). M.
- Team features (several people on one bridge: who works on which variant), if ever needed. L.

## 4. What we change or improve in DataPass (cross-cutting)

| Area | Change | When |
|---|---|---|
| Starting | *Open a Client Project* + walkthrough | V1-ON |
| Palette | 352 → ~60 visible commands, consistent prefixes | V1-PAL |
| Wording | "bridge repository" in the UI; "selected variant · preview"; "files present"; "registration file present" | 0.25, M1, V1-PAL |
| Honesty | evidence chain, receipts with separate outcomes | V2 1.1 |
| Performance | activation and refresh budget, lazy modules | V1-PERF |
| Docs | one French start page; handoff forest archived; short CLAUDE.md | V1-DOC |
| FOIL leftovers | `datapass.foil.*` settings out of the generic extension | V2 1.2 |
| Scope | Mongoku out (X1); DiagramCloud and Grafana optional modules only | 0.26 / V3 |
| Tests | testlab 10 as the acceptance journey; perf CI job | V1-T10, V1-PERF |

## 5. What we do not build (unchanged)

No MCP gateway or cloud proxy, no own agent shell, no scheduler, no knowledge database or price
scraper, no virtual mega-repository or custom file browser, no compiler per provider, no DataPass
files in native repositories, no second FOIL backlog, no Mongoku integration, no scientific
calculation in TypeScript, no automatic install, sign-in or deploy.
