# V4 status and what remains (TECH LEAD GLOBAL DataPass, Opus high · 2026-10-01 · rules V3.8)

Sources: `glab` MR states at ~12:30 (vscode, Common, cloud, studio, data-xray), code read on main 2e3f96c / Common origin/main. Detail per item and CI analysis: [`handoff/V4-TECHLEAD-REVIEW.md`](V4-TECHLEAD-REVIEW.md) (TECHLEAD-V4, part 1 d207c0c; § b/c to follow). Severity: **S1** blocks the V4+NAV VSIX · **S2** blocks V5 or wastes a wave · **S3** debt.

## a. Architecture as merged
| # | Sev | Finding (evidence) | Fix | M |
|---|---|---|---|---|
| a1 | S1 | **The standalone renderer draws only 3 of the 9 view-spi layout kinds** (`src/webview/views/layouts/{table,detailCard,surface}.ts`; `LAYOUT_KINDS` in Common `view-spi/src/catalog.ts:11` has 9). graph, metrics, diff-history, code-steps, context-text and erd are unregistered until NAVREN2 (no MR, branch `v4/navren2` only), NAVREN3 !192, NAVREN4 !193, NAVERD1 !208 merge. Views bound to a missing kind must render a typed hole, not a blank. | Assign NAVREN2 now; add a "kind not available" hole in the renderer registry (in NAVREN2) | 10 + 1 |
| a2 | S1 | **Vendored Common copies are stale under unchanged versions** (TL-13): standalone pins project-contracts alpha.3 @2622064 (schemas/v1 only) while Common main is also alpha.3 with v2 + `claim-origin.ts`; vendored analyzers-dbt alpha.1 lacks DBTRUN1 `route.ts`, Dataform, SQLMesh. The shipped VSIX would not contain V4 Common work, and digests are the only way to tell copies apart. | VERBUMP1 → V5FREEZE1 → REPIN5 (go/V5-REPIN5.md); release VSIX only after REPIN5 | 4 + 5 + 10 |
| a3 | S2 | **NavHost/NavigationService wiring incomplete**: `core/navigation/register.ts` `SURFACES` is empty on main; every NAV surface MR adds its line there and in palette.ts and package.json, which is the likely main cause of the 13 conflicting NAV MRs. | NAVWIRE1 (COORD 38, in PLAN) first, then the rebase train in PLAN order | 5 |
| a4 | S2 | **Three evidence-origin vocabularies** (analysis-protocol `evidence.ts:3`, project-contracts `realization.ts:112`, execution-model copy) + `CLAIM_ORIGINS`; the AI exchange (`core/project/aiExchange.ts`) uses none of them. | TL-14 in V5FREEZE1; exchange imports tag `ai-proposed` from the one enum | 3 |
| a7 | S1 | **The renderer drops every host message** (TECHLEAD-V4): `navHost.ts:75` posts without `bindings`, `model.ts:84` requires it. | Fix in NAVWIRE1 | 2 |
| a8 | S1 | **No binding provider and no view-data sender**: `viewHtml` has no caller, so views stay empty even with all layout kinds merged. | New **NAVDATA1** (binding provider + sender, reachability test), right after NAVWIRE1 | 10 |
| a9 | S2 | **Self-registration (BV5-2, accepted, TL-1 amended):** surfaces, layout kinds and palette GATED entries are collected by a **build-time generated, uncommitted** index (`src/**/*.surface.ts`, `*.layout.ts`, `*.palette.ts` → `out/gen/registry.ts`, gitignored), so no MR edits `register.ts`, `renderer.ts` or `palette.ts` again. package.json stays hand-written, append-only. | Add to NAVWIRE1 | 4 |
| a10 | S1 | Every project-map artifact is typed `other`, so kind views never show (NAVDATA1 !228). **Closed by NAVLOC1 !201**: `src/core/navigation/artifactKind.ts` `classifyArtifactKind(path, head, hints)` + the ladder assign kinds per file/component. Wiring: NAVDATA1 takes `artifactKind` from the ladder Location (never project-map `type`), and the host supplies `head` (first ~4 KB via `workspace.fs`, notebooks need it) | NAVDATA1 rebases on !201, no new package | +2 |
| a5 | S3 | MAT1 is core-only (`src/core/materialize/`, no command, Git plan = arguments). Fine for V4; DBTMAT1 adds the first command. Not a V4 release claim: say "planned" in the V4 notes. | Release notes wording | 0 |
| a6 | S3 | FastAPI analyzer (`analyzers-api`) and Observe types are not in the standalone; V4-API endpoints show in Cloud only. | REPIN5 vendors analyzers-api | (in REPIN5) |

## b. Open MRs and merge order
- **V4-NAV: 34 packages, 4 merged, 23 open, 7 not started.** Correction (merge simulation 13:30, go/NAV-train-conflict-map.md): **no MR conflicts with main on its own**; the "13 conflicting" count was stale. But 17 of 19 MR pipelines were cancelled or never ran (!193 failed): every MR needs a fresh CI run after its rebase.
- **Train (b1, S1):** **!199 NAVHOST1 → NAVWIRE1** (NAVWIRE1 builds on !199), then three rebase coders on disjoint files:
  - **R1 (package.json / palette / register):** !210 → !211 → !196 → !209 → !203 → !198 → !207.
  - **R2 (bindings, view packs):** !195 now; after NAVWIRE1: !206 → !194 → !204 → !208 → !205 (last, also touches package.json).
  - **R3 (no shared files, start now):** !201 → !192 → NAVREN2 → !193 → !202 → !197.
- **Semantic clash (b1a, S1):** `bindings/index.ts`. Keep NAVHOST1's registry; NAVLIN1, NAVTODO1, NAVHOME1, NAVPRIN1 and NAVERD1 drop their own index and each add a `*.binding.ts` adapter (typed hole when a fact is missing), which matches NAVDATA1 and the TL-1 amendment. NAVTODO1 uses NAVCTX2's `processStep.ts`. In `presets.json`, merge items into the one `show` array line (keeping both lines breaks the JSON). Regenerate `palette-snapshot.json` after each palette merge.
- **Unwired (b1b, S1):** nothing reads `VIEW_PACKS` (5 packs never appear), and the NAVREN2/3/4 and NAVERD1 layout kinds are not registered in the renderer. Both go in NAVWIRE1's self-registration (`*.layout.ts`, a view-pack index); each layout MR adds its own `*.layout.ts` in its rebase.
- **Drop / split (b2, S3):** none to drop. NAVPERF1 waits on NAVSPARK1 + NAVSQL1; if they are not merged by 16:00, ship V4 without NAVPERF1 (Spark/SQL starter views move to V5 W2).
- **Common analyzer batch (b4, S2, TECHLEAD-V4):** COVREG3 !130 does not remove the `coverage-registry.json` conflict (18 of 21 MRs touch it): fix and merge it before the analyzer batch. Stacked MRs: XMLSHARE1 contains SSIS1, YAMLSEQ1 contains ELT1 (merge the base first, then rebase).
- **BV5-1:** EVACTOR1 !180 contains EVCAPT1 !178: merge !178 first; none of the 6 contract MRs is freeze-covered yet (see go/V5FREEZE1-review.md).
- **Common V5 contracts (b3, S2):** !172, !175, !178, !180, !179 approved freeze-free; !173 OTELSPI1 pipeline skipped → run it before V5FREEZE1 so it can join v3 (TL-2).

## c. CI saturation (runner local-windows, 10–15 concurrent jobs; never touch the runner)
Measured by TECHLEAD-V4 (V4-TECHLEAD-REVIEW.md § c, f142236). Required checks are unchanged by every item.
- c1 (S2) **Cloud cache:** 104 of 197 runner-minutes per main pipeline are cache unpack/repack. Make caches `policy: pull` everywhere except one writer job: ~200 min saved per MR. **CIFIX1** (with c2, c4): 3 M, one coder now.
- c2 (S1 for releases) **vscode checkout:** 4 of the last 6 desktop reds die at checkout; copy cloud's `GIT_CLEAN_FLAGS` + longpaths fix. !217 only treats the symptom (b4).
- c4 (S2) **Auto-cancel redundant pipelines** is off in cloud and Common: 540 min in 8 h ran in superseded pipelines. Turn it on (project setting, not the runner) with `interruptible: true` on test/build jobs. **c10 decision (TECH LEAD): on for MR branches and for main too**, since a newer main commit re-runs every required check. Release/tag jobs stay `interruptible: false`.
- c5 (S3) vscode: a `merge-candidate` label tier + `rules: changes` for the desktop shards (30–80 min per MR); full matrix on main and on labelled MRs.
- c7 (S3) cloud: merge the 11 `*_ui` jobs into 3 shards.
- Process (unchanged): no pipelines on conflicting or draft MRs, `-o ci.skip` on WIP, re-run 3 at a time.

## d. Risks and V4+NAV VSIX checklist (ship today)
1. NAV rebase train merged through NAVERD1; NAVE2E1 green (acceptance + screenshots), or the release says which NAV views are not in it.
2. REPIN5 done and `scripts/verify-common.mjs` green (a2).
3. Renderer: every catalog view either renders or shows a typed hole (a1); no blank webview.
4. `npm run check`, full test suite and `qa:ui` green on main; palette test green (every `datapass.nav.*` command classified).
5. Keybinding check: arrow chords gated (`datapass.nav.active && !editorTextFocus && …`) and the conflict test passes (AC-N6).
6. PY1C Python host stays `platform:pending`; fallback off (ARCH_DECISIONS). DuckDB preview default off until DQ2.
7. `vsce package`, install with `code --install-extension`, size within +20 % of 1.1.0, cold activation < 1.5 s on the FOIL fixture.
8. Guided tutorial with screenshots for Julian's test session (standing gate) built from NAVE2E1 screenshots.
9. CHANGELOG in user words; "planned" for MAT1 command, NAVPERF1 if cut, X-Ray button if x!5 still red.

**Top 5 V4 actions, in order:** (1) NAVWIRE1 (+ a7 fix + a9 self-registration, 5+2+4 M) → NAVDATA1 (a8), after !199, then the 3-coder rebase train R1/R2/R3 (b1; R3 starts now); (2) assign NAVREN2 now (a1); (3) VERBUMP1 → V5FREEZE1 → REPIN5 before the VSIX (a2); (4) CIFIX1 now (c1 cache pull-only, c2 checkout fix, c4 auto-cancel; 3 M), then c5/c7; (5) NAVE2E1 + tutorial, then package the VSIX with the checklist (d).
