# Ready-to-paste prompt for the next Claude pass

Work on `julian-passebecq/datapass-vscode`, the DataPass VS Code control plane (not Mosaic, not
Mongoku, not Power Ops).

1. Read `CLAUDE.md`, then `handoff/V1_HANDOFF.md` (status, v1 gates, next passes) and the top
   section of `IMPLEMENTATION_STATUS.md`. `handoff/V2_1_HANDOFF.md` and `handoff/V2_2_HANDOFF.md`
   are the architecture reference, not the status.
2. Establish the real state before editing: `git fetch`, `git log --oneline -10 origin/main`,
   open PRs (`gh pr list --state all`), and `git worktree list`. If a handoff and the repository
   disagree, the repository wins; say which document is superseded.
3. Branch from current main. Run `npm ci`, `npm run check`, `npm test` and `npm run test:desktop`
   first to confirm the baseline is green.
4. Implement the next open gate from section 4 of `V1_HANDOFF.md` (after 0.9.3: **Pass 10,
   shared resources and workload bindings**). Keep it additive: manifest v2 only, migration-safe,
   no secrets or env values in Git, the Work view shows it, preflight uses it, and a host-level
   operation shows its impact on every binding of the resource.
5. Test like the previous passes: pure model tests, editor-schema/runtime agreement (Ajv), and
   desktop flows through the real commands with the scripted UI (`tests/integration/`). Use
   synthetic, non-FOIL fixture data. Never weaken an existing assertion to make a test pass.
6. Finish with: version bump (package.json and lock together), an `IMPLEMENTATION_STATUS.md`
   section (implemented / fixed / verified / still needs a human), `npm run package`, and a
   summary for Julian in plain language. Ask before pushing or opening a PR.

Boundaries that never change are in `CLAUDE.md`: local-first; manual, reviewed AI exchange;
native tools do the work; discovery never executes project code; no credentials, auto-push,
auto-merge, provisioning or authority writes without explicit approval; no private FOIL material
in this public repository.
