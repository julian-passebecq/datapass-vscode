# 5. The loops: how the AI's work reaches DataPass

Four ways to work, all ending in Git, all reviewed by the person. The AI view (right side bar)
has three tabs: **DataPass-guided** (loop A), **Agent** (loop B) and **Manual**.

## A. DataPass-guided JSON exchange (no API, any AI chat)

For `.datapass/*.json` files (project, graph, board, options, sheet).

1. AI view → DataPass-guided → pick the file and the task (or *DataPass: Copy a DataPass File for
   the AI…*). DataPass copies the file, the task and the rules.
2. Paste into the AI chat. The AI answers with **the complete file in one JSON code block**, never
   a partial patch.
3. *Import the AI's Answer into a DataPass File…*: DataPass extracts the block, recognises the file
   from its `format` (or `schemaVersion`), validates it with the extension's own parser, refuses
   credential-shaped text and local paths, shows a diff, asks, keeps a backup in
   `.datapass/local/backups/` and writes it. It never commits: the person commits.

For native files, the AI opens a pull request instead (loop C).

## B. Work orders (DataPass ≥ 0.20, Claude Code / Codex desktop apps)

For real changes across repositories by an agent.

1. Preconditions: machine setting `datapass.ai.workOrders.enabled: true`; for a **work** project
   also `modules.workOrders: true` in the manifest. Entry points: the Agent tab, a board card, a
   decision, a component's missing files, a failing PR.
2. DataPass writes the order in `<coordination repo>/.datapass/local/work-orders/<id>/`
   (`order.md`, `order.json`, attachments: schemas, preparation packs…). The planned branch is
   `dp/<id>`, from recorded base commits.
3. *Launch*: one confirmation, the marker prompt `DataPass work order <id>: read …\order.md and
   follow it.` is copied and the Claude app (or Codex) opens a new session; pick the folder, paste.
4. The agent works in a new worktree per repository, opens **one PR per repository**, deploys
   nothing, keeps `.datapass/*.json` valid, and writes `result.json` (format
   `datapass.work-order-result` 1) at the path the order gives. A DataPass file returned for import
   goes to `proposed/<kind>.json`.
5. DataPass checks the result (receipt, order id, no credential), finds the PRs **by the planned
   branch** itself, and shows the order in the **Work orders** view and the Details timeline; the
   agent's claims appear as "the agent says".
6. The person merges (work projects) — or the agent does on green CI (dev/perso, if the order says
   so). *Publish summary* updates `.datapass/work-log.json`; commit it.

## C. Pull requests and Check / Get updates

1. The AI (in chat or as an agent) pushes a branch and opens a PR in each repository it changes
   (a PR never spans repositories). When `graph.json` or `board.json` change too, they go in a
   separate bridge PR in the bridge repository (coordination repository), and the PRs link each
   other: a coordinated change set. The card moves to `review`, not to done: a merged PR is
   evidence of implementation; done follows the card's acceptance.
2. The person reviews and merges on the Git host.
3. DataPass → **Check for updates** (`git fetch`, nothing merged) → **Get updates** (fast-forward
   only, after listing the commits). DataPass never pulls silently and never pushes.
4. DataPass re-inspects: missing files turn found, operations move forward; reviews and results of
   changed components must be redone.

## D. The Git view (DataPass ≥ 0.19)

Left side bar, under Project. For every repository: branch, ↓behind ↑ahead, local changes, open
PRs with their CI (✓ ✗ ●), worktrees, last merges. **Needs you** lists, in order: failed CI, green
PRs waiting for a merge, merges not pulled, changes on the default branch, finished worktrees,
unpushed work, detached HEAD, and (rule 8) work orders without a PR. Every row is a route (Source
Control, the PR page, Check/Get updates, *Fetch all*, copy the cleanup command); DataPass never
deletes a branch or a worktree. PRs and CI come from `gh` / `az` / `glab` when installed and signed
in, else from web links.

## Which loop when

| Task | Loop |
|---|---|
| Prepare or fix `.datapass/*.json` | A (or B with kind *datapass-files*) |
| Write native files (Function, bundle, notebook, SQL) | C with any AI, or B with an agent |
| A bug on a board card | B (*fix-card*) or the card's AI pack + C |
| An architecture decision recorded in `options.json` | B (*apply-decision*) or C |
| Every morning | D: Needs you, then Get updates |
