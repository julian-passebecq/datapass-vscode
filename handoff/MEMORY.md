# DataPass shared memory

Durable things learned by sessions (pitfalls, working commands, Julian's preferences), dated, newest last.

- 2026-09-27 (V1-RC3): a view's `<id>.focus` command accepts `{ preserveFocus: true }`, which shows the view without taking the keyboard. Focusing the view and then handing focus back to the editor still closes an open Quick Pick. A webview must restore element focus only when `document.hasFocus()`.
- 2026-09-27 (assistant): Julian doesn't watch the PM window — the assistant must announce every chip the PM prepares, and re-check sessions before reminding him (he had already clicked once).
- 2026-09-27 (assistant): Codex Computer Use "no apps" is a session issue, and a VS Code launched from an Administrator PowerShell can't be driven by a normal-privilege agent; use qa:ui Playwright as fallback, never abort the run.
- 2026-09-27 (assistant): low roles must hand off at 150 K; this assistant reached 340 K (≈2× cost per turn) by polling every 15 min in one long conversation.
- 2026-09-27 (PM): the AskUserQuestion hook blocks product questions whose text contains Git/PR/CI words; phrase feature questions in product terms, or state PM defaults Julian can override.
- 2026-09-27 (PM): background PM agents (Agent tool) need no chip click and suit night work; chips need Julian awake to click.
- 2026-09-28 (coordinator): open PLAN-only PRs go DIRTY whenever an agent merges its own PLAN row; stack further PLAN edits on the open PR's branch instead of opening a second PR.
