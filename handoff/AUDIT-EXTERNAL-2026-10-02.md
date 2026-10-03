# External full audit of DataPass: brief for Codex (Sol 6.1)

This brief was written by PM DataPass 32 (Claude) on 2026-10-02 at Julian's request: a complete audit by an external AI.
You are the auditor. The Claude PM stays the architect, and your findings become packages that it plans.

## Mode
- Read-only on code. You only write your report (see Output). No branches, MRs, merges or pushes of code.
- Don't run client code or the DataPass extension against real projects. Running the repos' own unit tests is allowed (`npm test`, `npx tsx --test …`), at most 2 at a time, because the PC also runs the CI.
- Merges continue while you audit, so audit the SHAs below and name the SHA in every finding.

## Scope
| Repo (D:\PROJ\datapass\…) | SHA |
|---|---|
| datapass-vscode | 48656541 (tag v1.2.0-rc.1, V5 release candidate) |
| datapass-vscode-common | a311b0fb (pinned by v1.2.0-rc.1) |
| datapass-vscode-cloud, datapass-studio, datapass-vscode-hub | current origin/main |

Context: `datapass-vscode/handoff/CURRENT.md`, `PLAN.md`, `ARCH_DECISIONS.md`, `FEATURES.json` (what V4 and V5 claim to deliver), `go/V5-ACCEPTANCE.md`.

## Known at release (PM 32, 3 Oct 22:26; confirm or refute, don't just repeat)
- VSIX 13.8 MB, 87 % of it the bundled Python/sqlglot parser runtime. Accepted for the rc; a platform-specific VSIX is planned for V5.1.
- Activation median 336 ms (budget 500 ms), measured while CI was running.
- 9 local Common stub markers came back in 7 src files after REPIN8.
- Cloud and Studio are not re-pinned to Common a311b0fb.
- Report: go/handoff-inbox/V5REL1-report.md in the D:\PROJ\datapass workspace.

## What to audit, in priority order
1. **Claims vs reality:** for each V4/V5 feature in FEATURES.json marked merged, is it really reachable and working, or only scaffolded, a stub or a typed hole? Give a list per feature.
2. **Boundaries** (CLAUDE.md "Non-negotiable boundaries"): discovery never executes client code; every process spawn goes through `src/core/spawnAllowList.ts` (MR !263, possibly not merged yet); no hidden AI or network calls; no credentials or FOIL-private data in these public repos.
3. **Architecture:** drift from ARCH_DECISIONS, duplicated modules across repos (vendored Common copies, Studio view-spi copy), contract versioning, and pin drift between Common and its consumers.
4. **Tests:** weakened or skipped assertions, tests that cannot fail, flaky load-sensitive waits, and important paths with no test.
5. **Dead code and complexity:** unused exports and commands, palette entries without a feature, oversized files.
6. **CI and the merge process:** `.gitlab-ci.yml`, and whether a merge can land untested (the 2 Oct incident: !197).
7. **UX coherence** of V5 navigation, from the code and the qa/ screenshots.

8. **Comparison (Julian, 3 Oct):** after the tag, the PM merges a V5.1 night wave: CIDIET1, STUB2, REPINCS1, PERF1, MERGEQ1 shadow; see `git log v1.2.0-rc.1..origin/main` and go/handoff-inbox/<pkg>-report.md. Rate each one: does it fix a real problem you also found, miss the root cause, or add risk? Add a short "PM V5.1 vs audit" table.

## Output
- One file: `datapass-vscode/handoff/audits/EXTERNAL-AUDIT-2026-10.md`, committed and pushed with `git push -o ci.skip origin HEAD:main`. This is the only push allowed.
- An executive summary of at most 15 lines, with a verdict per area.
- Findings, each with: ID, severity (Critical/High/Medium/Low), repo@SHA file:line, evidence, a suggested fix of at most 2 lines, and a size estimate in M.
- Rank the findings by severity. Do not pad: a short list of real findings beats a long one.
- End with your top 5 "fix before V5 release" and top 5 "plan for V5.1".
