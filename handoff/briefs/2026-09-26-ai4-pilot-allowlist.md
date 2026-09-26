# Brief — AI-4 Pilot stage 1: how the agent is held to read-only (xhigh consult)

Written by ARCHI DataPass 1, 2026-09-26, on main after 0.24.0. One decision, then AI-4 is built at high.

## Question

For Pilot stage 1 (read-only, `dev` only, FOIL PDF flow first: Azure Storage + Azure Functions, then
Fabric and Databricks), **what exactly does DataPass hand the agent so it can run official CLIs
read-only, and how is that enforced** on each surface Julian uses? Output: the allowlist / denylist
per CLI (`az`, `func`, then `fab`, `databricks`), the launch profile per agent surface, and what
DataPass refuses to launch.

The tension: 09 §3.3 designs the guard rails for the **CLIs in a terminal** (Claude Code
`--allowedTools` / `--disallowedTools` + `--permission-mode default`; Codex `--sandbox read-only
--ask-for-approval on-request`), but Julian's answer Q5 (09 §13.1) makes the **Claude and Codex
desktop apps** the default surface, and DataPass cannot pass flags to an app session.

## Options

1. **Terminal only for pilot orders.** Pilot orders always launch the CLI in a VS Code terminal with
   the flags; the desktop apps stay for mode-2 work orders. + enforceable, testable (argument
   building), matches §3.3. − a second surface to learn for Julian; `/desktop` would carry the
   session over to the app, where the flags may or may not persist (to check).
2. **Project settings file written into the order folder** (e.g. a `.claude/settings.json` with
   `permissions.allow/deny` in the order's working folder, and Codex's config profile), so the app
   and the CLI both pick it up. + works with the default surface. − DataPass writes an agent config
   file (inside `.datapass/local/work-orders/<id>/` only, never in native repositories); relies on
   each app honouring folder settings — to verify against current docs.
3. **No agent-run CLIs in stage 1; typed requests only** (channel 2 of §3.3: the agent writes
   `requests/<n>.json`, DataPass runs its own read-only capability on Julian's click). + nothing to
   enforce on the agent side; DataPass already owns read-only capabilities. − much less useful: most
   of the value is in `az … list/show`; DataPass would have to grow read-only captures per CLI.
4. **Hybrid:** 1 for CLI reads + 3 for VS Code actions; the app surface is offered for pilot orders
   only once option 2 is proven for that app.

In every option: the real safety net is a read-only cloud role (Reader / Viewer / CAN_VIEW);
generic API commands (`az rest`, `databricks api`, `fab api`) are denied; data reads (blob
download), `func` start/publish, and remote shells are excluded; pilot orders force permission mode
`ask`.

## Files to read (only these)

- `handoff/v3/09_AI_MODES_WORK_ORDERS_GIT.md` §3.3, §4.2 (`agent.*`, `kind: pilot-read`), §4.6,
  §5 (exact launch commands), §8.8, §9, §13.1 (Julian's answers, they win).
- `src/work/workOrders.ts` (launch argument building), `src/work/controlClient.ts` only if needed.
- Current official docs, checked today: Claude Code permissions / settings (allow/deny rule syntax,
  settings precedence, whether the desktop app honours project settings), Codex CLI sandbox and
  approval flags and config profiles, `az` and `func` command references for the read-only subset.

## Decision

(to be written by the ARCHI xh consult: the option, the per-CLI allow/deny lists for `az` and `func`
— `fab` and `databricks` may be sketched —, the launch profile per surface, what is refused, the
acceptance tests AI-4 must add, and the reasons.)
