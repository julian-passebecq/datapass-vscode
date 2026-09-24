# DataPass VS Code — Data Platform Control Plane

DataPass VS Code is a **single VS Code control-plane extension** for composing existing data-platform tools around project context. It does not fork or replace Microsoft Fabric, Databricks, Grafana, OpenTofu/Terraform, Power BI tooling, Remote SSH, Docker or Kubernetes.

## Current surfaces

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

DataPass exposes focused modules from `data-goblin/power-bi-agentic-development`:

- PBIP
- Semantic models
- Reports
- Power BI Desktop
- Tabular Editor
- Fabric CLI

**Copy marketplace add** and each module's **Copy install** action only place the documented Copilot CLI command on the clipboard. DataPass does not install plugins automatically because Copilot CLI plugin scope is user-wide.

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
