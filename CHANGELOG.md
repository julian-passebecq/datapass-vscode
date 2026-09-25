# Changelog

DataPass Control Plane (VS Code extension). Detail per pass: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md);
status and next steps: [handoff/V3_HANDOFF.md](handoff/V3_HANDOFF.md).

## 0.18.0 — toolchain, ID map, connections (2026-09-25)

Manifest **v5** (`schemaVersion: 5`). Design: [handoff/v3/08_TOOLKIT_AND_AGENTS.md](handoff/v3/08_TOOLKIT_AND_AGENTS.md)
sections 5.3 and 8; contract: [docs/PREPARING_A_PROJECT.md](docs/PREPARING_A_PROJECT.md) section 12.

- **Toolchain**: `toolchain.tools[]` (tool id, optional version range, `optional`, `where`: local, ci,
  fabric). New **Tools & versions** section in the Project view and the Workbench: each local tool
  is compared with this computer's probe (ok, outside the range, missing, version not read); CI,
  Fabric-notebook, desktop-app and Python-library tools are shown, not checked. Install commands
  (winget, Homebrew, pip, `code --install-extension`) are copied, never run. Unknown ids run nothing
  and get a "did you mean". A version outside its range is a warning on the operations that use the
  tool, never a blocker and never on reading.
- **`.vscode/extensions.json`** compared with the toolchain's extensions; *Show Recommended
  Extensions* opens VS Code's own list. DataPass never writes the file or installs anything.
- **ID map**: identifiers get `values` (one id per declared environment) and `kind`; every value
  follows the no-secret rules (the error names the environment, never the value). *Copy Identifier*
  asks which environment; a hover on any declared id in any file, and *DataPass: Look Up an Id…*,
  say which identifier and environment it is.
- **Connections**: `connections[]` of kind `sign-in`, `git-binding` or `cloud-connection`. New
  **Connections** section and *DataPass: Check Connections*: read-only, no prompt, only when asked —
  `az account show` (tenant and subscription compared with the ID map), `databricks auth profiles`
  (profile exists and is valid), `fab auth status` (signed in, tenant). Fixed commands run from the
  home folder with stdin closed and a timeout; no manifest value is ever an argument; credential
  files are never opened; the CLIs' output is reduced to a few fields (the account name and masked
  token prefixes are dropped). Bindings DataPass cannot observe are "declared, not checked", with the
  portal page to verify them. Sign-in commands are copied for the person to run.
- **AI packs** (preparation pack, Copy AI context, card packs), the environment snapshot and the
  readiness report carry the toolchain state, the ID map as logical ids and the connection states —
  names and states only.
- **Upgrade Project Manifest** moves v1–v4 to v5 with a backup copy (a v4 file only changes version).
- **Tool registry**: install hints for every CLI (winget ids checked with `winget show`), Power BI
  Studio, the Power BI extension pack and the Power BI Modeling MCP server added; probes now store
  the version number (`az version`'s JSON no longer shows as "{").
- **Power BI agentic plugins**: the 11 plugins of `data-goblin/power-bi-agentic-development`
  (custom-visuals, etl, fabric-admin, fabric-cli, goblin-mode, paginated-reports, pbi-desktop, pbip,
  reports, semantic-models, tabular-editor), with install commands for Copilot CLI and Claude Code.
- New example `examples/v3/sales-bi` (Fabric + Power BI, fabric-cicd, manifest v5).

## 0.17.0 — windows and work views

Company workspace file (one window per company), work views (save / apply), status-bar switcher,
`datapass.startupView`, floating Workbench, the Power Ops launcher list. PR #25.

## 0.16.0 — work and DevOps

`.datapass/board.json` and the Board (kanban) view, Azure DevOps / GitHub / GitLab address forms and
web pages, CI profiles, Mongoku frozen. PR #24.

## 0.15.1

AI exchange view in the secondary side bar, shown instead of Chat when a DataPass project opens. PR #23.

## 0.15.0 — architecture options and project sheet

`options.json` (compare, preview, record a decision), `sheet.json`, diagram orientation / lanes /
folding, JSON exchange with an AI (validated import, diff, backups), `vm` and `docker` providers. PR #22.

## 0.14.0 — environment readiness

Manifest v4 (`localEnv`, `identifiers`): Local environment and Readiness sections, names and states
only, *Open Power Ops*. PR #21.

## 0.13.1

No `$schema` line in prepared `.datapass/*.json`; DataPass explains an existing one. PR #19.

## 0.13.0 — V3 pass 1: the Project Workbench

Trust fixes from the 2026-09-25 audit, manifest v3 / graph 0.2, repository and file resolution,
Project tree, Architecture panel, Details, Workbench tab, Git update loop, preparation pack, catalog.
PR #18.

Earlier passes (0.8–0.12): see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
