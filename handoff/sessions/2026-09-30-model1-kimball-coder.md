# Hand-off: CODER V4 MODEL1 Kimball (R55, Opus medium, rules V3.8), 2026-09-30

**State:** package done and pushed. Common MR !111 (`v4/model1-kimball`, commit 57cc62d) is ready (not draft) and has its description. Pipeline #2896326834 was pending at hand-off. Worktree: `datapass-vscode-common/.worktrees/model1-kimball`. The hand-off was triggered by context (306K > 180K), not by a blocker.

**What is in it:** the arch-lint `model` family (13 detectors with cards), the `busMatrix` / `inferDimensionScdTypes` / `classifyFactTables` projections, 4 new arch-catalog decision points (`entries/dimensional.ts`) plus `factless` on `modelling.grain`, and 3 decision-rationale static rules. The arch-bridge golden changes only its count line (39 → 43). The MR description has the full list.

**Checks:** `npm run check` green; `node --test packages/*/tests/*.test.mjs` gives 538 pass.

**Left for the successor:**
1. Pipeline green? If it failed: `glab ci get -p 2896326834` (glab is at `%LOCALAPPDATA%\Programs\glab\glab.exe` and is not on the bash PATH).
2. Merge order LAYER1b → PRACT2 → MODEL1 → BIPRAC1. Once LAYER1b (!108) and PRACT2 are on main: `git merge origin/main` in the worktree, then `node packages/arch-lint/scripts/generate-registry.mjs`, `npm run build`, then `UPDATE_GOLDEN=1 node --test packages/arch-lint/tests/model.test.mjs` (**review the diff**), then the arch-lint / arch-catalog / arch-bridge tests. Push, and report to COORD 18 and COORD Common 3. Likely conflicts: `ids.generated.ts`, `registry.generated.ts`, `src/cards.ts`, arch-lint README, the arch-catalog scale test and its README table, and the arch-bridge count line.
3. Never merge it yourself. COORD Common 3 merges.

**Notes:** R55 is not in the PLAN Team table (a COORD 18 assignment). `practices.test.mjs` now filters on `family === 'practice'`. The arch-lint scale test now allows `medium`.
