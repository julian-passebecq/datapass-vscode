# Implementation Status — 0.22.0: trust repairs, modes, context from any file, format checks, file versions

Date: 2026-09-26. Version `0.22.0` — released from main after five packages built in parallel on the
night of 26 September: A trust repairs (PR #36), B modes (#37), C context from any file (#34), D
format checks (#35), F file versions (#38). Plan and decisions D-01 to D-18:
[handoff/v3/10_GLOBAL_IMPROVEMENT_PLAN.md](handoff/v3/10_GLOBAL_IMPROVEMENT_PLAN.md). There is no
0.21.0: the toolkit catalogue planned under that number moves to 0.23 with package G (variants).
The packages' night notes (`handoff/v3/night/0.22-*.md`) are folded into this section.

### What's new

**A — Trust repairs (FOIL review F01–F08).**
- Costs: `src/core/project/costs.ts`, one aggregation for the option subtotal, the scenario table,
  the compact line, each declared line and the Workbench: per currency, never converted, monthly and
  one-time apart; a line without a figure is unpriced, an option without lines or with one unpriced
  line makes its decision unpriced; totals say "partial: n of m lines/decisions priced", "not priced"
  when nothing is. `ArchitectureImpact.costs.total` carries priced/total.
- File identity: `FileObservation.fingerprint` is `{ kind: "sha256" }` or `{ kind: "stat", size, mtimeMs }`
  (streamed hashing up to 64 MiB per file, 256 MiB per refresh); a failed read is `hashError` and no
  longer drops the file from the digest. `ArtifactView.digestStrength` exact / weak; a weak digest
  never matches a recorded qualification result and is not recorded with one.
- Git tracking of must-not-commit files: `tracking` tracked / untracked / unknown with a reason
  (`git ls-files -z` in batches; failure or output without the final NUL → unknown), shown as
  "could not check Git tracking" (warning), never clean.
- New repository state **unverified** (remote declared, Git repository, origin absent via `git remote`
  or its lookup failed): files browsable; *Get updates* (command and `session.fastForward`), work
  orders and operations refuse it; Locate / Retry in the Workbench, icon in the Project tree,
  readiness warning, Git view state.
- Bounded observation (`src/core/project/observation.ts`): 16 reads in flight, 2,000 expected files,
  byte budget; `ProjectObservation.incomplete` → "Project files: inspection incomplete (n skipped)".
- Prompts: a merged PR moves a card to `review` (done only per acceptance or a project rule); sprint
  planning asks for dates and capacity; no "beginner" phrasing. Packs and guide: `COORDINATED_CHANGE_RULE`
  (one PR per repository plus a cross-linked bridge PR); "bridge repository (coordination repository)";
  guide 07 "Trust limits (0.22)".

**B — Modes (experience presets).**
- 24 surface ids in `src/core/experience/surfaces.ts` (views, AI tabs, Project tree sections,
  Workbench views, status items, landing, badges) — a contract: add, never rename.
- `resources/experience/presets.json` (format `datapass.experience` 1): Vanilla ⊂ Standard ⊂ DataPass
  ⊂ Advanced; pure resolver preset → overrides → effective surfaces with origins; machine-scope
  settings `datapass.experience.preset` (default `standard`) and `datapass.experience.overrides`.
- Context keys `datapass.hidden.<surface>` on every view (`when`) and on menus that open a hidden
  surface; nothing hidden from the palette. *Switch Mode…*, *Customize DataPass Mode…*, *Reset Mode
  Customization*; status item `$(layers) DataPass: Standard` (`*` when customized); the 0.9 tool-health
  item only in Advanced. Standard+ lands on the Architecture panel (a workspace `datapass.startupView`
  wins). "Alternatives exist" on components an options.json decision can change.
- Blockers in every mode (D-03): Restricted Mode, manifest/graph errors, readiness errors, errors in
  project files, a refused secret.

**C — Copy Context for My AI from any file.** `datapass.copyFileContext` on the Explorer, the editor
tab and the editor (selection); pure builder `src/core/exchange/fileContext.ts`: question, repository
(bridge or native, remote identity, branch, HEAD, the file's Git state; "not in the bridge"; another
worktree of the same remote resolved by `--show-toplevel` + origin), owning components and scope,
their repositories' revisions, a folder excerpt, the file or selection (24 KB, 48 KB per pack, unsaved
and untitled buffers flagged, binary omitted), its diagnostics, and the answer rules. Local folders
replaced by `<local-path>`, then the shared `scrub()`; preview before copying; nothing written.

**D — Format checks without execution.** `src/core/checks/` (pure, no process): rules `json.syntax`,
`yaml.syntax` (bundled `yaml` 2.x), `dab.bundle-name|targets|include|path|var`, `docker.from|copy-source`,
`compose.build-context|env-file`, `checks.incomplete`; bounded scan (`datapass.checks.maxFiles` 2,000,
`maxFileBytes` 1 MB, depth 12). DiagnosticCollection `datapass-checks`, on save
(`datapass.checks.onSave`), *Check This File* / *Check This Repository*, quick fix copying
`databricks bundle validate` (never run); Restricted Mode safe. Guide page
[docs/guide/08_FORMAT_CHECKS.md](docs/guide/08_FORMAT_CHECKS.md).

**F — File versions.** *Open Latest Version* (origin's default branch as of the last fetch),
*Open Version…* (last 50 commits, `--follow`, "from PR #n"), *Compare with Version…*, *Changed by the
Last Update…* (the reflog's last fast-forward, files by component). Read-only `datapass-rev:` provider
(`git show`), vetted requests (hex revision, repository-relative path, known repository), trusted
workspaces only, `core.fsmonitor=false`; nothing fetches, checks out or writes.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | UNIT_COUNT on main (new: `trustRepairs` 15, `experience` 9, `fileContext` 12, `checks` 13, `fileVersions` 6) |
| `npm run test:desktop` (installed VS Code, Windows 11) | DESKTOP_COUNT (new fixtures `v22-modes`, `v22-checks`, `v22-versions`; new flows `experienceFlows`, `fileContextFlows`, `checkFlows`, `fileVersionFlows`) |
| CI | validate + desktop on ubuntu-latest and windows-latest green for every package PR |

### Known limits

- A: the Git view does not inspect an unverified repository (state and detail only); coordinated
  change sets are described, not shown linked (V2).
- B: the desktop harness runs with `--disable-workspace-trust` (the untrusted blocker in Vanilla is
  covered by the code path); before activation every view is visible (the keys are "hidden" keys);
  contributed icons cannot be recoloured; the company switcher is not a surface.
- C: Explorer multi-select copies the clicked file only; diagnostics are what VS Code has at that
  moment; revisions of other repositories come from the last observation.
- D: build context = the Dockerfile's folder, `.dockerignore` not applied; `include` globs without
  `{a,b}`; only `${var.x}` checked; Python syntax, notebooks, Terraform/Bicep, CI and Kubernetes
  schemas are V2 or later.
- F: "from PR #n" only for squash-merge subjects; the reflog is per clone; *Changed by the last
  update* is a quick pick, not yet a Details section.

### Still needs a human

Julian's morning confirmations (plan §6): J1 default mode (Standard), J2 FOIL's bridge repository,
J3 bridge-recommended mode (V2), J4 "bridge repository" wording. Then the FOIL AI prepares the bridge
(plan §8) and Julian runs the three FOIL stories in Standard mode.

# Implementation Status — 0.20.0 (pass AI-2): work orders

Date: 2026-09-25. Version `0.20.0` — merged, PR #30 (main `538a3d3`), on 0.19.0 (PR #29). The guide
for preparing a client project from scratch is [docs/guide/](docs/guide/README.md). Design and
Julian's answers: [handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md)
sections 3.2, 4, 5, 8.1–8.5, 8.9, 9, 11, 12 and **13.1** (which wins). Galaxy contracts
`datapass.work-order/1`, `datapass.work-order-result/1`, `datapass.work-order-marker/1` and
`datapass.work-log/1` (format designed here) were sent to the App Galaxy keeper session, with the
manifest note (`project.type`, `modules.workOrders` / `modules.pilot`).

### What's new

- **The AI view has three tabs** (right side bar, renamed "AI"), Julian's modes: **DataPass-guided**
  (the 0.15 JSON import/export, still the default tab), **Agent** (work orders; the Claude app and
  Codex app buttons; what the agents did last on this project; *Export JSON* of the project, the
  selected sub-project or the company — `datapass.ai.exportScope`; *Publish summary*) and **Manual**
  (where things stand, and the route to the Project view, the Git view, readiness, the Workbench, the
  official tool, Check for updates). Pilot is announced as a later option, no tab.
- **Work orders** (`src/core/workOrders/`): `order.json` (`datapass.work-order` 1), `order.md` (first
  line = the marker `DataPass work order <id>: read <path>\order.md and follow it.`), `attachments/`
  (result format, the schemas, preparation packs, card / decision packs, the optional export JSON,
  the previous order for a follow-up, a failing PR's checks), `state.json` (`datapass.work-order-state`
  1, DataPass only), `result.json` (`datapass.work-order-result` 1, the agent) and `proposed/<kind>.json`,
  in `<coordination repository>/.datapass/local/work-orders/<id>/` (git-ignored). Strict parsers from
  one schema source (`schemas/datapass-work-order*.schema.json`, editor validation through
  `jsonValidation`). Ids `wo-YYYYMMDD-HHMM-xxxx`, receipts `XXXX-XXXX` without 0/O/1/I.
- **Kinds**: change, investigate (report, no PR), prepare-files, apply-decision, fix-card,
  datapass-files — which can return files **for import only** (no repository changed, no PR: the
  testlab 7b path). Repositories default to: the component's repository and the coordination
  repository change, the others are left out; planned or not-cloned ones cannot change; the code
  repository comes first (the agent starts there, so its `CLAUDE.md` / `AGENTS.md` load).
- **Project types** `dev` / `work` / `perso` (`project.type` in the manifest — v5 stays v5, schema and
  parity corpus updated together — or `datapass.ai.projectTypes`, machine, which wins; default dev):
  dev and perso → orders on once the machine setting is on, the agent merges on green CI; work →
  off unless `modules.workOrders: true`, the person merges. `modules.workOrders: false` switches any
  project off. The per-order merge switch stays.
- **Launch, desktop apps first (Q5)**: after one modal, *Claude app* copies the marker prompt and
  opens `claude://code/new` (the app's own new-session route; the person picks the folder and
  pastes); *Codex app* the same with `codex:`; *Claude Code · terminal* is a VS Code terminal whose
  process is `claude` (arguments as an array: `--session-id`, `--name`, `--effort`, `--model`,
  `--permission-mode default` when asked, `--add-dir` per other repository, the marker), with
  *Resume in terminal*; *Codex CLI · terminal* when a Codex CLI is configured. A `.cmd` shim goes
  through `cmd.exe` only with double-quoted tokens of a strict set, else the command is copied.
  Pre-launch: trust, the machine setting, the type and switch, **the order was written by DataPass on
  this computer and is unchanged** (a digest recorded at writing), every repository is the clone
  DataPass resolves (same folder, verified origin), the base commits still on `origin/<base>` after a
  plain fetch (else *Write a new revision*), a warning when another open order changes the same
  repository, the executable found.
- **Results**: a watcher (and, for 48 h after a launch without result, a 15 s poll) reads
  `result.json`; the receipt and order id must match, unknown fields and credential-shaped text refuse
  it, PR addresses are kept only when they are PRs of the declared repository (rebuilt from its
  address). The order becomes *reported*; a notification offers to open it. **PRs are found by the
  planned branch** through the 0.19 Git observer (a PR the result names is adopted only when its head
  is the planned branch or the branch the result says it used); *pulled* is a `git merge-base
  --is-ancestor` check of the merge commit in the clone's default branch. Axes stay separate (order,
  output, result); "done" is the person's, suggested when every PR is merged and pulled.
- **Needs you rule 8** (Git view): a work order whose result names no PR, or with neither result nor
  PR a day after its launch; the row opens the order.
- **Work orders view** (fifth Workbench view: All / Open / Needs you / Done) and the **Details
  timeline** (written, launched, the result as "the agent says", checks, questions, follow-ups, each
  PR with its CI, imports, published, closed) with *Launch*, *Resume*, *Import the proposed file*,
  *Check the PR's DataPass files* (fetch, then `git show` of each changed `.datapass/*.json` through
  the import parsers), *Mark done*, *Follow-up order*, *Copy for a chat* (local paths scrubbed),
  *Copy the prompt*, *Revise*, *Abandon*, *Archive* (moved to `work-orders/archive/`, never deleted).
- **Entry points (8.9)**: board card → *Work order for this card*; Options → *Apply this decision as
  a work order*; a component with missing files → *Prepare the missing files as a work order*
  (Details and the Project tree); Git view, failing PR → *Work order to fix this* (its branch as the
  base, its failing checks attached); a result's follow-up → *Follow-up order*. Each opens the Agent
  tab prefilled; hidden parts (base branch, attachments, the order followed) stay in the extension.
- **The committed summary (Q2)**: *Publish summary* writes `.datapass/work-log.json`
  (`datapass.work-log` 1, backup and journal like every project file) and, when
  `datapass.ai.workLog.privateRepository` is set, `work-logs/<project id>.json` in that private clone
  — refused for this public repository or a repository of the project; on GitHub `gh repo view
  --json visibility` must say private (else DataPass asks). Ids, titles, dates, statuses, planned
  branches and PR links only: never the goal, the agent's words, a local path, a receipt or a secret;
  remotes are written as the host's canonical https address (no user, token or port). DataPass never
  commits or pushes either file.
- No MCP server (Q6: kept as a later option).

### Settings

Machine (a workspace can never set them): `datapass.ai.workOrders.enabled` (false),
`datapass.ai.projectTypes`, `datapass.ai.claude.path`, `datapass.ai.codex.path`,
`datapass.ai.workLog.privateRepository`. Application: `datapass.ai.defaultTool` (`claude-desktop`),
`datapass.ai.defaultEffort` (high), `datapass.ai.defaultModel`, `datapass.ai.branchPrefix` (`dp/`),
`datapass.ai.terminalLocation` (editor), `datapass.ai.exportScope` (project).

### Files

`src/core/workOrders/{format,builder,launch,projectType,status,workLog,export}.ts` (pure),
`src/work/workOrders.ts` (the service: listing, watcher, state writes one at a time, the registry of
orders written here, PR discovery, rule 8), `src/work/workOrderCommands.ts` (flows and commands),
`src/views/agentState.ts`, the AI view (`aiExchange.ts`, `aiExchangeHtml.ts`), the Workbench
(`workbenchState.ts`, `workbench.ts`, `src/webview/workbench.ts`), `gitReport.ts` / `gitObserver.ts` /
`gitTree.ts` (rule 8), `modules.ts` and `projectManifestModel.ts` (`project.type`, AI switches kept by
*Choose Project Modules*). Test stubs: `tests/fixtures/agents/claude-stub.cjs` (does what an order
asks: worktree, commit, push, a PR in the stub gh's answers, proposed files, result.json; modes good /
no-pr / wrong-receipt / silent) and `tests/fixtures/git/gh-stub.cjs` (now also `repo view` visibility).

### Review

The launch and parsing code had a `/code-review` at xhigh before merge: 15 findings, all fixed —
among them launching only orders written here and unchanged (a repository could ship an order
folder), clones re-derived from the project instead of the order file, token-free remotes in the
committed log, state writes serialized, no Git in Restricted Mode for the PR check, a PR adopted only
on its branch, *pulled* from a real Git check, PR discovery not tied to the Git view's visibility,
the launch text for orders without PRs, repaints only on change, digest caching, a bounded poll.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 329 / 329 on top of 0.19.0 (new `tests/workOrders.test.ts`: ids, receipts and the marker; the builder with hostile titles, goals and paths, unknown ids, missing bases, import-only orders; order.md rendering; strict parsers for order, state and result — unknown fields, wrong receipt, another order, oversized, duplicate keys, credential-shaped text, foreign and rebuilt PR addresses for GitHub, Azure DevOps and GitLab; launch arguments, the `.cmd` line and its strict set, copied commands; project types and verdicts; the work log without goal, path, receipt, session id or token-bearing remote; the private-repository rules; PR discovery by branch, claims adopted only on their branch, *pulled* from a Git check; the summary axes; Needs you rule 8 and its order; committed schemas up to date. Manifest parity corpus: `project.type`, `modules.workOrders` / `pilot`. AI view: three tabs, allowlisted commands) |
| `npm run test:desktop` (installed VS Code, Windows 11) | 260 / 260 on 12 fixtures (`empty` 13, `v2-retail` 49, `v1-foil` 15, `broken` 16, `v4-cloudflare` 21, `v3-research` 46, `v3-monorepo` 13, `v3-devops` 15, `v17-company` 13, `v18-toolchain` 16, `v19-git` 20, `v20-work-orders` 23). New fixture `v20-work-orders`: two repositories with GitHub origins fetched from local bare remotes, a stub `claude` and a stub gh — off until the machine setting; an order written from the Agent tab (files, marker first, attachments, a clean clone); a terminal launch after the modal with the arguments the stub logs; the result checked by receipt; PRs found by branch; rule 8 (also from the Git view's node); a refused result; the Claude-app hand-off (prompt copied, `claude://code/new` opened, nothing run); the Work orders view and the Details timeline; entry points (card, failing PR, follow-up); the PR's DataPass files; a proposed sheet imported through the review; the summary published with the private log after gh says private; the base-moved revision; a copied or edited order refused; a work project |
| Visual check | `scripts/workbench-preview.ts` now renders the Work orders view, the order in Details and the AI view's Agent tab (dark theme) |

### Known limits

The Claude app's `claude://code/new` route and the Codex app's `codex:` link come from the apps'
own bundles on this PC; neither accepts a folder or a prompt, so the person picks the folder and
pastes (testlab 7b checks it for real). Conversations are not linked to orders yet: that is Claude
Control's part (pass C-1, the marker regex) and the Claude & Codex panel (AI-3); tokens are not shown.
No Codex CLI on this PC, so *Codex CLI · terminal* is unit-tested only. The full form of design 8.2
is folded into the Agent tab ("More options"); there is no separate Workbench form. Azure DevOps and
GitLab PRs are found the same way through `az` / `glab` when installed (not on this PC).

### Still needs a human

Testlab 7b (`D:\PROJ\datapass-testlab\7b-ordre-de-travail`, 20–30 minutes): switch
`datapass.ai.workOrders.enabled` on, then one real order in the Claude app (a few hundred k tokens)
that returns `sheet.json` for import.

# Implementation Status — 0.19.0 (pass AI-1): the Git module

Date: 2026-09-25. Version `0.19.0` — merged as PR #29 (main `da0e168`). Design and Julian's answers:
[handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md) sections 6,
8.6, 9 and 13.1 (merged as PR #27). Julian chose this order (Q1): the toolkit's toolchain / ID map /
connections pass is 0.18.0 (PR #28, [handoff/v3/08](handoff/v3/08_TOOLKIT_AND_AGENTS.md)), and the
Git module is 0.19.0, on top of it. No project-file format changes in this pass.

### What's new

- **Git view** (left side bar, under Project, badge = the project's "needs you" count). One row per
  repository of the project — the coordination repository and every resolved clone — with its role,
  Git host, branch or detached HEAD, ↓behind ↑ahead of its upstream (or "no upstream"), uncommitted
  changes, open PRs (✗ failing) and when it was last fetched. Under each: the uncommitted changes
  (staged · unstaged · untracked · conflicted), **Worktrees** (`git worktree list --porcelain`: branch,
  clean or dirty, ↑↓, merged / PR closed, locked), **Pull requests** (number, title, branch, CI rollup
  ✓ ✗ ● with the failing checks, draft, review decision, conflicts / behind) and **Recent merges**
  (the last three). Planned and not-cloned repositories stay listed with their web pages.
- **Needs you**, deterministic, most urgent first: (1) a PR whose CI failed; (2) a green PR (or one
  whose CI the host CLI does not report, or with no checks) waiting for review or merge; (3) a PR
  merged on the host but not in this clone — *Check for updates* while its commit is not fetched,
  *Get updates* once it is; (4) uncommitted changes on the default branch of a main clone; (5) a
  worktree whose branch is merged or whose PR is merged or closed — clean: cleanup candidate; dirty:
  work that might be lost; (6) unpushed work: commits never pushed (no upstream), or ahead of the
  upstream for more than a day; (7) detached HEAD in a main clone. "Behind with no local changes" is
  information only. Rule 8 (work orders without a PR) comes with pass AI-2.
- **Routes, nothing destructive**: open in Source Control (the built-in Git extension's
  `git.openRepository`, no new window), open a repository or worktree in a new window, open a PR or
  its failing check on the web (or in the GitHub Pull Requests / Actions views when installed),
  *Check for updates* / *Get updates* (existing), *Fetch this repository*, copy a branch name, and
  **copy the cleanup command** of a finished, clean worktree (`git -C '<repo>' worktree remove '<path>'`
  then `branch -d`, or `-D` with a comment when only the host saw the merge — a squash merge).
  DataPass never deletes a worktree or a branch (Q7).
- **Fetch all** (view title, Project view menu, Workbench card): plain `git fetch` of every cloned
  repository of the project, never `--prune`; nothing is merged. There is no automatic fetch.
- **Other repositories in D:\PROJ** (optional, `datapass.git.showOtherRepositories`, on by default):
  the Git repositories directly under `datapass.projectsFolders` (at most 60, worktrees and the
  project's own repositories left out), read only when the section is opened, with their own
  "needs you" list (not counted in the badge).
- **Workbench overview Git card**: one line — how many items need you, repositories checked, open
  PRs (failing), the oldest last fetch, the most urgent item — with *Open the Git view* and *Fetch all*.
- **Pull requests from the host's own CLI, read-only**: GitHub through `gh pr list --repo owner/repo`
  (open with `statusCheckRollup`, closed/merged with their merge commit) after `gh auth status` (exit
  code only; the token is never read); Azure DevOps through `az repos pr list` (review votes; build
  status is not in that list, so CI shows "not reported"); GitLab through `glab mr list -F json`. On
  Windows `az` is `az.cmd`: it runs through `cmd.exe` only when every argument is quoted and matches a
  strict character set (else the web links). Without the CLI, not signed in, on a timeout or an
  unexpected answer, the repository shows the 0.16 web links (pull requests, pipelines) with the reason.

### How it runs (security)

Read-only commands only: `status --porcelain=v2`, `worktree list --porcelain`, `symbolic-ref`,
`for-each-ref --merged`, `reflog show` (a branch Git sees as merged but that never got a commit is a
fresh worktree, not finished work), `log`, `merge-base --is-ancestor`, `rev-parse`, `config --get`.
Each runs with `-c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0` (no index write while other sessions
work in the same repository), no credential prompt, a **5 s timeout** (a repository that times out
is "not checked") and **at most four at once** (a slot is handed straight to the next waiter).
Executables come from absolute PATH entries only; `datapass.git.ghPath` is a machine-level setting
(a workspace value is ignored); a `.js` path runs with VS Code's own Node (wrappers, test stubs).
**No Git at all in Restricted Mode.** Refresh: when the view becomes visible, on window focus, after
the project changes (Get updates, file watchers) and on request, with a cache of 60 s for Git and
120 s for host CLIs; never while the view is hidden. Status is reused from the project observation
when it is less than 60 s old, so the Project tree and the Git view never disagree. CLI output is
untrusted: every field is type-checked and bounded, control and bidi characters are removed, PR
pages are rebuilt from the repository's own address (never taken from the output), and only check
pages of the same repository are kept.

### Files and settings

`src/core/git/porcelain.ts` (status counts, worktree list, merge log, ref lists, branch-name and
text safety), `src/core/git/hostPrs.ts` (gh / az / glab arguments and strict parsers, CI rollup),
`src/core/git/gitReport.ts` (per-repository report, the Needs you rules, the summary, the cleanup
command), `src/core/git/run.ts` (the four-at-once limiter, the `cmd.exe` line for `.cmd` scripts),
`src/work/gitObserver.ts` (the observation service), `src/views/gitTree.ts` (the view),
`src/work/gitCommands.ts` (routes). `RepoGitState` gains `counts` (staged/unstaged/untracked/
conflicted); `resolveCommandOrScript` in `src/core/exec.ts`. Settings: `datapass.git.ghPath`
(machine), `datapass.git.showOtherRepositories` (application). No project-file or contract change.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 309 / 309 on top of 0.18.0 (17 new in `tests/git.test.ts` — porcelain v2 counts, worktree list incl. hostile paths and bounds, merge log, default branch, branch-name safety, gh/az/glab arguments and parsers incl. rebuilt URLs, foreign check pages, control characters and bounds, CI rollup, every Needs you rule and its order, what stays information, cleanup commands incl. quoting refusals, the limiter, the `cmd.exe` line, `.cmd` resolution) |
| `npm run test:desktop` (VS Code 1.139.1, Windows 11) | 237 / 237 on 11 fixtures (`empty` 13, `v2-retail` 49, `v1-foil` 15, `broken` 16, `v4-cloudflare` 21, `v3-research` 46, `v3-monorepo` 13, `v3-devops` 15, `v17-company` 13, `v18-toolchain` 16, `v19-git` 20). New fixture `v19-git`: two repositories with local bare remotes, two worktrees, a detached repository beside them and a stub `gh` (`datapass.git.ghPath`): the view checks when shown, Needs you in order drives the badge and the Workbench card, unique tree IDs and routes, PR / failing check / worktree / Source Control routes, the copied cleanup command (nothing deleted), Fetch all merges nothing and turns "merged, not pulled" into *Get updates*, other repositories read on opening, the web-links fallback without gh, and the stub's log proves only `auth status` and `pr list` reached gh |

### Known limits

Restricted Mode cannot be switched inside the desktop test runner (it starts with
`--disable-workspace-trust`); the rule is covered by the observer's code path and the existing
trust tests. `az` and `glab` are not installed on this PC: their arguments and parsers are unit
tested, not run for real. Azure DevOps and GitLab list pages do not carry CI status (the view says
"not reported" and links the pipelines page). The Git view is not a pane of work views yet (saved
layouts cannot hide or show it). A worktree's own PR row appears under its repository, not under
the worktree.

### Still needs a human

Testlab 7a (`D:\PROJ\datapass-testlab\7a-git`, about 15 minutes, offline, with the stub gh), then a
look at the real `D:\PROJ` in *Other repositories*.

# Implementation Status — 0.18.0: toolchain, ID map, connections

Date: 2026-09-25. Version `0.18.0` — branch `claude/v018-toolchain`, on 0.17.0 (PR #25) and the
toolkit proposal (PR #26). Design: [handoff/v3/08_TOOLKIT_AND_AGENTS.md](handoff/v3/08_TOOLKIT_AND_AGENTS.md)
sections 2, 5.3, 5.4 and 8. Contract: [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) section 12.

### What's new

- **Manifest v5** (`LATEST_MANIFEST_VERSION = 5`, schema and runtime together):
  `toolchain.tools[]` (`tool` id, `version` range, `optional`, `where`: local | ci | fabric);
  identifiers with `values` (one non-secret id per declared environment) and `kind`;
  `connections[]` (`sign-in` with `tool` / `identifier` / `subscription` / `profile`, `git-binding`
  with `provider` / `identifier` / `repoRef` / `folder` / `branch`, `cloud-connection` with
  `provider` / `name`; all with `environment`, `label`, `portal`). v1–v4 upgrade to v5 with *Upgrade
  Project Manifest* (backup `.datapass/project.v<N>.json`, journal); a v4 file only changes version.
- **Version ranges** (`src/core/toolchain/versions.ts`): `>=`, `>`, `<=`, `<`, `=`/`==` (a release
  line), `!=`, `x`/`*` wildcards, `^`, `~`, pip's `~=`, AND by spaces or commas, OR by `||`; no
  pre-release tags. Probes now keep the version number (`cliVersion`), so `az version`'s JSON is
  "2.64.0", not "{".
- **Tools & versions** (Project view section, Workbench card, report, snapshot): each local tool is
  compared with this computer's probe — ok, outside the range, missing, version not read — and CI,
  Fabric-notebook, desktop-app and Python-library tools are "not checked here". A click copies the
  install command for this platform (winget ids checked with `winget show`; Homebrew; `pip`;
  `code --install-extension <id>`) or opens the extension page / vendor page. Unknown ids run nothing
  and get a "did you mean" (`cli.databrick` → `cli.databricks`). Preflight: a version outside its
  range adds a warning to the operations that use the tool (never a blocker, never on read).
- **`.vscode/extensions.json`**: read as JSON with comments (never written), compared with the
  toolchain's local extensions (recommended / not / unwanted, others); *DataPass: Show Recommended
  Extensions* runs VS Code's `workbench.extensions.action.showRecommendedExtensions`.
- **ID map**: *Copy Identifier* asks the environment (or takes it as an argument); a hover provider
  shows which declared identifier and environment an id in any file is (plain text, never trusted
  Markdown); *DataPass: Look Up an Id in the Project's ID Map…* accepts a GUID or a pasted portal
  address. Every per-environment value is validated like a v4 value; errors name
  `identifiers[i].values.<env>`, never the value.
- **Connections** (section, Workbench block, report, snapshot): *DataPass: Check Connections* runs
  `az account show --output json`, `databricks auth profiles --output json` and `fab auth status`
  (fixed arguments, from the home folder, stdin closed, 30 s timeout, only when asked; results kept
  in memory). Parsers keep: signed in, tenant id, subscription id, profile names and validity — the
  account, subscription name, hosts and `fab`'s masked token prefixes are dropped. States: ok,
  signed in elsewhere, signed out, profile missing / invalid, tool missing, check failed, not
  checked yet, declared (not checked). *Copy Sign-in Command* builds `az login --tenant …`,
  `az account set --subscription …`, `databricks auth login --profile …` or `fab auth login` from the
  manifest at click time (never stored in a view). *Open the Connection's Portal Page*: a Fabric
  workspace from its id, Fabric's connections documentation, the Azure portal, or the declared
  `portal` (confirmed once per window). Git-binding folders are checked in the local clone.
- **AI packs**: preparation pack, Copy AI context and card packs get a "Tools, ID map and
  connections (names and states only)" section; the environment snapshot gets `tools` and
  `connections`; identifiers carry `kind` and their environments, never values.
- **Tool registry**: `ext.powerbi-studio`, `pack.powerbi-gbrueckl`, `ext.powerbi-modeling-mcp` added
  (Marketplace ids checked); install hints for every CLI; toolchain-only ids `py.fabric-cicd`,
  `py.semantic-link-labs`, `plugin.power-bi-agentic-development`.
- **Power BI agentic plugins**: the 11 plugins of `data-goblin/power-bi-agentic-development`
  (marketplace.json, version 26.31.5), with *Copy install* for Copilot CLI and for Claude Code, and
  the Windows long-paths note.
- **Example** `examples/v3/sales-bi` (Fabric lakehouse and notebook, PBIP model, fabric-cicd
  workflow, `parameter.yml`, `.vscode/extensions.json`); added to the example hub catalog.

### Files

`src/core/toolchain/versions.ts`, `toolchain.ts`, `extensionsJson.ts`, `connections.ts`, `idMap.ts`
(pure); `src/work/connectionChecks.ts` (the runner), `toolchainObserver.ts` (extensions.json, binding
folders), `toolchainCommands.ts` (commands and the hover); changes in `readiness/readiness.ts`,
`projectManifestModel.ts`, `capabilities/{tools,probe,preflight}.ts`, `projectMap.ts`, `workModel.ts`,
`session.ts`, the Project tree, the Workbench state and card, `preparation.ts`, `boardPack.ts`,
`aiContext.ts`, `powerbiAgentic.ts`, `actions.ts`, `adapters/powerbi.ts`; schema
`schemas/datapass-project.schema.json`; `CHANGELOG.md` (new).

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 292 / 292 (24 new: `tests/toolchain.test.ts` 23 — ranges good and bad, CLI version outputs, toolchain states and install commands, unknown ids, extensions.json, a secret-looking value in any environment, ID-map lookups, connection validation, parsers dropping account names and masked tokens, sign-in commands built at click time, the real runner run against a fake CLI on PATH (home folder, stdin closed, timeout, not found), credential files never opened (source scan and a spy on every file read), readiness and every AI output holding no value, v4 → v5 migration, non-FOIL Databricks and Azure examples, the guide listing every tool id; plus the 11 data-goblin plugins; 22 new v5 editor/runtime parity cases and 16 runtime-only ones in `tests/manifestV3.test.ts`) |
| `npm run test:desktop` (VS Code 1.139.1, Windows 11) | 217 / 217 on 10 fixtures (`empty` 13, `v2-retail` 49, `v1-foil` 15, `broken` 16, `v4-cloudflare` 21, `v3-research` 46, `v3-monorepo` 13, `v3-devops` 15, `v17-company` 13, `v18-toolchain` 16). New fixture `v18-toolchain` (the public Sales BI example as a real Git repository): Tools & versions and Connections rows against this machine's own probes, no value anywhere in the tree; Check connections through the Test-mode runner with fake `az` / `fab` output (only the two fixed commands run; account names and masked tokens never reach a notice, the tree, the snapshot, the preparation pack, the AI context, the report or the Workbench state); Copy Sign-in Command; Copy Identifier asking the environment; the ID-map hover on `parameter.yml`; Look Up an Id; portal pages; install commands copied; VS Code's Show Recommended Extensions; nothing installed. `v4-cloudflare`: Upgrade Project Manifest v4 → v5 with an exact backup. `broken` now uses schemaVersion 6 |
| Workbench preview (`scripts/workbench-preview.ts`, page `readiness`) | the Tools & versions and Connections blocks render in the overview card (dark theme checked in a browser) |

### Known limits

Connection checks never run by themselves (`databricks auth profiles` contacts every workspace):
the person clicks *Check connections*, and a new window checks again. `az account show` reads the
Azure CLI's current account; it does not prove the token is still valid. Git bindings and cloud
connections cannot be observed without calling the services' APIs, so they stay "declared, not
checked". Python libraries are never probed. The catalogue of community tools and the recipes are
the later toolkit catalogue pass (hub repository, 08 section 5.4), after the Git module (0.19.0) and
AI-2 work orders — Julian's order in `handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md` §13.1.

### Still needs a human

- Testlab project 8 (`D:\PROJ\datapass-testlab\8-outils-connexions`, ≈ 20 min): the real `az`,
  `fab` and `databricks` checks, and the install commands on a real machine.

# Implementation Status — 0.17.0: windows and work views

Date: 2026-09-25. Version `0.17.0` — branch `claude/v017-windows-views`, on 0.16.0 (work and DevOps,
PR #24) and 0.15.1 (AI exchange view, PR #23). Design: [handoff/v3/06_VISION_AND_READINESS.md](handoff/v3/06_VISION_AND_READINESS.md)
section 2. Full detail and the Power Ops launcher contract:
[handoff/v3/07_WINDOWS_AND_POWER_OPS.md](handoff/v3/07_WINDOWS_AND_POWER_OPS.md).

### What's new

- **Company workspace file** — *DataPass: Create the Company Workspace File (one window per
  company)…* (Command Palette, status-bar switcher, Project view **…** menu): a five-step wizard
  writes a multi-root `.code-workspace` — which DataPass projects, their folders (coordination
  repository plus repositories found on this machine by Git origin, relative to the file whenever
  possible), the company name, where to save, a title-bar colour (8 named colours, custom hex, or
  none) and an optional startup work view. Replacing a file keeps its other settings, extensions,
  tasks and launch configurations. Julian's recommended mapping: **1 VS Code window = 1 company**.
- **Work views** — named saved layouts of the main window, kept in
  `<project>/.datapass/local/views.json` (machine-local, git-ignored): selected sub-project/component,
  editor grid and files per group (repository-relative paths), the Workbench tab (in a group or
  floating), which DataPass views were visible, diagram settings (orientation, lanes, folds, zoom,
  Workbench view) and the previewed architecture. *Save Work View…*, *Apply Work View…* (one call:
  closes only unmodified/unpinned tabs, sets the grid, opens files, restores the Workbench, panes,
  selection, diagram and preview — missing files or repositories become notes, never errors),
  *Manage Work Views* (apply, replace, rename, startup, delete), *Rename*, *Delete*. Limits: 40
  views per project, 9 groups, 3 levels, 30 tabs per group.
- **Status-bar switcher** — `$(briefcase) <Company> · <Sub-project> ▾`: work views (apply in one
  click), sub-projects, other DataPass projects of the window, *Switch project…*, *Open the
  Workbench in a floating window*, *Create the company workspace file…*, *Export company
  workspaces for Power Ops*. Also a **Company switcher** button in the Project view title and
  **Work views** / **Own window** buttons in the Workbench header.
- **`datapass.startupView`** — read only from a `.code-workspace` file (never a folder's own
  settings); applied once the project loads. *Choose the Work View this Workspace Opens With…*
  edits the workspace file through VS Code's settings API (keeps its comments). A launcher request
  wins over it; an unknown view name warns instead of guessing.
- **Floating Workbench** — *Open the Workbench in a Floating Window* (VS Code's own
  `workbench.action.moveEditorToNewWindow`), verified to keep the floating window part of the same
  VS Code workspace; component files opened while it floats target the main window's first group.
- **Power Ops launcher list** — *Export Company Workspaces for Power Ops* writes a machine-local,
  secret-free JSON (file paths and view names only) to `%LOCALAPPDATA%\DataPass\company-workspaces.json`
  (macOS/Linux equivalents), kept up to date automatically after the first export. The launcher
  contract (open a company, request a work view by writing a small file DataPass watches and
  deletes, why not `vscode://` links, VS Code Profiles) is unchanged by, and does not touch,
  PowerToy_UI — its own task is next.
- **Also fixed**: the Project tree's own reveal could re-fire a stale selection event that brought
  back the previous selection right after a work view changed it; the tree now ignores its own
  reveal events.

### Files and settings

`src/core/windows/workViews.ts` (pure model: parsing, validation, layout normalisation, diagram-UI
sanitising, open-view requests), `src/core/windows/company.ts` (pure: workspace-file JSONC
reading/writing, relative-folder rules, the Power Ops export builder), `src/work/workViews.ts` (VS
Code layer: capture/apply), `src/work/windowCommands.ts` (commands, status-bar item, launcher
watcher). Settings: `datapass.company`, `datapass.startupView` (workspace-only). Files:
`.datapass/local/views.json`, `.datapass/local/open-view.json` (transient launcher request),
`<Company>.code-workspace`, `company-workspaces.json` (per-user application data).

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 268 / 268 (13 new in `tests/windows.test.ts` — views.json validation incl. path traversal, layout normalisation, ids/names, diagram-UI sanitising, launcher-request freshness, relative folders on Windows and POSIX, company-workspace merge, JSONC reading, Power Ops export, export location per platform) |
| `npm run test:desktop` (VS Code 1.139.1, Windows 11) | 200 / 200 on 9 fixtures (`empty` 13, `v2-retail` 49, `v1-foil` 15, `broken` 16, `v4-cloudflare` 20, `v3-research` 46, `v3-monorepo` 13, `v3-devops` 15, `v17-company` 13), on top of 0.16.0. New in `v3-research`: layout commands, Save/Apply Work View (one call), unsaved work kept, rename/startup refused in a single-folder window, delete, the switcher, the floating Workbench (real VS Code command) with files opening in the main window, Create the Company Workspace File (relative folders, teal, startup view, Profiles note), the Power Ops list kept up to date on rename, a launcher request applied once and deleted, a stale one refused. New fixture `v17-company`: a real `Research Co.code-workspace` opens with its startup view; choosing/clearing the startup view edits the file |

### Known limits

Work views and the Power Ops export are machine-local by design (never committed, never shared);
`datapass.startupView` only applies from a `.code-workspace` file; side bar and panel views cannot
float (a VS Code limit); a view's editors are not touched when a floating window has the focus at
apply time (VS Code arranges the focused window only) — DataPass says so instead of guessing which
window to arrange.

### Still needs a human

- Testlab project 7 (`D:\PROJ\datapass-testlab\7-fenetres-vues`): dragging the floating Workbench to
  a second screen is a physical check.
- The PowerToy_UI task (read the Power Ops list, open a company or a view) is not started; see
  `handoff/v3/07_WINDOWS_AND_POWER_OPS.md` section 7.

---

# Implementation Status — V3 pass 4 (0.16.0): work and DevOps

Date: 2026-09-25
Version: `0.16.0` — branch `claude/v016-work-devops`, rebased on main `c48bc81` (0.15.1 AI exchange
view, PR #23, on 0.15.0 architecture options, PR #22). Why and what next:
[handoff/v3/06_VISION_AND_READINESS.md](handoff/v3/06_VISION_AND_READINESS.md).

### Implemented

- **Board** (`.datapass/board.json`, format `datapass.board` 1): columns (1–12, work-in-progress
  `limit`), sprints and milestones (dated), cards (task, bug, feature, decision, question) with
  status, priority, sub-project, components, files, environment, sprint, milestone, due date, labels
  and links (https only, no credential or token in the query). Strict parser (unknown fields are
  errors, duplicate ids refused, status must be a declared column, sprint/milestone must be declared,
  dates must be real calendar dates, links refused if they carry a user name, password, or a
  token/signature parameter); cross-checks against the project as warnings (unknown sub-project,
  component, environment, repository, decisionRef).
- **Board view of the Workbench**: kanban columns with drag-and-drop (and `Shift+←`/`Shift+→`), filters
  (sub-project, sprint, type, text search), sprint and milestone cards, a card panel (components link
  to the Architecture view, files open in the editor or offer Clone/Locate, links open after a
  confirmation, decisions link to the Options view). Project tree "Board" section (open cards, most
  urgent first); Details side bar and preparation packs list a component's cards.
- **Moving a card writes only that card's `"status"` value**: located and replaced in place, every
  other byte kept, the result re-parsed and required to equal the board with that single change or
  nothing is written. Base check, backup (`.datapass/local/backups`), journal; first move in a window
  confirmed once. Never commits or pushes.
- **AI pack for a card** (`datapass.board.aiPack`): fix / implement / decide / answer / explain / plan
  questions matched to the card's type; a bug's error text (clipboard or typed) scrubbed of
  credentials and local paths, up to 4000 characters; rules ask the AI to open a pull request and
  move the card to review in that same PR, keeping every id. `board.json` joins the JSON exchange
  (the 0.15.1 AI exchange view, and "Copy a DataPass File for the AI" / "Import the AI's Answer") with
  its own tasks (update the board, plan the next sprint).
- **Git hosts** (`core/project/gitHosts.ts`): Azure DevOps https-with-organization (`https://{org}@
  dev.azure.com/{org}/{project}/_git/{repo}`, what its Clone button copies) and legacy SSH addresses
  accepted by the manifest check and the editor schema; `remoteIdentity()` maps all five Azure DevOps
  address forms (https, https-with-org, SSH, legacy https, legacy SSH) to one identity, so a clone
  made with one form is recognised when the manifest declares another, and sibling auto-discovery
  uses the repository's real name. Web pages per host (repository, pull/merge requests,
  pipelines/Actions, boards/issues), command **DataPass: Open a Repository on the Web…**, address
  shown once per window before it opens.
- **CI profiles and providers**: `github-actions` (`.github/workflows/*.{yml,yaml}`),
  `azure-pipelines` (`azure-pipelines.yml`), `gitlab-ci` (`.gitlab-ci.yml`); provider `devops`
  (always on, not a switchable module). "See the runs" (`ci.github-actions.runs`,
  `ci.azure-pipelines.runs`, `ci.gitlab.pipelines`) opens the host's runs page, or the GitHub Actions
  extension's own view when it is installed; an Azure pipeline building a GitHub repository is
  explained rather than guessed, with a component-doc link suggested. Tool probes for the five new
  extensions (GitHub Actions, GitHub Pull Requests, Azure Pipelines, GitLab Workflow, Grafana),
  verified against each extension's own `package.json` on 2026-09-25.
- **Mongoku frozen**: manifests DataPass creates (Initialize, generic and FOIL templates) now set
  `"modules": { "mongoku": false }`; existing manifests are unaffected. Modules picker, Problems and
  the editor schema explain it reads `board.json`/`project.json` from GitHub and has no link with
  DataPass.
- **Grafana**: its extension has no view container, so DataPass opens a dashboard JSON/YAML file with
  its own `grafana-vscode.openUrl` command (the dashboard editor `grafana.dashboard`) rather than
  routing to a side-bar view; "Show extension" when it is missing.
- Editor schema `schemas/datapass-board.schema.json` (jsonValidation), new public example
  `examples/v3/shop-platform` (one repository per Git host, one CI pipeline each), the board added to
  `examples/v3/research-library`; guide sections 10–11.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 249 / 249 (15 new: board 8, git hosts / CI 6, modules 1; the examples test also covers board.json and the new example) |
| `npm run test:desktop` (VS Code 1.139.1, Windows 11) | 172 / 172 on 8 fixtures — `empty` 12, `v2-retail` 48, `v1-foil` 15, `broken` 16, `v4-cloudflare` 19, `v3-research` 34 (6 new board flows), `v3-monorepo` 13, `v3-devops` 15 (new fixture, 4 DevOps flows). Tool probes on the isolated test profile correctly report the five new extensions "absent" |
| Visual check | `scripts/workbench-preview.ts`, board and board-filtered pages, dark and light; drag & drop, `Shift+→` and search focus exercised in the browser preview |
| New public example | `examples/v3/shop-platform` (project.json + graph.json + README: one repository per Git host, Azure DevOps declared with the `{org}@` Clone address) |

### Still needs a human

- Testlab project 6 (`D:\PROJ\datapass-testlab\6-board-devops`): the board and kanban, Git host links
  and CI runs, Mongoku frozen — offline, with the real FOIL Azure DevOps repository's Clone address
  checked at the end (optional, real).
- The V3 acceptance with Julian (testlab 4/5, FOIL on the real repositories) and account qualification
  listed in earlier sections remain open.

---

# Implementation Status — 0.15.1: AI exchange view instead of Chat in the secondary side bar

Date: 2026-09-25. Version `0.15.1` — branch `claude/ai-exchange-pane`, on main `90cd817` (0.15.0, PR #22).
0.16.0 (work and DevOps) and 0.17.0 (windows and work views) are being prepared in parallel sessions.

- **AI exchange view** (`datapass.aiExchange`, first view of the secondary side bar container, now
  titled "DataPass", above Details, about three quarters of the height by default): choose a DataPass file (options, sheet, graph, manifest,
  catalog) and a task, copy the file with the AI's instructions, paste the answer (typing, the
  clipboard button or a file), see it checked live with the same parser as every import (which file
  it is, valid or the reason it is refused, about how many lines change, warnings), then write it
  after the diff, the modal confirmation and a backup. The pasted answer lives in memory only (not in
  webview state); webview messages are validated (known kinds, tasks and two footer commands).
- The Workbench's "Import the AI's answer" buttons now open this view on the right file
  ("Paste the AI's answer"); the palette commands keep the clipboard / file quick pick.
- **Chat replaced by default**: the first time a DataPass project (`.datapass/project.json`) opens in
  a workspace, DataPass focuses the AI exchange view, so the secondary side bar shows DataPass rather
  than VS Code's Chat; VS Code remembers the active tab per workspace afterwards. Setting
  `datapass.layout.showInSecondarySideBar` (default true). An extension cannot remove VS Code's Chat;
  to hide it everywhere, use VS Code's own `chat.disableAIFeatures` setting.
- Tests: `tests/aiExchangeView.test.ts` (HTML/CSP/script, state, live review); desktop: the side bar
  shows DataPass at startup in DataPass projects and not in an empty workspace; the full copy → paste
  → check → write flow through the view's real message handler.

---

# Implementation Status — V3 pass 3 (0.15.0): architecture options and project sheet

Date: 2026-09-25
Version: `0.15.0` — branch `claude/v3-options`, rebased on main `e48b4f2` (0.14.0 environment readiness, PR #21, from a
parallel session). Why and what next:
[handoff/v3/06_VISION_AND_READINESS.md](handoff/v3/06_VISION_AND_READINESS.md).

### Implemented

- **Architecture options** (`.datapass/options.json`, format `datapass.options` 1): criteria, decisions
  per level with the `current` option (what graph.json implements) and alternatives whose `changes`
  add, replace or remove components, links and repositories; declared values (text, number, score
  1–5), pros, cons, consequences, pricing lines with `source` + `asOf`, `requires` / `excludes`;
  scenarios. Strict parser (unknown fields are errors; option components go through the graph's own
  rules, credential-shaped targets refused), cross-checks against the project (warnings).
- **Consequences computed by DataPass** (`applyPicks`, `analyzeOptions`): each option and scenario is
  applied to a *copy* of the manifest and graph and rebuilt with the same project model — components
  added / removed / replaced, links, official tools newly needed and whether they are installed here,
  DataPass support (operations / files / unsupported), module switches, repositories, operations,
  sums of declared monthly and one-time costs, conflicts and `requires` / `excludes` violations. The
  files of alternatives are observed too (unknown, never "missing", until seen).
- **Workbench views**: Architecture | Options | Project sheet. Options: scenario comparison (preview per
  column, custom combination per level), per-decision comparison (declared rows, DataPass rows,
  pros/cons, pricing lines with their sources), consequences column with actions. Preview is session
  state shared by every view; components that exist only in the preview can be selected; nothing is
  written.
- **Diagram**: left-to-right or top-to-bottom, lanes by sub-project / repository / cloud family /
  level, fold a lane or a parent, preview marks (new, changed, removed) on nodes and links.
- **Project sheet** (`.datapass/sheet.json`, `datapass.sheet` 1): datasets (volumes as text, key
  columns), formulas (as written, variables and units, file and symbol that compute them — *Open the
  file that computes it*), runtimes, glossary. Shown in the Sheet view, in the Details side bar of
  each component, and in preparation packs. Never evaluated.
- **Decisions**: *Record an Architecture Decision* writes `chosen`, `decidedOn`, `rationale` (backup,
  journal, base check); the "Decided (to apply)" scenario appears; *Ask the AI to apply this decision*.
- **JSON exchange with an AI, without an API**: *Copy a DataPass File for the AI* (task + rules + file);
  *Import the AI's Answer* (extracts the JSON block, recognises the file, validates it with the runtime
  parser, refuses credentials and local paths, diff, confirmation, named backup under
  `.datapass/local/backups/`, 20 kept per file); *Restore a Backup*. Options exports: Markdown
  comparison, AI context to compare or to apply a decision.
- **Providers and tools**: `vm` (Remote - SSH from `target.sshHost`/`folder`), `docker` (Container
  Tools view `containersView`); Google Cloud Storage and BigQuery name their official tool (Google
  Cloud Data Agent Kit `GoogleCloudTools.datacloud`, gcloud CLI; probes added) and stay without
  DataPass operations. Providers link to their tool probes (`nativeTool.toolIds`).
- Editor schemas `datapass-options.schema.json`, `datapass-sheet.schema.json` (jsonValidation), public
  example `examples/v3/research-library` with both files, guide sections 7–9.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 234 / 234 after the rebase on 0.14.0 (20 new in this pass: options parsing, application, conflicts, analysis, report, sheet, AI exchange, backups, vertical layout, lanes, diagram folding and preview marks, AI pack sections, example parity with the editor schemas) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 151 / 151 on 7 fixtures after the rebase on 0.14.0 (`empty` 12, `v2-retail` 48, `v1-foil` 15, `broken` 16, `v3-research` 28, `v3-monorepo` 13, `v4-cloudflare` 19). The 6 new `v3-research` flows: analysis and Project tree sections, a scenario preview that writes nothing, a decision recorded with a backup (only options.json changes in Git), AI contexts to apply and compare, an AI answer imported after validation / diff / backup (and refused with a credential or when invalid), a backup restored |
| Visual check | `scripts/workbench-preview.ts`: options, scenarios, sheet, preview with lanes, vertical map, details |
| FOIL | options and sheet written in the private coordination repository (PR #3, merged); zero problems with the 0.15 parsers |

### Still needs a human

- Testlab project 5 (`D:\PROJ\datapass-testlab\5-options-architecture`) and the FOIL options on the
  real repositories; the V3 acceptance and account qualification listed below remain.

---

# Implementation Status — V3 pass 2 (0.14.0): environment readiness

Date: 2026-09-25
Version: `0.14.0`. 0.13.1 merged as PR #19 (main `748c32b`), based on 0.13.0 merged as PR #18 (main
`c68f853`). Handoff: [handoff/V3_HANDOFF.md](handoff/V3_HANDOFF.md).

### 0.14.0 — local environment readiness, never a value

Manifest **v4** adds two optional blocks: `localEnv` (env files a developer needs, e.g. `.env`,
`.env.local`, `.dev.vars`, and the variable **names** the project requires) and `identifiers`
(explicitly non-secret ids such as a Cloudflare account id). DataPass reads a declared env file only
to learn which declared names are **set**, **empty** or **missing** — never the value, and never an
undeclared name; symlinks are not followed and files over 256 KiB are not read. In a trusted
workspace it also asks Git whether the file is committed (error), not ignored (warning) or ignored.
A required name with no declared identifier is always treated as a secret: DataPass tells the person
to fetch it from their local vault (Power Ops) and never asks for it itself.

- **Project view**: new "Local environment" section (files found/missing/optional, each variable
  set/empty/missing with "secret · vault" or "non-secret id", the declared identifiers, Copy project
  ID, Open Power Ops) and "Readiness" section (deterministic checks: env files and keys, Git-ignore
  status, companion addresses not set, manifest version/problems, repository branch/head — detached
  HEAD, wrong branch, behind/ahead, uncommitted changes, no upstream — plus optional companion rows).
  The Workbench overview tab shows the same "Local environment" card.
- **Commands**: Copy Variable Name (never its value), Open Env File (a missing file can be created
  with the declared names and empty values; a name already set elsewhere is written as a comment),
  Copy Non-secret Identifier, Copy Project ID, Open Power Ops (starts the machine-level
  `datapass.powerOps.path` program, `JUtilityPalette.exe`, with no argument — a workspace can never
  choose the program), Show Readiness Report (markdown, names and states only).
- **Migration**: *DataPass: Upgrade Project Manifest* (`datapass.upgradeManifest`, replaces
  `datapass.upgradeManifestToV3`) upgrades v1/v2/v3 to v4, with a backup copy
  (`.datapass/project.v<N>.json`) and a journal. v3 manifests keep working unchanged.
- **Optional modules unaffected**: Mongoku and DiagramCloud switched off
  (`modules.mongoku`/`modules.diagramcloud: false`) show only "optional module disabled" — no
  warning, no error, no check. Enabled and mapped but with no address set is an info note, same as
  before.
- The environment snapshot, the V3 AI preparation pack and the V2.2 Copy AI context gain a "Local
  environment (names and states only)" section; identifier values are not included there.
- **Not built**: a Power Ops deep link (Power Ops exposes none yet — only "Open" is supported, no
  secret ever crosses it); a Mongoku "DataPass maintenance" Galaxy projection (left for later).
- **Tests**: `tests/readiness.test.ts` (parser, validation, checks, companions, migration, and a
  no-leak test with fake secrets across every output) and a new desktop fixture `v4-cloudflare`
  (real Git, a fake `.env`) in `tests/integration/readinessFlows.ts`. The `broken` fixture now uses
  `schemaVersion: 5` to keep testing an unknown future version.

### 0.13.1 — `$schema` fix (first use by Julian)

A `"$schema"` web address in `.datapass/project.json` (as the 0.13.0 guide and examples wrote it)
replaces the schema the extension attaches, and VS Code blocks domains outside
`json.schemaDownload.trustedDomains` ("Schema download issue — Location untrusted"), so the editor
showed a warning and did not validate the file. The guide (rule 9), the examples and the FOIL starter
no longer write `$schema`; DataPass lists an existing web `$schema` under Problems (info) with the fix.
`$schema` stays accepted by the manifest, graph and catalog schemas.

### Implemented

- **Trust fixes (audit Lot 0).** F01 file-backed facts only when observed ("declared but not found",
  "not checked" = unknown); F03 base fingerprint covers untracked bytes and binary diffs, partial
  captures never match; F04 reviews keyed by a target digest (environment, target names, facts, file
  digest); F05 redaction of JSON-quoted secrets, Azure connection strings, function keys, SAS, bearer,
  PEM; F06 unknown manifest fields rejected at runtime from the schema file itself; F07 results per
  project, scope, operation and target; F15 `untrustedWorkspaces: limited` (no Git in Restricted Mode).
- **New finding fixed:** on Windows a `git.exe` inside an opened folder would have run (libuv searches
  the working directory first). Git and probes now use absolute paths from absolute PATH entries;
  Git runs with `core.fsmonitor=false`.
- **Manifest v3** (`environments`, `docs`, planned repositories, repository `description`, scope
  `repoRef`/`docs`, `$schema`) with *Upgrade Project Manifest to v3* (journaled, backup). **Graph 0.2**
  (item `provider`, `status`, `artifacts`, `operations`, `checklist`, `docs`, `owner`; relations
  `feeds`, `orchestrates`; kinds `function`, `pipeline`, `storage`, `database`, `contract`, `step`).
  v1/v2 manifests and 0.1-draft graphs load unchanged.
- **Resolution.** Project folder = the one holding the manifest (F02, chosen when several); repositories
  by declared path, located clone, workspace or sibling folder whose Git origin matches (wrong origin
  refused); expected files from profiles (`azure-functions.python`, `databricks.bundle`, `adf.factory`,
  `cosmos-nosql.container`, `mongodb.database`, `postgres.migrations`, `python.*`, …) plus declarations;
  generated outputs with their producer; content digests; `local.settings.json` tracked → problem.
- **Operations per component** by phase (read → publish) and environment; profile operations when none
  declared; 13 new capabilities (Azure Functions, Data Factory, Storage, Cosmos DB, MongoDB, PostgreSQL/
  Neon, Python, Databricks run, open files); new `azure` and `databases` modules (ADF out of Fabric, F08).
- **Workbench.** Project tree (left), Architecture diagram (bottom panel), Details (secondary side bar,
  VS Code ≥ 1.106), Workbench tab (overview); one shared selection; files open in the editor, missing
  ones explained; open repository or component folder in a new window; route to the official
  extension's view (verified container ids) or ADF Studio.
- **Git loop.** *Check for updates* (`git fetch`), *Get updates* (fast-forward only, commits listed,
  refused on divergence or tracked local changes), what changed and what is now present; *Clone*
  (VS Code Git) and *Locate*.
- **AI preparation pack** per component or sub-project (4 questions), allowlisted and previewed.
- **Catalog** (`datapass.catalog`, schema) and *Switch Project* (catalogs + recent projects);
  `datapass.projectsFolders` and `datapass.catalogs` settings.
- **Inventory:** Azure Functions apps (F09), IaC roots; ADF pipelines under `azure`.
- Docs: [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) (bundled, *Open the Project
  Preparation Guide*), [examples/v3](examples/v3/) generated from the test fixtures.

### Bugs found by the tests of this pass and fixed

| Bug | Effect | Fix |
|---|---|---|
| The editor schema accepted `resources`/`bindings` in a v1 manifest; the runtime refused them | Editor and runtime disagreed | Schema aligned (parity corpus) |
| A result recorded before a file change disappeared instead of showing as stale | Lost evidence | Latest result for the operation shown, flagged stale |
| Diagram scaled to 60 % in a narrow column | Unreadable labels | Layout computed in the webview for its width (narrower boxes, 2-line labels, 100 % toggle) |
| State classes (`ok`, `blocked`) reused the colour utility classes | Green labels | Namespaced classes |
| Recent-project bookkeeping wrote global state on every refresh | Intermittent loss of a just-recorded result in a desktop test | Written only when the project changes |

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 200 / 200 (33 new: trust regressions, manifest v3 parity corpus, project model A/B, examples) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 125 / 125 on 6 fixtures (`empty` 12, `v2-retail` 48, `v1-foil` 15, `broken` 15, `v3-research` 22, `v3-monorepo` 13). `v3-research` runs real Git offline: a local bare "GitHub", a sibling clone found by origin, an AI clone that pushes `requirements.txt`, Check → Get updates → the file is found; divergence refused; Locate accepts the right clone and refuses another |
| Visual check | `scripts/workbench-preview.ts` rendered in a browser: full, map and detail modes |

### Still needs a human

- The V3 acceptance in [handoff/v3/04_NEXT_PASSES.md](handoff/v3/04_NEXT_PASSES.md): testlab project 4
  (offline loop), the FOIL consumer on the real repositories, account qualification (Databricks,
  Azure Functions, ADF Studio, Cosmos DB, MongoDB).
- Restricted Mode and Remote-SSH/WSL are implemented by policy but not desktop-qualified yet.
- `git.clone` (Clone) uses VS Code's Git extension and was not driven by the desktop tests (it needs
  its own UI); Locate was.

---

# Implementation Status — Pass 12 (tooling): qualification records and report

Date: 2026-09-25
Version: `0.12.0` — branch `claude/pass-12-qualification`, based on main `02e5242` (v0.11.0)

Pass 12 is the signed-in qualification (v1 gate 16). Only Julian can sign in to Fabric,
Databricks, Azure and the VM, so this part of the pass gives that session a structured way to
record and report results; the results themselves come from Julian's run.

### Implemented

- **Record Operation Result** (inline button on every operation row, and **…** menu): Worked /
  Failed / Not tried plus a short note. The record keeps the date, the project and scope, the
  preflight status at that moment, the DataPass version and the versions of the tools the
  operation depends on. It is stored per user (VS Code global storage), not in any repository, so
  one report covers every project; recording again replaces the previous result for that
  operation and project. The operation row shows "✓ worked" / "✗ failed".
- **Export Qualification Report**: Markdown (results table, environment, every detected tool)
  opened in an editor and copied, ready to paste to Claude. **Clear Qualification Results** asks
  first.
- Notes are shortened (500 characters) and scrubbed.

### Bug found and fixed

| Bug | Effect | Fix |
|---|---|---|
| `scrub` (used by *Copy AI Context* and the bridge) removed local paths and `user:pw@` in URLs only | A GitHub token, `password=…`, a connection string or a JWT pasted in a checklist note would have reached the AI context although it announces "credentials and tokens" as omitted | Connection strings, GitHub/OpenAI/AWS/Slack/Databricks tokens, JWTs and `secret=value` pairs are redacted |

### Pre-qualification evidence (this PC, real extensions, read-only)

`npm run test:desktop -- --real-extensions --fixture=v2-retail`: 48 / 48. Detected present:
Jupyter 2025.9.1, Python extension 2026.4.0, Python 3.14.7, Java 22.0.2, Fabric Studio 2.25.2,
OneLake explorer 0.4.0, Databricks extension 2.18.0, Container Tools 2.5.2, Remote - SSH 0.128.0,
OpenSSH 9.6p1, Git 2.44. Absent: Microsoft Fabric and Fabric Data Engineering extensions, `fab`,
`az`, `databricks`, `tofu`/`terraform`, `gcx`, TMDL, MongoDB. Power BI Desktop and Tabular Editor:
unknown (desktop apps are never probed). No operation was run against an account.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 167 / 167 (4 new: tool snapshot, note scrubbing, report, credential shapes) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 90 / 90: record Failed then Worked on an operation (one record kept, tree shows it), export (no local path or user name), clear after confirmation |

### Next (needs Julian)

Run `D:\PROJ\datapass-testlab\LISEZ-MOI-TESTS.md`, record each operation, export the report and
send it. Then fix what failed and release **1.0.0**.

---

# Implementation Status — Pass 11: static inventory and repository state

Date: 2026-09-25
Version: `0.11.0` — branch `claude/pass-11-inventory`, based on main `1645df0` (v0.10.1)

### Implemented (v1 gates 5 and 7)

- Work view **Assets** (collapsed): notebooks (`.ipynb`), Fabric items in Git format (`*.Notebook`,
  `*.DataPipeline`, `*.Lakehouse`, `*.SemanticModel`, … read from `.platform`), Databricks bundles
  (`databricks.yml`, bundle name) and notebooks (`# Databricks notebook source`), Airflow DAG files
  (literal `dag_id` only; a computed id is shown as "DAG id not static"), Data Factory pipelines
  (`pipeline/*.json` with activities) and Power BI projects (`.pbip`). Each row opens the file in its
  native editor, or reveals a Fabric item folder.
- Recognition is static: file names plus at most the first 64 KiB of text. Notebooks are not run,
  DAG Python is never imported, JSON/YAML is not evaluated; symlinks and files over 4 MiB are not
  read; `node_modules`, `.git`, virtualenvs, build output and `.datapass` are skipped; at most 3000
  Python files are scanned (the count shows "+" when capped). Assets of a switched-off module are hidden.
- Work view **Repositories** (collapsed): the workspace and each declared repository with branch,
  commit, uncommitted changes and ahead/behind *as of the last fetch*
  (`git status --porcelain=v2 --branch`, local only); "not found locally (never cloned
  automatically)", "not a Git repository" and "remote-only" are stated as such.
- The scan is cached for 60 s and redone by the Work view's refresh button.

### Bug found by the desktop run and fixed

| Bug | Effect | Fix |
|---|---|---|
| On Windows the workspace URI and search results can differ in drive-letter case (`/c:/` vs `/C:/`) | Every found file looked "outside the folder": the Assets section was empty in real VS Code although the unit tests passed | Relative paths are computed after normalising the drive letter |

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 163 / 163 (3 new inventory tests) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 89 / 89: the v2-retail fixture (now a real Git repository) lists one asset of each kind and "main · <commit> · N changes · no upstream"; the remote-only repository is not contacted; switching Airflow off hides its DAGs |

---

# Implementation Status — Pass 10b: shared resources and workload bindings

Date: 2026-09-25
Version: `0.10.1` — branch `claude/pass-10b-resources`, stacked on `claude/pass-10a-modules` (PR #14)

### Implemented (V2.1 §7, v1 gate 4)

- Manifest v2 `resources[]` (`id`, `kind`: vm / container-host / kubernetes-cluster / database /
  workspace / other, `title`, `provider`, `ssh.host`) and `bindings[]` (`id`, `resource`, `scopes`,
  `folder`, `repository`, `compose`, `env` names, `processes`). Declared once, bound per workload.
- Never in the manifest: credentials, `user@host`, ports or keys (`ssh.host` is an alias from the
  user's own `~/.ssh/config`), env **values** (`NAME=value` is rejected and the value is never echoed
  back), relative or `..` folders. Runtime validation and the editor schema agree.
- Work view **Resources** for the selected scope: each resource with this scope's binding (folder,
  repository, Compose file, env names, processes), **Copy: ssh <alias>**, and **Shared with: …**
  when other scopes use the same host ("host-level changes affect all": rebooting or upgrading the
  VM affects every binding). The whole project lists every binding.
- **Open Resource on its Host**: Remote - SSH straight to `ssh-remote+<alias>` in the binding's
  folder (new window). The Galaxy **Remote SSH** action now does this when a resource is declared
  (it used to open only VS Code's generic remote menu and ignore the declared host).
- The legacy `platforms.oracle.sshHost` becomes an implicit "Oracle VM" resource, so existing
  manifests get the same behaviour; the `vm.sshHost` preflight fact comes from the resources.
- Resources belong to the Infrastructure module (hidden and refused when it is switched off).
- Remote folders open through a Test-mode seam (`src/core/external.ts`), so desktop tests never
  start an SSH connection or a window.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 160 / 160 (5 new resource tests: shared-VM views, SSH target, legacy alias, secret refusal, schema agreement) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 87 / 87: scope shows its binding and "Shared with: Operations"; Open on host → `vscode-remote://ssh-remote+retail-vm/srv/retail/weekly`; Galaxy path opens without a question; whole project lists both bindings; unknown binding refused |

### Still needs a human

Open a real VM with your own alias (testlab project 3, step 5).

---

# Implementation Status — Pass 10a: per-project modules

Date: 2026-09-25
Version: `0.10.0` — branch `claude/pass-10a-modules`, based on main `83c41e0` (v0.9.3)

### Implemented

- `modules` in `.datapass/project.json` (v1 and v2): `fabric`, `databricks`, `powerbi`, `grafana`,
  `infrastructure`, `airflow`, `mongoku`, `diagramcloud` → `true`/`false`. Only `false` switches a
  module off; unlisted modules stay on; no block = previous behaviour. Validated at runtime and in
  the editor schema (unknown ids and non-booleans rejected).
- A switched-off module disappears everywhere DataPass shows it: its Galaxy card is not detected,
  shown or counted in health; its operations leave the Work view (a scope that still references
  one reports it as a problem instead of silently dropping it); its links (Grafana, Mongoku,
  DiagramCloud) disappear; DiagramCloud bridge commands and Mongoku imports refuse with a clear
  message; a Mongoku `vscode://` link cannot select a scope through it.
- **DataPass: Choose Project Modules…** (Work view row "modules" and **…** menu): a checklist
  grouped as *cloud core* / *optional add-on*, a confirmation listing on/off, then a journaled
  write of only the `modules` block (placed after `project`), refused if the file changed since it
  was read. Nothing is installed or uninstalled.
- `D:\PROJ\datapass-testlab` (local, not in this repository): three mini projects (Fabric
  notebook, Databricks bundle, Azure plan + Oracle VM) with French scopes/checklists, each enabling
  only its module.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | 155 / 155 (4 new module tests, including editor-schema/runtime agreement) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 84 / 84: switching Power BI, Mongoku and DiagramCloud off leaves 4 Galaxy cards and only Grafana under Links, the bridge refuses, switching back restores 5 cards; declining the save changes nothing |

### Known gap (next pass)

The Galaxy **Remote SSH** action opens VS Code's generic remote menu and ignores
`platforms.oracle.sshHost`; direct connection to the declared host belongs to Pass 10b
(resources and bindings).

---

# Implementation Status — V2.2 (Pass 9.3: DiagramCloud bridge on main, Grafana and Mongoku links)

Date: 2026-09-25
Version: `0.9.3` — branch `claude/v0.9.3-bridge-companions`, based on main `6bce8b8` (v0.9.2)
Start-here handoff: [`handoff/V1_HANDOFF.md`](handoff/V1_HANDOFF.md)

### Integrated

- **DiagramCloud Bridge V1** from PR #11 (`0dc93ab`) and its contract from PR #9 (`fde955a`),
  moved onto current main (both targeted the stale `claude0.9` branch). Commands: *Open
  Architecture in DiagramCloud*, *Copy DiagramCloud AI Context*, *Import DiagramCloud AI Plan*,
  *Copy Project/Scope Summary* (Work view **…** menu). They are separate from the older
  *Export DiagramCloud Projection*.
- **Links** section in the Work view (optional; absent unless configured):
  - **Grafana**: `platforms.grafana.url` + `dashboards[{uid,title,scopes?,source?}]` → home,
    Explore, the scope's dashboards and their as-code source; **Open Grafana** on the Galaxy
    Observability card.
  - **Mongoku Lite**: `companions.mongoku.{entityId,scopeEntities}` + the `datapass.mongoku.url`
    user setting → **Open in Mongoku** (`<base>/?project=<entity>`) and **Import Mongoku
    Context** (Mongoku's own `mongoku.portfolio-context` 0.1-proposal "Developer context" JSON),
    shown as a dated snapshot, never as live state.
  - **Open in DataPass**: `vscode://julian-passebecq.datapass-vscode/open?entity=<id>` selects
    the scope mapped to that Mongoku entity. Nothing else; other parameters are ignored.
  - **DiagramCloud** row when `.datapass/diagramcloud.json` exists.

Links open only after a modal showing the exact address (once per address per window) and a
re-check against freshly loaded state; a destination or scope that changed during review is
refused. No HTTP request, database client, polling or credential anywhere in these features.

### Bugs found and fixed

| Bug | Effect before the fix | Fix |
|---|---|---|
| The bridge wrote to `vscode.env.clipboard` directly | Bypassed the Pass 9.2 clipboard seam: desktop tests could not drive *Copy AI Context* / *Copy Summary*, and would have used the real clipboard | Routed through `src/core/clipboard.ts` |
| No seam for opening a browser | "Open in browser" flows (bridge, Galaxy links) could not be tested without launching a browser | `src/core/external.ts`, swapped only in Test mode |
| The `grafana.instance` fact was hard-coded `undefined` | *Configure Grafana datasources/alerts as code* could never leave `blocked`; its next step asked for a manifest field that did not exist | Supplied by `platforms.grafana.url` (host only) |
| Preflight next steps named internal fact ids ("Declare grafana.instance…") | Not actionable for a person | Next steps name the manifest field (`FACT_MANIFEST_FIELDS`) |
| Bridge fixtures drifted from DiagramCloud after its PR #6 merged (new defaulted fields) | The serializer-parity test compared against an older DiagramCloud | Regenerated from DiagramCloud main `43f3d95`; round trip re-checked byte-identical |

### The 2026-09-25 GPT "0.9.3 review kit": reviewed, not applied as-is

| Kit proposal | Problem found | Done instead |
|---|---|---|
| Separate `.datapass/linked-services.json` repeating `projectId` and scope ids | Renaming a scope silently drops its links; a second Grafana config surface next to `platforms.grafana` | Config lives in the manifest; a dangling scope reference is a manifest error |
| A third, collapsed "Companions" view | Splits scope context; the tested layout is exactly Work + Galaxy | A **Links** section inside the Work view |
| New `datapass.mongoku-summary` contract (counts, expiry) | No producer exists; Mongoku has no summary endpoint | Consume Mongoku's real export; the test fixture is produced by Mongoku's own `buildProjectContext` |
| "No Mongoku deep-link route is known" | Mongoku documents `?project=<entity_id>` as its stable deep link | Used as-is |
| No reverse link | Mongoku's notes propose `vscode://julian-passebecq.datapass-vscode/open?entity=<id>` | Implemented, scope selection only |
| Node `fs` with `O_NOFOLLOW`, local `file:` only | Not usable in remote workspaces | `vscode.workspace.fs` with symlink and size refusal |

Kept from the kit: strict bounded validation, control/bidi character rejection, "not live / not
a health check" labelling, confirm-then-re-check before opening, no network or credentials.

### Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` (Windows 11, Node 26.9) | 151 / 151 (129 from main, 12 bridge, 10 companions) |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11 x64, isolated profile) | 82 / 82 across 4 fixtures (empty 12, v2-retail 40, v1-foil 15, broken 15), including 16 new bridge/companion flows |
| Bridge, end to end in real VS Code | *Import DiagramCloud AI Plan* writes exactly DiagramCloud's own bytes; a stale plan is refused; a manifest operation is never offered for approval |
| Cross-repo: DiagramCloud main `43f3d95` | Its serializer reproduces the fixtures and DataPass's post-plan write byte for byte; the bridge contract schemas are identical git blobs in both repositories |
| Cross-repo: Mongoku master (`aiContext.ts` blob `d673d4b`) | A context produced by its own exporter is accepted; a context for another entity is refused |
| Galaxy preview | Observability card shows *Open Grafana*; card status unchanged (a configured URL is not a tool) |

### Still needs a human

1. Real services: open a real Grafana stack and dashboard; run Mongoku (`http://localhost:3100`)
   on real data → *Developer context* → import; click a `vscode://…/open?entity=` link in a browser
   (VS Code first asks whether to let DataPass open it).
2. DiagramCloud by hand: open the DataPass-written sidecar in DiagramCloud, save, and check that
   `git diff` is empty.
3. Remote SSH / WSL workspaces (the code uses `vscode.workspace.fs`, but this is untested remotely).
4. A glance at the Work view **Links** section in your own theme.

---

# Implementation Status — V2.2 (Pass 9.2: end-to-end desktop flows, Galaxy fixed)

Date: 2026-09-24
Version: `0.9.2`

### Bugs found and fixed

| Bug | Effect before the fix | Fix |
|---|---|---|
| The Galaxy webview script was a plain template literal, so the source `'\\'` reached the webview as `'\'` | **SyntaxError: the Galaxy panel showed only its title** in v0.8.0–v0.9.1; `split(/[\\/]/)` also lost its backslash | HTML moved to `src/views/galaxyHtml.ts` (pure) as `String.raw`; unit test parses every embedded script; the same test fails on the v0.9.1 source |
| Choosing "Whole project" in the scope picker fell back to the first declared scope | The picker offered an option that was silently ignored | Explicit whole-project selection is honoured; scope id `project` is reserved (validator + JSON schema) |

### New

- **Operation readiness on Galaxy cards.** Each platform card lists the registry operations
  for that platform with the same preflight the Work view uses (asserted equal in the desktop
  suite); clicking one opens the full preflight. Only registry IDs are accepted from the
  webview. Grafana operations appear on the Observability card; Mongo, apps, Airflow and
  diagram operations stay in the Work view. Readiness is re-posted when the session changes
  (for example a review confirmation) without re-detecting platforms.
- **End-to-end desktop flows** (`tests/integration/flows.ts`), driven through the real command
  handlers with a scripted UI (quick picks, inputs, modals, file dialogs):
  checklist state + note (and the 500-character limit), scope switching, app request (frozen
  bytes, digest, self-ignoring `.datapass/local`, no local paths), result import → `candidate`
  with verified artifact and untouched manifest, stale base → `quarantined`, clipboard import,
  AI context copy (no workspace path, home directory or user name in the text), claims
  register creation, brief preparation (confidential sources never reach an internal brief)
  and approval, manifest upgrade declined (no change) and accepted (byte-identical backup,
  committed journal with its own backup, loads as v2), and refusals on an invalid manifest.
- **Clipboard seam.** All clipboard use goes through `src/core/clipboard.ts`; the test suite
  replaces it through the Test-mode API, so desktop tests never read or write the user's
  system clipboard (`vscode.env.clipboard` itself is frozen).
- **Visual preview.** `npm run preview:galaxy` renders the real Galaxy HTML with the state
  captured in real VS Code into `out/preview/galaxy-{dark,light,hc}.html`. Reviewed in dark,
  light and high contrast; high-contrast text contrast is ≥ 8.5:1.

### Verification

| Check | Result |
|---|---|
| `npm test` (Windows 11) | 129 / 129 |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11) | 66 / 66 across 4 fixtures, including 16 end-to-end flows |

### Still needs a human

Anything signed in: Fabric workspace browse, Databricks `bundle validate`, Power BI Desktop
with a PBIP project. The Galaxy preview approximates theme colours; a glance at the real panel
in your own theme is still worthwhile.

---

# Implementation Status — V2.2 (Pass 9.1: Windows desktop qualification)

Date: 2026-09-24
Version: `0.9.1`

Pass 9 was verified only on Linux with a stubbed `vscode` API. Pass 9.1 runs the extension
in real desktop VS Code on Windows and fixes what that exposed.

### Bugs found on Windows / real VS Code and fixed

| Bug | Effect before the fix | Fix |
|---|---|---|
| `DataPass: Open Galaxy` called `workbench.actions.view.openView`, which does not exist | The command and the **status bar item** failed with "command not found" on every platform | Uses the generated `datapass.galaxy.focus` |
| CLI probes used `execFile` with bare names | On Windows, CLIs installed as `.cmd` shims (Azure CLI `az.cmd`, npm tools such as `copilot`) were reported **absent** even when installed | `resolveWindowsCommand` (PATH × PATHEXT); `.cmd`/`.bat` run through `cmd.exe` only with arguments cmd cannot reinterpret, otherwise refused |
| Copied `cd "…" && tool` commands | `&&` is a parse error in Windows PowerShell 5.1 (the stock Windows shell); cmd-style `"…"` lets PowerShell expand `$` in names | Windows commands use `Set-Location -LiteralPath '…'; if ($?) { … }`, which works in PowerShell 5.1 and 7 and never runs the tool in the wrong directory; arguments use literal single quotes |
| Paths resolved with the host's `path` module regardless of target platform | Wrong command text when building for another platform | `inDirectory` uses `path.win32`/`path.posix` for the target |
| `fab` commands on Windows came out as `fab "auth" "status"` | Readability only | `shellWord` leaves plain tokens bare |

The PowerShell form was executed in real Windows PowerShell 5.1.26100 and PowerShell 7.6.6:
it runs in a directory containing `$` and `'`, stops when the directory is missing, and passes
a hostile workspace name (`O'Neil $env:USERNAME `x`) to `fab` as one literal argument.

### Desktop acceptance harness (new)

`npm run test:desktop` launches real VS Code (the installed one, or a downloaded stable build)
with the extension in development mode, a throwaway `--user-data-dir`, and four generated
fixture workspaces: `empty`, `v2-retail` (non-FOIL, builtin `sample.retail` pack), `v1-foil`,
`broken` (schemaVersion 3). It checks activation, command registration, menu/tree command
references, Work tree rendering through the real provider with unique IDs, Work and Galaxy view
resolution, refresh, preflight quick picks, graph initialisation through the real workspace FS,
validation without prompts, scope picker dismissal, manifest error reporting and JSON-schema
diagnostics from the built-in JSON server. `--real-extensions` also loads the user's installed
extensions (read-only) to record detection. Evidence is written to `out/integration/*.json`.
A read-only test API is returned from `activate()` **only** in `ExtensionMode.Test`.

CI now runs unit tests on Ubuntu **and Windows**, and the desktop suite on both (`xvfb-run` on Linux).

### Verification (this pass)

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` (Windows 11, Node 26) | 122 / 122 pass |
| `npm run test:desktop` (VS Code 1.138.0, Windows 11 x64, isolated profile) | 48 / 48 across 4 fixtures (11 + 14 + 11 + 12) |
| `--real-extensions` run (v2-retail) | 14 / 14; detections below |
| VSIX | 21 files, 112 KB; no test code, `out/` or fixtures |

Detections recorded on this machine: Databricks extension 2.18.0, Jupyter 2025.9.1, Python
2026.4.0, Container Tools 2.5.2, Remote-SSH 0.128.0, Fabric Studio 2.25.2, OneLake explorer
0.4.0, JDK 22, Python 3.14, Git 2.44, OpenSSH 9.6 present; Fabric core, Fabric Data
Engineering, TMDL, MongoDB, Draw.io extensions and `fab`, `az`, `databricks`, `tofu`,
`terraform`, `gcx`, `mongosh`, `copilot` CLIs absent; Power BI Desktop and Tabular Editor
`unknown` (never probed). `databricks.quickstart.open`, `workbench.view.extension.fabricstudio`
and `workbench.action.remote.showMenu` exist; the Fabric core view commands do not (extension
not installed). This is **detection** evidence only: no operation has been run against a Fabric,
Databricks or Power BI account.

### Still needs a human (not automatable here)

1. Modal confirmations (manifest upgrade, brief approval, review confirmations) and file dialogs.
2. Visual check of the Galaxy webview and Work tree in light, dark and high-contrast themes.
3. Anything signed in: Fabric workspace browse, Databricks `bundle validate`, Power BI Desktop
   with a PBIP project. Record results as observations, per capability.

---

# Implementation Status — V2.2 (Pass 9)

Date: 2026-09-24
Branch: `claude/v2.2-contracts-and-preflight`
Version: `0.9.0`
Handoff: `handoff/V2_2_HANDOFF.md`, `handoff/v2.2/*`

This document separates three things the handoff asks us never to blur:
**implemented** (code + tests in this repo), **documented-only** (DataPass routes the user
to a native tool and does not perform the operation) and **qualified** (evidence that it
works on a real desktop, account or tenant). Nothing in this pass is desktop-, account- or
runtime-qualified.

## Verification (this pass)

| Check | Result |
|---|---|
| `npm run check` (tsc strict, `noUncheckedIndexedAccess`) | clean |
| `npm test` | 115 / 115 pass (45 pre-existing preserved) |
| `npm run build` | `dist/extension.js` 304 kB, no test-only dependencies bundled |
| Activation smoke test (bundle loaded against a stubbed `vscode` API, v2 manifest) | `activate()` succeeds; 32/32 contributed commands registered; Work tree renders scope, checklist, operations, outputs, apps, exchanges, programme |
| Contract parity with `handoff/v2.2/contracts/contract_kit.py` | 5 emitted schemas deep-equal the Python kit; 6 examples valid; all 29 negatives rejected with coded failures |
| DiagramCloud projection | validated by DiagramCloud's own `src/core/model.ts` (vendored fixture, zod 3.25.76, devDependency only) |
| JSON Schemas (`schemas/**`) | meta-valid Draft 2020-12 (Python `jsonschema`); v1/FOIL/v2 manifests accepted; v1+scopes and credential URLs rejected; both shipped packs valid; drift test keeps them equal to the TS definitions |

Not verified: real VS Code UI (only a stubbed host), Windows, VS Code for the Web,
any Fabric/Databricks/Power BI/Grafana/Mongo account, Power BI Desktop.

## Implemented

### Core (pure TypeScript, no `vscode` import, fully tested)

| Module | What it guarantees |
|---|---|
| `core/model/strictJson` | Bounded parser: duplicate keys, non-finite numbers, `__proto__`/`constructor`/`prototype`, depth > 30, oversize, invalid UTF-8 and trailing data are rejected. Now also used for `.datapass/project.json`. |
| `core/model/{ids,evidence,canonical}` | Byte hashing (never re-serialised), ID rules shared with DiagramCloud, observation kinds each carrying what they do **not** prove. `datapass-sorted-json-v1` is explicitly not JCS and not FOIL `case_hash`. |
| `core/contracts/*` | Five envelopes (`io-contract`, `app-exchange`, `authority-snapshot`, `architecture-view`, `publication-brief`) at contract `0.1-draft`, schema DSL + interpreter, semantic rules and result correlation. |
| `core/exchange/pathSafety` | Traversal, absolute, URI, UNC, `.git`, non-portable names rejected; high-risk targets (tasks, launch, MCP, devcontainer, workflows, package scripts, `.env`, bundles, `.tf`, the manifest) flagged; symlink escape check. |
| `core/exchange/appExchange` | Frozen request bytes + digest; results are `candidate` or `quarantined`, never applied; external `succeeded` is recorded as *reported*, never as runtime-observed. |
| `core/exchange/journal` | Multi-file writes revalidate every base first, back up, read back, and roll back. |
| `core/exchange/aiContext` | Four presets, byte budget, path/credential scrubbing, explicit omissions list. |
| `core/capabilities/*` | 21 operation records (provider × item type × operation × authoring mode) with sources S01–S18, preflight statuses `ready / blocked / needs-review / needs-config / unsupported / unknown`. Optional tools never block; an unprobeable desktop app is `unknown`, not absent. |
| `core/impact/facets` | Changed JSON pointers → facets; unmapped changes become `unknown` and invalidate conservatively; stale / stale-upstream fixed point; undeclared dependencies reported as such; history retained. |
| `core/domainPacks/*` | Declarative packs only (unknown keys and executable-looking text rejected); detached candidates where only `assumption`/`proposal` fields are editable. |
| `core/workspace/graph` | `.datapass/graph.json`: dangling relations and containment cycles rejected, data-flow loops allowed, pack roles bound to items. |
| `core/workspace/gitBase` | Base capture = HEAD + fingerprint of uncommitted changes; `git ls-remote` with argv, `--` guard, credential-free URLs only. |
| `core/projectManifestModel` | `schemaVersion 1 | 2`; v2 adds scopes, apps, domain packs, graph path, remote-only repositories; pure `migrateManifestToV2`. |
| `core/programme/*` | Programme views over the graph; money kinds never summed, unknown ≠ 0, targets are not commitments. |
| `core/publication/*` | Claims register (`.datapass/claims.json`); briefs select claims by audience/classification rule and never rewrite them; local approval bound to exact bytes + audience; output manifests are `received-not-approved` or `quarantined`. |
| `core/authority/*` | Mongo QuerySpec allowlist (no `$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$unionWith`, pipeline `$lookup`), typed parameter binding, query hash; snapshots never present an error as empty or partial as complete. |
| `core/powerbi/pbipGraph` | PBIP → reports → semantic models, PBIR vs PBIR-legacy, `byPath` vs `byConnection`, TMDL vs `model.bim`, consumers, issues. |
| `core/diagramcloud/projection` | Explicit visibility on every element, confidential never exported, node status always `idle`, provenance and loss report in a private sidecar, publication `not-authorized`. |
| `core/work/workModel` | The Work view model: scope → next step → checklist → operation readiness → outputs → apps → exchanges → programme. |

### VS Code layer

- **Work view** (`datapass.work`, native tree, above Galaxy): selected scope and objective,
  next step, checklist (Done / Blocked / Problem / Skipped + note, labelled user-reported),
  operations with preflight status, affected outputs, apps (local / remote-only, last
  observed remote revision), exchanges, Programme views, problems.
- **Commands** (all in `src/work/commands.ts`): select scope, set checklist state, show
  preflight (with session-only review confirmations and the permitted action), create app
  request, import app result (clipboard or file, artifacts hash-checked), observe app remote
  revision, create parameter candidate (+ impact), analyze impact, prepare brief, approve
  brief for generation, import output manifest, import authority snapshot (checked against
  reviewed QuerySpecs in `.datapass/queries/`), export DiagramCloud projection (preview of
  omissions before saving), inspect Power BI project, copy AI context (preview of bytes,
  sections, omissions before copying), upgrade manifest to v2 (journaled, v1 backup),
  initialize project graph, validate any DataPass JSON file.
- Private session data lives in `.datapass/local/`, which writes its own `.gitignore`.
  Checklist states, exchange history, approvals and observations are in VS Code
  `workspaceState`; review confirmations are per window session only.
- **Editor validation** for `.datapass/project.json` (v1 + v2), `graph.json`, `claims.json`
  and pack files; contract schemas emitted to `schemas/contracts/` (`npm run schemas`).

### Adapter corrections

- Fabric: detects **Fabric Data Engineering** (`SynapseVSCode.synapse`, web
  `SynapseVSCode.vscode-synapse-remote`) and Jupyter; Fabric Studio, OneLake explorer and
  workspace MCP are optional and no longer lower the card status.
- Power BI: Copilot CLI optional; TMDL/PBIR markers are information, not prerequisites;
  detects the Microsoft TMDL extension (`analysis-services.TMDL`, alias `CPIM.TMDL-language-support`); card summary comes from
  the PBIP structure scan.
- Infrastructure: Container Tools (`ms-azuretools.vscode-containers`, legacy
  `ms-azuretools.vscode-docker`); Terraform and Kubernetes tooling optional next to OpenTofu.

## Documented-only (DataPass routes; the native tool acts)

Notebook local-sync and remote-VFS editing, Fabric item and Eventstream deployment (activation
review required), Airflow Git sync, Databricks notebook connect, TMDL/PBIR editing and
Power BI Desktop, Grafana Git sync (dashboards and folders only) and datasource configuration,
Mongo playground. Each record says so in its preflight evidence note.

## Corrections to the handoff

- The Microsoft TMDL extension is listed on the Marketplace as `analysis-services.TMDL`.
  Microsoft docs link `CPIM.TMDL-language-support`; DataPass detects both (Marketplace ID first).
- Fabric Data Engineering needs the Jupyter extension and a JDK for local runs; it is the
  Fabric product, not Azure Synapse Analytics, despite the publisher name.
- The draft Python kit compares `base` with dict equality; the TS port uses order-insensitive
  JSON equality, which gives the same result for the examples and is stricter about types.

## Waiting on FOIL (the FOIL pack stays `draft-awaiting-owner-declaration`)

1. Native case schema reference and the JSON pointers for each facet (economics, geometry,
   kinematics, pose, generator, presentation).
2. Declared dependencies per output (which facets LCOE, CAD, drawings, reports consume).
3. Python and JS hash test vectors for `case_hash`, so DataPass can *compare* without
   claiming equivalence.
4. Agreement on the candidate envelope and on Design Lab request/result and output
   manifests.

## Next passes

1. Manual qualification on Windows desktop VS Code with the Fabric, Databricks and TMDL
   extensions installed; record results as `desktop-qualified` per capability.
2. Galaxy cards show operation readiness from the capability registry.
3. Reviewed FOIL pack once the declarations above arrive; qualification against a real case.
4. Account qualification (Fabric workspace browse/capture, Databricks bundle validate) with
   evidence captured as observations.

---

## Previous pass (8, v0.8.0)

Date: 2026-09-23
Branch: `codex/pass8-galaxy-health-ux`
Version: `0.8.0`

### Implemented

#### Health-first Galaxy

The Galaxy is now organized as a control plane rather than a vertical diagnostic dump.

The top of the view shows:

- overall environment state: `healthy`, `attention` or `setup`;
- platform readiness count;
- detected-tool count;
- project-binding count;
- actionable attention count.

No arbitrary numeric health score is used.

#### Attention queue

DataPass now derives a compact attention queue from project and platform state.

It surfaces:

- invalid or missing project context;
- missing project repository bindings;
- platform detection errors;
- missing platform tooling.

When a safe non-mutating action exists, the queue exposes it directly.

#### Platform grouping

Platform cards are grouped into:

**Data platforms**
- Microsoft Fabric
- Databricks
- Power BI

**Engineering & runtime**
- Observability / Grafana
- Infrastructure

Unknown future adapters fall into an `Other` group automatically.

#### Compact platform cards

Each platform is now a collapsible card.

The closed state shows:

- platform name;
- status;
- summary.

The expanded state exposes:

- detected tools;
- detailed notes;
- actions;
- Fabric/Power BI catalogs.

Missing/error platforms open automatically.

#### Galaxy filters

The UI now supports:

- All
- Ready
- Partial
- Attention

Filter choice and expanded-platform state persist through the VS Code webview state API.

#### Project presentation

Project bindings remain visible, but long local filesystem values are shortened in the visible UI while the complete value remains available as hover text.

#### Status bar

The VS Code status bar now uses the same Galaxy health model.

It distinguishes:

- healthy;
- attention required;
- initial setup.

The tooltip includes detected tool, project binding and attention counts.

#### Sanitized handoff snapshot

The existing environment snapshot now includes safe health metadata:

- overall state;
- platform status counts;
- tool counts;
- binding counts;
- attention severity + labels.

It still omits:

- local paths;
- project binding values;
- generated command payloads;
- action details;
- tool/platform detail strings;
- credentials/secrets.

### Verification

CI remains the merge gate:

1. dependency installation;
2. strict TypeScript typecheck;
3. unit tests;
4. production build;
5. VSIX packaging;
6. artifact upload.

New tests cover:

- Galaxy health aggregation;
- missing binding / invalid manifest attention;
- safe action selection;
- health metadata in sanitized snapshots;
- omission of attention detail/action internals.

### Deliberately unchanged

Pass 8 does not add any new cloud mutation capability.

Existing review-first boundaries remain:

- Fabric deployment is copied/scaffolded, not silently executed;
- Power BI agentic plugins are copy-only;
- Databricks mutation remains explicit;
- infrastructure mutation remains user-triggered.

### Next likely pass

After installing the v0.8.0 VSIX in desktop VS Code:

1. adjust card density/grouping from real sidebar ergonomics;
2. add project-specific quick actions only where the desktop flow demonstrates real value;
3. bind the verified FOIL Fabric workspace;
4. validate one MCP server and one PBIP/TMDL/PBIR project;
5. only then consider controlled execution buttons for already-proven workflows.
