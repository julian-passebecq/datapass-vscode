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
`agent.host` is always `app`: runs use the Codex desktop app only (Computer Use sees nothing launched
from `codex exec`). DataPass carries the released commit in `datapass.commit` when known.

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

## Validating a test repository (its own CI)

```
npm run qa:prepare -- --auto <test repository clone> --check [--report <report.json>]
```

Validates the configuration and the journeys (and a report, path relative to the test repository)
with no run root, no VS Code and no network. Exit 0 valid, 2 not, reasons printed.
