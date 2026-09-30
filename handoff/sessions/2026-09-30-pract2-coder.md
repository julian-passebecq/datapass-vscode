# Hand-off: CODER PRACT2 (R54, local_8e28793e), 2026-09-30, rules V3.8

- **Package:** PRACT2 (`D:\PROJ\datapass\go\PRACT2.md`), constraint-driven architecture checks. Done; waiting for CI.
- **MR:** https://gitlab.com/juliandatapass-group/datapass-vscode-common/-/merge_requests/112 (non-draft, no auto-merge). Branch `v4/pract2`, worktree `D:\PROJ\datapass\datapass-vscode-common\.worktrees\pract2`, head `5d7fd33` (origin/main + LAYER1b merged in).
- **What changed:** new arch-lint family `constraint` with 5 detectors (metric-bypasses-semantic-layer, sensitive-column-grant-only, sla-schedule-mismatch, streaming-for-batch-sla, medallion-layer-no-guarantee), optional `ArchLintInput.criticalPaths` (FRESH1 shape), 2 catalogue points (`bi.metric-definition`, `governance.sensitive-data`), 5 concepts linked. The MR description has the details.
- **Local checks:** `npm run check` green; all package tests 542, 0 fail; `check:coverage` 0 problems; `contracts:additive` ok; `generate-registry --check` clean.
- **If CI fails:** run the failing job's command in the worktree. Refresh goldens only after review (`UPDATE_GOLDEN=1`): arch-lint `constraint-synthetic.golden.json` and `golden/pract2-cards.json`, arch-bridge `fakeerp.pack*`, arch-catalog `concept-coverage.md`.
- **Merge order (shared arch-lint files):** LAYER1b (merged) → PRACT2 → MODEL1 → BIPRAC1. The next merger regenerates the registry (`node packages/arch-lint/scripts/generate-registry.mjs`) and the goldens after merging main.
- **Update:** BIPRAC1 merged before PRACT2, so !112 now conflicts with main in `ids.generated.ts`, `registry.generated.ts`, `lint.ts` and `model.ts` (COORD Common 4). To re-merge:
  - Take both sides in `model.ts`: the `ArchLintFamily` union gains `'constraint'`, and `ArchLintInput` gains `criticalPaths` plus `CriticalPathFact`.
  - In `lint.ts`, keep both sides and include the `criticalPaths` context line.
  - Don't hand-merge the generated files. Regenerate them with `node packages/arch-lint/scripts/generate-registry.mjs`; `ORDER` must list `'constraint'`.
  - Then rebuild, run all tests, review the goldens and push.
- **Lesson:** don't pass regex text through Python non-raw strings. `"\b"` became a backspace character, which silently broke a regex. Use Edit instead.
