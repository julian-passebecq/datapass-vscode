# V4 status and what remains (TECH LEAD GLOBAL DataPass, Opus high · 2026-10-01 · rules V3.8)

Sources: `glab` MR states at ~12:30 (vscode, Common, cloud, studio, data-xray), code read on main 2e3f96c / Common origin/main. Detail per item and CI analysis: `handoff/V4-TECHLEAD-REVIEW.md` (TECHLEAD-V4, linked when pushed). Severity: **S1** blocks the V4+NAV VSIX · **S2** blocks V5 or wastes a wave · **S3** debt.

## a. Architecture as merged
| # | Sev | Finding (evidence) | Fix | M |
|---|---|---|---|---|
| a1 | S1 | **The standalone renderer draws only 3 of the 9 view-spi layout kinds** (`src/webview/views/layouts/{table,detailCard,surface}.ts`; `LAYOUT_KINDS` in Common `view-spi/src/catalog.ts:11` has 9). graph, metrics, diff-history, code-steps, context-text and erd are unregistered until NAVREN2 (no MR, branch `v4/navren2` only), NAVREN3 !192, NAVREN4 !193, NAVERD1 !208 merge. Views bound to a missing kind must render a typed hole, not a blank. | Assign NAVREN2 now; add a "kind not available" hole in the renderer registry (in NAVREN2) | 10 + 1 |
| a2 | S1 | **Vendored Common copies are stale under unchanged versions** (TL-13): standalone pins project-contracts alpha.3 @2622064 (schemas/v1 only) while Common main is also alpha.3 with v2 + `claim-origin.ts`; vendored analyzers-dbt alpha.1 lacks DBTRUN1 `route.ts`, Dataform, SQLMesh. The shipped VSIX would not contain V4 Common work, and digests are the only way to tell copies apart. | VERBUMP1 → V5FREEZE1 → REPIN5 (go/V5-REPIN5.md); release VSIX only after REPIN5 | 4 + 5 + 10 |
| a3 | S2 | **NavHost/NavigationService wiring incomplete**: `core/navigation/register.ts` `SURFACES` is empty on main; every NAV surface MR adds its line there and in palette.ts and package.json, which is the likely main cause of the 13 conflicting NAV MRs. | NAVWIRE1 (COORD 38, in PLAN) first, then the rebase train in PLAN order | 5 |
| a4 | S2 | **Three evidence-origin vocabularies** (analysis-protocol `evidence.ts:3`, project-contracts `realization.ts:112`, execution-model copy) + `CLAIM_ORIGINS`; the AI exchange (`core/project/aiExchange.ts`) uses none of them. | TL-14 in V5FREEZE1; exchange imports tag `ai-proposed` from the one enum | 3 |
| a5 | S3 | MAT1 is core-only (`src/core/materialize/`, no command, Git plan = arguments). Fine for V4; DBTMAT1 adds the first command. Not a V4 release claim: say "planned" in the V4 notes. | Release notes wording | 0 |
| a6 | S3 | FastAPI analyzer (`analyzers-api`) and Observe types are not in the standalone; V4-API endpoints show in Cloud only. | REPIN5 vendors analyzers-api | (in REPIN5) |

## b. Open MRs and merge order
- **V4-NAV: 34 packages, 4 merged (NAVSPI1, NAVSVC1, NAVREN1, NAVINTRO1b), 23 open, 7 not started** (NAVREN2, NAVCHG1, NAVTOUR1, NAVINTRO1a, NAVPERF1, NAVCLOUD1, NAVE2E1). 13 open MRs conflict (KEYS1, BAR1, MAP1, CTX1, CTX2, AIX1, CODE1, CAT1, HIST1, LIN1, TODO1, HOME1, PRIN1); only NAVINTRO1c (x!6) is green.
- **Order (b1, S1):** NAVWIRE1 → NAVLOC1 !201 → NAVKEYS1 !210 → NAVREN3 !192 → NAVREN2 (new) → NAVREN4 !193 → NAVHOST1 !199 (un-draft) → NAVBAR1 !211 → NAVMAP1 !196 → NAVCTX1 !209 → NAVCTX2 !195 → NAVFAB1 !202 → NAVAIX1 !203 → NAVCODE1 !198 → NAVCAT1 !207 → NAVHIST1 !197 → NAVLIN1 !206 → NAVTODO1 !194 → NAVHOME1 !205 → NAVPRIN1 !204 → NAVERD1 !208. One rebase coder per 4–5 MRs in this order (3 coders), never two on overlapping files. Common NAVSPARK1 !160 and NAVSQL1 !158 are independent (merge now if green); XRAYOL1 x!5 CI failed: fix first.
- **Drop / split (b2, S3):** none to drop. NAVPERF1 waits on NAVSPARK1 + NAVSQL1; if they are not merged by 16:00, ship V4 without NAVPERF1 (Spark/SQL starter views move to V5 W2).
- **Common V5 contracts (b3, S2):** !172, !175, !178, !180, !179 approved freeze-free; !173 OTELSPI1 pipeline skipped → run it before V5FREEZE1 so it can join v3 (TL-2).

## c. CI saturation (runner local-windows, 10–15 concurrent jobs; never touch the runner)
- c1 (S2) Pipelines on conflicting MRs are wasted work: cancel and re-run only after the rebase. Do not run MR pipelines on drafts (`rules: if $CI_MERGE_REQUEST_DRAFT == "true"` → manual) and use `-o ci.skip` on WIP pushes (already in the GOs).
- c2 (S2) Common: run per-package jobs only for changed packages (`rules: changes:` per workspace) on MR pipelines; the full matrix stays required on main and on the merge train. Detail and job list: V4-TECHLEAD-REVIEW.md § c.
- c3 (S3) Cache `node_modules` by lockfile hash per repo; cloud's 19-slot holds on 1 Oct came from 9 re-runs at once: re-run 3 at a time.

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

**Top 5 V4 actions, in order:** (1) NAVWIRE1 then the NAV rebase train with 3 coders (b1); (2) assign NAVREN2 now (a1); (3) VERBUMP1 → V5FREEZE1 → REPIN5 before the VSIX (a2); (4) CI hygiene on MR pipelines: no runs on conflicting/draft MRs, changed-package jobs in Common (c1–c2); (5) NAVE2E1 + tutorial, then package the VSIX with the checklist (d).
