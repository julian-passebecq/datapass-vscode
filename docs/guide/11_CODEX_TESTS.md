# 11. Codex tests: formats and `qa:prepare`

For whoever writes a Codex test repository (a configuration plus journeys) and for the agent that
runs it. The mode itself is described in `handoff/v3/12_CODEX_TEST_MODE.md`; this page is the
contract DataPass checks. Three formats, each with a JSON schema under `schemas/` (for editors) and
a stricter parser in `src/qa/formats.ts` (what `qa:prepare` actually runs).

| Format | File | Schema |
|---|---|---|
| `datapass.codex-tests` v1 | `datapass-codex-tests.json` at the root of the test repository (`datapass-auto.json` is also read) | `schemas/datapass-codex-tests.schema.json` |
| `datapass.test-journey` v1 | one file per journey, listed by the configuration | `schemas/datapass-test-journey.schema.json` |
| `datapass.qa-report` v1 | `reports/app/<runId>/report.json` or `reports/client/<runId>/report.json` | `schemas/datapass-qa-report.schema.json` |

Examples that parse: `tests/fixtures/qa/` (a client configuration with two journeys, an app
configuration with two workspaces, a report).

## The configuration: `purpose` app or client

- `purpose: "client"`: one client, `client {id, title}` and one `workspace {bridge, repositories[]}`.
  The journeys play a client's person (`kind: "client"`).
- `purpose: "app"` (vsixtest, 12 §4.7): tests DataPass itself across several projects:
  `workspaces[]` (1 to 10), each `{id, title, bridge, repositories[]}`. The journeys are `kind: "app"`.
- A `bridge` or repository is `{remote, folder, path?}`: `folder` is the clone under the run root,
  `path` an optional sub-folder inside it, opened instead of the clone (the `examples/v3/*` of one
  datapass-vscode clone: several workspaces share `folder: "datapass-vscode"` with different paths).
- Both: `datapass {version, vsix?}` (the DataPass version the run expects and, optionally, the VSIX
  path under the run root), `journeys[]` (relative paths), `report {remote, folder}`, `limits {runMinutes, journeyMinutes}`.
- Folders and paths are relative (no `..`, no drive, no leading `/`), remotes are `https://` with no
  credentials, a folder is declared with only one remote. The VSIX is a local path: the repository
  has no tags, so it is built locally from the **released commit** (0.26.0 = `c78f01f`; later
  releases: the commit PLAN.md records) with `npm ci && npx vsce package` in a datapass-vscode
  clone checked out at it.

## A journey

`id` (`J01`, `A01`…), `kind`, `title`, `as` (who the agent plays), `goal`, `setup {client, mode,
variant, environment}`, `hints[]`, `expected[]` (at least one), `questions[]`, `features[]` (at least
one, from the closed list below), `outOfScope[]`. No field runs anything: a journey is prose for the agent.

Feature tags: onboarding, workspace, architecture, variants, options, costs, readiness, evidence,
work-orders, stamps, file-context, ai-exchange, resources, git, format-checks, modes, file-versions,
toolkit, mcp, install, docs, performance. An unknown tag is refused by name.

## The report

`purpose`, `runId` (`yyyymmdd-hhmm-<client id | app>`), DataPass version and VSIX sha256, VS Code and
OS, the clients with each clone's commit, `agent` (Codex, model, app or terminal), one entry per
journey (`outcome` reached / partly / not-reached / blocked, each expectation met true / false /
"unclear"), `findings[]` (`F1`…, severity, area = a feature tag), `answers[]` (`{question, answer,
evidence, screens?, confidence high/medium/low}`), `clientFeedback`, `coverage {listed, reached}`.
`agent` is either Codex in its desktop app (`{"tool": "codex", "host": "app"}`: Computer Use sees
nothing launched from `codex exec`) or `npm run qa:ui` (`{"tool": "qa-ui", "host": "playwright"}`, the
model being the driver's version, see below). DataPass carries the released commit in `datapass.commit` when known.

Screens are shell captures (Computer Use saves none), stored in the report folder as
`screens/<journey id>-<what>.png` (for example `screens/J01-architecture.png`); every `screens`
field in the report must follow that pattern. `run.json` gives the capture command for the machine
(`<file>` = the target path).

## `npm run qa:prepare`

```
npm run qa:prepare -- --auto <test repository clone> --root <run root> [--vsix <file>] [--commit <released commit>] [--code <VS Code executable>] [--launch]
```

1. Validates the configuration and every journey (a journey's `kind` must equal the purpose, its
   `setup.client` must be a configured client, ids are unique).
2. Checks every declared folder is under the run root, is a git clone whose `origin` is the declared
   remote, and reads its commit. **It never clones**: clone first, then prepare.
3. Installs the VSIX into an isolated profile under the run root (`.vscode-user`, `.vscode-ext`)
   and checks the installed version equals `datapass.version`. Your own VS Code profile is never used.
4. Writes one `<client id>.code-workspace` per client (bridge folder first) and `run.json`
   (`datapass.qa-run` v1: run id, VSIX sha256 and released commit, VS Code version, each clone's
   commit, the launch commands, the preconditions, the known leaks and the screenshot convention).
5. Prints the command that opens each client in the isolated VS Code; with `--launch` it also starts
   them. **qa:prepare is the launcher**: installing the VSIX works inside Codex's sandbox, launching
   VS Code does not, so it happens through qa:prepare (or an approved escalated run), never from the sandbox.

### Preconditions (also in `run.json`)

- The Codex desktop app runs the journeys.
- A visible, unlocked foreground desktop for the whole run (no lock, no sleep).
- Windows: Computer Use approved for `Code.exe` (a per-app approval, asked once).
- The VSIX is the person's own local build: the run prompt says so, since the model asks before
  installing a local VSIX.

### Known leak

`--user-data-dir` does not isolate `~/.vscode-shared`: whatever VS Code keeps there is shared with
the person's own VS Code. `run.json` lists it under `knownLeaks`.

Exit **0** = ready. Exit **2** = cannot prepare; every reason is printed, for example
`doc-processing is a clone of https://github.com/someone-else/doc-processing, not https://github.com/example-org/doc-processing`.

VS Code: `--code`, else `VSCODE_EXECUTABLE`, else the Windows user install, else a stable download
(cached under `.vscode-test/`).

## UI journeys without Computer Use: `npm run qa:ui` (QA-4)

While Codex's Computer Use sees no apps, Codex still writes the journeys and reads the reports, and
`qa:ui` does the clicking. It drives the isolated VS Code of a prepared run root through Playwright
`_electron`: no screen control, no Computer Use approval, and it works under `xvfb-run` on Linux.

```
npm run qa:ui -- <run root> <journey.json> [--code <VS Code executable>] [--out <report folder>]
```

1. Reads `run.json` (so run `qa:prepare` first) and the journey. It uses the journey's `client`, or the
   first client if the journey names none.
2. Starts VS Code with the same isolated profile (`.vscode-user`, `.vscode-ext`) and
   `--disable-workspace-trust`, and opens the client's `.code-workspace`.
3. Runs the steps in order and stops at the first failure. A failure takes a screenshot
   (`screens/<id>-fail-step-<n>.png`), and the remaining steps are NOT_RUN.
4. Writes a `datapass.qa-report` (validated before it is written) to `<run root>/qa-ui/<run id>-<journey id>/report.json`,
   with the screenshots beside it under `screens/`. Exit 0 = reached, 1 = not reached (see the
   report), 2 = cannot start (every reason printed).

A UI journey is a separate format, `datapass.ui-journey` v1. A `test-journey` is a goal written for
Codex; a `ui-journey` lists the exact steps (this is `tests/fixtures/qa/ui/smoke-doc-pipeline.json`,
which the unit tests parse):

```jsonc
{
  "format": "datapass.ui-journey", "version": 1,
  "id": "UI01", "title": "Open the DataPass Architecture view on the doc-pipeline example",
  "client": "doc-pipeline-lab", "features": ["onboarding", "architecture"],
  "steps": [
    { "openView": "Architecture" },
    { "expect": "PDF inbox", "timeoutMs": 60000 },
    { "screenshot": "architecture-view" }
  ]
}
```

| Step | Does |
|---|---|
| `{"run": "<palette label>"}` | Command Palette: types the label and picks the first entry showing it |
| `{"openView": "<view name>"}` | *View: Open View*: types the name and picks the first entry showing it |
| `{"click": "<text>", "role"?: "button"}` | clicks the first visible match, in the workbench or a webview; `role` (button, link, tab, treeitem, menuitem, checkbox, option) matches by accessible name |
| `{"expect": "<text>", "timeoutMs"?: 15000}` | waits until the text is visible, in the workbench or a webview |
| `{"press": "Escape"}` | a key or chord, e.g. `Control+Shift+P` |
| `{"screenshot": "<name>"}` | saves `screens/<id>-<name>.png` |

A step that is not understood (an unknown kind, an empty selector, two actions in one step) is
reported **NOT_RUN, never PASS**, so the journey is at best `partly` reached. A bad header (format,
id, features, 1 to 40 steps) refuses the file. Outcome: every step passed → `reached`; a step failed →
`not-reached` with one major finding; some steps not run → `partly`; VS Code could not be driven →
`blocked` with a blocker finding. Coverage lists the journey's `features` and counts them as reached
only when the journey is reached.

Note: in the default Standard mode the DataPass Project view is hidden. Journeys should open views
that the mode they test shows (the smoke journey uses the Architecture panel).

CI packages the VSIX on Ubuntu and runs the smoke journey (`tests/qa-ui.smoke.test.ts`) under `xvfb-run`;
its report and screenshot are uploaded as the `qa-ui-evidence` artifact.

## Codex procedure notes (from the in-app runs)

- Start Codex's shell **without the user's PowerShell profile**: a profile that starts Anaconda
  crashes it (`No module named '_ctypes'`). Use profile loading off (`login: false`), or
  `powershell.exe -NoProfile`.
- Take screenshots with **Windows PowerShell** (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File shot.ps1`),
  not `pwsh`: PowerShell 7 fails with `Unable to find type [System.Windows.Forms.Screen]`.
- Start a Computer Use task with the `@Computer` or `@AppName` prefix on the first line of a new app thread
  (for example `@Computer use Visual Studio Code: …`), with VS Code already open in front. The per-app
  approval only appears then. Until Computer Use lists apps, use `qa:ui` for the UI steps.

## Validating a test repository (its own CI)

```
npm run qa:prepare -- --auto <test repository clone> --check [--report <report.json>]
```

Validates the configuration and the journeys (and a report, path relative to the test repository)
with no run root, no VS Code and no network. Exit 0 valid, 2 not, reasons printed.

## The mode in DataPass: *Codex tests* in the Work orders view

Shown in the **DataPass** and **Advanced** modes (surface `ai.codexTests`), hidden in Standard and Vanilla.

1. Set the machine setting `datapass.codexTests.autoRepository` to your clone of the test repository
   (*Choose the test repository…* in the section opens it). A workspace can never set it.
2. The section lists the client (or the app workspaces), the DataPass version under test and each
   journey with its feature tags. It reads the **audit clone beside it**, the folder named after the
   report remote (for example `datapass-codex-test` next to the test repository), and shows the
   newest report under `reports/<purpose>/`: date, version, reached / partly / not reached, blocker
   and major counts, coverage. *Open last report* opens `summary.md` (else `report.json`).
3. **Hand to Codex** (work orders must be on for the project) asks you to confirm, then:
   - writes a work order of kind `qa-run` in the project's `.datapass/local/work-orders/<id>/`
     (the test repository read-only, no pull request in the project, Codex only);
   - creates the run root `%TEMP%\datapass-qa\<run id>` with `.codex/config.toml` (workspace-write
     there, the order folder writable, approvals on request);
   - copies the one-line prompt and opens the **Codex desktop app** on the run root (`codex app`
     when the Codex CLI is found, else the app is brought to the front). Paste the prompt into a new
     thread. Only the desktop app can drive VS Code (QA-0): the order says so, and it also says that
     the VSIX is your own build, that the VS Code launch needs one escalated run you approve, that
     Computer Use takes the visible foreground desktop (leave the PC alone), that
     `%USERPROFILE%\.vscode-shared` is not isolated, and that screenshots come from a shell capture.
4. **The receipt.** Codex writes `report.json` to the audit repository, opens the pull request
   `report/<run id>`, copies the report into the order folder and writes `result.json`. DataPass
   accepts the report only if it is a valid `datapass.qa-report` whose `runId`, `datapass.version`
   and `purpose` match the order. The order is then **done**, with the report pull request (found in
   the result's summary, rebuilt from the audit remote). A report for another run or version is shown
   as *report refused* with the reason.
