# PLAN — DataPass Control Plane (datapass-vscode)

Kept by `ARCHI DataPass N` (docs/roles/archi.md in claude-control). Lean on purpose: one screen per version. Estimates are orders of magnitude; fill **Actual** when a package merges (GALAXY Contrôle compares them every week).

Updated: 2026-09-26 10:20 by ARCHI DataPass 1 · Sources: [v3/10_GLOBAL_IMPROVEMENT_PLAN.md](v3/10_GLOBAL_IMPROVEMENT_PLAN.md) (decisions D-01…D-18, §3 features by version), [v3/08_TOOLKIT_AND_AGENTS.md](v3/08_TOOLKIT_AND_AGENTS.md) §5.1, 5.2, 5.4 (toolkit catalogue), [v3/09_AI_MODES_WORK_ORDERS_GIT.md](v3/09_AI_MODES_WORK_ORDERS_GIT.md) §12–13.1 (AI-3, AI-4, pass order), main `743dca3` (0.22.0 released, 0.23 G merged).

## Versions

"V1 / V2 / V3" are the feature tiers of plan 10 §3, not extension releases (current release: **0.22.0**; next: **0.23.0**).

| Version | Goal (one line) | Useful? | Status |
|---|---|---|---|
| V1 — up to 1.0.0 | The daily loop on real projects: bridge repository, architecture first, modes, context from any file, format checks, file versions, variants, toolkit catalogue, AI work orders | yes: it is what Julian and FOIL use now | in progress: 0.22.0 released, 0.23 = G (merged) + toolkit catalogue (below); then AI-3, AI-4 stage 1, Julian's acceptance (testlabs 4–9, FOIL), 1.0.0 |
| V2 | Bridge recommends a mode (manifest v6 `presentation`), presets from the hub, check plan / evidence rows, coordinated change sets shown, cost lines linked to toolkit ids, Python syntax check, variants on another branch/tag, side-by-side variant diff, company-level global view, Remote-SSH/WSL | yes, after 1.0: each item comes from a real gap seen in V1 | later (J3, J5 recommended "yes, in V2") |
| V3 | Recipes as agent skills, read-only MCP server, Pilot stages 2–3, FOIL producer routes, diagram editing | no for now: depends on V1 used for real and on FOIL | parked |

Cut (plan 10 §1.5, still true): no knowledge database or price scraper, no virtual mega-repository or custom file browser, no compiler per provider, no DataPass files in native repositories, no second FOIL backlog, no Mongoku features (frozen).

## Packages (0.23.0 — toolkit catalogue)

Common rules (as in 0.22): each package in its own worktree from up-to-date main, branch `claude/0.23-<id>-<slug>`, `npm run verify` green, PR merged on green CI (never `gh pr merge --auto` in this repository: no required checks). **No version bump**, no edits to `CHANGELOG.md`, `IMPLEMENTATION_STATUS.md`, `CLAUDE.md`, `handoff/V3_HANDOFF.md`; release notes go to `handoff/v3/night/0.23-<id>.md`. In `package.json`, `src/extension.ts` and `tests/integration/suite.ts` add only your own entries and resolve those three by union when rebasing. The contract between T1, T2, T3 and T4 is the JSON shape of 08 §5.1 (tool) and §5.2 (recipe), wrapped in `{ "format": "datapass.toolkit", "version": 1, "requires"?: { "datapass": ">=0.23.0" }, "tools"|"recipe"…, "datapassRequests"?: [{ "title", "why", "example" }] }`; T1 owns the schema and may tighten it, T2 then adapts its data before merging.

| Id | Package | Size | Estimate (h · M tokens) | Model · effort | Owned files | Acceptance tests | Coder | Status | Actual (h · M tokens) |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Toolkit core: format, schema, hub reader, built-in baseline, merge, "Needs a newer DataPass" data | L | 3–5 h · 40–90 | Opus 5.5 · high | `src/core/toolkit/**`, `schemas/datapass-toolkit.schema.json`, `resources/toolkit/**` (built-in baseline: the official tools and the probes of `src/core/capabilities/tools.ts`, which stays the probe layer and is only read), `tests/toolkit.test.ts` | Unit: tools.json and a recipe validate; unknown field rejected with a message; `requires.datapass` newer than the running version → file shown as "needs DataPass ≥ x", its entries skipped, never guessed; format version newer → same; hub entry overriding the baseline marked "changed by the hub"; a hub entry naming an unknown probe id is refused; install commands are data only (a test that `src/core/toolkit/**` imports nothing from `exec`/`child_process`); `datapassRequests` listed; hub absent → baseline only; recipe step `capability` resolved against the registry or flagged | toolkit session | merged (#43) | ≈ 9 h together (T1–T4, one session started on 0.20.0) · not split per package |
| T2 | Toolkit content: hub example data (Fabric + Power BI first, then Databricks, Azure), recipes incl. the Copy Job bulk edit (08 §4), guide page and preparation contract | M | 2–3 h · 25–50 | Opus 5.5 · medium | `examples/v3/hub/.datapass/toolkit/**`, `examples/v3/hub/README.md`, `docs/guide/09_TOOLKIT.md`, `docs/guide/README.md` (one line), `docs/PREPARING_A_PROJECT.md` (new toolkit section only) | Every file validates with T1's validator (after T1 merges: rebase, run it, fix the data); each tool has `verified.on` and links checked on the day; each recipe names existing tool ids; the guide explains who updates the hub (ChatGPT via the JSON exchange or an agent PR), what needs a newer DataPass, and `datapassRequests` | toolkit session | merged (#43) | ≈ 9 h together (T1–T4, one session started on 0.20.0) · not split per package |
| T4 | Board `recipe` field: board items may name `{ "recipe": "<id>", "route"?: "<id>" }`; validation (unknown id = warning when the toolkit is loaded, never an error that blocks the board); AI board pack asks for recipe ids when relevant | S | 1–2 h · 15–30 | Opus 5.5 · medium | `src/core/project/board.ts`, `src/core/project/boardPack.ts`, `schemas/datapass-board.schema.json`, `tests/board.test.ts` | Unit: a card with a recipe round-trips (moving a card still rewrites only `status`); old boards without `recipe` unchanged; unknown recipe id → warning; the pack text mentions recipes only when the toolkit has some. Board desktop flows still pass | toolkit session | merged (#43) | ≈ 9 h together (T1–T4, one session started on 0.20.0) · not split per package |
| T3 | Toolkit surfaces (after T1): tools and recipes where they are needed — Details (a component's provider → tools, recipes), Options comparison (tools per option), board card (recipe steps, from T4's field), Readiness *Tools & versions* links to catalogue entries; a Toolkit section with "Needs a newer DataPass" and files skipped; surface ids `project.toolkit`, `badge.hubChanged` added to presets (DataPass+; add, never rename) | L | 3–4 h · 40–80 | Opus 5.5 · high | `src/views/{workbenchHtml,workbenchState,projectTree}.ts` (toolkit parts only), `src/webview/workbench.ts` (toolkit parts), `src/work/toolkitCommands.ts`, `src/core/experience/surfaces.ts` + `resources/experience/presets.json` (new ids only), `tests/integration/toolkitFlows.ts` | Desktop flow on `examples/v3/hub` + `sales-bi`: Details of a Fabric component lists Fabric Studio and the `fab` route with its steps; a board card with a recipe shows its steps; a hub file requiring a newer DataPass appears under "Needs a newer DataPass" and its entries are skipped; Vanilla hides the Toolkit section, DataPass shows it; nothing is installed or run (copy only); no file written in any repository | toolkit session | merged (#43) | ≈ 9 h together (T1–T4, one session started on 0.20.0) · not split per package |
| T5 | Testlab 9 for Julian: modes, context from any file, format checks, file versions, variants, toolkit (offline, ≈ 25 min), then run it yourself with the desktop harness and Playwright where possible | M | 2–3 h · 20–40 | Opus 5.5 · medium | `D:\PROJ\datapass-testlab\9-modes-contexte-versions\**` (outside the repo), `D:\PROJ\datapass-testlab\LISEZ-MOI-TESTS.md` (one row), `handoff/v3/04_NEXT_PASSES.md` (a "B6. Testlab project 9" section only) | `setup.ps1` builds the fixture from scratch twice without error; `LISEZ-MOI.md` in French, step by step, each step with what Julian should see; every step not needing Julian's eyes or hardware run once by the coder and marked done; the toolkit steps added after T3 merges (or marked "0.23, after install") | TAMPON 10 | GO | |
| R | Release 0.23.0: bump, `CHANGELOG.md`, top of `IMPLEMENTATION_STATUS.md`, `CLAUDE.md` current-source line, `04_NEXT_PASSES.md` "Done in 0.23.0", fold `handoff/v3/night/0.23-*.md` (and G's notes) in, full desktop suite, VSIX built and installed, todo.md row for Julian | S | 1 h · 10–20 | Opus 5.5 · medium | the shared release files above | `npm run verify` + full desktop suite green; VSIX installs; PR merged on green | toolkit session or a TAMPON | merged (release PR) | ≈ 1 h |

Size guide: **S** < 1 h, one area · **M** 1–3 h, a few files · **L** > 3 h or hard (effort high, or split it).

**Reassigned (2026-09-26 10:20):** T1–T4 are built by the session already running the toolkit catalogue pass ("DataPass: build the toolkit catalogue pass (0.21.0)", started on 0.20.0, work uncommitted at staffing time); it rebases on main and ships them as 0.23.0 against the acceptance above. The TAMPONs sent on T1/T2/T4 were stopped before any commit. T5 runs on TAMPON 10. R: the toolkit session, or a TAMPON if it hands off.

## Merge order

T4 → T1 → T2 → T3 → R (0.23.0). T5 merges its one repository line whenever green (docs only). Each coder merges on green CI, then tells the next one (send_message); a coder whose predecessor has not merged yet rebases on main before merging.

## After 0.23.0 (next packages, not staffed yet)

| Id | Package | Size | Model · effort | Depends on |
|---|---|---|---|---|
| AI-3 | Claude & Codex panel + Codex hand-off (09 §12) | L | Opus 5.5 · high; panel polish medium | Claude Control pass C-1 is merged (claude-control PR #15). Starts after 0.23.0: it shares the AI view and work-order files with the toolkit pass |
| AI-4 | Pilot stage 1, read-only: allowlist design per CLI (`az` + `func` first, for the FOIL PDF flow, 09 §13.1 Q8), `requests/` / `responses/`, Pilot tab | L | allowlist design: an "ARCHI xh" consult brief; build: high | toolkit connections (0.18, done); Julian signs in read-only on dev resources |
| FOIL-PDF | Apply the FOIL bridge preparation (foil-v1-vscode-datapass `docs/DATAPASS_PREPARATION.md` steps 1–3) | M | medium | Julian's answers Q2–Q4 and the FOIL AI's spike (todo.md, 2026-09-26) |
| 1.0.0 | Release after Julian's acceptance (testlabs 4–9, FOIL on the real repositories, account qualification gate 16) | S | medium | Julian |

## Escalations and decisions

| Date | Package | What happened | Re-run at / consult | Result |
|---|---|---|---|---|
| 2026-09-26 | T1–T4 | a toolkit catalogue session was already running (uncommitted work on 0.20.0) when T1/T2/T4 were staffed | TAMPONs stopped; the running session keeps the packages and rebases | — |

xhigh consult briefs: `handoff/briefs/<date>-<topic>.md` (question, options, files to read, then "## Decision").

## Open questions for Julian

None blocking. Plan 10 §6 J1–J5 continue with the recommendations (Standard by default, `foil-v1-vscode-datapass` as FOIL's bridge, "bridge repository" wording, J3 and J5 in V2). The pass order toolkit catalogue → AI-3 → AI-4 is Julian's (09 §13.1 Q1).
