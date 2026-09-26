# Changelog

DataPass Control Plane (VS Code extension). Detail per pass: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md);
status and next steps: [handoff/V3_HANDOFF.md](handoff/V3_HANDOFF.md).

## 0.26.0 — Pilot without sign-in, Open a Client Project, MCP and cost repairs, Mongoku removed (2026-09-26)

Plan: [handoff/PLAN.md](handoff/PLAN.md) rows AI-4a, M1, K1, C1, X1, R3, E1, V1-ON, V1-P1, V1-DOC, V1-T10 (FOIL MCP review
[handoff/v3/11_FOIL_MCP_REVIEW.md](handoff/v3/11_FOIL_MCP_REVIEW.md), decisions D-19 to D-28). One new order kind (`pilot-read`), two new
optional options.json cost fields; no manifest version change.

- **Pilot stage 1, read-only, no Azure sign-in needed** (package AI-4a, PR #55): a new order kind
  `pilot-read` (cloud read-only, every repository read-only, permissions always *ask*, no pull
  requests), written from the new **Pilot** tab of the AI view. DataPass writes the agent's guard rails
  only inside the order folder (`.claude/settings.json`, `.codex/config.toml`, `.codex/rules/pilot.rules`,
  regenerated and compared byte for byte before each launch) and launches Claude or Codex in a terminal
  with them; the Codex app is refused until `datapass.pilot.codexAppQualified`. The agent asks for a
  read action by writing `requests/<n>.json`; each valid request becomes a **Pilot card** you run
  (*Run it*) or decline (*Not now*), and DataPass answers in `responses/<n>.json` (names and states
  only). Off until the machine setting `datapass.pilot.enabled`.
- **Lossless `.vscode/mcp.json` edits** (package M1, PR #57, FOIL review R1): *Configure Fabric MCP*
  keeps `inputs`, unknown keys and every server field (`env`, `envFile`, `cwd`, `type`, remote
  `url`/`headers`), refuses another host's `mcpServers` dialect and files with comments or trailing
  commas, and writes through the reviewed path (diff, confirmation, digest check, backup, journal).
- **Toolkit knowledge refresh** (package K1, PR #60, FOIL review R2): the example hub gains the Fabric
  Core / local / IQ MCP servers, the hosted Power BI Authoring MCP, the Skills for Fabric plugin and the
  Azure MCP, each dated with hosts, transport and side effects; baseline corrections (Fabric Studio,
  Power BI Authoring MCP local option, data-goblin plugin, semantic-link-labs, `ws.mcp` = registration
  file only); recipe `mcp.fabric-sample.inspect-readonly`; guide page 9 section *MCP servers and the
  official Power BI agentic route*.
- **Cost basis in options.json** (package C1, PR #61, D-24): a cost line may carry `shared` (same key
  across options counts **once** in combined totals; disagreeing figures → unpriced with a message) and
  `use: "learning-only"` (flagged "learning only — not for client work", never hidden). options.json
  stays version "1". These two fields require **DataPass ≥ 0.26**: an older DataPass rejects them with
  the unknown-field message (the cost-basis brief says 0.27; it is a historical record, the guides are
  right).
- **Mongoku removed from DataPass** (package X1, PR #63): Mongoku is a separate app with no link to
  DataPass. Its commands, the `datapass.mongoku.url` setting, the `vscode://…/open?entity=` link, its
  Work-view and Readiness rows, the `mongoku` module and the context import are gone; new manifests and
  the docs no longer mention it. Old manifests with `modules.mongoku` or `companions.mongoku` still
  load (accepted and ignored). The MongoDB authority-snapshot import moved to the `databases` module.
  `.datapass/board.json` and `.datapass/work-log.json` are unchanged.
- **First V1 items** (on main when 0.26.0 was cut, so they ship in it):
  - **DataPass: Open a Client Project…** (V1-ON, PR #68): from the bridge repository's Git address
    (GitHub, Azure DevOps, GitLab; https or SSH) to a company window in one command — clones what is
    missing, finds clones already here by remote identity, never clones planned repositories, writes
    the company workspace file and opens it; idempotent, with Retry on a failed clone. Also in the
    empty Explorer and Project view, and a walkthrough **Get started with DataPass** (Help → Welcome →
    Walkthroughs).
  - **Integration evidence chain** (E1, PR #67, D-22): for az, databricks, fab and the known MCP
    servers, Readiness, its report and the Workbench show each link — known → installed → registered
    → connected → authenticated → authorized → operation verified — as observed, unknown (with why)
    or not applicable; nothing is inferred, a registration file never means connected. Work-order
    result.json `checks[]` accept optional `field` / `tool` / `scope` / `input` (receipts), and
    Details shows each result field on its own.
  - **Pack and work-order stamps** (V1-P1, PR #66, D-23): Copy Context for My AI, the options packs
    and work orders (`order.json` optional `stamp`, `order.md` stamp line) carry the selected variant,
    the environment and the bridge revision they were built for. The AI view flags a copied pack as
    **⚠ Stale** when the variant, environment or bridge revision changed since; launching an order
    stamped for another variant asks *Keep and launch / Rebuild for the selected variant / Cancel*.
    Pilot cards go stale the same way, and the result format asks agents for `field` / `tool` /
    `scope` / `input` on each check.
  - **Docs you can read** (V1-DOC, PR #64): [docs/DEMARRER.md](docs/DEMARRER.md) (French quick start),
    [handoff/CURRENT.md](handoff/CURRENT.md) as the entry point, older handoffs moved to
    `handoff/archive/`, README top rewritten.
  - **Testlab 10, acceptance journeys** (V1-T10, PR #69, D-28): outside the repository
    (`datapass-testlab/10-parcours-client`), 10/10 journeys replayed by Claude; section B7 in
    `handoff/v3/04_NEXT_PASSES.md`.

## 0.25.0 — Previewing variants and repository layout (2026-09-26)

Plan: [handoff/PLAN.md](handoff/PLAN.md) rows V-A, R-L, R2 (Julian's FOIL answers Q1 and Q5). No new
file format; one new machine-local state key (`datapass.v25.activeVariant`).

- **Selected variant** (package V-A, PR #54 and the release PR): choose which architecture variant to
  **preview**, **on this machine, per project** (VS Code global state keyed by project id; never
  written in a repository). A status-bar item (surface `status.selectedVariant`, Standard, DataPass and
  Advanced) reads `Variant: B — … · preview`; one click opens *DataPass: Switch the Selected Variant*
  (current, decided, every scenario of options.json). It is the architecture preview made persistent:
  the Project tree (*Selected architecture*), the diagram, Details and the Workbench follow it, and
  switching in the Workbench selector or on the diagram switches it too. A scenario or option that
  disappears falls back to the current architecture with one message.
- **Preview, test, activate** are kept apart (FOIL review): the selected variant is a preview only —
  not a decision (*Record decision* stays the committed path), not a test (a native check on a
  declared environment, approved separately) and never an activation (switching the live route is
  operational, outside DataPass; DataPass does not observe it).
- **Packs name the selected variant as a preview**: *Copy Context for My AI*, the options export /
  compare / apply packs and the options work orders carry `Selected variant (preview on this machine —
  not a decision, not a deployment): **…** · files: … Live route: not observed by DataPass.`
- **Files on disk, not "coded"**: the coding-state badges now read **files present** / **some files
  present** / **no files** / not checked here, with "present on disk; not built, tested or deployed"
  in their tooltips (the internal states are unchanged).
- **Example `examples/v3/doc-pipeline`** (public, generic): PDFs → storage → processing, orchestrated
  by A a direct script (files present), B a Blob event + Function (some files present) or C Data
  Factory in a planned repository (no files), with dated per-currency prices. Guide page
  [docs/guide/10_SWITCHING_VARIANTS.md](docs/guide/10_SWITCHING_VARIANTS.md) (previewing variants;
  preview / test / activate also in guide page 2).
- **Repository layout contract** (package R-L, PR #52, docs only): "we prefer one native repository per
  sub-project; you may also use one repository with sub-folders (`path`)"; the bridge holds only
  links and DataPass JSON, never code, and is not part of what a client or auditor receives. Sources
  cited with their check date in [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md),
  guide pages 01, 02 and 06.

## 0.24.0 — Claude & Codex panel (2026-09-26)

Plan: [handoff/PLAN.md](handoff/PLAN.md) row AI-3. Design:
[handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md) §7, §8.7, §3.2,
§5, §9 and Julian's answers §13.1. Reads Claude Control's `GET /api/work-orders` (Galaxy
`claude-control-api.work-orders/1`, claude-control C-1) and its existing API (`claude-control-api`).
No new file format. PR #46.

- **Claude & Codex panel** (right side bar, between the AI view and Details, folded by default;
  shown in the DataPass and Advanced modes, surface `view.agentPanel`): your quick links
  (`datapass.ai.quickLinks`: https pages, `claude:` links and http on 127.0.0.1 / localhost only),
  Claude Control ● on / ○ off with the time of the check, plan usage (5-hour and weekly %), and per
  project the conversations running, waiting for you or with an open PR (*Open in Claude*), open
  PRs, urgent alerts and your *À faire par toi* rows. When Control is off: "Claude Control is off.
  DataPass works normally; conversation status and token counts are hidden." and *Copy the start
  command* (`datapass.control.folder`); DataPass never starts Control.
- **Claude Control, read-only and loopback only**: `datapass.control.enabled` (off = no request at
  all) and `datapass.control.url` (machine setting, `http://127.0.0.1:<port>` or
  `http://localhost:<port>` only). DataPass reads `/api/health`, `/api/status`, `/api/project/<name>`
  and `/api/work-orders` only while the panel is visible or a launched order is open (every 60 s;
  every 5 min once Control is off), never during activation. Everything is treated as untrusted:
  allowlisted fields (never task texts, last messages, agents, mode or project instructions),
  flattened text, and links kept only when `claude://claude.ai/epitaxy/<id>` or an https PR page on
  a known Git host; the webview never holds a URL.
- **Work orders view**: new **Conversation** and **Tokens** columns and a *Conversation (Claude
  Control)* section in the order's Details: status, where it runs, how DataPass knows it is this
  order's conversation — the exact session id DataPass chose, **moved to the app with /desktop**
  (the Claude app keeps that id), or found by the marker line — tokens, last activity, and *Open in
  Claude*. Without Control: "— (Control off)", everything else unchanged.
- **Codex hand-off**: the ChatGPT app route runs `codex app <folder>` when a Codex CLI is configured
  (`datapass.ai.codex.path`) or on PATH, otherwise it copies the prompt and opens the app as before;
  the Codex terminal launch (`-C`, `--add-dir`, `--sandbox workspace-write --ask-for-approval
  on-request`) and `.cmd` shims (strict tokens on the cmd.exe line, else *Copy the command*) are
  covered by tests. The Agent tab says which Codex route applies on this computer.


## 0.23.0 — toolkit catalogue and variants (2026-09-26)

Plan: [handoff/PLAN.md](handoff/PLAN.md) rows G, T1–T4 and R. Toolkit design:
[handoff/v3/08_TOOLKIT_AND_AGENTS.md](handoff/v3/08_TOOLKIT_AND_AGENTS.md) §5.1, 5.2, 5.4, with the
free tier and pricing Julian asked for ([09 §13.1](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md)).
Variants: [10_GLOBAL_IMPROVEMENT_PLAN.md](handoff/v3/10_GLOBAL_IMPROVEMENT_PLAN.md) D-15 to D-17.
New files in the **hub repository**: `.datapass/toolkit/tools.json` and `.datapass/toolkit/recipes/*.json`
(format `datapass.toolkit` 1, schema `schemas/datapass-toolkit.schema.json`). Board items gain the
optional `recipe` and `route` (`datapass.board` stays version 1; DataPass ≤ 0.22 refuses a board that
uses them). PRs #39 (variants) and #43 (toolkit).

### Toolkit catalogue

- **Catalogue**: every tool DataPass knows (the probe registry plus fabric-cicd, semantic-link-labs
  and the data-goblin plugins) ships as a **built-in baseline** with what it is for, its modules,
  and its **free tier and prices** (`priceModel`, `freeTier`, `pricingUrl`, `tiers[]`, `checkedAt`),
  read on the vendors' pages on 2026-09-26. A figure that could not be confirmed on the official
  page is written *unknown*, never guessed. Prices are shown as dated claims, never authority.
- **Hub layer**: DataPass reads the toolkit files of the project folder and of the hubs beside the
  catalogs of `datapass.catalogs`, after *Get updates* or when they change. Hub entries add tools or
  change the shown fields of a built-in one ("changed by the hub"); what DataPass probes or runs
  stays in the extension. Every entry is validated on its own: one this DataPass does not
  understand is skipped with its reason, never guessed. A file for a newer DataPass
  (`requires.datapass`) or a newer format version is flagged.
- **Recipes**: step-by-step routes that name their tools, with checks and risks. Each route is marked
  *applies here* / *does not apply* / *not checked* from the project's facts (a Fabric Git binding,
  the coordination repository) and this computer's probes, and the first that applies is suggested.
  Commands in steps are copied, never run.
- **Where it shows**: a sixth Workbench view, **Toolkit** (Tools, Recipes, Needs a newer DataPass,
  Files read; *DataPass: Open the Toolkit*); **Details** of a component ("Tools and what they cost",
  with the recipes that use them); **board cards** (the card's recipe and route, with the steps);
  **Options** (the price next to each official tool an option adds); the card **AI pack** (the
  recipe section).
- **Needs a newer DataPass**: `datapassRequests` (`title`, `why`, `example`) is how ChatGPT says the
  format cannot express something, instead of inventing a field; listed in the Toolkit view with the
  files written for a newer DataPass.
- **Updating it**: ChatGPT through *Copy a DataPass File for the AI* → toolkit catalogue (check free
  tiers and prices / add or correct tools and recipes) and *Paste the AI's answer* (strict: any
  invalid entry refuses the file; diff, backup, confirmation); agents through pull requests. The
  toolchain (0.18) accepts tool ids the hub describes (not probed).
- **Modes**: new surfaces `workbench.toolkit`, `project.toolkit` (a Project tree section) and
  `badge.hubChanged`, shown in DataPass and Advanced, hidden in Vanilla and Standard.
- **Example**: `examples/v3/hub/.datapass/toolkit/` (Copy Job bulk edit, fabric-cicd dev → prod, PBIP
  in Git) and a Sales BI board whose cards name those recipes.

### Variants (package G)

- The Project tree follows the selected architecture (current or previewed); *Show All Variants* adds
  a section listing every option's components and files, each tagged with its option.
- **Coding state** of each option and scenario (coded / partly coded / not coded / not checked here),
  derived from the files DataPass finds; shown on the Options table, the preview banner and the
  Project tree's decisions (surfaces `project.variantFilter` in DataPass and Advanced,
  `badge.codingState` from Standard up).
- Guide §2.5 "Declaring variants" with a checked example.

## 0.22.0 — trust repairs, modes, context from any file, format checks, file versions (2026-09-26)

Plan: [handoff/v3/10_GLOBAL_IMPROVEMENT_PLAN.md](handoff/v3/10_GLOBAL_IMPROVEMENT_PLAN.md) (decisions
D-01 to D-18). Five packages built in parallel on the night of 26 September (PRs #36, #37, #34, #35,
#38). There is no 0.21.0: the toolkit catalogue planned under that number moves to 0.23 with the
variants (package G). No project-file format changes; new DataPass file `resources/experience/presets.json`
(format `datapass.experience` 1, schema `schemas/datapass-experience.schema.json`).

- **Trust repairs (FOIL review F01–F08)**: declared costs are added **per currency** and never
  converted, monthly and one-time apart, and a total with an unpriced option or line says
  **"partial: n of m priced"** (unknown is never 0) — in the report, the scenario table and the
  Workbench. A file is identified by its **SHA-256** or, beyond a byte budget, by **size and date
  only**, which makes the component's digest **weak**: a weak digest never matches a recorded result.
  Git tracking of files that must not be committed is **tracked / untracked / unknown** ("could not
  check Git tracking" is never clean). A declared repository whose clone has no origin, or whose
  origin could not be read, is **unverified**: browsable, but *Get updates*, work orders and
  operations refuse it (Locate / Retry). Observation is **bounded** (16 reads at once, 2,000 expected
  files, "inspection incomplete (n skipped)" in Problems). Prompts: a merged PR moves a card to
  `review`, not done; no fixed sprint or "beginner" assumption. Guide and packs: **one PR per
  repository plus a cross-linked bridge PR** (a coordinated change set); "bridge repository
  (coordination repository)".
- **Modes**: **Vanilla / Standard (default) / DataPass / Advanced** — presentation presets over the
  same project (`datapass.experience.preset`, machine scope), adjusted surface by surface
  (`datapass.experience.overrides`, *DataPass: Customize DataPass Mode…*). *DataPass: Switch Mode…*
  and a status item `DataPass: Standard`. Views, AI tabs, Project tree sections and Workbench views
  follow the mode; blockers (Restricted Mode, errors in project files, readiness errors, a refused
  secret) show in every mode; commands stay in the palette. Standard and above open on the
  architecture; components an options.json decision can change say "alternatives exist". Switching
  writes no file in any repository.
- **Copy Context for My AI** from any file (Explorer, editor tab, editor with a selection): the
  question, the file's repository (bridge or native, branch, HEAD, its Git state), the owning
  component(s) and scope, the revisions they use, a folder excerpt, the file or selection (24 KB,
  truncation labelled, unsaved buffer flagged), its diagnostics, and the rules for the answer (a PR
  in that repository, a separate bridge PR if the architecture changes). Repository-relative paths
  only, credentials scrubbed, a preview before copying; nothing written.
- **Format checks without execution → Problems**: JSON and YAML syntax, **Databricks bundles**
  (`bundle.name`, targets, `include` globs, notebook / Python / wheel paths, `${var.x}` declared),
  **Dockerfile** (`FROM`, `COPY`/`ADD` sources) and **docker-compose** (`build.context`, `env_file`
  paths — never read). On save, *Check This File* and *Check This Repository*; a quick fix copies
  `databricks bundle validate` (never run). No process, works in Restricted Mode, bounded scan
  (`datapass.checks.*`). Guide page [08_FORMAT_CHECKS.md](docs/guide/08_FORMAT_CHECKS.md).
- **File versions** (thin commands on native Git): *Open Latest Version* (origin's default branch as
  of the last fetch — never fetches), *Open Version…* (the file's last 50 commits, renames followed,
  "from PR #n"), *Compare with Version…*, *Changed by the Last Update…* (the last fast-forward's
  files grouped by component). Read-only `datapass-rev:` tabs titled with the revision and fetch time.

Tests: unit 389/389; desktop 314/314 on 15 fixtures (new fixtures `v22-modes`, `v22-checks`,
`v22-versions`). Detail: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## 0.20.0 — work orders (pass AI-2, 2026-09-25)

Design and Julian's answers: [handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md)
sections 3.2, 4, 5 and 13.1. Project files: the manifest (still v5) gains the optional `project.type`
and the `modules.workOrders` / `modules.pilot` switches (DataPass ≤ 0.19 reports them as unknown);
new committed file `.datapass/work-log.json` (format `datapass.work-log` 1). Only an order DataPass
wrote on this computer, unchanged since, can be launched.

- **AI view, three tabs**: **DataPass-guided** (the existing JSON exchange, still the default tab),
  **Agent** (work orders for Claude Code or Codex) and **Manual** (routes to Project, Git,
  readiness, Workbench, the official tool, Check for updates). Pilot mode stays a later option.
- **Work orders**: off by default (`datapass.ai.workOrders.enabled`, a machine setting a workspace
  can never turn on). Project type — `project.type` in the manifest, or `datapass.ai.projectTypes`
  by project id, which wins — decides the default: **dev** and **perso** have orders on and the
  agent merges its own PRs when CI is green; **work** (FOIL, clients) has them off unless the
  project sets `modules.workOrders: true`, and the person merges. `modules.workOrders: false`
  always turns a project off.
- **Writing an order**: goal, kind, scope (sub-project, component, board card, decision),
  repositories to change or read, agent (Claude Code or Codex) and effort, merge policy, an
  optional export-JSON attachment and which DataPass files the agent should return (in its pull
  request, or as files to import). DataPass writes `order.md` (the prompt) and `order.json` (a
  strict schema) under `.datapass/local/work-orders/<id>/` in the coordination repository
  (git-ignored), with a receipt the result must repeat.
- **Launch**: one modal, then the default is the **Claude desktop app** (prompt copied to the
  clipboard, `claude://code/new` opened, you pick the folder and paste); the **Codex app**
  (`codex:`) the same way; **Claude Code** or **Codex** in a VS Code terminal when configured.
  Pre-launch checks: trust, the setting, the project type, clones with a verified origin, the base
  commit still on `origin` after a fetch (else DataPass asks for a new revision), and a warning
  when another open order already changes the same repository.
- **Results**: a watcher plus a receipt check; pull requests are found by the planned branch
  (`dp/<id>` by default) through the Git module. **Needs you** in the Git view gains rule 8: a
  work order whose result names no pull request, or with neither a result nor a PR a day after
  launch. The Work orders view (5th Workbench view) lists every order with filters; its Details
  panel has the timeline, **Check the PR's DataPass files**, **Import a proposed file** (diff,
  confirm, backup), **Follow-up**, **Revise**, **Mark done**, **Abandon**, **Archive** (moved,
  never deleted) and **Copy for a chat**.
- **Entry points**: a board card ("Work order for this card"), an architecture option ("Apply this
  decision as a work order"), a component ("Prepare the missing files as a work order", in Details
  and the Project tree), and a failing PR in the Git view ("Work order to fix this").
- **Publish summary** writes `.datapass/work-log.json` (format `datapass.work-log` v1: ids,
  titles, dates, statuses, planned branches, PR links — never goal text, the agent's summary,
  paths or secrets) and, when `datapass.ai.workLog.privateRepository` is set, the same entry to
  `<private repository>/work-logs/<project id>.json` (refused for the public DataPass repository
  or a repository of the project; `gh` must say the repository is private, else DataPass asks).
  DataPass never commits or pushes either file.
- No MCP server in this pass (Julian's answer Q6 in section 13.1: kept as a later option).

## 0.19.0 — the Git module (pass AI-1, 2026-09-25)

Design and Julian's answers: [handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md](handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md)
sections 6, 8.6, 9 and 13.1. No project-file format change.

- **Git view** (left side bar, under Project, badge = items that need you): per repository of the
  project, the branch or detached HEAD, ↓behind ↑ahead, staged / unstaged / untracked changes, the
  last fetch, worktrees (clean or dirty, merged or PR closed), open PRs with their CI rollup and
  review, and the last three merges.
- **Needs you**, deterministic and ordered: failed CI, a green PR waiting, a merge not pulled here,
  changes on the default branch, a finished worktree (cleanup candidate, or work at risk), unpushed
  work, a detached HEAD.
- **Routes only**: Source Control, open in a new window, the PR or its failing check (web or the
  GitHub views), Check / Get updates, **Fetch all** (plain `git fetch`, never automatic, never
  `--prune`), copy a branch, and **copy the cleanup command** of a finished, clean worktree —
  DataPass never deletes.
- **Other repositories** under `datapass.projectsFolders` (at most 60), read when the section opens;
  a **Git card** on the Workbench overview.
- PRs from `gh` (`datapass.git.ghPath`, machine-level), `az` or `glab` when installed and signed in,
  read-only; otherwise the host's web pages. Read-only Git with `core.fsmonitor=false`, no optional
  locks, 5 s per command, four at once, nothing in Restricted Mode.

## 0.18.0 — toolchain, ID map, connections (2026-09-25)

Manifest **v5** (`schemaVersion: 5`). Design: [handoff/v3/08_TOOLKIT_AND_AGENTS.md](handoff/v3/08_TOOLKIT_AND_AGENTS.md)
sections 5.3 and 8; contract: [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) section 12.

- **Toolchain**: `toolchain.tools[]` (tool id, optional version range, `optional`, `where`: local, ci,
  fabric). New **Tools & versions** section in the Project view and the Workbench: each local tool
  is compared with this computer's probe (ok, outside the range, missing, version not read); CI,
  Fabric-notebook, desktop-app and Python-library tools are shown, not checked. Install commands
  (winget, Homebrew, pip, `code --install-extension`) are copied, never run. Unknown ids run nothing
  and get a "did you mean". A version outside its range is a warning on the operations that use the
  tool, never a blocker and never on reading.
- **`.vscode/extensions.json`** compared with the toolchain's extensions; *Show Recommended
  Extensions* opens VS Code's own list. DataPass never writes the file or installs anything.
- **ID map**: identifiers get `values` (one id per declared environment) and `kind`; every value
  follows the no-secret rules (the error names the environment, never the value). *Copy Identifier*
  asks which environment; a hover on any declared id in any file, and *DataPass: Look Up an Id…*,
  say which identifier and environment it is.
- **Connections**: `connections[]` of kind `sign-in`, `git-binding` or `cloud-connection`. New
  **Connections** section and *DataPass: Check Connections*: read-only, no prompt, only when asked —
  `az account show` (tenant and subscription compared with the ID map), `databricks auth profiles`
  (profile exists and is valid), `fab auth status` (signed in, tenant). Fixed commands run from the
  home folder with stdin closed and a timeout; no manifest value is ever an argument; credential
  files are never opened; the CLIs' output is reduced to a few fields (the account name and masked
  token prefixes are dropped). Bindings DataPass cannot observe are "declared, not checked", with the
  portal page to verify them. Sign-in commands are copied for the person to run.
- **AI packs** (preparation pack, Copy AI context, card packs), the environment snapshot and the
  readiness report carry the toolchain state, the ID map as logical ids and the connection states —
  names and states only.
- **Upgrade Project Manifest** moves v1–v4 to v5 with a backup copy (a v4 file only changes version).
- **Tool registry**: install hints for every CLI (winget ids checked with `winget show`), Power BI
  Studio, the Power BI extension pack and the Power BI Modeling MCP server added; probes now store
  the version number (`az version`'s JSON no longer shows as "{").
- **Power BI agentic plugins**: the 11 plugins of `data-goblin/power-bi-agentic-development`
  (custom-visuals, etl, fabric-admin, fabric-cli, goblin-mode, paginated-reports, pbi-desktop, pbip,
  reports, semantic-models, tabular-editor), with install commands for Copilot CLI and Claude Code.
- New example `examples/v3/sales-bi` (Fabric + Power BI, fabric-cicd, manifest v5).

## 0.17.0 — windows and work views

Company workspace file (one window per company), work views (save / apply), status-bar switcher,
`datapass.startupView`, floating Workbench, the Power Ops launcher list. PR #25.

## 0.16.0 — work and DevOps

`.datapass/board.json` and the Board (kanban) view, Azure DevOps / GitHub / GitLab address forms and
web pages, CI profiles, Mongoku frozen. PR #24.

## 0.15.1

AI exchange view in the secondary side bar, shown instead of Chat when a DataPass project opens. PR #23.

## 0.15.0 — architecture options and project sheet

`options.json` (compare, preview, record a decision), `sheet.json`, diagram orientation / lanes /
folding, JSON exchange with an AI (validated import, diff, backups), `vm` and `docker` providers. PR #22.

## 0.14.0 — environment readiness

Manifest v4 (`localEnv`, `identifiers`): Local environment and Readiness sections, names and states
only, *Open Power Ops*. PR #21.

## 0.13.1

No `$schema` line in prepared `.datapass/*.json`; DataPass explains an existing one. PR #19.

## 0.13.0 — V3 pass 1: the Project Workbench

Trust fixes from the 2026-09-25 audit, manifest v3 / graph 0.2, repository and file resolution,
Project tree, Architecture panel, Details, Workbench tab, Git update loop, preparation pack, catalog.
PR #18.

Earlier passes (0.8–0.12): see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
