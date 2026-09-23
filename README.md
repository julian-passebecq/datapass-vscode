# DataPass VS Code — Data Platform Control Plane

DataPass VS Code is a **single VS Code control-plane extension** for composing existing data-platform tools around project context. It does not fork or replace Microsoft Fabric, Databricks, Grafana, OpenTofu/Terraform, Power BI tooling, Remote SSH, Docker or Kubernetes.

## Pass 1 surfaces

- **Galaxy** — one status/control view for projects and platforms.
- **Microsoft Fabric** — detects Microsoft Fabric VS Code, Fabric Studio, OneLake-VSCode and Fabric CLI; exposes a curated, manifest-driven Fabric Toolbox catalog and guarded upstream Security Audit action.
- **Databricks** — detects the official Databricks extension, CLI and Asset Bundle projects; provides safe Bundle command generation.
- **Power BI** — detects PBIP/TMDL/PBIR source projects and links specialized/agentic tooling.
- **Observability / Grafana** — treats dashboards as code with `gcx`, Foundation SDK and OpenTofu/Terraform deployment paths.
- **Infrastructure** — detects OpenTofu/Terraform, Docker, Kubernetes, SSH and peer extensions without replacing them.
- **Projects** — generic profile boundary with **FOIL** as profile #1.

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

## FOIL pilot

Use:

- `datapass.foil.controlRoot`
- `datapass.foil.databricksRoot`
- `datapass.foil.oracleSshHost`

The extension never treats these local bindings as engineering truth. FOIL authoritative state remains in the existing FOIL project authorities and repositories.

## Fabric Toolbox

Set `datapass.fabric.toolboxRoot` to a local clone of `microsoft/fabric-toolbox` or the tracked local fork. DataPass does not vendor the Toolbox wholesale; it reads a curated catalog and launches upstream assets where appropriate.

The first guarded execution path is **Fabric Security Audit**:

1. configure the local Toolbox root;
2. click **Security audit**;
3. supply a full HTTPS Fabric/Power BI URL;
4. choose **Run** or **Copy command**.

No credentials are stored by DataPass.

## Grafana as code

Configure `datapass.grafana.generatorCommand` and optionally `datapass.grafana.watchPath`. The Galaxy can generate a `gcx dev serve` preview command while keeping dashboard source in Git.

## Safety

- no cloud credentials are persisted by DataPass;
- vendor authentication remains vendor-owned;
- mutating cloud/IaC commands are explicit user actions;
- Pass 1 generally **copies** deploy/plan commands instead of silently executing them;
- missing extensions/CLIs degrade to actionable Missing/Partial states rather than activation failure.

See `handoff/` for the architecture lock and acceptance criteria, and `IMPLEMENTATION_STATUS.md` for the current build state.
