# GitLens reuse audit (2026-09-29)
Source: `vscode-gitlens-main.zip` (read only, extracted to %TEMP% and deleted afterwards). Paths below are relative to `vscode-gitlens-main/`.

## 1. Licence (from `LICENSE` and `LICENSE.plus`)
- **MIT** (Copyright GitKraken 2021-2026, Eric Amodio 2016-2021): everything **except any directory named `plus`**. To copy: keep the MIT notice and add a line to our ThirdPartyNotices.
- **GitLens Pro licence (copying forbidden)**: 4 directory trees, `src/plus/`, `packages/plus/` (agents, ai, commit-graph, commit-graph-ui, git-github, integrations), `src/webviews/plus/` and `src/webviews/apps/plus/`. The licence says you may use it only with a paid subscription, it assigns your patches to GitKraken, and it forbids copying. **Inspiration only: no code, no copied prompts.**
- What is Pro: the commit graph UI, Launchpad, the GitHub/GitLab API integrations, Cloud Workspaces, all AI features (`packages/plus/ai/src/prompts.ts`), timeline, treemap, patch/drafts, startWork.
- What is MIT: `packages/git` and `packages/git-cli` (the whole git layer, including `providers/graph.ts` for graph *data*), `packages/core|utils|ipc|components`, `src/annotations`, `src/hovers`, `src/codelens`, `src/views` (non-plus tree views, including `worktreesView.ts`), `src/worktrees`, `src/webviews/commitDetails`, `src/webviews/rpc` and `src/git/remotes`.

## 2. Architecture worth reusing
- **Git layer (MIT)**: `packages/git/src/service.ts` + `repositoryService.ts` define a per-repo facade over sub-providers. `packages/git-cli/src/providers/*.ts` has 20 domains (blame, branches, commits, diff, graph, refs, remotes, stash, status, worktrees...). `packages/git-cli/src/exec/git.ts` (1,481 lines) plus `gitQueue.ts` (326 lines, a concurrency-limited git process queue) and `locator.ts` (finds git.exe). `packages/git/src/cache.ts` is a per-repo cache with invalidation by `watching/`. Parsers are in `packages/git/src/parsers`. This is the best candidate to copy.
- **Multi-repo**: `src/repositories.ts`, `src/views/repositoriesView.ts`, `worktreesView.ts` and `src/worktrees/worktreeTaskService.ts` (70 lines) are MIT. Cloud Workspaces (`src/plus/workspaces/*`) are Pro and need a GitKraken account.
- **Remotes/forges**: `packages/git/src/remotes/gitlab.ts` + `matcher.ts` (with tests) are MIT: URL → forge, deep links to commits/MRs/files, self-hosted GitLab config (`src/git/remotes/remoteProviderConfigs.ts`). The GitLab **API** (MRs, Launchpad) is Pro (`packages/plus/integrations/src/providers`).
- **Blame/hover (MIT)**: `src/annotations/lineAnnotationController.ts` (452 lines, end-of-line blame), gutter blame/heatmap/changes providers, `src/hovers/`.
- **Webview infra (MIT)**: `src/webviews/webviewController.ts`, `rpc/`, `packages/ipc`. Lit components are in `packages/components`. The graph UI is Pro.
- **AI (Pro)**: `src/plus/ai/aiProviderService.ts` routes to several providers, including `vscodeProvider.ts` (VS Code `vscode.lm` / Copilot models). `aiIgnoreCache.ts` excludes files from prompts. Actions include explainChanges, generateMessage, generateCommits, reviewChanges, generateChangelog and generateSearchQuery (`src/git/search.naturalLanguage.ts`). Design ideas only.

## 3. Top ideas for DataPass
| # | GitLens feature → DataPass adaptation | Target | Reuse | Size |
|---|---|---|---|---|
| 1 | Git CLI layer + queue + cache → one shared `GitService` for all repos of a project (Oracle VM / Fabric / Databricks) | common lib → Hub + Git companion | copy MIT (`packages/git`, `git-cli`) | M |
| 2 | Commit graph → **project graph across 3 repos** on one time axis, each commit tagged with lineage impact (HG1b) | Git companion / Cloud | graph data from MIT `providers/graph.ts`; UI reimplemented | L |
| 3 | End-of-line blame → **blame on a pipeline/lineage node** (last commit, author, decision id touching it) | Cloud workbench | adapt MIT `lineAnnotationController.ts` logic | M |
| 4 | Gutter heatmap → **change heat per layer/segment** (bronze/silver/gold age) on the lineage graph | Cloud | inspiration (MIT heatmap algorithm) | S |
| 5 | Worktrees view → **one worktree per architecture variant**, variant switcher + diff of `.datapass/decisions/*.json` | Hub | adapt MIT `worktreesView.ts`, `worktreeTaskService.ts` | M |
| 6 | Remote matcher → GitLab (self-hosted) deep links from any node/decision to the file/commit/MR | Git companion | copy MIT `remotes/gitlab.ts`, `matcher.ts` | S |
| 7 | Launchpad → **project MR inbox** across repos (GitLab API, CI status, impact size) | Hub dashboard | reimplement (Pro) | M |
| 8 | AI explain/commit message/review → "explain this change's lineage impact", decision-log draft via the client-AI bridge with an ignore list (`aiIgnoreCache` idea) for client data | AI bridge + Git companion | inspiration only (Pro) | M |
| 9 | Natural-language commit search → "which commits touched table X in any repo" | Hub | inspiration (Pro) over MIT search | S |
| 10 | Commit details webview + RPC → impact details panel for a commit | Git companion | copy MIT `webviews/commitDetails`, `webviews/rpc`, `packages/ipc` | M |

## 3 recommendations
1. Extract MIT `packages/git` + `packages/git-cli` (with LICENSE and a ThirdPartyNotices entry) into datapass-vscode-common as the single multi-repo git layer before HG1b grows its own.
2. Add a CI licence guard that rejects any file copied from a `plus` path (grep for the GitKraken Pro header): graph UI, Launchpad, AI and GitLab API must be reimplemented.
3. Plan ideas 2, 3 and 5 (cross-repo impact graph, node blame, worktree per variant) as the differentiators, and schedule 6 and 10 as cheap S/M quick wins.
