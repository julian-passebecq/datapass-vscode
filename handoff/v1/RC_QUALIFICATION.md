# 1.0.0-rc.1 qualification (M3)

Owner: PM DataPass 1 (decides 1.0.0). Written by CODER DataPass RC on 2026-09-27 for package V1-RC
([PLAN.md](../PLAN.md) § V1 → 1.0.0, M3; tech-lead roadmap M3 and §4 acceptance matrix).
Verdict rule: 1.0.0 only when every gate below is PASS. NOT_RUN, BLOCKED, HUMAN and "deferred" stay open.

## The pinned artifact

The candidate is built **once** by `npm run qa:rc` (new in V1-RC, `scripts/qa/rc.ts`) from a clean commit. It writes
`out/rc/1.0.0-rc.1/manifest.json` (format `datapass.rc-manifest` 1): commit, version, VSIX SHA-256 and size, lockfile
SHA-256, Node, npm, vsce, OS, VS Code, and one row per gate.

| | Branch dry run (this PR) | Pinned candidate (to do after merge) |
|---|---|---|
| Commit | `7783da6` (claude/v1-rc) | the squash commit on `main` |
| VSIX SHA-256 | `2a2ae3cee4a6183ad6024fbcbbaeddb76b2a576ca7d07c440424f622d641423d` (814,179 bytes) | recorded by `qa:rc` |
| Built on | Windows 11 (10.0.26200) x64, Node 26.9.0, npm 11.19.1, vsce 3.9.2, VS Code 1.139.1 | same command, same machine class |

After the merge, the PM (or the coordinator) runs on an up-to-date, clean `main`, then gives that VSIX path and hash to
the assistant for [RC_CHECK.md](RC_CHECK.md):

```
npm ci
npm run qa:rc -- --upgrade-from <datapass-vscode-0.27.0.vsix> --auto <clone of datapass-vscode-codex-auto>
```

The 0.27.0 VSIX for `--upgrade-from` is built from the release commit `a07745d` (`npm ci && npm run build && npx vsce
package --no-dependencies`); there is no GitHub release asset. Keep both VSIX files: 0.27.0 is the rollback.

## Gates

| Gate | Status | Evidence |
|---|---|---|
| VSIX built once from a clean commit, hash recorded | PASS (dry run) | `qa:rc` on `7783da6` |
| Upgrade 0.27.0 → 1.0.0-rc.1 in one profile | PASS (dry run) | `qa:rc --upgrade-from`: VS Code lists 0.27.0, then 1.0.0-rc.1 |
| Clean install reports the built version | PASS (dry run) | `qa:rc`: VS Code 1.139.1 lists 1.0.0-rc.1 |
| `npm run verify` | PASS | local, `7783da6`: 578 tests, 576 pass, 0 fail, 2 skipped (the two VSIX-gated QA tests; CI runs them) |
| Desktop suite, Windows | see CI | extension-ci `desktop (windows-latest)` on this PR |
| Desktop suite, Ubuntu | see CI | extension-ci `desktop (ubuntu-latest)` on this PR |
| Performance harness | see CI | extension-ci `perf` jobs (activation, first paint, full refresh, no storm; 2× budget envelope) |
| qa:prepare + qa:ui smoke on the packaged VSIX | see CI | extension-ci `validate (ubuntu-latest)`; **Playwright, not Codex Computer Use** |
| J01–J10 synthetic-client journeys | **BLOCKED — setup blocker** | `qa:rc --auto`: `datapass-codex-fakeclient`, `-fakeclient2`, `-fakeclient3` are empty repositories. The client AI (Codex Wind Lab) must fill them; the journeys then run through Codex (`qa:prepare --launch`). The doc-pipeline smoke is regression coverage, not evidence for J01–J10. |
| Codex desktop Computer Use | **open** | QA-0 retry never succeeded (Computer Use saw no window). Only the PM may defer it, naming the Playwright route as the tested automation. |
| Restricted Mode on the installed VSIX | **HUMAN** (RC_CHECK step 2) | See finding F1. Unit tests cover the code paths (`tests/capabilities.test.ts`, Git/native-test/file-version refusals). |
| Missing tools, no sign-in on activation | covered + HUMAN | desktop `toolchainFlows`/`checkFlows` (fixed read-only probes, honest states); real accounts in RC_CHECK step 5 |
| Real-screen / sign-in check | **HUMAN** | [RC_CHECK.md](RC_CHECK.md), ~20 min, batched by PM ASSISTANT DataPass 1; includes the deferred 0.26.0 / 0.27.0 checks |
| Authorized private pilot (FOIL) | **open** | waits for the FOIL AI (client side); its data and logs stay outside this repository |

## Acceptance matrix (roadmap §4) → evidence

| AC | Automated evidence today | Still open |
|---|---|---|
| AC-01, AC-02 onboarding, partial/wrong identity | desktop `openClientProjectFlows` (v26-open-client) | J01 on the synthetic client |
| AC-03 architecture/details/tree | desktop `v3Flows`, `readinessFlows` | J01 |
| AC-04 A/B/C, rapid selection | desktop `variantFlows`, `activeVariantFlows`; V1-FRESH race tests (#103) | J02 |
| AC-05 context from a file | desktop `fileContextFlows` | J04 |
| AC-06 AI orders | desktop `workOrderFlows`, `agentPanelFlows` | J04 |
| AC-07 Git loop | desktop `gitFlows` | J06 |
| AC-08 native Test | desktop `nativeTestFlows` (V1-TEST #104) | — |
| AC-09 tools, connections, MCP | desktop `toolchainFlows`, `toolkitFlows`, `checkFlows` | J10; real sign-in (RC_CHECK 5) |
| AC-10 formats, trust, malicious input | V1-LOAD unit tests (#102), `checkFlows` | Restricted Mode (F1, RC_CHECK 2) |
| AC-11 surface, modes, upgrade | `tests/palette.test.ts`, desktop `experienceFlows`; upgrade by `qa:rc` | J08 |
| AC-12 performance, QA truthfulness | `perf` jobs; `tests/qaRc.test.ts` (no gate passes without evidence), qa-report tests | — |

## Findings

| Id | Severity | Finding | Proposal |
|---|---|---|---|
| F1 | minor (test gap) | No automated route reaches Restricted Mode on this machine: the test-electron desktop harness is always trusted (VS Code trusts a test host), and a Playwright launch of the installed VSIX without `--disable-workspace-trust`, with trust enabled and no trusted folder stored, still opened trusted (VS Code 1.139.1, Windows). Both attempts were detected, not counted as passes. | Keep the real-screen step (RC_CHECK 2). V2: find why the Playwright window is trusted (policy, launch args) and automate it. |
| F2 | setup blocker | The three synthetic-client native repositories are empty, so J01–J10 cannot run. | Client AI fills them; then re-run `qa:rc --auto` and the Codex run. Not a product pass until then. |
| F3 | note | CI installs with `npm install`; the pinned build uses `npm ci` (lockfile enforced). | V2: switch CI to `npm ci` without updating dependencies. |
