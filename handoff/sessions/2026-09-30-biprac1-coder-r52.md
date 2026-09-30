# Hand-off — CODER BIPRAC1 (R52, local_74f9adf1), 2026-09-30

GO: `D:\PROJ\datapass\go\BIPRAC1.md` (rules V3.8). Context at hand-off: ~330 K (over the 180 K limit), so this session stops here.

## State
- Common MR **!110** `v4/biprac1` → main, non-draft, description set, SHA `765a76c`, pipeline 2896272117 (was pending at hand-off). origin/main (5932a4c) already merged in; no conflicts.
- Worktree: `D:\PROJ\datapass\datapass-vscode-common\.worktrees\biprac1` (node_modules installed, full build done).
- Local checks green: arch-lint + arch-catalog + practice-corpus tests (126), `check:contracts` (527), boundaries, coverage, provenance, contracts-additive, `validate_contracts.py`, `check_iac_corpus.py`.

## What shipped (see MR description and arch-lint README § BIPRAC1)
- `packages/arch-lint/src/families/bi/`: 24 detectors (storage mode, logic placement, model shape, RLS, refresh), TMDL + model.bim parser (`model.ts`), schedule parsing (`schedule.ts`), cards.
- arch-catalog: new decision points `bi.logic-placement`, `bi.model-design`, `bi.security` (`src/entries/bi.ts`); Power BI concepts list the detectors (coverage golden refreshed).
- Optional inputs: `ArchLintInput.constraints` (client-constraints/1), `TableVolume.rows`.
- Fixture `packages/arch-lint/tests/fixtures/bi/fixbi/` + `fixbi.golden.json`; test `tests/bi.test.mjs` also checks the practice-corpus answer key (all 7 BIPRAC1 bad cases found, finance model clean).

## Open / next
1. If pipeline 2896272117 fails: read the failing job log; likely suspects are goldens that count catalogue entries (arch-bridge `fakeerp.pack.md` was refreshed: 39 → 42) or cloud-side goldens after a later repin.
2. Merge order (arch-lint group): LAYER1b → PRACT2 → MODEL1 → BIPRAC1. When rebasing !110 after them: union `src/cards.ts` spreads, `model.ts` optional fields (PRACT2 may also add `constraints`: keep one field), run `node packages/arch-lint/scripts/generate-registry.mjs`, then `UPDATE_GOLDEN=1` for `packages/arch-bridge/tests/arch-bridge.test.mjs` and `packages/arch-catalog/tests/concepts.test.mjs` if catalogue/concept counts moved; re-run `node --test packages/arch-lint/tests/ packages/arch-catalog/tests/`.
3. `arch-lint.test.mjs` scale-set expectation now includes `medium` (BI storage/refresh detectors).

## Scope decisions (for the PM)
- Metric drift across dbt / SQL / DAX left to LAYER1 (divergent logic) and PRACT2 (answer key PB-MET-* is PRACT2's); Power Query cleaning left to LAYER1 (PB-PBI-015). Snowflake is checked on the Power BI model only (MODEL1 covers SQL/dbt).

## Lessons
- In this repo the Bash tool mangles `\\` inside heredocs: write scripts with the Write tool.
- The git-credential token for gitlab.com has no API scope; use `glab` (`C:\Users\julia\AppData\Local\Programs\glab\glab.exe`) to update an MR description.
