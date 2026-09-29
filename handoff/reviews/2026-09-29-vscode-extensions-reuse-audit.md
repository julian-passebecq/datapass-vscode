# VS Code extensions reuse audit (2026-09-29)

Scope: 4 zips from Downloads, static reading only (README, file tree, docs). No code executed. Size: S ≤ 1 day, M 2-5 days, L > 1 week.

## 1. SuperPlane (Apache 2.0, Go + React, ~45 pkg dirs)
What it is: a self-hosted **AI-agent "software factory"** and event-driven DevOps control plane. Model: Factory → Work order → Line (ordered stages) → Automation (agent / tool / wait-for-event / approval) → Run (durable inputs, outputs, retries, **cost**). Everything is laid out on a **Canvas** (node graph). Core nodes: triggers (Webhook, Schedule, Manual, On Run, On Error), actions (Approval, Filter, If, **Merge** = wait for several upstream inputs). 40+ integrations (GitLab, GitHub, Claude, Azure, OCI, Databricks-like clouds).

| Idea | DataPass adaptation | Target | Reuse | Size |
|---|---|---|---|---|
| Canvas of stages with a live state on each node | Cross-repo project view: one node per repo (Oracle VM, Fabric, Databricks); edges = contracts/lineage between them; badge = last GitLab pipeline + open MRs | Hub dashboard (reuse Cloud graph renderer) | inspiration only (their UI is React web app) | M |
| **Merge** node (wait for N upstream) | "Release train": a project change is ready only when every repo MR it touches has green CI. Shows which repo is blocking | Hub + Git companion | reimplement | M |
| Run record with inputs, outputs, retries, cost | One JSON per client-AI exchange / CI run (`.datapass/runs/*.json`), same shape as decision logs; timeline view | bridge + Hub | reimplement (schema idea) | S |
| Approval node + event history | Decision log gets a state (proposed → approved → superseded) and is linked to the MR/commit that applied it | Hub (decisions) | inspiration only | S |

Overlap: our multi-project dashboard and decision logs. Do **not** integrate SuperPlane itself (server + Postgres, off-scope vs. local-runner GitLab contract). Worth a later look only if Factory F0D needs a workflow engine.

## 2. TeamDocs (MIT, ~4 TS files)
Activity Bar tree of one global Markdown folder, click = rendered preview, fuzzy quick-pick search, honours `files.exclude`.
- Per-project docs tree built from all repos of a project (ADR, `handoff/`, `.datapass/decisions`) aggregated in one view → Hub → copy code with attribution → S. **Overlaps** "docs per project" plan: use it as the minimal implementation.
- Decision-log quick pick: search decisions by title / chosen option across repos, open rendered → Hub → reimplement → S.

## 3. Folder Projects (MIT, ~4 TS files)
Roots in settings; every subfolder becomes a project (no registration), ignore globs, quick pick + tree grouped by root.
- Auto-discovery of DataPass projects: scan roots for `.datapass/` or `.git`, group repos into a project by a shared `.datapass/project.json` id → Hub → copy code with attribution (scanner + ignore matcher) → S. **Overlaps** multi-project dashboard; removes manual project registration.
- "Open project as multi-root workspace" (all its repos at once), generated `.code-workspace` → Hub → reimplement → S.

## 4. Don't Git Lost (MIT, ~20 TS files, vitest tests)
Per-file time travel (step commits, gutter diff overlay, one reused tab), inline blame, hover card with author, commit and **MR/PR link**; GitLab/GitHub/Bitbucket clients (~230 lines), remote URL parser, caches.
- `host/remoteParser` + `gitlabClient` (commit → MR lookup, token in settings/SecretStorage) → Git companion "change → impact" shows the MR that introduced a line → copy code with attribution → S. Must support self-hosted GitLab base URL (check).
- Time-travel for **artifacts**: step a lineage/infra graph or a decision JSON through its commits, with diff colouring of added/removed nodes → Git companion + Cloud → reimplement (reuse navigator pattern) → M. Nobody else does this; strong fit for architecture variants.
- Blame on decision files: hover a decision's `chosen` field → who/when/which MR changed it → Git companion → reimplement → S.

## 3 recommendations
1. Hub, next package: Folder Projects scanner + TeamDocs tree (MIT, both S, attribution in NOTICE) = project auto-discovery + per-project docs/decisions view; closes two planned items cheaply.
2. Git companion: copy Don't Git Lost `remoteParser`/`gitlabClient` (S), then build "graph time travel" on lineage and decisions (M), our most original idea here.
3. Hub cross-repo canvas with a SuperPlane-style Merge/release-train gate over GitLab pipelines (M); keep SuperPlane as inspiration only, no integration.
