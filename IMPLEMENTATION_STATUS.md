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
