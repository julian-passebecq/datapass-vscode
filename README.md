# DataPass VS Code — Data Platform Control Plane

DataPass VS Code is a **single VS Code control-plane extension** for composing existing data-platform tools around project context. It does not fork or replace Microsoft Fabric, Databricks, Grafana, OpenTofu/Terraform, Power BI tooling, Remote SSH, Docker or Kubernetes.

## Current surfaces

- **Galaxy** — one status/control view for projects and platforms.
- **Projects** — portable `.datapass/project.json` manifests with JSON-schema validation; FOIL remains profile #1.
- **Microsoft Fabric** — detects Microsoft Fabric VS Code, Fabric Studio, OneLake-VSCode, Fabric CLI and operational prerequisites; renders a curated Fabric Toolbox gallery with verified upstream provenance, a guided Assessment Tool workflow, and workspace MCP configuration.
- **Databricks** — detects the official Databricks extension, CLI and Asset Bundle projects; provides safe Bundle command generation.
- **Power BI** — detects PBIP/TMDL/PBIR source projects and links specialized/agentic tooling.
- **Observability / Grafana** — treats dashboards as code with `gcx`, Foundation SDK and OpenTofu/Terraform deployment paths.
- **Infrastructure** — detects OpenTofu/Terraform, Docker, Kubernetes, SSH and peer extensions without replacing them.

## Architecture rule

One VSIX first. Platform code is separated internally into adapters so a domain can be packaged independently later only if a real distribution, runtime, security or lifecycle boundary appears.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

Press **F5** with the included `Run DataPass Extension` launch configuration to open an Extension Development Host.

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
