# V1-PERF — measurement first (TAMPON 25, 2026-09-26) — STOPPED, package bigger than estimated

## What this branch adds
- `scripts/perf.ts` (`npm run perf`, `-- --runs=N`, `-- --ci`):
  - builds a FOIL-sized fixture and launches a real VS Code 3 times (fresh profile, no other extensions);
  - prints and stores the medians (`out/perf/perf-report.json`);
  - with `--ci`, exits 1 above twice a budget.
- `tests/fixtures/perf/foilSized.ts`: 8 Git repositories (the hub and 7 others) opened as a multi-root workspace, 5,000
  files, 60 components with relations. Each origin is a GitHub URL rewritten to a local bare repository. Before every
  launch one new commit lands in each remote, so the `git fetch` has something to download.
- `tests/perf/suite.ts`: the runner inside the host. It reads the timings, times a second refresh, runs `git fetch` in
  the 8 repositories and counts the refreshes during the next 6 s.
- `src/extension.ts`: timings only. `perf()` in the Test API gives load, activate and the first refresh, plus
  counters: session refreshes (counted in Test mode only), session changes and Git view updates.
- `esbuild.mjs`: a one-line banner stamps when the bundle starts evaluating.
- `.github/workflows/ci.yml`: a `perf` job (Ubuntu and Windows) running `npm run perf -- --ci`.

## Numbers (Julian's PC, Windows 11, VS Code stable, medians of 3)
| | Measured | Budget |
|---|---|---|
| Activation (bundle evaluation + `activate()`) | **234 ms** (load 79–220, activate 87–155) | < 500 ms ✅ |
| First project refresh | **12.5 s** (9.6–15.0) | < 3 s ❌ (×4) |
| Warm refresh (2nd) | 4.4–5.5 s | — |
| Refreshes after `git fetch` ×8 | **0** (0 Git view updates) | no storm ✅ |

## Why the first refresh is slow (profiled once, instrumentation not kept)
One cold `session.refresh` on the fixture took 7.7 s, plus 0.9 s of inventory; `galaxy.refresh` added about 1.6 s.
- `detectProjectRoot`: 0.3 s.
- `probeTools`: 2.5 s. It runs in parallel with `loadProjectContext` (1.1 s), and nothing else overlaps it:
  `observeProject` waits for both.
- `observeProject`: 4.8 s.
  - `locateRepositories`: 2.3 s. The Git reads run one repository after another, each with about 4 `git` spawns.
    Parallelising them (tried) did not measurably help cold; Windows process start is the cost.
  - Expected-file stats: 1.2 s for 228 entries through `vscode.workspace.fs` (a round trip per stat).
  - `git ls-files`: 1.3 s, sequential per repository.
- `scanInventory`: 0.9 s (4 `findFiles` over 5,000 files).

## Why I stopped (rule: package bigger than estimated)
The brief assumed the cost was in activation, and planned lazy imports behind the views. Activation is already under
budget at about 230 ms, so lazy imports would not change a measured number. The cost is the first refresh.
Reaching 3 s means reworking the refresh pipeline:
- overlap `probeTools` with `observeProject`;
- defer the inventory and Galaxy until after the first render;
- use node `fs` for the stats;
- run `ls-files` in parallel;
- possibly render the tree progressively.

That work is in `src/work/session.ts`, `src/work/projectObserver.ts` and the Galaxy view, all outside the owned files.
It needs ARCHI's go and a new estimate.

## Open for ARCHI
1. The CI `perf` job would fail today on the first refresh (above 6 s). Keep it failing, report the refresh without
   failing until the refresh package lands, or gate only activation and the fetch storm?
2. A refresh package: the candidates above, in order of gain.
3. Lazy imports: drop them from V1, since activation is under budget.
