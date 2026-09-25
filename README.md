# DataPass VS Code — Project Workbench for AI-prepared cloud projects

DataPass VS Code is a **single VS Code extension** that sits between the AI assistant that prepares a
project in Git (ChatGPT, Claude), GitHub, the **official** VS Code extensions and CLIs (Fabric,
Databricks, Azure Functions, Azure Data Factory Studio, Cosmos DB, MongoDB, PostgreSQL/Neon, Power BI,
Grafana, OpenTofu/Terraform, Remote SSH) and you. It shows the architecture, which files each step
needs in which repository, what is missing and why, opens the right file or tool, and gets the AI's
merged work — without ever deploying, pushing or running project code.

## V3 (0.13.0, env readiness since 0.14.0): the Project Workbench

- **Project** view (left): sub-projects → components → expected files (found / missing / not cloned /
  to generate), repositories (cloned, not cloned, planned, commits to get), problems in the project
  files, and (0.14.0) **Local environment** / **Readiness**: which declared env files and variable
  names are set on this machine — never a value, always from your local vault (Power Ops).
- **Architecture** panel (bottom): the diagram of the selected sub-project; click a component.
- **AI exchange** (right, secondary side bar, 0.15.1): pick a DataPass file and what the AI should do,
  **Copy the file and instructions**, paste the AI's answer back: it is checked as you paste (which
  file, valid or not, about how many lines change, warnings), then **Show the diff and write**.
  When a DataPass project opens, this side bar shows DataPass instead of VS Code's Chat (once per
  workspace; Chat stays one click away; setting `datapass.layout.showInSecondarySideBar`).
- **Details** (right, under AI exchange): the component's files, what each step needs (read, develop,
  test, validate, deploy, run, publish) per environment, checklist and actions.
- **Workbench** tab: the overview of every sub-project and what it still needs on this machine.
- **Check for updates** (`git fetch`) and **Get updates** (fast-forward only, after listing the commits).
- **Prepare AI context**: a bounded pack for ChatGPT/Claude with the exact repository, folder and files.
- Several repositories per project, found by Git origin; **Clone**, **Locate**; a hub **catalog** of projects.

A project is described by `.datapass/project.json` (**manifest v4**, v3 still accepted) and
`.datapass/graph.json` (**graph 0.2**): see [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) and the examples in
[examples/v3](examples/v3/). Architecture and status: [handoff/V3_HANDOFF.md](handoff/V3_HANDOFF.md).

```json
{ "id": "extract", "kind": "function", "label": "PDF extraction", "provider": "azure-functions",
  "artifacts": { "repoRef": "pipeline", "root": "functions/extract", "profile": "azure-functions.python" },
  "operations": [ { "capability": "azure-functions.run-local" },
                  { "capability": "azure-functions.deploy", "environment": "dev", "target": { "functionApp": "func-papers-dev" } } ] }
```

## Board and DevOps (0.16.0)

- **Board** view (Workbench tab): `.datapass/board.json` is a kanban of tasks, bugs, features,
  decisions and questions, with sprints and milestones, that the AI keeps up to date and you move.
  Drag a card to another column (or `Shift+←` / `Shift+→`); filter by sub-project, sprint or type; a card
  panel links its components to the Architecture view, opens its files (or offers Clone/Locate), and
  opens its links after a confirmation. Moving a card writes only that card's status — every other
  byte of the file stays as it is — with a backup, and DataPass never commits or pushes it. **Prepare
  AI pack for this card** builds a bounded context (fix/implement/decide/answer/explain/plan) with a
  bug's error text scrubbed of credentials and local paths.
- **Git hosts**: DataPass recognises a GitHub, Azure DevOps or GitLab repository from its remote,
  including the address Azure DevOps' **Clone** button copies and its SSH form as the same
  repository, and opens each host's own pages (repository, pull/merge requests, pipelines/Actions,
  boards/issues) from **DataPass: Open a Repository on the Web…**.
- **CI profiles**: `github-actions`, `azure-pipelines` and `gitlab-ci` components open their pipeline
  files and, with "See the runs", the host's runs page (or the GitHub Actions extension's own view
  when it is installed).
- **Mongoku is frozen**: manifests DataPass prepares now set `"modules": { "mongoku": false }` —
  Mongoku reads `board.json` and `project.json` from GitHub on its own; DataPass never talks to it.

See [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) sections 10–11, and the examples in
[examples/v3/research-library](examples/v3/research-library/) (a board) and
[examples/v3/shop-platform](examples/v3/shop-platform/) (one repository per Git host).

## Architecture options and project sheet (0.15.0)

- **Options** view (Workbench tab): compares 2–3 alternatives per architecture decision (e.g. "Where
  do the PDFs live?"), each with its changes to the graph, declared criteria (text or a 1–5 score),
  pros, cons, consequences and cost lines (official source URL + date). DataPass computes the
  consequences itself — components added/removed/changed, official tools needed and whether they
  are installed, DataPass support level, repositories touched, sum of declared costs — it never
  picks an architecture for you. A **Scenarios** table compares whole architectures side by side,
  each with **Preview on diagram**, plus a **Build your own combination** picker per decision.
  **Record decision** writes `chosen`/`decidedOn`/`rationale` to `.datapass/options.json` (with a
  backup); the AI applies it later in a pull request.
- **Project sheet** view: datasets, formulas (shown exactly as the code computes them, with a link
  to the file), runtimes and a glossary, from `.datapass/sheet.json`. DataPass never computes a
  formula or counts rows itself.
- The architecture diagram toolbar adds orientation (horizontal/vertical), grouping into
  foldable lanes (sub-project, repository, cloud/service family, level), and a preview dropdown
  that marks components new/changed/removed for a scenario, without writing anything.
- An API-free JSON round trip with an AI assistant, in the **AI exchange** view (0.15.1) or with the
  commands **Copy a DataPass File for the AI…** and **Import the AI's Answer into a DataPass File…**:
  validate, diff, back up (`.datapass/local/backups/`) and refuse files containing credential-shaped
  text or local paths.

See [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) and the full example in
[examples/v3/research-library](examples/v3/research-library/).

## Tools, versions, the ID map and connections (0.18)

Manifest **v5** (`schemaVersion: 5`) lets a project say what it needs on a computer, and DataPass
compares it with the real one — without ever installing, signing in or deploying:

- **Tools & versions** (Project view, Workbench): `toolchain.tools[]` names each tool by id
  (`cli.fab`, `cli.az`, `ext.fabric`, `py.fabric-cicd`…) with an optional version range (`>=1.0`,
  `^2.60`, `>=0.1.20,<1`) and where it runs (`local`, `ci`, `fabric`). Each local tool shows *ok*,
  *outside the range*, *missing* or *version not read*; a click copies the install command for this
  platform (winget, Homebrew, pip, `code --install-extension`) or opens the extension's page. A
  version outside its range is a warning on the operations that use the tool, never on reading.
- **`.vscode/extensions.json`** is compared with the toolchain's extensions; *Show Recommended
  Extensions* opens VS Code's own list. DataPass never writes the file.
- **The ID map**: `identifiers[]` can hold one id per environment (`values: { dev, prod }`) and a
  `kind` (tenant, subscription, workspace…). Copying asks which environment; hovering a GUID in any
  file, or *DataPass: Look Up an Id…*, says which identifier and environment it is. A secret-looking
  value is refused in every environment.
- **Connections**: sign-ins (`cli.az`, `cli.databricks`, `cli.fab`) are checked read-only on
  request — **Check connections** runs `az account show`, `databricks auth profiles` and
  `fab auth status` from your home folder, with no prompt, and compares tenant and subscription with
  the ID map; DataPass never opens credential files and never passes a manifest value to a CLI.
  Git bindings and cloud connections are "declared, not checked", with the portal page where you
  verify them. The sign-in command is copied for you to run.
- AI packs (preparation pack, Copy AI context, card packs) carry the toolchain state, the ID map as
  logical ids and the connection states — names and states only.

*DataPass: Upgrade Project Manifest* moves a v4 file to v5 with a backup. Contract:
[docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) section 12; example:
[examples/v3/sales-bi](examples/v3/sales-bi/); design:
[handoff/v3/08_TOOLKIT_AND_AGENTS.md](handoff/v3/08_TOOLKIT_AND_AGENTS.md).

## Company windows and work views (0.17)

Julian's mapping: **1 VS Code window = 1 company**. **DataPass: Create the Company Workspace File
(one window per company)…** writes a multi-root `.code-workspace` from this window's DataPass
projects: their repositories found on this computer (folders relative to the file whenever
possible), a title-bar colour, and an optional startup work view.

A **work view** is a named saved layout of the main window — selected sub-project/component,
editor grid and open files per group, the Workbench tab (or floating), which DataPass views are
shown, diagram settings, previewed architecture — kept in `.datapass/local/views.json` (machine-local,
never committed). **Save Work View…** captures the current layout; **Apply Work View…** restores it
in one call (closing only unmodified, unpinned tabs; a missing file or repository becomes a note,
never an error). The status-bar switcher (`$(briefcase) <Company> · <Sub-project> ▾`) applies a
work view in one click, switches sub-project or project, opens the Workbench in a floating window
(for a second screen), and creates the company workspace file or exports it for Power Ops.

A `.code-workspace` file can set `datapass.startupView`: DataPass applies that work view once the
project has loaded (a launcher's request wins over it). **Export Company Workspaces for Power
Ops** writes a machine-local, secret-free JSON of company workspace files and their work views to
`%LOCALAPPDATA%\DataPass\company-workspaces.json` (or the platform equivalent), so a launcher such
as Power Ops (PowerToy_UI) can open a company or a specific work view; see
[handoff/v3/07_WINDOWS_AND_POWER_OPS.md](handoff/v3/07_WINDOWS_AND_POWER_OPS.md) for the full
contract.

## Earlier surfaces (still available)

- **Galaxy** — health-first control plane with readiness metrics, attention queue, grouped/collapsible platform cards, filters, persistent view state, and a sanitized environment snapshot for debugging/handoffs.
- **Projects** — portable `.datapass/project.json` manifests with JSON-schema validation; FOIL remains profile #1.
- **Microsoft Fabric** — detects Microsoft Fabric VS Code, Fabric Studio, OneLake-VSCode, Fabric CLI and operational prerequisites; renders a curated Fabric Toolbox gallery, guided Assessment/MCP workflows, read-only environment capture, and review-first CI/CD scaffolding.
- **Databricks** — detects the official Databricks extension, CLI and Asset Bundle projects; provides safe Bundle command generation.
- **Power BI** — detects PBIP/TMDL/PBIR source projects and GitHub Copilot CLI; exposes focused agentic modules while keeping specialized editors external.
- **Observability / Grafana** — treats dashboards as code with `gcx`, Foundation SDK and OpenTofu/Terraform deployment paths.
- **Infrastructure** — detects OpenTofu/Terraform, Docker, Kubernetes, SSH and peer extensions without replacing them.

## Architecture rule

One VSIX first. Platform code is separated internally into adapters so a domain can be packaged independently later only if a real distribution, runtime, security or lifecycle boundary appears.

## Work view (v0.9, V2.2)

The **Work** view answers, for one selected scope: what are we trying to do, what is next,
which operations are ready (and why not), which outputs a change makes stale, and which
exchanges with external apps are pending. Readiness is evaluated per operation — e.g.
*develop a Fabric notebook locally* needs Fabric Data Engineering, Jupyter and a JDK — and
"ready" means prerequisites are present, not that the operation will succeed.

Declare scopes, apps and domain packs in a schemaVersion 2 manifest
(`DataPass: Upgrade Project Manifest to v2` migrates with a backup):

```json
{
  "schemaVersion": 2,
  "project": { "id": "retail-bi", "title": "Retail BI" },
  "repositories": { "site": { "remote": { "url": "https://github.com/example/site", "branch": "main" }, "management": "remote-only" } },
  "apps": [{ "id": "forecast-app", "appType": "streamlit", "repoRef": "site" }],
  "domainPacks": ["builtin:sample.retail"],
  "scopes": [{
    "id": "weekly", "title": "Weekly forecast", "objective": "Publish the weekly forecast",
    "checklist": [{ "id": "nb", "label": "Update notebook", "capabilityRef": "fabric.notebook.edit-local-sync" }]
  }]
}
```

External apps and AI tools exchange **contracted envelopes** (`schemas/contracts/`): DataPass
freezes a request, correlates the returned result against the exact request bytes and stages
it as a candidate or quarantines it. Nothing is applied automatically, and private exchange
history stays in `.datapass/local/` (git-ignored). See `IMPLEMENTATION_STATUS.md` for what is
implemented, documented-only and qualified.

## Modules per project (v0.10)

Each project chooses the parts of DataPass it uses. Run **DataPass: Choose Project Modules…** (or
click the *modules* row in the Work view) and tick what the project needs; DataPass writes:

```json
{ "modules": { "fabric": true, "databricks": true, "powerbi": false, "grafana": false,
               "infrastructure": true, "airflow": false, "mongoku": false, "diagramcloud": false } }
```

A module set to `false` disappears from Galaxy, the Work view and Links; unlisted modules stay on,
and a manifest without `modules` shows everything as before. Fabric, Databricks, Infrastructure,
Airflow, Power BI and Grafana are the cloud core; Mongoku and DiagramCloud are optional add-ons.

## Assets and repositories (v0.11)

The Work view lists what the project folder contains, without running anything: **Assets**
(notebooks, Fabric items in Git format, Databricks bundles and notebooks, Airflow DAG files,
Data Factory pipelines, Power BI projects), each opening in its native editor, and
**Repositories** (branch, commit, uncommitted changes, ahead/behind as of your last fetch; remote-only
repositories are never contacted or cloned).

## Shared resources (v0.10.1)

Declare a machine once and say how each workload uses it. One VM can serve two scopes:

```json
{
  "resources": [{ "id": "oracle-vm", "kind": "vm", "title": "Oracle VM", "provider": "oci", "ssh": { "host": "my-oracle" } }],
  "bindings": [
    { "id": "wind", "resource": "oracle-vm", "scopes": ["wind"], "folder": "/opt/foil/wind", "compose": "docker-compose.yml", "env": ["MQTT_URL"] },
    { "id": "hydro", "resource": "oracle-vm", "scopes": ["hydro"], "folder": "/opt/foil/hydro" }
  ]
}
```

The Work view's **Resources** section shows the selected scope's binding and warns when the host is
shared ("host-level changes affect all"). Click the folder to open it on the VM over Remote - SSH.
`ssh.host` is an alias from your `~/.ssh/config`; env lists **names** only; no credentials anywhere.

## Links: Grafana, Mongoku and DiagramCloud (v0.9.3, all optional)

When configured, the Work view shows a **Links** section for the selected scope:

- **Grafana** — your stack's home, Explore and the dashboards declared for this scope, plus each
  dashboard's as-code source file. The Galaxy Observability card gets **Open Grafana**.
- **Mongoku** — **Open in Mongoku** (Mongoku's own `/?project=<entity>` page) and the last
  **imported Mongoku context**: status, test gate, stop point, next action and the listed work
  items, always labelled with its age and "not live".
- **DiagramCloud** — when `.datapass/diagramcloud.json` exists: open it in DiagramCloud, copy a
  bounded AI context, import a reviewed AI plan (Work view **…** menu).

```json
{
  "platforms": {
    "grafana": {
      "url": "https://your-stack.grafana.net/",
      "dashboards": [{ "uid": "weekly-1", "title": "Weekly metrics", "scopes": ["weekly"], "source": "grafana/weekly.ts" }]
    }
  },
  "companions": { "mongoku": { "entityId": "retail_bi", "scopeEntities": { "hydro": "retail_hydro" } } }
}
```

Addresses of apps that serve every project are **user settings**, not manifest fields:
`datapass.mongoku.url` (e.g. `http://localhost:3100/`) and `datapass.diagramCloud.url`. DataPass
asks for them the first time. To bring Mongoku context in: in Mongoku, open the project →
**Developer context** → **JSON** → **Copy**, then run **DataPass: Import Mongoku Context…**.
Mongoku (or any page) can open `vscode://julian-passebecq.datapass-vscode/open?entity=<id>` to
select the scope mapped to that entity; the link can do nothing else.

Every link shows its exact address once per window before opening and is re-checked afterwards;
a destination that changed meanwhile is refused. A link is navigation only: DataPass never
checks sign-in, datasource reachability or data freshness, makes no HTTP request and holds no
credential.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

Press **F5** with the included `Run DataPass Extension` launch configuration to open an Extension Development Host.

### Desktop acceptance tests

```bash
npm run test:desktop
```

This launches real VS Code (installed, or a downloaded stable build) with a throwaway profile
against generated fixture workspaces, and writes evidence to `out/integration/`. Add
`-- --real-extensions` to also load your installed extensions and record what DataPass detects
on your machine. Your settings, state, open windows and clipboard are not touched.

After a desktop run, `npm run preview:galaxy` writes the real Galaxy panel, filled with the
state captured in VS Code, to `out/preview/galaxy-{dark,light,hc}.html` for a visual check.

## Package locally

```bash
npm run package
```

This produces a `.vsix`. Marketplace publication is not required; install it through **Extensions → … → Install from VSIX…**.

## Portable project manifest

Initialize from the Command Palette:

- **DataPass: Initialize Project Manifest**
- **DataPass: Initialize FOIL Project Manifest**
- **DataPass: Open Project Manifest**

The generated file is:

```text
.datapass/project.json
```

Example:

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "foil",
    "title": "FOIL",
    "profile": "foil"
  },
  "repositories": {
    "control": {
      "path": "../foil-control-v1",
      "label": "FOIL control"
    },
    "databricks": {
      "path": "../foil_databrick_dab",
      "label": "FOIL Databricks"
    }
  },
  "platforms": {
    "fabric": {},
    "databricks": {
      "bundleRoot": "../foil_databrick_dab"
    },
    "grafana": {},
    "infrastructure": {},
    "oracle": {}
  },
  "links": []
}
```

Paths may be relative to the opened workspace. The manifest is intended for Git and **must not contain credentials, tokens, passwords or client secrets**.

Local VS Code settings remain valid overrides for machine-specific paths or commands.

## FOIL pilot

The FOIL template intentionally does **not** invent:

- a Fabric workspace ID;
- an Oracle host;
- cloud credentials;
- Grafana runtime identities.

Those remain unknown until supplied by real project/runtime configuration.

Legacy local overrides still work:

- `datapass.foil.controlRoot`
- `datapass.foil.databricksRoot`
- `datapass.foil.oracleSshHost`

FOIL authoritative engineering/project state remains in existing FOIL authorities and repositories.

## Fabric Toolbox

The Galaxy currently curates verified assets from `microsoft/fabric-toolbox`, including:

- Fabric Cost Analysis
- Fabric Platform Monitoring
- Fabric Unified Admin Monitoring
- Fabric Spark Monitoring
- Fabric Security Audit
- Fabric Assessment Tool
- Semantic Model MCP Server
- Microsoft Fabric Management MCP Server
- DAX Performance Tuner MCP Server
- Real-Time Intelligence Eventstream accelerator
- CI/CD branch/workspace accelerator
- CI/CD deployment-pipeline accelerator

The catalog records the upstream commit used for verification. DataPass does not vendor the Toolbox wholesale.

### Action boundary

- **Open** — opens the upstream asset documentation/source.
- **Clone** — copies a safe `git clone` command for the upstream repository.
- **Configure** — opens a local upstream configuration/readme if a Toolbox clone is configured, otherwise upstream setup docs.
- **Run** — currently automated only for the guarded Fabric Security Audit path.
- **Scaffold / Deploy** — shown when upstream supports the concept but intentionally disabled until DataPass has a tested, explicit workflow.

For **Fabric Security Audit**:

1. configure `datapass.fabric.toolboxRoot` or `platforms.fabric.toolboxRoot` in the project manifest;
2. click **Run** under Fabric Security Audit;
3. supply a full HTTPS Fabric/Power BI URL;
4. choose **Run** or **Copy command**.

No credentials are stored by DataPass.

## Databricks project routing

DataPass resolves a Databricks Bundle root in this order:

1. project manifest `repositories.databricks`;
2. project manifest `platforms.databricks.bundleRoot`;
3. legacy FOIL local binding;
4. a Bundle manifest discovered in the current workspace.

The official Databricks extension remains the primary Databricks client.

## Grafana as code

Configure either VS Code settings or the project manifest:

```json
{
  "platforms": {
    "grafana": {
      "generatorCommand": "npm run generate:grafana",
      "watchPath": "src/grafana"
    }
  }
}
```

The Galaxy generates a `gcx dev serve` preview command while keeping dashboard source in Git.
Declaring `platforms.grafana.url` (see *Links* above) also names the target stack for the
*Configure Grafana datasources/alerts as code* preflight. Grafana Git Sync covers dashboards and
folders only; datasources and alert rules need their own qualified path (gcx or IaC).

## Safety

- no cloud credentials are persisted by DataPass;
- vendor authentication remains vendor-owned;
- mutating cloud/IaC commands are explicit user actions;
- deploy/plan flows are generally copied instead of silently executed;
- missing extensions/CLIs degrade to actionable Missing/Partial states rather than activation failure;
- project manifests are schema-validated and intentionally exclude secret fields.

See `handoff/` for the architecture lock and acceptance criteria, and `IMPLEMENTATION_STATUS.md` for the current build state.

## Fabric Assessment Tool

When the upstream `fat` CLI is installed, **Fabric Assessment Tool → Run** provides a guided command builder.

DataPass asks only for non-secret execution context:

- source: Synapse or Databricks;
- Databricks cloud: Azure or AWS;
- optional workspace name;
- output directory.

It then offers **Run** or **Copy command**. Authentication remains entirely with the upstream tool (Azure CLI, Fabric notebook context, Databricks environment configuration, etc.).

## Fabric / Power BI MCP tools

With a local Microsoft Fabric Toolbox clone configured, the Galaxy can add supported upstream MCP servers to the active workspace's `.vscode/mcp.json`:

- Semantic Model MCP Server;
- Microsoft Fabric Management MCP Server;
- DAX Performance Tuner MCP Server.

DataPass does **not** build these servers for you and does not collect MCP credentials. It verifies the expected upstream executable first. If setup has not been completed, it routes you to the upstream setup instructions instead.

Existing workspace MCP servers are preserved. Replacing an existing server with the same name requires explicit confirmation.

## Official Fabric CLI navigation

When `fab` is installed, the Fabric card exposes:

- **Auth status** — runs `fab auth status`;
- **Login** — runs the official interactive `fab auth login`;
- **List workspaces** — runs `fab ls`;
- **Project workspace** — runs `fab ls "<workspace>.Workspace" -l` using `platforms.fabric.workspaceName` from the DataPass project manifest.

DataPass does not request or persist Fabric CLI credentials. Pass 4 intentionally avoids Fabric CLI mutation commands.

## Sanitized environment snapshot

Use **Copy environment snapshot** in the project card or **DataPass: Copy Environment Snapshot** from the Command Palette.

The exported JSON contains project/platform capability state and detected tool versions, but deliberately excludes local repository paths, binding values, generated commands, tool detail strings and credentials. It is intended for troubleshooting and handoffs, not as a source of project truth.

## Fabric environment summary

With a verified `platforms.fabric.workspaceName`, DataPass can capture workspace metadata and the detailed workspace item listing into a local VS Code Output channel.

Only the official read-only commands `fab get` and `fab ls -l` are used.

## Fabric deployment configuration

Optional project-manifest settings:

```json
{
  "platforms": {
    "fabric": {
      "workspaceName": "Verified workspace name",
      "deployment": {
        "configPath": ".deploy/fabric.yml",
        "repositoryDirectory": ".",
        "targetEnvironment": "dev"
      }
    }
  }
}
```

**Scaffold deploy config** creates a fabric-cicd-compatible YAML with orphan removal disabled:

```yaml
publish:
  skip: false

unpublish:
  skip: true
```

**Copy deploy command** copies the corresponding `fab deploy` command. DataPass does not execute it and does not add `--force` or experimental bulk-publish options.

## Fabric CI preflight

**Scaffold CI preflight** creates a manual-only GitHub Actions workflow using Azure OIDC and `ms-fabric-cli`.

The workflow validates:

- authentication;
- access to the configured Fabric workspace;
- workspace item listing;
- presence of the generated deployment config.

It contains no deployment step. This keeps CI readiness separate from cloud mutation until the real environment has been validated.

## Power BI agentic engineering

The Power BI card detects PBIP, TMDL and PBIR source plus GitHub Copilot CLI.

DataPass lists the 11 plugins of the `data-goblin/power-bi-agentic-development` marketplace (read
from its `marketplace.json` on 2026-09-25), which serves both **Claude Code** and **GitHub Copilot
CLI**: goblin-mode, tabular-editor, pbi-desktop, pbip, semantic-models, reports, paginated-reports,
fabric-cli, fabric-admin, custom-visuals and etl.

**Copy marketplace add** and each plugin's **Copy install** actions (one for Copilot CLI, one for
Claude Code) only place the documented command on the clipboard (`copilot plugin …` /
`claude plugin …`). DataPass does not install plugins because their scope is user-wide. On Windows,
enable long paths first: some TMDL paths in that repository are longer than 260 characters.

The MacGyver toolbox remains a visual/reference resource; Power BI Desktop, Tabular Editor and other specialized tools remain external peer applications.

## Galaxy health UX

The Galaxy now prioritizes **what needs attention** before low-level tool detail.

At a glance it shows:

- platform readiness;
- detected tools;
- project bindings;
- actionable attention items.

Platforms are grouped into **Data platforms** and **Engineering & runtime** and can be filtered by **All / Ready / Partial / Attention**. Tool lists and upstream catalogs stay collapsed until needed.

The extension deliberately uses status categories rather than an opaque numeric health score.

Galaxy filter and expanded-card state are retained by the VS Code webview while the view is alive.

The VS Code status bar uses the same health summary and links back to the Galaxy.
