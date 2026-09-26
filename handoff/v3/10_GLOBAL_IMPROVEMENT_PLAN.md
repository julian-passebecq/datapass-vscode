# V3 — Global improvement plan (night of 2026-09-26)

Author: the DataPass architect session (Claude, xhigh), with the architecture choices Julian delegated
for tonight. Inputs: main `a3c08bf` (0.20.0, unit suite **334/334 pass**, run once tonight), Julian's
night vision (`effort-board/ideas/2026-09-26-julian-night-vision.md`), and the FOIL AI's step-back
review (`foil-control-v1@454ee60`, `docs/foil-platform-handbook/reviews/2026-09-26-gpt-step-back/`).
The toolkit catalogue pass (0.21.0) runs in its own session and is not changed by this plan; its
planned 0.22 "modes" pass is **replaced by package B** below.

## 1. Findings

1. **The foundation is right; nothing is restarted.** Julian's vision (client AI prepares, DataPass
   reads and shows, a bridge repository lists the native repositories, architecture first, native
   tree, AI loop, Git refresh) is already the V3 model: coordination repository + `.datapass/*.json`,
   options.json authored by the client AI, the Architecture panel and Details, the company workspace
   (multi-root), the Git view, the AI exchange, Check for updates. The FOIL review reaches the same
   conclusion.
2. **The real gap is presentation.** 0.20 shows every surface to everyone (7 views, a 3-tab AI view,
   Galaxy, Work, board, readiness, toolchain, work orders). No view has a `when` clause and the
   extension sets no context key. Julian wants a light experience first, the full one on demand.
3. **Trust gaps (F01–F08) are all confirmed on current main** — I checked each one in the source:
   mixed-currency subtotal (`optionsReport.ts` "Declared cost of this choice"), `size:mtime` stored as
   `sha256` (`projectObserver.ts`), a failed `git ls-files` read as "untracked", a declared remote
   with no observed origin resolved as `local` (`resolve.ts` line ~148), 2,000 observations started
   at once (`Promise.all`), "move merged cards to done" and "I am a beginner" in prompts
   (`aiExchange.ts`, `optionsReport.ts`), "same pull request" across repositories (`docs/guide/02`,
   `05`), partial cost totals not labelled. None is rejected.
4. **Two missing links in the daily loop.** (a) Context export starts from a component, not from any
   file: Julian's "one click on a file → context for the client AI" does not exist. (b) DataPass never
   flags format errors it could see without running anything (a `databricks.yml` whose notebook path
   does not exist, a broken YAML, a Dockerfile `COPY` of a missing file).
5. **What not to build** (agreeing with the review): no new knowledge database or price scraper, no
   virtual mega-repository or custom file browser, no compiler per provider, no DataPass files in
   native repositories, no second FOIL backlog, no psychological profile.

## 2. Decisions (taken tonight, delegated by Julian)

| # | Decision | Reason |
|---|---|---|
| D-01 | **Modes are presentation presets over one model**: ids `vanilla`, `standard`, `datapass`, `advanced`, labels Julian's (Vanilla, Standard, DataPass, Advanced). Same manifest, graph and files in every mode; switching writes no project file. | Julian's four modes; the review's "one policy layer, not four products". "Essential" (review) is not used: Julian named it Vanilla; the description says third-party extensions are untouched. |
| D-02 | **Presets are JSON**: shipped in `resources/experience/presets.json` (format `datapass.experience` 1, schema in `schemas/`), selected by the setting `datapass.experience.preset`, adjusted surface by surface with `datapass.experience.overrides` (the "~80 %, Julian picks" mode). Presets control views, AI tabs, Project/Workbench sections, status-bar items and the landing view. | Julian: "paramétrable en JSON en amont, y compris les icônes et les barres". Settings are JSON, need no manifest change and are per machine. VS Code cannot recolour contributed icons at runtime; a preset shows or hides activity-bar entries instead. |
| D-03 | **Presets never gate safety.** Blockers (untrusted workspace, wrong or unverified repository, stale approval, secret refused, production) show in every mode; work orders keep their own opt-ins (machine setting + project type). Commands stay in the palette; only menus/views are hidden. | Hiding is not authorisation (review §02.2). |
| D-04 | **Bridge repository = the existing coordination repository.** No new repository kind, no manifest change. Docs and UI say "bridge repository" (with "coordination repository" as the older name). **Native repositories stay free of DataPass files**; acceptance for any bridge-only feature: the native repositories' diff is empty. | Julian's bridge idea is the V3 model; renaming is cheaper than a second concept. |
| D-05 | **Architecture comparisons are the client AI's** (options.json, per project and sub-project). DataPass computes graph and tool deltas, typed per-currency costs, marks partial totals, never gives a verdict. **The shared service knowledge is the 0.21 hub toolkit** (`tools.json` with free tier / pricing / `checkedAt`), updated by the global AI through the JSON exchange. | Already modelled; one knowledge store only. |
| D-06 | **Global tree = the native multi-root Explorer** (0.17 company workspace, one root per repository) **plus** DataPass's semantic tree; both open the same URI; split editors are VS Code's. | The review and VS Code agree; a custom browser would duplicate Git status and extension roots. |
| D-07 | **First view = the global architecture diagram** (Standard and above), with the existing renderer (lanes, folding, clickable components → Details / project pages). Mermaid stays an export. | Julian: keep the good diagrams. |
| D-08 | **The daily loop** is: file → *Copy context for my AI* (package C) → client AI → PR in the native repository **plus a separate bridge PR when the architecture changes** (a coordinated change set, F07) → *Check for updates*. Format checks (package D) read, never run. | Julian's loop; F07. |
| D-09 | **Four meanings of "scenario" stay separate**: machine/experiment scenario (FOIL-owned, never in DataPass logic), cloud architecture scenario (options.json), execution environment (manifest), presentation preset. | Review §03.2; avoids a silent mismatch. |
| D-10 | **Board and work orders are kept, not shown by default**: board off in Vanilla/Standard, optional in DataPass mode, on in Advanced; work orders only in DataPass/Advanced and still opt-in. FOIL keeps its PM backlog as authority (no DataPass board for FOIL). | Nothing is thrown away (Julian); review value matrix. |
| D-11 | **F01–F08 accepted**, all in package A. F05 gets a bounded queue and an "incomplete" flag, not a benchmark. | Confirmed on main. |
| D-12 | **The FOIL bridge files are prepared by the FOIL AI, not by Claude.** DataPass ships the guide; §8 is the message for the FOIL AI. | Julian's principle "the client AI prepares". |
| D-13 | **Release discipline tonight**: packages A–D do **not** bump the version or edit `CHANGELOG.md`, `IMPLEMENTATION_STATUS.md` or `CLAUDE.md`; each writes `handoff/v3/night/0.22-<letter>.md`. Step E consolidates into **0.22.0**. | Four parallel PRs otherwise collide on the same lines. |
| D-14 | Julian-dev-v1 (review proposal) is a Claude Control matter, not a DataPass feature; nothing is activated here. | Out of this repository's scope. |

## 3. Features by version and mode

Mode column = the lightest mode in which the surface is visible by default (Vanilla < Standard <
DataPass < Advanced). "Useful" is for Julian's daily loop, FOIL first.

| Feature | Exists since | Value | Mode | Version |
|---|---|---|---|---|
| Native multi-root Explorer through the company workspace, work views, startup view | 0.17 | useful | Vanilla | V1 |
| Git view: repositories, worktrees, PRs with CI, Needs you, Fetch all | 0.19 | useful | Vanilla | V1 |
| Check for updates / Get updates (fast-forward only) | 0.13 | useful | Vanilla | V1 |
| AI exchange, DataPass-guided tab (JSON copy / validated import, backup, restore) | 0.15 | useful | Vanilla | V1 |
| **Copy context for my AI from any file** (package C) | new | useful | Vanilla | V1 (0.22) |
| **Format checks without execution → Problems** (package D) | new | useful | Vanilla | V1 (0.22) |
| **Modes / presets** (package B) | new | useful | all | V1 (0.22) |
| **Trust repairs F01–F08** (package A) | new | useful | all | V1 (0.22) |
| Architecture panel as the landing view, Details side bar | 0.13/0.15 | useful | Standard | V1 |
| "Alternatives exist" indicator on a component | new in B | useful | Standard | V1 (0.22) |
| Project tree by scope / sub-project, repository states | 0.13 | useful | DataPass | V1 |
| Options: scenario comparison, preview, record a decision | 0.15 | useful | DataPass | V1 |
| Readiness, local env, toolchain, ID map, connections (full sections) | 0.14/0.18 | useful | DataPass (blockers in all) | V1 |
| Toolkit catalogue and recipes from the hub | 0.21 | useful | DataPass | V1 |
| Floating Workbench, Power Ops launcher list | 0.17 | useful | DataPass | V1 |
| Project sheet (datasets, formulas, runtimes) | 0.15 | less useful | DataPass, on selection | V1 |
| Board (kanban, sprints) | 0.16 | less useful (FOIL: none) | DataPass optional / Advanced | V1 |
| Work orders, Agent tab, work log | 0.20 | conditional | DataPass/Advanced + opt-in | V1 |
| AI Manual tab | 0.20 | less useful | DataPass | V1 |
| Galaxy view, Work view (module cards, capability operations), qualification report | V1/V2 era | less useful | Advanced | V1 |
| DiagramCloud export, Mongoku links | frozen | less useful | Advanced | V1 |
| Bridge recommends a preset and surfaces (manifest v6 `presentation`) | — | useful | — | V2 |
| Presets and checklists shipped from the hub (like the toolkit) | — | useful | — | V2 |
| Check plan and evidence rows (NOT_RUN / UNKNOWN / FAIL / STALE), result reuse by input identity | — | useful | DataPass | V2 |
| Coordinated change sets shown (native PR ↔ bridge PR, prepared vs landed) | docs in A | useful | DataPass | V2 |
| Cost lines linked to toolkit ids, pinned catalogue revision, stale assertions | — | useful | DataPass | V2 |
| Python syntax check through a vetted parser, notebook formats | — | useful | Vanilla | V2 |
| Company-level global view (all projects of a company on one diagram) | — | useful | Standard | V2 |
| Remote-SSH / WSL qualification | — | useful | all | V2 |
| Recipes exported as agent skills; read-only DataPass MCP server; Pilot | — | later | Advanced | V3 |
| FOIL producer routes (generate), diagram editing | — | depends on FOIL / optional | Advanced | V3 |

## 4. Work packages for tonight (A–D in parallel, E after)

Each package: its own worktree from up-to-date main, branch `claude/0.22-<letter>-<slug>`, effort
**high**, `npm run verify` green, its own desktop flows file passing locally, PR merged on green CI.
Common rules:

- **Shared files.** No version bump; no edits to `CHANGELOG.md`, `IMPLEMENTATION_STATUS.md`,
  `CLAUDE.md`, `handoff/V3_HANDOFF.md`. Release notes go to a new `handoff/v3/night/0.22-<letter>.md`
  (what changed, tests, limits). In `package.json`, `src/extension.ts` and
  `tests/integration/suite.ts`, add only your own entries (commands, menus, settings, one register
  call, one suite line); before merging, rebase on main and resolve those three files by union.
- **Merge order** when several are green together: A, C, D, B (B last: it gates every view).
- **Ownership** (do not edit another package's files; if you must, keep it to a one-line hook and
  say so in the PR):

| Package | Owns |
|---|---|
| A | `src/core/project/{options,optionsReport,resolve}.ts`, `src/core/project/aiExchange.ts` (prompts), `src/work/projectObserver.ts`, the state labels in `src/views/{projectTree,workbenchState}.ts`, `docs/guide/{02,05,07}_*.md`, `docs/PREPARING_A_PROJECT.md` |
| B | `src/core/experience/**`, `resources/experience/**`, `schemas/datapass-experience.schema.json`, `src/work/experienceCommands.ts`, views `when` clauses in `package.json`, section gating in `src/views/{workbenchHtml,aiExchangeHtml}.ts` and the root children of `src/views/projectTree.ts` |
| C | `src/core/exchange/fileContext.ts`, `src/work/fileContextCommands.ts`, its menus in `package.json` |
| D | `src/core/checks/**`, `src/work/checkCommands.ts`, `tests/fixtures/checks/**`, its settings in `package.json` |

### A — Trust repairs (F01–F08)

**Scope.** Repair the eight confirmed findings of the FOIL review, each with a regression test that
fails on `a3c08bf`.

- **F01 + F08.** One typed cost aggregation (per currency; monthly and one-time separate; priced vs
  unpriced count) used by the option subtotal, the compact cost line, the scenario table and the
  webview. No FX conversion. A total with any unpriced decision or line says "partial: n of m
  priced". Unknown is never zero.
- **F02.** Observations carry a discriminated fingerprint: `{ kind: "sha256", value }` or
  `{ kind: "stat", size, mtimeMs }`. A composite digest built from a stat fingerprint is marked weak;
  every consumer needing exact content (approvals, qualification, work-order digests if any) treats
  weak as unknown or hashes on demand (streaming, byte budget). Grep every reader of `sha256`.
- **F03.** Git tracking is `tracked | untracked | unknown` with a reason; `mustNotCommit` shows
  "could not check Git tracking" and never counts as clean.
- **F04.** New repository state `unverified` (a remote is declared, the folder is a Git repository,
  origin is absent or its lookup failed): browsing allowed; *Get updates*, work-order launch and
  anything that relies on identity are blocked with *Locate* / *Retry*. A repository declared without
  a remote stays `local`.
- **F05.** Bounded observation queue (≈16 at a time), a total byte budget, an `incomplete` flag with
  the reason shown as "inspection incomplete (n skipped)".
- **F06.** Board prompt: a merged PR is implementation evidence (card to `review`), `done` only per
  the card's acceptance or an explicit project rule; remove "I am a beginner in cloud engineering"
  and any fixed sprint assumption (grep the prompts and packs).
- **F07.** Guide and preparation contract: one PR per native repository plus a separate bridge PR,
  cross-linked ("coordinated change set"); never "the same PR" across repositories. Use "bridge
  repository (coordination repository)" wording (D-04).

**Acceptance.** `tests/trustRepairs.test.ts` with the review's regression cases (mixed currencies,
default currency, monthly + one-time, zero line, all unknown, partial; equal size+mtime with
different bytes; failed hash; git missing / error / truncated output; absent origin, failed lookup,
wrong origin, SSH vs HTTPS equivalent, local-only repository; 2,000+ planned entries stay bounded;
prompt texts). Existing tests and the options/readiness desktop flows pass. The PR body has the
reconciliation table: finding → fixed → test name. **Effort: high.**

### B — Modes (experience presets)

**Scope.** D-01 to D-03 and D-10. A stable list of **surface ids** (views, AI tabs, Project tree
sections, Workbench sections, status-bar items, landing); `presets.json` defines the four presets
(table in §3); a pure resolver (preset → overrides → effective surfaces, each with its origin);
context keys `datapass.surface.<id>` set on start and on setting change; `when` clauses on views and
menus; section gating in the Project tree, Workbench and AI view; a status-bar item "DataPass:
Standard" (tooltip: effective mode and overrides) opening *DataPass: Switch Mode*; *Customize
DataPass Mode* (multi-select quick pick writing `datapass.experience.overrides`); landing: Standard
and above focus the Architecture panel when a project opens (reuse, don't replace, 0.17's
`datapass.startupView`, which wins when set). Standard shows an "alternatives exist" badge on
components that an options.json decision touches, instead of the Options section. Default preset
for a new install: `standard`, with a one-time notification "DataPass opens in Standard mode —
Switch mode" (logged for Julian's confirmation, §6).

**Acceptance.** Unit: presets.json validates against its schema; unknown surface or preset id
rejected with a message; resolution order and origins; every contributed view has a surface id
(a test compares `package.json` views with the surface list, so a future view cannot escape the
modes). Desktop flows (`experienceFlows.ts`): Vanilla shows Explorer, Git and the AI view
(DataPass-guided tab only); Standard adds Architecture + Details; switching to Advanced shows
everything as in 0.20; **switching writes no file in any repository** (checked with `git status` on
the fixture); in Vanilla an untrusted-workspace blocker and a refused-secret import still show; a
command hidden from menus still runs from the palette with its own guards. README gets the modes
table. **Effort: high.**

### C — "Copy context for my AI" from any file

**Scope.** D-08, first half. Command *DataPass: Copy Context for My AI* on the Explorer context menu,
the editor title/context menu and a selection. It builds a bounded pack: the question (optional
input), the file's repository (declared id, role in the manifest, branch, HEAD, dirty or unsaved
state — an unsaved buffer is included or clearly flagged), the owning component(s) and scope from
the graph, the revision of each repository the component uses, a small tree excerpt (parent folders
and siblings, capped), the file or selection (byte budget, truncation labelled), the file's current
diagnostics (VS Code's, including package D's), and the rules for the answer (native PR in that
repository; a separate bridge PR if the architecture changes). Repository-relative paths only;
credential-shaped text scrubbed with the existing scrubber; a preview before copying. Uses the
resolver read-only; changes no existing module.

**Acceptance.** `tests/fileContext.test.ts`: file inside a component; file in a declared repository
but no component; file outside every declared repository (tree + "not in the bridge"); unsaved
buffer; selection; oversize file truncated and labelled; a secret in the file scrubbed; no absolute
local path in the output; two worktrees of the same remote resolved to the one that holds the file.
Desktop flow: the Explorer menu entry copies a pack for a fixture file. **Effort: high.**

### D — Format checks without execution

**Scope.** D-08, second half. A DataPass `DiagnosticCollection` fed by parse-only rules, on save and
on *DataPass: Check This File* / *Check This Repository*: JSON syntax (non-`.datapass` files), YAML
syntax, **DAB** (`databricks.yml`: `bundle.name`, targets, `include` globs match files, referenced
`notebook_path` / `python_file` / `whl` paths exist, `${var.x}` declared), **Dockerfile** (`FROM`
present, `COPY`/`ADD` sources exist in the context), **docker-compose** (`build.context`, `env_file`
paths exist — never read). Each diagnostic has a rule id and, for DAB, offers the existing
`databricks bundle validate` route (never run automatically). No child process, no project code
executed, works in an untrusted workspace; bounded file count and bytes. A YAML parser may be added
as a bundled dev dependency (`yaml`) if the existing readers are not enough. The guide gets "What
DataPass checks without running anything", so the client AI can pre-check before its PR. Python
syntax is V2 (it needs a vetted parser).

**Acceptance.** `tests/checks.test.ts` with good/bad fixtures per rule; a fixed file clears its
diagnostics; a test that `src/core/checks/**` imports nothing from `exec`/`child_process`; the
budget stops a 5,000-file repository scan with an "incomplete" diagnostic. Desktop flow: a broken
`databricks.yml` in a fixture shows in Problems. **Effort: high.**

### E — Release 0.22.0 (after A–D are merged)

Bump to 0.22.0; `CHANGELOG.md`, the top of `IMPLEMENTATION_STATUS.md` and `CLAUDE.md`'s current-source
line from `handoff/v3/night/*.md` (then delete that folder's notes into the status); update
`04_NEXT_PASSES.md` (Done in 0.21/0.22, the V2 list of §3); full desktop suite; merge on green.
**Effort: medium** (coder D or whichever finishes first).

## 5. The client ↔ DataPass contract (short form, for the guide)

- **Client side** (company, project, sub-project) and its AI own: native repositories and their
  files, the bridge repository's `.datapass/*.json` (manifest, graph, options with sourced and dated
  prices, sheet, board if wanted), acceptance criteria and scientific meaning.
- **DataPass** owns: reading and resolving the bridge, observing local clones and tools (with
  unknown when it could not observe), showing the architecture and the files, parse-only checks,
  bounded context export, validated import of DataPass files, explicit Git updates (fast-forward
  only), routes to native tools. It writes only DataPass files in the bridge, after review, with a
  backup.
- **Native repositories** never contain DataPass files. Changes land as native PRs plus, when the
  architecture changes, a bridge PR.

## 6. For Julian to confirm in the morning (work continues with the recommendation)

| # | Question | Recommendation |
|---|---|---|
| J1 | Default mode for a new window: Standard or Advanced? | **Standard** (the calm view you asked for; one click to Advanced, nothing lost). |
| J2 | FOIL's bridge repository: `foil-v1-vscode-datapass` or `foil-control-v1` (the review's suggestion)? | **`foil-v1-vscode-datapass`**: it is already DataPass-shaped, and `foil-control-v1` stays FOIL's own control authority, listed in the bridge as a native repository, free of DataPass files. |
| J3 | V2: may the bridge recommend a mode and surfaces (manifest v6 `presentation` block), so the client's or DataPass's AI "chooses the 80 %"? | **Yes, in V2**; your local choice always wins. |
| J4 | Call it "bridge repository" in the UI from 0.22 (older name kept in the docs)? | **Yes.** |

## 7. FOIL review reconciliation

| Finding | Disposition | Where |
|---|---|---|
| F01 mixed currencies | accepted, confirmed on main | A |
| F02 stat marker as sha256 | accepted, confirmed | A |
| F03 failed tracking probe | accepted, confirmed | A |
| F04 origin not verified | accepted, confirmed | A |
| F05 unbounded concurrency | accepted (queue + incomplete flag; no benchmark) | A |
| F06 merge = done, beginner, sprint | accepted | A |
| F07 same PR across repositories | accepted | A (docs) |
| F08 partial costs hidden | accepted | A |
| Four presentation presets | accepted with Julian's names | B |
| Keep diagram model, native Explorer, explicit Git | accepted, unchanged | — |
| Qualify three FOIL stories (Wind formula, PDF pipeline, DAB) | accepted as Julian's acceptance after 0.22, once the FOIL AI has prepared the bridge | §8 |

## 8. Message for the FOIL AI (Julian forwards it)

DataPass 0.22 keeps your contract: prepare the FOIL bridge in `foil-v1-vscode-datapass` (pending J2):
a short README/AGENTS, the manifest naming the native repositories with their roles
(`foil-control-v1`, `foil-streamlit-wind-3d-lcoe`, `foil_databrick_dab`, `reactoracle` with its
verified branch, the Azure PDF pipeline when it has a home) and real environments, a graph at native
units (DAB root, Function App, DAG package, model library, dataset contract), and options.json for
real platform choices with sourced, dated, per-currency prices. No DataPass file in the native
repositories; no board (the PM backlog stays the authority). Your eight findings are all accepted
and fixed in 0.22 (package A). Julian then runs your three stories (§6 of your chapter 03) in
Standard mode.
