# Source Map and Donor Boundaries

Use this file to avoid rediscovering old experiments.

## Architecture authority

### dataprojects
https://github.com/julian-passebecq/dataprojects

Pinned reference: `1e9cab12c9a966202ffe07c435123ee0268fc001`

Read:
- `registry/vscode-control-plane.json`
- `registry/vscode-tool-catalog.json`
- `registry/tooling.json`
- `registry/repo-cartography.json`

Use for global product/tool boundaries.

## Strong donor: Fabric VS Code prototype

https://github.com/julian-passebecq/fabricdatapasstoolbox

Use branch: `codex/initial-vscode-companion`

Pinned head: `82cfb48f59a59d4db89f1072a07575a2865bd3b9`

High-value files:
- `src/fabricIntegration.ts`
- `src/toolboxCatalog.ts`
- `src/toolboxPanel.ts`
- `src/toolRunners.ts`
- `src/fabricMgmtCommands.ts`
- `src/projectModel.ts`
- `src/projectState.ts`
- `src/projectTemplates.ts`
- `src/resourceCapture.ts`
- `webview/App.tsx`
- `tests/*`
- `.github/workflows/ci.yml`

Decision: **reuse/adapt**. Do not preserve it as a second Fabric-extension product.

Ignore `codex/v0-vscode-toolbox`; it is an empty initial branch.

## Strong donor: FOIL lightweight VS Code control

https://github.com/julian-passebecq/foil-ai-extension

Pinned main: `4a7c7f09d1f3dc651ba929d49d746a0a8d1246dd`

Useful:
- `src/extension.ts`
- `src/controlStore.ts`
- `src/tree.ts`
- `src/types.ts`
- `package.json`
- CI workflow

Decision: reuse generic patterns; convert FOIL-specific behavior into profile #1.

## Databricks reference experiment — do not copy vendor code

https://github.com/julian-passebecq/databricks-vscode-foil

Reference branch: `foil-lab-mvp`

Pinned head: `6dcd49a4d2d592e2d8792c3e539039de16e1a70a`

Use only to inspect previous FOIL experiment, official extension command contribution names, and workflow ideas.

Do **not** copy/repackage Databricks source into DataPass VS Code. The previous VSIX declares the official `databricks.databricks` identity and conflicts with the Marketplace extension.

FOIL execution repository:
https://github.com/julian-passebecq/foil_databrick_dab
Pinned main: `24c821a43168b21cf903b6ee7f39d461eef7617a`

## Power BI donors/references

PbiBench:
https://github.com/julian-passebecq/powerbi_enhanced_dev
Pinned main: `d75b7ab9df5bd5289a205390111237481cb4e84e`

Use as feature/reference source. Do not make the C# desktop shell the global control plane.

TabularEditor_J:
https://github.com/julian-passebecq/TabularEditor_J
Reference branch: `pbi-workflow-pro-v0.2`
Pinned head: `a7317e7ff1bbdb8949b7e6d82b6277b6e22300de`

Keep advanced semantic-model editing specialized/external unless a small source-level integration belongs in VS Code.

## Fabric ecosystem references

Use directly / compose; do not fork by default:

- Microsoft Fabric VS Code extension
- https://github.com/gbrueckl/FabricStudio
- https://github.com/gbrueckl/OneLake-VSCode
- https://github.com/microsoft/fabric-toolbox
- https://github.com/microsoft/fabric-cicd
- https://github.com/microsoft/fabric-extensibility-toolkit
- https://github.com/gbrueckl/Fabric.Toolbox
- https://github.com/gbrueckl/fabric-cicd

Local fork/history:
https://github.com/julian-passebecq/fabric-toolbox_J

## Power BI agentic/reference ecosystem

- https://github.com/data-goblin/power-bi-agentic-development
- https://github.com/data-goblin/powerbi-macguyver-toolbox

Optional companions/reference catalogs, not code to repackage wholesale.

## Databricks automation reference

https://github.com/gbrueckl/Databricks.API.PowerShell

Optional admin/automation provider; not the primary Databricks UI/client.

## Grafana / observability

- https://github.com/grafana/grafana-foundation-sdk
- https://github.com/grafana/terraform-provider-grafana

Current architecture uses `gcx` as the Grafana CLI path and Foundation SDK for dashboards-as-code.

## Licensing discipline

For every reused source file:

- preserve license/notice requirements;
- record donor path and commit in `IMPLEMENTATION_STATUS.md`;
- prefer reimplementation against public extension commands/CLI interfaces when vendor-source licensing is restrictive;
- never mix vendor-fork code into this project merely because it is technically accessible.
