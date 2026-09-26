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

ARCHI xh consult (TAMPON 8), 2026-09-26. Docs checked today: code.claude.com `permissions`,
`desktop`, `cli-reference`, `sandboxing`; Codex `agent-approvals-security`, `rules`, config basics;
Learn `az functionapp function`, `az monitor app-insights`, `az storage blob`, Functions Core Tools
reference (2026-05-29). A technical decision; nothing here needs Julian except the one-time setup below.

**Option 2, done as a "pilot folder", plus channel 2 unchanged; the Codex app gated (option 4's rule
for that one surface).** The **order folder itself is the agent's working folder** and holds the
guard rails DataPass writes: `.claude/settings.json`, `.codex/config.toml`, `.codex/rules/pilot.rules`
(all under the git-ignored `.datapass/local/work-orders/<id>/`, never in a repository). Why:
- Claude Code loads `.claude/settings.json` from the **cwd with no parent fallback**, the desktop app
  "reads the same settings files as the CLI", a mode is remembered **per folder** (a new order folder
  starts in `defaultMode`), and `disableBypassPermissionsMode` / `disableAutoMode` "also work in user
  and project settings". So the default surface (Q5) is held without flags, and a repository's own
  permissive `.claude/settings.json` is not loaded (repositories are only `--add-dir` / `additionalDirectories`).
- **Fail-safe:** project `allow` rules need workspace trust, `deny`/`ask` never do. Untrusted folder →
  more prompts, never fewer. Codex skips an untrusted `.codex/` layer, which is safe in the terminal
  (flags carry the sandbox) but not in the app → the Codex app stays refused until qualified.
- Deny/allow rules match command text, not programs ("isn't a security boundary around the program"),
  and Claude's OS sandbox does not run on native Windows. Hence: Manual mode, narrow allows, deny for
  everything nameable and harmful, **Reader roles as the real net**. Codex adds a real boundary: the
  `read-only` sandbox has no network, so any unlisted CLI call must escalate and ask.

**Rules** (Claude: each rule written twice, `Bash(…)` and `PowerShell(…)`; Codex: `prefix_rule`
`allow` = runs outside the sandbox, `forbidden` = blocked; everything else asks).

| CLI | Allow (stage 1, `dev`) | Deny (any form; verbs as `az * <verb> *` and `az * <verb>`) |
|---|---|---|
| `az` | `az version`, `az account show`, `az account list`; `az group list/show *`; `az resource list/show *`; `az functionapp list/show *`, `az functionapp function list/show *`, `az functionapp config show *`, `az functionapp plan show *`; `az storage account list/show *`; `az storage container list --auth-mode login *`, `az storage blob list --auth-mode login *` (login first: without it az queries the account key); `az monitor app-insights query *`, `az monitor metrics list *`, `az monitor activity-log list *` | `rest`, `login`, `logout`, `account set/clear/get-access-token`, `config`, `configure`, `extension add/update/remove`, `interactive`, `upgrade`, `keyvault`, `ad`, `role`; verbs `create delete update set start stop restart deploy upload download copy sync import purge invoke-action generate-sas`; `keys`, `show-connection-string`, `connection-string`, `appsettings`, `list-publishing-*`, `lease`, `storage blob query`, `--debug` |
| `func` | `func --version`, `func azure functionapp list-functions *`, `func settings list` (exact) | `azure functionapp publish`, `fetch-app-settings` (writes secrets to `local.settings.json`), `azure storage fetch-connection-string`, `--show-keys`, `--showValue`, `--access-token*`, `start`, `run`, `host`, `new`, `init`, `pack`, `deploy`, `settings add/delete/encrypt/decrypt`, `durable`, `extensions`, `bundles`, `workload`, `setup`, `quickstart`, `profile set`, `kubernetes`, `azurecontainerapps` |
| `fab` (sketch) | `fab --version`, `fab auth status`, `fab ls *`, `fab get *`, `fab exists *`, `fab desc *` | bare `fab` (interactive mode), `api`, `set`, `rm`, `mkdir`, `cp`, `mv`, `import`, `export` (1b, order folder only), `job`, `acl set/rm`, `start`, `stop`, `assign`, `unassign`, `ln`, `auth login/logout`, `config set` |
| `databricks` (sketch) | `auth profiles`, `current-user me`, `workspace list *`, `jobs list/get/list-runs *`, `clusters list *` | `api`, `auth token`, `auth login`, `configure`, `secrets`, `fs`, `workspace export/import*`, `jobs run-now/submit/cancel*`, `bundle deploy/run/destroy`; **`bundle validate/summary` move to stage 2** (Python bundles execute code) |

Not allowed and not denied (so they ask): `func azure functionapp logstream` (2 h stream, unsupported
on Linux Consumption/Flex; use the App Insights query). Files: allow `Edit(requests/**)`,
`Edit(result.json)`; deny `Edit` on every read repository. `fab`/`databricks` lists are verified
against their docs when those CLIs are installed, before their flag is turned on.

**Launch profile per surface** (all: `kind: pilot-read`, `policy.cloud: read-only`, `permissions: ask`)

| Surface | Launch | Held by |
|---|---|---|
| Claude · terminal | cwd = order folder; `claude --session-id … --name … --effort … --permission-mode default --settings <order>\.claude\settings.json [--add-dir <read repo>…] "<marker>"` | flags + the file (`defaultMode: default`, bypass and auto disabled, `additionalDirectories`, rules) |
| Claude · app (default, Q5) | copy marker; steps say "Choose this folder: **the order folder**"; `/desktop` from the terminal allowed | the same file, read by the app; bypass/auto not selectable in that folder |
| Codex · terminal | `codex -C <order> --sandbox read-only --ask-for-approval on-request "<marker>"` | flags + `.codex/config.toml` (same values) + `pilot.rules` |
| Codex · app | **refused** in stage 1; enabled per machine after the qualification below passes (then `codex app <order>`) | — |

**DataPass refuses to launch** when: environment ≠ `dev`; any repository `access: change` or
`expected.pullRequests ≠ none`; `permissions ≠ ask`; the Codex app surface (until qualified); CLIs other
than `az`/`func` (until their flag); the pilot machine setting is off or Workspace Trust is missing;
the written guard-rail files' digest differs from what DataPass generated (re-read just before
launch); `.claude/` or `.codex/` already exists in the order folder; any argument would be
`bypassPermissions`, `auto`, `--dangerously-skip-permissions`, `danger-full-access` or approval
`never`. The rule tables are **code** (a reviewed constant), never data: hub/toolkit files cannot
extend them.

**Acceptance tests AI-4 must add**
1. Snapshot of the generated `.claude/settings.json`, `config.toml`, `pilot.rules` for a fixture order
   (Bash + PowerShell mirrors, `defaultMode`, both disable keys, `additionalDirectories`, Edit rules).
2. Table test with a small matcher implementing the documented prefix semantics: ~40 write/secret
   commands (`az group create …`, `az storage account keys list …`, `az account get-access-token`,
   `func azure functionapp publish x`, `func azure functionapp fetch-app-settings x`, `az rest …`,
   `az storage blob download …`) each hit a deny and no allow; every allow sample hits no deny; no
   allow rule has a `*` before its subcommand.
3. Codex rules carry `match`/`not_match` examples (Codex validates them at load).
4. Launch args: pilot Claude args contain `--permission-mode default` and `--settings`, cwd = order
   folder; Codex args `read-only` + `on-request`; the forbidden values never appear (property test
   over surfaces and orders).
5. One refusal test per rule above, each with its message.
6. The pilot module imports nothing from the toolkit/hub reader (the lists stay code).
7. Desktop flow: a pilot launch writes only inside the order folder (`git status` of every repository
   unchanged).

**Only Julian can do (one-time, add to todo.md when AI-4 is built):** sign `az` in with **Reader** on
the dev resource group and **Storage Blob Data Reader** on the dev storage account (cloud roles);
pre-install the `application-insights` az extension (it auto-installs on first use otherwise); trust
the coordination repository in Claude and Codex; run the ~10 min qualification: in a pilot session
(terminal, app, and after `/desktop`) `/permissions` shows the rules, `az group list` runs,
`az group create` is refused, Bypass/Auto cannot be selected; in Codex terminal the same pair.
