# 12 — Codex test mode, the fake client "Codex Wind Lab", and DataPass's own repositories

Owner: ARCHI DataPass 1, 2026-09-26, from Julian's decisions in chat (recorded in §1). Part of V1
(ROADMAP §1.3, packages QA-1…QA-3 and HUB-1 below). Supersedes nothing; complements 09 (work
orders) and 11 (evidence chain).

## 1. Julian's decisions (2026-09-26)

1. **An external tester.** Codex (GPT, desktop app and terminal on Julian's PC) tests DataPass as a
   *user* would, on fake clients. It does not audit DataPass's code, and Claude Code is not the
   tester. Codex runs whole batteries by itself and writes a report.
2. **Everything local.** Tests use local files only. No cloud CLI (az, func, databricks, fab) and
   no sign-in, so Codex's machine can run everything alone. Docker is optional.
3. **An external AI plays the client.** The FOIL AI (ChatGPT web, which knows FOIL) plays an
   external client company and prepares the fake client from the public common base only. This
   measures whether an outside AI understands the DataPass format.
4. **The fake client stays close to FOIL.** It is a small wind-turbine study with 2D and 3D parts
   and an ADF-like pipeline reproduced at small scale with local files. Some Docker/VM
   configuration is included, all synthetic, because the client repositories are public.
5. **Repository roles.** The table in §2 is final. The extension code stays in `datapass-vscode`
   (coders keep working there). `datapass-vscode-hub` is DataPass's spokesperson.
   `datapass-vscode-common` is the public base that every client reads. The word "bridge" keeps
   its current meaning: each client has its own bridge repository.
6. **The auto repository.** A client may have one. It holds the tests to launch. The client's AI
   (here Codex) writes the test settings there, following DataPass's needs. DataPass's Codex test
   mode reads it to launch the tests. For now only the Codex client has one; real clients may get
   one later.
8. **Codex drives VS Code itself; the procedure lives in common** (Julian, follow-up). Codex can control the desktop the way a person does: it opens VS Code, clicks and reads the screen. So testing has two tracks, API batteries and a UI track (§4.6). The exact procedure (who installs the VSIX, which profile, how Codex launches VS Code) must be **verified on the real Codex** before we rely on it (package QA-0). The procedure is documented in **common** (`testing/CODEX_PROCEDURE.md`) and summarised in the hub. The auto repository stays **settings and code only**, with no prose: the client's AI reads common and fills auto for DataPass.
7. **Model choice for Codex** (Julian: "your call"). Use Luna medium for exploratory runs and
   report writing, and Luna light for plain reruns of a battery. This is logged in questions.md.

## 2. Repository map

| Repository | Visibility | Side | Role | Written by |
|---|---|---|---|---|
| `datapass-vscode` | public | DataPass | extension source, CI, releases, design docs (this file) | Claude coders |
| `datapass-vscode-hub` | private | DataPass | spokesperson: every repository link, the client registry, the operating manual, DataPass's machine settings and toolkit hub, verification that clients' deliveries are right | ARCHI / assistant |
| `datapass-vscode-common` | **public** | DataPass | common base for all clients: delivered version, formats and schemas (synced at each release), cloud and MCP feature notes, what a client prepares, what tests exist | synced from `datapass-vscode`; knowledge notes by PR |
| `datapass-vs-code-archive` | private | DataPass | backlog/archive of finished client work and past projects | ARCHI / assistant |
| `datapass-vscode-helper` | private | DataPass | internal odds and ends, never shown to clients | anyone on our side |
| `datapass-vscode-vsix` | private | DataPass | later: version history and built VSIX files; unused now | — |
| `datapass-codex-fakeclient` | public | client "Codex Wind Lab" | native code: 2D wind study | client AI (FOIL AI) |
| `datapass-codex-fakeclient2` | public | client | native code: 3D blade geometry and viewer | client AI |
| `datapass-codex-fakeclient3` | public | client | native code: platform (ADF-like pipeline, bundles, infra, Docker "VM") | client AI |
| `codex-datapass-bridge` | private | client | the client's **bridge repository**: `.datapass/*.json`, links to every client repository, architecture docs, and the DataPass ↔ client conversation (onboarding brief, questions) | client AI; DataPass writes only the requests |
| `datapass-vscode-codex-auto` | private | client | the **auto repository**: `datapass-auto.json` and `batteries/*.json` (which tests to launch, on which workspace), plus AGENTS.md for Codex | Codex, from our needs (starter set by QA-3) |
| `datapass-codex-test` | private | client → DataPass | the **audit backlog**: every Codex run report (`reports/<run-id>/`) | Codex |

`datapass-vscode-codex` and `datapass-vscode-codex-bridge` were created during the discussion and
are not used. Julian may delete them.

Invariant (unchanged): the three client code repositories work with DataPass removed. None of them
contains a DataPass file. Deleting the bridge or the auto repository breaks nothing in the client
code.

## 3. The loop

```
common (formats, v0.26) ──read──▶ client AI (FOIL AI as "Codex Wind Lab")
                                    │ writes code repos 1–3 + bridge (.datapass) + QUESTIONS.md
                                    ▼
DataPass requests ◀──────── codex-datapass-bridge ◀── ARCHI reviews the bridge against common
                                    │
Codex (tester) ──reads── datapass-vscode-codex-auto (datapass-auto.json, batteries)
   │ clones the client repos, checks out datapass-vscode at the version under test
   │ runs `npm run qa -- --auto <auto repo>`  (battery runs, deterministic)
   │ then explores by hand (UI, docs), following AGENTS.md
   ▼
datapass-codex-test/reports/<run-id>/ (report.json + summary.md + evidence)
   ▼
ARCHI triage → bugs become packages in PLAN.md; doc gaps go to common; client mistakes go back to
the bridge as requests → next release → Codex reruns
```

## 4. What DataPass codes: the Codex test mode

### 4.1 The auto file: `datapass-auto.json` (format `datapass.auto-tests`, version 1)

This file is found at the root of the auto repository.

```json
{
  "format": "datapass.auto-tests", "version": 1,
  "client": { "id": "codex-wind-lab", "title": "Codex Wind Lab (fictional)" },
  "datapass": { "minVersion": "0.26.0", "ref": "main", "vsix": "https://github.com/julian-passebecq/datapass-vscode/releases/download/v0.26.0/datapass-vscode-0.26.0.vsix" },
  "workspace": {
    "bridge": { "remote": "https://github.com/julian-passebecq/codex-datapass-bridge", "folder": "codex-datapass-bridge" },
    "repositories": [
      { "remote": "https://github.com/julian-passebecq/datapass-codex-fakeclient",  "folder": "wind-study-2d" },
      { "remote": "https://github.com/julian-passebecq/datapass-codex-fakeclient2", "folder": "wind-blade-3d" },
      { "remote": "https://github.com/julian-passebecq/datapass-codex-fakeclient3", "folder": "wind-platform" }
    ]
  },
  "batteries": ["batteries/B01-format.json", "batteries/B02-model.json"],
  "report": { "remote": "https://github.com/julian-passebecq/datapass-codex-test", "folder": "reports" },
  "limits": { "batteryTimeoutSeconds": 600, "stepTimeoutSeconds": 30 }
}
```

- Folder names are relative to one run root, and the runner refuses `..` and absolute paths.
- Remotes are https only. The runner never clones; Codex clones, following AGENTS.md. The runner
  only checks that each folder exists and that its `origin` matches the declared remote (normalised
  the same way V1-ON does).
- The schema goes in `schemas/datapass-auto-tests.schema.json`, emitted by `npm run schemas`.

### 4.2 Batteries: `batteries/*.json` (format `datapass.qa-battery`, version 1)

Each battery is data only: an id, a title, a level (§5), and ordered steps. Each step has one
action from a fixed vocabulary and optional expectations.

| Action | What the runner does | Allowed arguments |
|---|---|---|
| `probe` | calls a read-only Test API method and records its JSON | `name` ∈ allowlist: readiness, projectMap, repositories, inventory, qualification, optionsAnalysis, selection, workModel, toolObservations, boardView, workViews, windowInfo, experience.current, experience.status, selectedVariant.statusText, evidence (E1), toolkit (K2), workOrders.list, pilot.cards, renderProjectTree, renderWorkTree, git.renderTree, diagnostics (format checks → Problems) |
| `command` | runs a DataPass command with no UI prompt | `id` ∈ allowlist in `src/qa/allowlist.ts` (datapass.* commands that only read, or only write under the workspace's `.datapass/local/`); `args` JSON |
| `select` / `setPreview` | selects a component or variant (existing Test API) | ids from the bridge |
| `setMode` | switches preset Vanilla / Standard / DataPass / Advanced | preset id |
| `copyContext` | Copy Context for My AI on a file (captured clipboard) | workspace-relative path |
| `aiImport` | imports an AI proposal file through the validated exchange | path inside the auto repository |
| `writeOrder` | writes a work order draft (stub agent, no launch) | draft JSON |
| `wait` | waits for a probe to satisfy an expectation | probe + expect + timeout |

- **Expectations** use `path` (a dotted path into the recorded JSON) with one of `equals`,
  `contains`, `exists`, `absent`, `count`, `matches` (anchored regex, max 200 characters), or
  `noUnhandledErrors: true`, which fails when the extension host log contains an unhandled error
  or rejection.
- **Refused:** shell steps, arbitrary command ids, any path outside the run root, any network step.
  An unknown action or command id makes the step `ERROR` and the battery continues.
- The battery file is untrusted data (CLAUDE.md boundary). It is parsed with the same validator
  style as the other formats.

### 4.3 The runner: `npm run qa`

```
npm run qa -- --auto <path to datapass-vscode-codex-auto> --root <run root> [--battery B02] [--out <dir>]
```

- **Implementation.** It is built as `scripts/qa/run.ts` (launcher) plus `tests/qa/host.ts`
  (in-host executor). It reuses `scripts/desktop-test.ts`: the same VS Code resolution, a fresh
  `--user-data-dir`, isolated extensions, and `ExtensionMode.Test` so the Test API is available.
  The workspace is a generated `.code-workspace` holding the bridge first, then the native folders
  (the company-workspace writer from 0.17 builds it).
- **One VS Code launch per battery.** Steps run in order, each step's JSON goes into the evidence,
  and screenshots come later in QA-4.
- **Output.** It writes `<out>/<run-id>/report.json` (§4.4), `summary.md` (PASS/FAIL table, first
  failure details) and `evidence/<step-id>.json`. The default `<out>` is the report folder named in
  the auto file.
- **Exit code.** 0 when every step passes, 1 when any step fails or errors, 2 when the runner itself
  cannot start (bad auto file, missing folder, wrong remote). This is what Codex branches on.
- **What it never does:** run git push, npm publish, cloud CLIs, or network calls. It writes only
  under `<out>` and the workspace's `.datapass/local/`.

### 4.4 The report: `report.json` (format `datapass.qa-report`, version 1)

- **Run context:** `runId` (`<yyyymmdd-hhmm>-<client>-<battery|all>`), the DataPass `version` and
  `commit`, the `vscode` version, `os`, and `client` with the bridge commit and each repository's
  commit.
- **`batteries[]`:** `{ id, level, status, steps[] }`, where each step is
  `{ id, action, status: PASS|FAIL|ERROR|SKIP, expected, observed (truncated to 2 KB), ms }`.
- **`findings[]`:** written by Codex after exploring, never by the runner. Each finding is
  `{ id, severity: blocker|major|minor|idea, area: format|onboarding|architecture|variants|ai|git|work-orders|readiness|docs|ui|performance, title, steps, expected, actual, evidence, suggestion }`.
- **`clientFeedback[]`:** doc gaps the client AI reported in the bridge's `QUESTIONS.md`, copied
  in by Codex.
- **`agent`:** `{ tool: "codex", model, mode: app|terminal }`.

Findings are claims. The ARCHI verifies each one before it becomes a package (D-22: agent claims
are labelled as claims).

### 4.5 The mode inside DataPass (what Julian sees)

- **Visibility.** The mode is a "Codex tests" section in the Work orders view, surface id
  `ai.codexTests` (add-only). It shows in the DataPass and Advanced presets and stays hidden in
  Standard and Vanilla. The setting `datapass.codexTests.autoRepository` holds a machine-local path
  to the auto repository clone.
- **Section content.** It shows the client, the batteries (id, level, title) and the last report
  found in the audit clone: date, version, PASS/FAIL counts, and the number of blocker and major
  findings.
- **Hand to Codex.** This writes a work order of a new kind, `qa-run`, in
  `.datapass/local/work-orders/<id>/`. Its prompt is generated from the auto file:
  1. clone or pull the listed repositories under the run root;
  2. check out `datapass-vscode` at `datapass.ref`, run `npm ci`, then `npm run qa -- …`;
  3. explore by hand following AGENTS.md;
  4. write findings into report.json;
  5. commit and push the report to `datapass-codex-test` on a branch `report/<run-id>` and open a
     PR.

  The order launches through the existing AI-3 Codex hand-off: Codex terminal, or Codex app with
  `codex app <folder>`. **For `qa-run` the Codex app is allowed**, unlike the pilot, because the
  kind has no cloud access. The order's `.codex/config.toml` is workspace-write inside the run
  root, with network allowed only for git and npm.
- **Receipt.** The existing result watcher reads `report.json`: the receipt is valid if the format
  parses and `version`/`commit` match the order stamp (P1). The order is then done with a link to
  the report PR.
- **Open last report** opens `summary.md` in a preview.

### 4.6 The UI track: Codex uses DataPass like a person

The API batteries (§4.3) are deterministic, but they run the extension in development mode. The
UI track tests **the released VSIX**, as Julian would use it. The procedure below is the design
target. QA-0 verifies it on the real Codex and corrects it.

1. **Get the VSIX.** Codex downloads the release VSIX named in `datapass-auto.json`
   (`datapass.vsix`: a release asset URL or a local path). If there is no release asset yet, it
   builds one with `npm run package` in its `datapass-vscode` clone.
2. **Install into an isolated VS Code**, never Julian's own profile:
   `code --user-data-dir <run root>/vscode-user --extensions-dir <run root>/vscode-ext --install-extension <vsix>`.
3. **Launch** with the same two flags on the run's workspace file:
   `code --user-data-dir … --extensions-dir … <run root>/codex-wind-lab.code-workspace`.
   The runner writes this workspace file (`npm run qa -- --prepare-only`).
4. **Drive by hand.** Codex follows the UI checklist in common: *Open a Client Project* from the
   bridge URL, the Architecture panel, switching variants, Copy Context, modes, Git view, work
   orders and the Codex tests section. It takes a screenshot at each checkpoint into
   `reports/<run-id>/screens/`.
5. **Close** that VS Code window and delete `<run root>/vscode-user` at the end.

QA-0 must also confirm:

- what Codex's desktop control can reach on Windows: the VS Code window, webviews, the command
  palette and notifications;
- whether it needs a visible desktop session;
- how it handles the notification "trust this folder" and the first-run walkthrough;
- whether the Codex app or the Codex terminal is the right host for the UI track.

## 5. Test levels and the starter batteries

These are written by QA-3 in the auto repository. Codex may add batteries; the ARCHI reviews them.

| Battery | Level | What it proves |
|---|---|---|
| B01-format | L0 format | The client's `.datapass` files parse and validate: zero errors in Problems, every id resolves, every repository in the bridge is found on disk with the right remote, no secret-looking value, `datapassRequests` empty or understood. This is the direct test of "did the external AI understand the format". |
| B02-model | L1 model | The project map shows 3 native repositories + the bridge. The graph has the components the client declared, with the right repository and root. Environments dev/prod exist. Readiness rows exist for each tool with evidence `unknown` (nothing is observed without the cloud). Resources include the VM and storage. |
| B03-variants | L2 flows | Variants A (local), B (Docker "VM") and C (ADF-like, simulated) exist. `setPreview` A→B→C changes the tree, the status text says "Variant: X · preview", and packs carry the P1 stamp with the right variant. Costs: the shared storage line is counted once and learning-only lines are labelled. |
| B04-ai-loop | L2 flows | Copy Context for My AI on one file from each repository gives a pack naming the file, its component and the selected variant. `aiImport` of a valid proposal gives a reviewable change. `aiImport` of a proposal with a wrong base revision is refused. |
| B05-work-orders | L2 flows | A draft order for the 2D study is written with its stamp. After a variant change the order shows stale (P1). The pilot tab is hidden in Standard and visible in DataPass mode. |
| B06-modes | L2 UI state | Vanilla, Standard, DataPass and Advanced: the surfaces listed in `presets.json` are visible or hidden as specified, and safety commands are never hidden. |
| B07-negative | L3 robustness | The auto repository holds `fixtures/broken-bridge/` (a copy of the bridge with 8 seeded faults: bad JSON, unknown repoRef, duplicate id, a planned repository with files, a secret-looking value, a wrong remote, an unknown toolchain id, a missing required file). Each fault is reported once with a readable message, there is no crash, and `noUnhandledErrors`. |
| B08-docker-vm | L3 optional | When `docker` is on PATH (otherwise SKIP): the declared "VM" resource shows declared vs **not observed**. DataPass never runs docker; Codex may run `docker compose up` itself and note what DataPass shows. |
| X (exploratory) | L4 | Not a battery: the UI track (§4.6). Codex follows common/testing/UI_CHECKLIST.md: onboarding with *Open a Client Project* (once V1-ON lands) on the bridge URL, the DEMARRER.md steps, the modes, and anything confusing. Everything goes into `findings[]`. |

## 6. Where the procedure lives: common, not auto

- **`datapass-vscode-common/testing/CODEX_PROCEDURE.md`** is the full tester procedure: role,
  setup, both tracks, reproduction rule, report, limits.
  - **Role.** You are an external QA tester who tests as a user. You never edit `datapass-vscode`,
    never touch the cloud and never sign in.
  - **Setup.** The run root is under `%TEMP%\datapass-qa\<run-id>`, never a drive root. Clone
    the listed repositories and `datapass-vscode` at `datapass.ref`, then `npm ci`.
  - **API track.** Run `npm run qa -- --auto … --root …`, then read `summary.md`.
  - **UI track.** Follow §4.6.
  - **Reproduction rule.** Reproduce every FAIL once by hand before writing a finding.
  - **Report.** Fill `findings[]` and `clientFeedback[]`, push the branch `report/<run-id>` to the
    audit repository and open a PR titled `QA <run-id>: <n> FAIL, <n> blocker`. Never merge it.
  - **Limits.** Stop after 2 h. When blocked, write a `blocked` finding and stop.
- **`datapass-vscode-common/testing/`** also holds:
  - `AUTO_FORMAT.md`: `datapass-auto.json` and the battery vocabulary of §4.1–4.2, in client
    terms;
  - `BATTERIES.md`: the levels and B01–B08 of §5 as **examples**;
  - `UI_CHECKLIST.md`: the UI track steps;
  - `REPORT_FORMAT.md`: §4.4.
- **The hub** (`datapass-vscode-hub/docs/OPERATING_MANUAL.md`) gets a short French paragraph that
  links there.
- **The auto repository** contains only `datapass-auto.json`, `batteries/*.json`, `fixtures/`
  and a 3-line `AGENTS.md`: "Read https://github.com/julian-passebecq/datapass-vscode-common/tree/main/testing,
  then run or update the settings in this repository." **The client's AI (Codex) writes these
  settings** after reading common. We do not pre-write its batteries. QA-3 only adds a minimal
  valid `datapass-auto.json` so the runner can be tried.

## 7. The fake client: what the client AI prepares

The request to the client is written as DataPass talking to an external client, in
`codex-datapass-bridge/DATAPASS_ONBOARDING.md`. Summary:

- **Three native repositories, all synthetic** (no FOIL data, formulas or payloads):
  - fakeclient `wind-study-2d`: Python, a synthetic wind CSV, a textbook blade-section and
    power-curve toy model, a notebook with outputs, pytest, CI;
  - fakeclient2 `wind-blade-3d`: parametric blade mesh to OBJ, a static HTML viewer, tests;
  - fakeclient3 `wind-platform`: an ADF-like pipeline JSON with a local Python runner that simulates
    the activities, `databricks.yml` + job YAML, a Fabric-like item folder, Bicep/OpenTofu files that
    are never applied, `docker-compose.yml` with a "vm" service, a Functions-style
    `function_app.py` runnable with plain Python, CI.
- **The bridge:** manifest v5, graph 0.2, options (A/B/C, costs with a `shared` storage line and one
  `learning-only` line), sheet, board, `.vscode/extensions.json`, AGENTS.md, README and
  docs/ARCHITECTURE.md.
- **QUESTIONS.md:** every place the common base was unclear. This is a deliverable, not a failure.

## 8. Packages (ROADMAP V1 §1.3)

| Id | Package | Size · effort | Owned files | Acceptance |
|---|---|---|---|---|
| **QA-0** | Verify how Codex tests a VSIX (investigation, no product code) | S · medium | a report `handoff/briefs/2026-09-27-codex-procedure.md` | It answers each §4.6 question with a source: the official Codex docs (desktop app, CLI, sandbox and approvals, computer/desktop control on Windows). Where possible, run it on this PC with a throwaway test: Codex installs the current VSIX into an isolated profile, opens the doc-pipeline example, clicks one view and takes a screenshot. The report states the exact working command lines and what failed. The ARCHI then corrects §4.6 and CODEX_PROCEDURE.md. |
| **QA-1** | Runner + formats | M–L · medium (high if the host executor fights the Test API) | `scripts/qa/**`, `tests/qa/**`, `src/qa/**` (allowlist, battery and auto parsers, report writer), `schemas/datapass-auto-tests.schema.json`, `schemas/datapass-qa-battery.schema.json`, `schemas/datapass-qa-report.schema.json`, `package.json` script `qa` only, `docs/guide/11_CODEX_TESTS.md` | Unit: auto, battery and report validators, including negatives (path escape, unknown action, unknown command, remote mismatch, oversized regex). Desktop: `npm run qa` on a local fixture (`tests/fixtures/qa/` — doc-pipeline as bridge + 2 native folders, with local bare "remotes") runs a 6-step battery, gives exit 0, and `report.json` validates; a battery with one failing expectation gives exit 1 and a readable summary; a bad auto file gives exit 2. |
| **QA-2** | The mode in DataPass | M · medium | `src/work/codexTests.ts`, the `qa-run` kind (additive schema enum), a Work orders view section, surface `ai.codexTests` in surfaces.ts/presets.json (add only), setting `datapass.codexTests.autoRepository` | Unit: prompt generation from the auto file, receipt check (stamp match). Desktop: the section lists batteries and the last report from a fixture audit folder; *Hand to Codex* writes a `qa-run` order (launcher stubbed); hidden in Standard. Starts after QA-1 merges (shared parsers). |
| **QA-3** | Testing docs in common + minimal auto/audit skeletons | S–M · medium | `datapass-vscode-common/testing/**` (CODEX_PROCEDURE, AUTO_FORMAT, BATTERIES, UI_CHECKLIST, REPORT_FORMAT); `datapass-vscode-codex-auto`: the 3-line AGENTS.md and one minimal `datapass-auto.json`; `datapass-codex-test`: README and reports/ layout | The example batteries in BATTERIES.md validate with QA-1's validator. The minimal auto file lets `npm run qa -- --prepare-only` succeed. After QA-0, CODEX_PROCEDURE.md matches QA-0's verified commands. PRs to `main` of each repository; these are ours, so merge on green. |
| **HUB-1** | Hub and common seeds | S–M · medium (docs-writer) | `datapass-vscode-hub`: README (repository map §2, client registry: codex-wind-lab, foil), docs/OPERATING_MANUAL.md (French, including a short Codex testing paragraph that links to common/testing). `datapass-vscode-common`: README, VERSION, formats/ + schemas/ + examples/ copied by `scripts/sync-common.ts` (lives in datapass-vscode, owned by HUB-1), knowledge/ (cloud features, MCP servers from K1/K2); testing/ is owned by QA-3. `datapass-vs-code-archive` and `datapass-vscode-helper`: README. | The sync script is idempotent and copies only public files (no handoff/, no FOIL). Common's README links resolve. The onboarding brief's links into common resolve. |
| QA-4 (V1.1) | UI steps | M · medium | Playwright `_electron` steps `click`, `screenshot`, `readView` | later |

**Order.** QA-0, QA-1 and HUB-1 start now in parallel (disjoint files). QA-3 starts now on the testing docs and corrects the procedure when QA-0 reports. QA-2 follows QA-1. Codex's first real run needs QA-1, QA-3, QA-0's verified procedure and the client's bridge.

## 9. Later, not V1

- Real clients get their own auto repository ("quick automatic tests").
- A client-side battery library in common.
- Claude Code as a second tester.
- Codex drives the Pilot (cloud read-only) against a real sandbox. This needs AI-4b.
