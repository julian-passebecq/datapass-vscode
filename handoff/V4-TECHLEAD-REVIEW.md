# V4 tech-lead review (PM DataPass TECHLEAD-V4, Opus high · 2026-10-01 · rules V3.8)

Detail behind [V4-STATUS-REMAINING.md](V4-STATUS-REMAINING.md) (TECH LEAD GLOBAL owns it; items there are not repeated). Code read at main f970c32 / Common origin/main. Severity: **S1** blocks the V4+NAV VSIX · **S2** blocks V5 or wastes a wave · **S3** debt. Advice only: PM 27 decides.

## BLOCKER-V5 (top)
- **BV5-1 (S2) · Common project-contracts: the six V5 contract MRs no longer clash on a version, but none is freeze-covered.** evpin1 !179, gitspi1 !172, otelspi1 !173, detspi1 !175, evcapt1 !178 and evactor1 !180 each dropped their v3 commit. They add no `schemas/v3/*`, no `ownership/contracts.json` entry and no package bump, so the additive-contracts check ignores the six new ids. All six edit `project-contracts/src/index.ts`, and **evactor1 contains evcapt1** (stacked). · Fix: merge !178 → !180 → !179/!172/!175/!173 (in that order, each rebased), then one V5FREEZE1 (schemas/v3 + contracts.json + alpha.4). Optional: one barrel file per MR so `index.ts` stops conflicting. · 2 M (+ V5FREEZE1 already planned)
- **BV5-2 (S2) · Shared standalone files (package.json, palette.ts, register.ts, renderer.ts).** Every NAV MR and every V5 W1 standalone MR appends at the same lines: `core/navigation/register.ts:12-14` (SURFACES), `webview/views/renderer.ts:10-19` (one import + `registerLayout` per kind), package.json commands/views/menus/keybindings, and package-lock. NAVWIRE1 (in PLAN) should ship **self-registration** (each surface/layout file registers itself, one generated `layouts/index.ts` / `surfaces/index.ts`), not just fill the list, otherwise V5 rebases hit the same wall. · 4 M on top of NAVWIRE1

## a. Architecture as merged (new findings only)
| # | Sev | Finding (evidence) | Fix | M |
|---|---|---|---|---|
| a7 | **S1** | **The renderer drops every message the host sends.** `NavHost.message()` sends views as `{id,title,layout}` (`src/core/navigation/navHost.ts:75`), while `parseHostMessage` requires `bindings: []` on each view (`src/webview/views/model.ts:84-86`) and returns null. Once a surface is wired, the nav webview stays empty. No test feeds the host output to the parser. | Send the full ViewDef; add a host→parser round-trip test. Put it in NAVWIRE1. | 2 |
| a8 | **S1** | **No binding provider exists.** The SPI lists 12 binding sources, but nothing in `src/` resolves one or posts `view-data`, and `src/views/viewHtml.ts:6` has no caller (the nav webview is never hosted on main). Even with all layout kinds merged, views show no rows. | `BindingProvider` registry keyed by source + `view-data` sender + a test that every source used in `DEFAULT_VIEW_CATALOG` has a provider or a declared hole. Check which NAV MRs (TODO1/HOME1/LIN1/HIST1) already bring theirs before assigning. | 10 |
| a9 | S2 | The renderer and its test still import the stub (`renderer.ts:8`, `model.ts:6`, `tests/navRenderer.test.ts:8` → `core/navigation/navStub.ts`), which carries a second `LAYOUT_KINDS`. The two copies can drift with no compile error. | Import from `navTypes.ts` (vendored SPI) and delete `navStub.ts`. | 1 |
| a10 | S2 | The ladder maps every artifact to `artifactKind:"other"` (`core/navigation/projectLadder.ts:17`), so kind-specific catalog views (sql, spark, hop, powerbi, erd) never match. | Derive the kind from the ProjectMap component type and check it against `ARTIFACT_KINDS`. | 3 |
| a11 | S2 | The catalog is never validated at load: `validateViewCatalog/Overrides` are re-exported but not called (`navigationService.ts:23,55-59`), so a bad `.datapass/views.json` (NAVCAT1) fails silently. | Validate in `setCatalog` and in the constructor; show a schema-id mismatch as a visible error. | 2 |
| a12 | S3 | `view-data` is matched on `viewId` only (`renderer.ts:88-91`), so late data can land on the next node. | Add `nodeId` or a sequence number to `view-data` and check it. | 1 |
| a13 | S3 | The layout registry is a module-level Map that silently overwrites a kind, and tests leak registrations (`renderer.ts:14-15`, `tests/navRenderer.test.ts:69`). `surface` is special-cased by string. | Inject a registry that rejects duplicates; give each layout a `needsData` flag. | 3 |
| a14 | S2 | Missing tests: `navHost.ts` (context keys, two-way selection sync, `pickView`), `register.ts`, `navView.ts`. No fixture per layout kind or per binding. | Contract test over `LAYOUT_KINDS` × `DEFAULT_VIEW_CATALOG` (known gaps listed) + `NavHost` test with a fake session. NAVE2E1 depends on it. | 4 |
| a15 | S2 | `scripts/verify-common.mjs` (sha256 of the vendored tarballs) runs in neither `prepackage` nor CI. `vendor/common/manifest.json` records Common `5fda1a0` (29 Sept, ~500 commits behind). No runtime check of contract schema ids. Complements a2/REPIN5. | Add verify-common to `prepackage` and `verify_and_package`; check supported schema ids against the manifest at activation. | 3 |

## Common (analyzers, coverage registry)
| # | Sev | Finding | Fix | M |
|---|---|---|---|---|
| k1 | S2 | **COVREG3 !130 does not remove the main Common conflict.** 18 of the 21 open v4 analyzer MRs touch `coverage-registry.json`. COVREG3 adds per-package fragments but still commits the assembled file (its `check` fails on any difference), so every MR keeps editing both. It is 176 commits behind main (98 families vs 114). | Rebase COVREG3 and split on current main; stop committing the assembled file (build it in `check:coverage`, gitignored) or add a regenerate-on-merge driver in `.gitattributes`. **Merge it before the analyzer batch.** | 4 |
| k2 | S2 | **Stacked and duplicated MRs.** xmlshare1 !190 contains 15 of ssis1 !185's 16 files; yamlseq1 !191 contains all of elt1 !189 (and does not deduplicate the YAML readers, despite its name). analyzers-orchestration is alpha.1 on main, ssis1 and xmlshare1 both bump it to alpha.2, adfdf1 to alpha.3. iacarm1 !147 is 189 commits behind main. | Merge order ssis1 → xmlshare1, elt1 → yamlseq1 (each rebased on its parent's merge); one version bump per package per VERBUMP round, not per MR. | 1 |
| k3 | S3 | Five near-identical YAML parsers (analyzers-cicd, -dbt, -ml, -ml-pipeline, iac-cloud; 158–225 lines each, differing by 4–16 lines) plus `analyzers-config` readYaml. XML and M readers move into the dispatcher's root `index.ts` (xmlshare1, mreader1), which mixes readers into the dispatch API. | One `@juliandatapass-group/analyzers/readers` subpath (xml, yaml, m) + a qualification corpus; V5 debt package. | 4 |
| k4 | S3 | Every family's file-type signature is written twice, in the package `src` and in the registry JSON (`check-coverage.mjs:42-63` diffs them). Hotspots: `analyzers/src/sql/index.ts` (6 branches) and `sql/extractor.ts` (4). | Generate fragments from each package's exported signature; one file per SQL object family, collected through a sorted list. | 4 |

## b. MR merge order (detail)
PENDING (subagent running): pairwise conflict matrix for vscode !192–!217, pipeline state, stacked branches. Until then the order in V4-STATUS-REMAINING b1 stands.

## c. CI saturation (job level)
PENDING (subagent measuring durations). Facts read so far:
- vscode: `desktop_acceptance` (4 shards) and `ui_smoke` each run `npm ci` again and do not `needs: verify_and_package`, so the packaged VSIX is not what gets tested and npm installs run 6× per MR pipeline.
- cloud: one main pipeline runs ~13 `*_ui` jobs at once (api_explorer_ui, archv1_ui, runx1_ui, pract3a_ui, vis5_ui, hop6a_ui, hopc1_ui, scale_ui, dash1_ui, export1_ui, hop_browser, iac_vsix, verify_package). At 09:13 UTC, 13 of the 20 running jobs were cloud.

## d. Release checklist additions (to V4-STATUS-REMAINING d)
- d10 a7 + a8 merged, and NAVE2E1 asserts that a non-empty view renders at each ladder level (not just that the webview opens).
- d11 `verify-common` green in `prepackage` (a15).
- d12 Install the VSIX built by CI (`verify_and_package` artifact + `.vsix.sha256`), not a local rebuild; tag `v1.2.0-rc.1` from that SHA.
