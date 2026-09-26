# V1 QA-1 — Codex test formats and `qa:prepare`

## What changed
- **Formats** (`src/qa/formats.ts`, handoff/v3/12 §4.1–4.4 with ARCHI's addendum): `datapass.codex-tests` v1
  (`purpose` app | client; client = `client` + `workspace`, app = `workspaces[]` 1..10; the parser normalises both to a
  workspace list), `datapass.test-journey` v1 (`kind` app | client, closed feature-tag list `FEATURES`),
  `datapass.qa-report` v1 (`purpose`, `answers[]` {question, answer, evidence, confidence}, report folder
  `reports/<purpose>/<runId>`), and `datapass.qa-run` v1 (what qa:prepare writes, not emitted as a schema).
- **Schemas**: `schemas/datapass-codex-tests.schema.json`, `datapass-test-journey.schema.json`,
  `datapass-qa-report.schema.json`, emitted by `npm run schemas` (3 lines in `src/core/contracts/schemaFiles.ts`).
- **`scripts/qa/prepare.ts`** (`npm run qa:prepare`): validate config + journeys, check each folder's origin (never
  clones), install the local VSIX into `.vscode-user` / `.vscode-ext` under the run root, check the installed version,
  write one `.code-workspace` per client and `run.json` (VSIX sha256), print the launch command. Exit 0 / 2 with reasons.
  `--check [--report f]` validates a test repository only (the validator for QA-3).
- **Codex procedure addendum** (after QA-0, `handoff/briefs/2026-09-27-codex-procedure.md`): report `agent.host` = `app`
  only; `screens` = `screens/<journey id>-<what>.png` (shell captures), also on `answers[]`; `datapass.commit` = released
  commit (no tags). run.json gains `host: codex-desktop`, `preconditions[]` (visible unlocked desktop, Computer Use
  approval for Code.exe, the VSIX is the user's own build), `knownLeaks[]` (~/.vscode-shared), `screenshots {folder,
  pattern, command}`. `--commit <released commit>` and `--launch` (qa:prepare is the launcher, outside Codex's sandbox).
- **12 §4.7 alignment**: app `workspaces[]` entries are `{id, title, bridge, repositories}` (no `client` nesting, as
  first shipped in #79); every folder reference takes an optional `path` (sub-folder inside the clone, checked to exist
  inside it; the workspace file opens it; run.json/report carry it).
- CI: the ubuntu validate job runs `tests/qaPrepare.test.ts` with the VSIX it just packaged (`DATAPASS_QA_VSIX`).
- Docs: `docs/guide/11_CODEX_TESTS.md`.

## Tests
- `tests/qa.test.ts`: both configurations parse; negatives for bad purpose / kind, missing `workspaces[]` for app, path
  escape, absolute path, http and credential remotes, unknown feature tag, bad outcome / severity / area / confidence,
  oversized fields, duplicates, coverage; run.json closed shape; committed schemas equal the emitted ones and Ajv agrees.
- `tests/qaPrepare.test.ts`: a fixture in %TEMP% (doc-pipeline as bridge + two native folders, local bare remotes
  behind their https address): wrong remote → exit 2 with the reason (CLI); missing folder, bad journey, missing VSIX
  refused; with `DATAPASS_QA_VSIX` the full run installs the VSIX in the isolated dir, writes the workspace (bridge first)
  and a valid run.json, exit 0 (passed locally on Windows with a freshly packaged VSIX); `--check`.

## Limits / next
- The guide README index does not list page 11 yet (not an owned file).
- `common/testing/FEATURES.md` in the test repositories should copy `FEATURES` from `src/qa/formats.ts` (QA-3).
- QA-2 (the report reader in DataPass) consumes `parseQaReport`.
