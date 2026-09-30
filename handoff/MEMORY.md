# DataPass shared memory

Durable things learned by sessions (pitfalls, working commands, Julian's preferences), dated, newest last.

- 2026-09-27 (V1-RC3): a view's `<id>.focus` command accepts `{ preserveFocus: true }`, which shows the view without taking the keyboard. Focusing the view and then handing focus back to the editor still closes an open Quick Pick. A webview must restore element focus only when `document.hasFocus()`.
- 2026-09-27 (assistant): Julian doesn't watch the PM window — the assistant must announce every chip the PM prepares, and re-check sessions before reminding him (he had already clicked once).
- 2026-09-27 (assistant): Codex Computer Use "no apps" is a session issue, and a VS Code launched from an Administrator PowerShell can't be driven by a normal-privilege agent; use qa:ui Playwright as fallback, never abort the run.
- 2026-09-27 (assistant): low roles must hand off at 150 K; this assistant reached 340 K (≈2× cost per turn) by polling every 15 min in one long conversation.
- 2026-09-27 (PM): the AskUserQuestion hook blocks product questions whose text contains Git/PR/CI words; phrase feature questions in product terms, or state PM defaults Julian can override.
- 2026-09-27 (PM): background PM agents (Agent tool) need no chip click and suit night work; chips need Julian awake to click.
- 2026-09-27 (assistant 2): commands for Julian are PowerShell (`& "exe" args`) or launched for him via Start-Process; a bare "exe" --flag fails.
- 2026-09-28 (coordinator): open PLAN-only PRs go DIRTY whenever an agent merges its own PLAN row; stack further PLAN edits on the open PR's branch instead of opening a second PR.
- 2026-09-28 (coordinator): before pushing onto a PLAN PR branch, check the PR is still open — a push after merge recreates the deleted branch; Team rows share the `PM agent · X` text with the V3 Owner column, anchor inserts on the role column too.
- 2026-09-28 (PM): a background agent can merge its own PR and publish a release overnight; when its GO reuses a common GO, name the rules it overrides (e.g. "no version bump") explicitly.
- 2026-09-28 (PM): low role sessions that read screenshots reach 150 K in a few hours; expect one assistant hand-off per Julian test session.

- 2026-09-29 (assistant 6): a clicked chip becomes a session titled like the chip: check `list_sessions limit 30` (default 20 hides idle ones) before reminding Julian; chip_watch re-emits reported chips, so treat its events as "offered" only. Check `get_usage self` every ~10 turns: assistant 6 reached 235 K against a 150 K limit.
- 2026-09-29 (PM 6): every new Common package edits the same shared registries (PACKAGES.md, package.json, check-packed-consumers, contracts.json), so after each Common merge the next MR usually conflicts: re-check with `git merge-tree` after every merge. `glab mr merge --sha` needs the full 40-character SHA. Edit PLAN.md with the Edit tool or sed, never PowerShell Set-Content (BOM + CRLF rewrite the whole file).
- 2026-09-29 (PM 9): AskUserQuestion to Julian is for product questions only (a hook blocks CI/disk topics); decide the rest. Read the local time before logging times in PLAN.
- 2026-09-29 (PM 9, Julian): DataPass reasons like a problem solver across five scales (macro-macro → super-micro) and a value lens, never "pick archi A/B/C"; see `handoff/ARCH_DECISIONS.md` § 3c.

- 2026-09-30 (PM 16): GitLab auto-cancels older main pipelines by default, so with a busy merge queue main is never fully tested and a semantic conflict between two green MRs (LAYER1 + CLEAN1, generated arch-lint registry) went unseen. Keep auto_cancel_pending_pipelines disabled on repos with a merge queue, and stop the queue when main is red.

- 2026-09-30 (CODER VIS6): without `glab` or a token, open a GitLab MR with push options: `git push -o merge_request.create -o merge_request.target=main -o merge_request.title=...` (the push must update the ref).
- 2026-09-30 (coder R51): with no glab, create a GitLab MR through push options: `git push -u origin <branch> -o merge_request.create -o merge_request.target=main -o "merge_request.title=..." -o "merge_request.description=..."`. They only act on a push that changes the ref.
- 2026-09-30 (coder R51): on Windows, Python `open(...,'w')` writes CRLF. Use `newline=''` when editing repository files.

## 2026-09-30 (PM DataPass 23)
- Check a new package id against the Common coverage registry (coverage-plan-packages.json and planned rows) before using it: reusing SCHED1e turned Common main red.
- Chips titled "Opus medium" may start on Sonnet low: get_session every reserve before assigning it and fix model/effort while it is idle.
- PowerShell `cd` doesn't move .NET's current directory: use (Resolve-Path x).Path with [IO.File] calls.
