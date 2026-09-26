# 12 — Codex test mode ("auto" mode), the fake client "Codex Wind Lab", and DataPass's repositories

Owner: ARCHI DataPass 1, 2026-09-26, from Julian's decisions in chat (recorded in §1). Part of V1
(ROADMAP §1.3, packages QA-0…QA-3 and HUB-1 below). Complements 09 (work orders) and 11 (evidence
chain).

## 1. Julian's decisions (2026-09-26)

1. **An external tester who acts as a client.** Codex (GPT, desktop app and terminal on Julian's
   PC) uses the **released DataPass VSIX the way one of our clients would**, on that client's
   project, to see whether DataPass delivers what the client needs. That includes preparing the
   deployment of the client's project. Codex does not debug or audit DataPass's code: Claude's
   own suites already test the VSIX regularly. A future `codex-testvsix` role may test the app
   code (§9), but not now. Claude Code is not this tester.
2. **Everything local.** Only local files. No cloud CLI (az, func, databricks, fab) and no sign-in,
   so Codex's machine runs everything alone. Docker is optional.
3. **An external AI plays the client.** The FOIL AI (ChatGPT web) plays an external client company
   and prepares the fake client from the public common base only. This measures whether an outside
   AI understands the DataPass format.
4. **The fake client stays close to FOIL.** It is a small wind-turbine study (2D, 3D) with an
   ADF-like pipeline at small scale, on local files, with some Docker/VM configuration. Everything
   is synthetic, because the client code repositories are public.
5. **Repository roles** are final (§2). The extension code stays in `datapass-vscode`.
   `datapass-vscode-hub` is DataPass's spokesperson and `datapass-vscode-common` is the public base
   every client reads. "Bridge" keeps its meaning: one bridge repository per client.
6. **The auto repository.** A client may have one. It says which **client journeys** DataPass
   should have tested for that client. It holds **settings and code only, no prose**: the client's
   AI (here Codex) reads the procedure in common and fills auto. DataPass's Codex test mode reads it.
   For now only the Codex client has one; real clients may get one later ("quick automatic tests").
7. **Codex drives VS Code itself** (clicks, reads the screen). The exact procedure (who installs the
   VSIX, in which profile, from the app or the terminal) must be **verified on the real Codex**
   before we rely on it (QA-0). The procedure is documented in **common**
   (`testing/CODEX_PROCEDURE.md`) and summarised in the hub.
8. **Model** (Julian: "your call"). Luna medium for journeys and reports, Luna light for a plain
   rerun. This is logged in questions.md.

## 2. Repository map

| Repository | Visibility | Side | Role | Written by |
|---|---|---|---|---|
| `datapass-vscode` | public | DataPass | extension source, CI, releases, design docs (this file) | Claude coders |
| `datapass-vscode-hub` | private | DataPass | spokesperson: every repository link, the client registry, the operating manual, DataPass's machine settings and toolkit hub, verification that clients deliver correctly | ARCHI / assistant |
| `datapass-vscode-common` | **public** | DataPass | common base for all clients: delivered version, formats and schemas (synced per release), cloud and MCP notes, what a client prepares, the Codex testing procedure and journey format | synced from `datapass-vscode`; notes by PR |
| `datapass-vs-code-archive` | private | DataPass | archive of finished client work and past projects | ARCHI / assistant |
| `datapass-vscode-helper` | private | DataPass | internal odds and ends, never shown to clients | our side |
| `datapass-vscode-vsix` | private | DataPass | later: version history and built VSIX files; unused now | — |
| `datapass-codex-fakeclient` | public | client "Codex Wind Lab" | native code: `wind-study-2d` | client AI (FOIL AI) |
| `datapass-codex-fakeclient2` | public | client | native code: `wind-blade-3d` | client AI |
| `datapass-codex-fakeclient3` | public | client | native code: `wind-platform` (ADF-like pipeline, bundle, infra, Docker "VM") | client AI |
| `codex-datapass-bridge` | private | client | the client's **bridge repository**: `.datapass/*.json`, links to every client repository, architecture docs, and the DataPass ↔ client conversation (`DATAPASS_ONBOARDING.md`, `QUESTIONS.md`, `DATAPASS_REQUESTS.md`) | client AI; DataPass writes only requests |
| `datapass-vscode-codex-auto` | private | client | the **auto repository**: `datapass-auto.json`, `journeys/*.json`, `fixtures/` — settings only | Codex, after reading common |
| `datapass-codex-test` | private | client → DataPass | the **audit backlog**: every Codex run report (`reports/<run-id>/`) | Codex |

`datapass-vscode-codex` and `datapass-vscode-codex-bridge` were created during the discussion and
are unused; Julian may delete them.

Invariant: the client code repositories work with DataPass removed, and none contains a DataPass
file. Deleting the bridge or the auto repository breaks nothing in the client's code.

## 3. The loop

```
common (formats + testing procedure) ──read──▶ client AI (FOIL AI as "Codex Wind Lab")
                                                  │ code repos 1–3 + bridge + QUESTIONS.md
                                                  ▼
DataPass requests ◀──── codex-datapass-bridge ◀── ARCHI reviews the bridge against common
                                                  │
Codex ──reads common/testing──▶ fills datapass-vscode-codex-auto (client journeys)
  │ DataPass "Codex tests" (or Codex alone): prepare the run root, install the released VSIX
  │ into an isolated VS Code, open the client's workspace
  │ Codex walks each journey as the client, through the UI, with screenshots
  ▼
datapass-codex-test/reports/<run-id>/ (report.json + summary.md + screens/)
  ▼
ARCHI triage → product gaps become PLAN.md packages; doc gaps go to common;
client mistakes go back to the bridge as requests → next release → Codex reruns
```

## 4. What DataPass codes: the Codex test mode

### 4.1 The auto file: `datapass-auto.json` (format `datapass.auto-tests`, version 1)

```json
{
  "format": "datapass.auto-tests", "version": 1,
  "client": { "id": "codex-wind-lab", "title": "Codex Wind Lab (fictional)" },
  "datapass": { "version": "0.26.0", "vsix": "https://github.com/julian-passebecq/datapass-vscode/releases/download/v0.26.0/datapass-vscode-0.26.0.vsix" },
  "workspace": {
    "bridge": { "remote": "https://github.com/julian-passebecq/codex-datapass-bridge", "folder": "codex-datapass-bridge" },
    "repositories": [
      { "remote": "https://github.com/julian-passebecq/datapass-codex-fakeclient",  "folder": "wind-study-2d" },
      { "remote": "https://github.com/julian-passebecq/datapass-codex-fakeclient2", "folder": "wind-blade-3d" },
      { "remote": "https://github.com/julian-passebecq/datapass-codex-fakeclient3", "folder": "wind-platform" }
    ]
  },
  "journeys": ["journeys/J01-open-my-project.json", "journeys/J02-choose-a-variant.json"],
  "report": { "remote": "https://github.com/julian-passebecq/datapass-codex-test", "folder": "reports" },
  "limits": { "runMinutes": 120, "journeyMinutes": 20 }
}
```

- **Paths.** Folders are relative to one run root; `..` and absolute paths are refused.
- **Remotes.** Remotes are https only.
- **Where the VSIX comes from.** `datapass.vsix` is a release asset URL or a path relative to the
  run root. When no release asset exists yet, the procedure in common says how to build one.
- **Schema.** It lives in `schemas/datapass-auto-tests.schema.json`.

### 4.2 Client journeys: `journeys/*.json` (format `datapass.client-journey`, version 1)

A journey is a goal the client has, written in the client's terms. It is not a script of API
calls. Codex reaches the goal through DataPass's UI the way the client would, and says whether it
got there.

```json
{
  "format": "datapass.client-journey", "version": 1,
  "id": "J03", "title": "Prepare the dev deployment of the publish function (variant C)",
  "as": "client engineer, cloud beginner",
  "goal": "Know exactly what is needed to deploy the publish function to dev under variant C, and hand the preparation to an AI.",
  "setup": { "mode": "Standard", "variant": "C", "environment": "dev" },
  "hints": ["Start from the Architecture panel", "Readiness shows what is missing"],
  "expected": [
    "The function component shows its repository, folder and the dev target",
    "Readiness lists the tools needed (Python, Azure Functions extension) and marks cloud evidence as not observed",
    "A work order or Copy Context pack names variant C, dev and the bridge revision",
    "Nothing is deployed and no sign-in is asked for"
  ],
  "features": ["architecture", "variants", "readiness", "evidence", "work-orders", "stamps"],
  "outOfScope": ["real Azure deployment"]
}
```

- **`features`** tags come from a fixed list in common (`testing/FEATURES.md`). They let the ARCHI
  see which DataPass features each run covered.
- **Safety.** Journeys are untrusted data. Codex follows them in the UI, but DataPass never
  executes anything from them.

### 4.3 The prepare helper: `npm run qa:prepare`

This is a small helper in `datapass-vscode` (`scripts/qa/prepare.ts`). It does the mechanical part
so Codex spends its time on the journeys.

```
npm run qa:prepare -- --auto <auto repo clone> --root <run root>
```

1. It validates `datapass-auto.json` and every journey file.
2. It checks that every declared folder exists under the root with the matching `origin`,
   normalised like V1-ON. It never clones: Codex clones, following the procedure.
3. It gets the VSIX: it downloads the asset, or takes the local path.
4. It installs the VSIX into an isolated profile:
   `code --user-data-dir <root>/.vscode-user --extensions-dir <root>/.vscode-ext --install-extension <vsix>`.
5. It writes `<root>/<client>.code-workspace`: the bridge first, then the native folders, using the
   0.17 company-workspace writer.
6. It prints the exact launch command, with the same two flags and the workspace file, and writes
   `<root>/run.json`:
   - the run id;
   - the DataPass version and VSIX hash;
   - the bridge and repository commits;
   - the VS Code version;
   - the OS.
7. Exit codes: 0 = ready; 2 = cannot prepare. The reason is printed.

It never touches Julian's own VS Code profile. It never pushes, publishes or calls a cloud CLI. It
writes only under `<root>`.

### 4.4 The report: `report.json` (format `datapass.qa-report`, version 1)

- **Run context:** `runId`, the DataPass `version` and VSIX `sha256`, `vscode`, `os`, and `client`
  (the bridge commit and each repository's commit), all copied from `run.json`.
- **`agent`:** `{ tool: "codex", model, host: app|terminal }`.
- **`journeys[]`:** `{ id, outcome: reached|partly|not-reached|blocked, minutes, path (what Codex did, in short steps), expected[] with met: true|false|unclear, screens[] }`.
- **`findings[]`:** `{ id, journey, severity: blocker|major|minor|idea, area (fixed list, the same as the feature tags), title, steps, expected, actual, screens, suggestion }`.
- **`clientFeedback[]`:** doc gaps from the bridge's `QUESTIONS.md`.
- **`coverage`:** the feature tags reached versus the tags listed.

Findings are claims (D-22). The ARCHI verifies each one before it becomes a package.

### 4.5 The mode inside DataPass: "Codex tests"

- **Where it lives.** It is a section in the Work orders view, surface id `ai.codexTests`
  (add-only). It is shown in the DataPass and Advanced presets and hidden in Standard and Vanilla.
  The setting `datapass.codexTests.autoRepository` holds a machine-local path.
- **What it shows.** The client, the journeys (id, title, feature tags), and the last report found
  in the audit clone: date, version, reached / partly / not reached, blocker and major counts, and
  coverage.
- **Hand to Codex** writes a work order of the new kind `qa-run`.
  - **The prompt**, generated from the auto file and common's procedure, asks Codex to:
    1. clone or pull the listed repositories;
    2. run `qa:prepare` from a `datapass-vscode` clone at the release tag;
    3. launch the isolated VS Code;
    4. walk each journey as the client;
    5. write the report;
    6. push the branch `report/<run-id>` to the audit repository and open a PR.
  - **Launching.** It goes through the AI-3 Codex hand-off (terminal, or `codex app <folder>`).
    The Codex app is allowed for `qa-run`, because there is no cloud access. The order's
    `.codex/config.toml` is workspace-write inside the run root, with network allowed only for
    git, npm and the VSIX download.
- **Receipt.** The result watcher validates `report.json`. Its `version` and `runId` must match
  the order stamp (P1). The order is then done, with a link to the report PR.
- **Open last report** opens `summary.md`.

### 4.6 What QA-0 must verify on the real Codex (Windows)

- **Reach.** Can Codex's desktop control reach a VS Code window, its webviews (Architecture,
  Workbench), the command palette, quick picks and notifications? Does it need a visible,
  unlocked desktop session?
- **Host.** Which Codex host fits: the app, the terminal, or the app with computer use? What do
  its sandbox and approval settings allow for `code` and `npm`?
- **Isolation.** Do `--user-data-dir` and `--extensions-dir` isolate completely from Julian's
  profile? Can the isolated window run next to Julian's own VS Code?
- **First run.** How is workspace trust handled, and the DataPass first-run walkthrough?
- **Evidence.** Where does Codex save screenshots, and can it attach them to a report?
- **Output.** QA-0 writes the working command lines, and what failed, into
  `handoff/briefs/2026-09-27-codex-procedure.md`. The ARCHI then corrects §4.3–4.5 and
  `common/testing/CODEX_PROCEDURE.md`.

## 5. Example client journeys (published in common as examples; Codex writes the real ones)

| Id | Client goal | Features |
|---|---|---|
| J01 | Open my project from its bridge URL and see my three repositories in one architecture | onboarding, workspace, architecture |
| J02 | Compare variants A, B and C, including monthly cost, and understand which is only for learning | variants, options, costs |
| J03 | Prepare the dev deployment of the publish function under variant C and hand it to an AI | architecture, readiness, evidence, work-orders, stamps |
| J04 | Ask my AI about the pipeline file with the right context, then apply its proposal safely | file-context, ai-exchange |
| J05 | See what my VM (Docker "VM" for variant B) needs and how DataPass knows it is not observed | resources, readiness, evidence |
| J06 | Find which of my repositories have changes, open PRs or failing CI | git |
| J07 | See whether my bridge files are correct, and understand each error | format-checks |
| J08 | Use DataPass with the fewest panels, then switch to the full view | modes |
| J09 | Keep an older version of a file and compare it | file-versions |
| J10 | Check which tools and MCP servers my project needs and what each one would send to a model | toolkit, mcp |

Julian's cadence: a full run is J01–J10, at most 2 h. A rerun is the journeys that failed.

## 6. Where the procedure lives: common, not auto

- **`datapass-vscode-common/testing/`** holds the testing material:
  - `CODEX_PROCEDURE.md`: the role (a client using DataPass, never editing DataPass, never touching
    the cloud or signing in), the setup (run root under `%TEMP%\datapass-qa\<run-id>`, never a
    drive root), `qa:prepare`, launching the isolated VS Code, walking journeys, the rule that each
    `not-reached` is retried once, the report and PR, and the limits;
  - `AUTO_FORMAT.md`: §4.1–4.2 in client terms;
  - `FEATURES.md`: the feature tags;
  - `JOURNEYS.md`: §5 as examples;
  - `REPORT_FORMAT.md`: §4.4.
- **The hub.** `datapass-vscode-hub/docs/OPERATING_MANUAL.md` has a short French paragraph that
  links to common/testing.
- **The auto repository** holds `datapass-auto.json`, `journeys/`, `fixtures/`, and a 3-line
  `AGENTS.md`: "Read https://github.com/julian-passebecq/datapass-vscode-common/tree/main/testing,
  then create or update the settings in this repository." Codex writes the journeys itself. QA-3
  adds only a minimal valid `datapass-auto.json` so `qa:prepare` can be tried.

## 7. The fake client: what the client AI prepares

The request is `codex-datapass-bridge/DATAPASS_ONBOARDING.md`, written as DataPass to an external
client (merged 2026-09-26):

- **Native code, three repositories:**
  - `wind-study-2d`: a toy blade-section and power model, a notebook with outputs, pytest, CI;
  - `wind-blade-3d`: a parametric mesh and a static viewer;
  - `wind-platform`: an ADF-like pipeline with a local runner, a Functions-style handler, a
    Databricks-like bundle, a Fabric-like item, Bicep/OpenTofu that is never applied, and a Docker
    Compose "VM".
- **The bridge:** manifest v5, graph 0.2, options with A/B/C and a `shared` and a `learning-only`
  cost line, sheet, board, extensions.
- **Feedback files:** `QUESTIONS.md` and `DELIVERY.md`.

## 8. Packages (ROADMAP V1 §1.3)

| Id | Package | Size · effort | Owned files | Acceptance |
|---|---|---|---|---|
| **QA-0** | Verify how Codex uses a VSIX (investigation, no product code) | S · medium | `handoff/briefs/2026-09-27-codex-procedure.md` | Every §4.6 question is answered with a source (official Codex docs: app, CLI, sandbox and approvals, desktop control on Windows) and, where possible, a real throwaway try on this PC: Codex installs the 0.25.0 VSIX into an isolated profile, opens `examples/v3/doc-pipeline`, clicks one view and takes a screenshot. The exact working command lines are recorded. |
| **QA-1** | Formats + `qa:prepare` | S–M · medium | `src/qa/**` (auto, journey and report parsers and validators), `scripts/qa/prepare.ts`, `tests/qa*.test.ts`, `tests/fixtures/qa/**`, the three schemas `datapass-auto-tests` / `datapass-client-journey` / `datapass-qa-report`, the `package.json` script `qa:prepare` only, `docs/guide/11_CODEX_TESTS.md` | Unit: the validators, including negatives (path escape, http remote, unknown feature tag, bad outcome, oversized fields). An integration test on a local fixture (the doc-pipeline example as bridge + 2 native folders with local bare "remotes", a VSIX built in CI) prepares a run root: VSIX installed in the isolated extensions dir, workspace file written, `run.json` valid, exit 0. A wrong remote gives exit 2 with a readable reason. |
| **QA-2** | The mode in DataPass | M · medium | `src/work/codexTests.ts`, the `qa-run` kind (additive enum), the Work orders view section, surface `ai.codexTests` in surfaces.ts/presets.json (add only), setting `datapass.codexTests.autoRepository` | Unit: the prompt is generated from the auto file; the receipt check works (stamp match). Desktop: the section lists journeys and the last report from a fixture audit folder; *Hand to Codex* writes a `qa-run` order (launcher stubbed); the section is hidden in Standard. Starts after QA-1 merges. |
| **QA-3** | Testing docs in common + skeletons | S–M · medium | `datapass-vscode-common/testing/**` (§6); `datapass-vscode-codex-auto`: 3-line AGENTS.md + a minimal `datapass-auto.json`; `datapass-codex-test`: README + `reports/` layout | Example journeys validate with QA-1's validator. After QA-0 reports, CODEX_PROCEDURE.md uses its verified commands. PRs to `main` of each repository; these are ours, so merge on green. |
| **HUB-1** | Hub and common seeds | S–M · medium (docs-writer) | `datapass-vscode-hub`: README (the §2 map, client registry: codex-wind-lab, foil), `docs/OPERATING_MANUAL.md` (French, with the Codex testing paragraph). `datapass-vscode-common`: VERSION; formats/, schemas/ and examples/ copied by `scripts/sync-common.ts` (in datapass-vscode, owned by HUB-1); knowledge/ (cloud features, MCP servers from K1/K2). `datapass-vs-code-archive` and `datapass-vscode-helper`: README. | The sync script is idempotent and copies only public files (no handoff/, no FOIL content). Links in common and in the onboarding brief resolve. |

**Order.** QA-0, QA-1 and HUB-1 start now in parallel (disjoint files). QA-3 starts now and
corrects the procedure when QA-0 reports. QA-2 follows QA-1. Codex's first real run needs QA-0's
verified procedure, QA-1, QA-3, the client's bridge and a 0.26.0 VSIX release asset.

## 9. Later, not V1

- **`codex-testvsix`: Codex tests the app itself** (Julian: "in the future"). This is a dev-mode
  battery runner on the Test API, deterministic, with declarative steps (probe / command / select
  / setPreview / copyContext / aiImport / writeOrder / wait), expectations (`equals`, `contains`,
  `exists`, `absent`, `count`, anchored `matches`, `noUnhandledErrors`), an allowlist of Test API
  probes and command ids, no shell, no network, and exit 0/1/2. The first draft of this document
  (PR #75, commit 1) holds the full step design; reuse it then.
- Real clients get their own auto repository.
- Claude Code as a second tester.
- Codex walks cloud journeys through the Pilot (read-only) on a real sandbox, after AI-4b.
