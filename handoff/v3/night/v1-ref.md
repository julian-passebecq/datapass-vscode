# V1-REF — progressive refresh (TAMPON DATAPASSVSCODE - H 2, 2026-09-26)

Escalated from V1-PERF (#88). Spec: ARCHI DataPass 1's note in `handoff/PLAN.md` (V1-REF row).

## What changed
- **Two steps per refresh** (`src/work/session.ts`).
  1. Step one paints the project, its architecture and the tree: the manifest, the repositories and the component files.
  2. Step two gathers the tool probes, readiness (env files, `.vscode/extensions.json`, binding folders) and the
     inventory while the views already show step one.
  - Each step fires `onDidChange`; `onDidPaint` says which step ended ("first-paint" / "settled").
  - `refresh()` still resolves when both are done, so callers and tests see a complete session.
  - A newer refresh supersedes an older one: the older stops writing and resolves with the newer.
  - Until the first probes answer, the map lists no tool as missing (`toolsPending`).
  - Readiness shows "not checked" for env files until step two.
- **Galaxy after the first paint** (`src/extension.ts`).
  - `refreshState` starts the Galaxy detection once the session has painted, and runs it beside step two.
  - The cards get their operation readiness when the session settles.
- **Probes in step two, capped at 6** (`src/core/capabilities/probe.ts`).
  - On Windows, starting a process holds the extension host's thread, so the probes no longer run beside the
    first paint's Git reads.
  - A second refresh waits for a probe run already in progress instead of starting the CLIs again.
- **Git reads side by side, capped at 4** (`src/work/projectObserver.ts`).
  - Repositories are located and read in parallel.
  - The origin is asked once per folder: discovery and `gitState` share the answer, where they each asked before.
  - The Git folder and FETCH_HEAD are read from disk, where Git used to be run with `rev-parse --git-dir`.
- **Per-clone cache keyed by HEAD + index mtime** (`src/core/git/repoCache.ts`).
  - The fingerprint is HEAD, the ref it names (or packed-refs' mtime), the index's mtime and size, and the config's
    mtime (the common one too, for a linked worktree). All of it is read from disk, never through Git.
  - While the fingerprint holds, the origin answers and the `ls-files` tracking answers are reused.
  - `git status` is never cached: editing a file changes it without touching HEAD, the index or the config.
  - Failed or cut-short answers are not kept.
- **One `git ls-files` per clone**: the paths when they fit on a command line (6,000 chars), else the whole index
  read as a membership list. The F03 rule is unchanged: a failed or cut-short answer is "unknown", never "untracked".
- **node `fs` on disk**. `vscode.workspace.fs` costs a round trip per call and is slow while the window starts, so
  these now use node `fs`:
  - the component-file stats and listings, and hashing reads;
  - the project-root detection (the 8 folders are checked in parallel);
  - the inventory's head reads (one open and one read, no longer a full read).
- **Perf harness**.
  - `firstRefreshMs` is now the first paint; `fullRefreshMs` covers everything, Galaxy included.
  - Both are gated in CI at twice their budget (3 s and 6 s), with activation and the fetch storm.
  - The session's per-step timings are in the report (`sessionSteps`).

## Numbers (Julian's PC, Windows 11, VS Code stable, `npm run perf -- --runs=5`, medians)
| | Before (#88 harness, main) | After | Budget |
|---|---|---|---|
| Activation | 153 ms | 131 ms | < 500 ms |
| First paint (project, architecture, tree) | 8.3 s (the whole refresh) | **1.9 s** | < 3 s ✅ |
| Full refresh (probes, readiness, inventory, Galaxy) | 8.3 s + Galaxy | **5.0 s** | < 6 s ✅ |
| Refreshes after `git fetch` ×8 | 0 | 0 | ≤ 1 ✅ |

A typical first refresh: root 6 ms, context 380 ms, repositories 1.4 s, files 1.5 s, tracking 1.9 s (first paint),
inventory 3.3 s, probes 5.1 s. Timings on this PC vary ±30 % with other sessions running.

## Left as is
- `loadProjectContext` still reads through `vscode.workspace.fs` (about 350 ms cold).
- The inventory's `findFiles` (search service) is untouched.
- The Galaxy adapters run their own CLI checks. They now run after the first paint, not before it.
- A persistent (cross-window) cache would speed the first refresh of a new window further. It is not done: the
  in-memory cache already covers every refresh after the first one.
