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
| datapass-vscode | 08c7237 |
| datapass-vscode-common | a311b0f |
| datapass-vscode-cloud, datapass-studio, datapass-vscode-hub | current origin/main |

Context: `datapass-vscode/handoff/CURRENT.md`, `PLAN.md`, `ARCH_DECISIONS.md`, `FEATURES.json` (what V4 and V5 claim to deliver), `go/V5-ACCEPTANCE.md`.

## What to audit, in priority order
1. **Claims vs reality:** for each V4/V5 feature in FEATURES.json marked merged, is it really reachable and working, or only scaffolded, a stub or a typed hole? Give a list per feature.
2. **Boundaries** (CLAUDE.md "Non-negotiable boundaries"): discovery never executes client code; every process spawn goes through `src/core/spawnAllowList.ts` (MR !263, possibly not merged yet); no hidden AI or network calls; no credentials or FOIL-private data in these public repos.
3. **Architecture:** drift from ARCH_DECISIONS, duplicated modules across repos (vendored Common copies, Studio view-spi copy), contract versioning, and pin drift between Common and its consumers.
4. **Tests:** weakened or skipped assertions, tests that cannot fail, flaky load-sensitive waits, and important paths with no test.
5. **Dead code and complexity:** unused exports and commands, palette entries without a feature, oversized files.
6. **CI and the merge process:** `.gitlab-ci.yml`, and whether a merge can land untested (the 2 Oct incident: !197).
7. **UX coherence** of V5 navigation, from the code and the qa/ screenshots.

## Output
- One file: `datapass-vscode/handoff/audits/EXTERNAL-AUDIT-2026-10.md`, committed and pushed with `git push -o ci.skip origin HEAD:main`. This is the only push allowed.
- An executive summary of at most 15 lines, with a verdict per area.
- Findings, each with: ID, severity (Critical/High/Medium/Low), repo@SHA file:line, evidence, a suggested fix of at most 2 lines, and a size estimate in M.
- Rank the findings by severity. Do not pad: a short list of real findings beats a long one.
- End with your top 5 "fix before V5 release" and top 5 "plan for V5.1".
