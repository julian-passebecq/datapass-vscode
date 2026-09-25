# Ready-to-paste prompt for the next Claude pass (V3)

Work on `julian-passebecq/datapass-vscode`, the DataPass VS Code workbench (not Mosaic, not Mongoku,
not Power Ops).

1. Read `CLAUDE.md`, then `handoff/V3_HANDOFF.md` (status, audit reconciliation, what changed, next
   steps) and the top of `IMPLEMENTATION_STATUS.md`. `handoff/v3/02_ARCHITECTURE.md` is the model;
   `docs/PREPARING_A_PROJECT.md` is the contract an AI uses to prepare a project.
2. Establish the real state first: `git fetch`, `git log --oneline -10 origin/main`, open PRs
   (`gh pr list --state all`), `git worktree list`. If a handoff and the repository disagree, the
   repository wins; say which document is superseded. `git worktree list` may show parallel sessions
   working beside this one.
3. Branch from current main. Run `npm ci`, `npm run check`, `npm test`, `npm run test:desktop`.
4. 0.16.0 (work and DevOps) and 0.17.0 (windows and work views, `handoff/v3/07_WINDOWS_AND_POWER_OPS.md`)
   are done. Take the next item of `handoff/v3/04_NEXT_PASSES.md`: the PowerToy_UI Power Ops task
   (separate repository, effort high), then the V3 acceptance with Julian (testlab projects 4 to 7,
   FOIL), account qualification, then 1.0.0. Fixes from Julian's acceptance report come first when
   there is one.
5. Keep the V3 rules: declarations are expectations, only observations make something present;
   reviews and results are bound to operation, environment, target names and file digests; the
   runtime and editor schemas agree (extend `schemas/datapass-project.schema.json` and the parity
   corpus together); Git is read-only except the explicit fetch / fast-forward; nothing pushes or deploys.
6. Test like the previous passes: pure model tests with synthetic non-FOIL fixtures
   (`tests/fixtures/v3`), desktop flows through the real commands (`tests/integration/v3Flows.ts`),
   `scripts/workbench-preview.ts` for a visual check. Never weaken an assertion to pass.
7. Finish with a version bump (package.json and lock), an `IMPLEMENTATION_STATUS.md` section,
   `npm run package`, and a plain-language summary for Julian. Ask before pushing or opening a PR.
