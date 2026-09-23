# PRO MASTER PROMPT — DataPass VS Code Pass 1

## Mission

Implement the first working version of **DataPass VS Code — Data Platform Control Plane**.

Do not stop at a plan, architecture proposal, screenshots, pseudo-code or scaffolding-only result. Produce a runnable VS Code extension, tests, build scripts, CI configuration, documentation, and a packaged VSIX.

You have GitHub read access but may not have GitHub write access. Work in the provided repository working tree / handoff folder and return the complete implemented repository as a ZIP. Do not wait for GitHub write permission.

## Read order

1. `handoff/ARCHITECTURE_LOCK.md`
2. `handoff/SOURCE_MAP.md`
3. `handoff/PASS1_ACCEPTANCE.md`
4. `julian-passebecq/dataprojects/registry/vscode-control-plane.json`
5. `julian-passebecq/dataprojects/registry/vscode-tool-catalog.json`
6. Inspect donor repositories listed in SOURCE_MAP only as needed.

The architecture is already decided. Do not redesign the product before completing Pass 1.

## Required Pass 1 outcome

Create one VS Code extension with a DataPass Activity Bar container and a polished **Galaxy / Control Plane** home surface.

The first pass must visibly expose:

- Overview / Galaxy
- Projects
- Microsoft Fabric
- Databricks
- Power BI
- Observability / Grafana
- Infrastructure
- FOIL pilot profile

Each platform adapter must distinguish:

- detected VS Code peer extensions;
- detected CLI/tool availability;
- project bindings;
- safe actions available now;
- unavailable/not-configured capabilities.

Missing tools must show a useful state and installation/documentation action; they must not break activation.

## Implementation strategy

Use TypeScript and the VS Code Extension API.

Prefer a single npm package for Pass 1 with clean module boundaries instead of premature workspace/monorepo complexity. Keep the source separable so adapters can become packages later without redesign.

Recommended structure:

```text
src/
  extension.ts
  core/
    commands/
    detection/
    registry/
    projects/
    status/
  adapters/
    fabric/
    databricks/
    powerbi/
    observability/
    infrastructure/
  profiles/
    foil/
  views/
    galaxy/
    platform/
schemas/
tests/
resources/
.github/workflows/
```

A webview is appropriate for the Galaxy/home dashboard. Use VS Code theme variables; do not build a separate web application or backend.

## Reuse before rewrite

### Fabric donor — high priority

Read:

`julian-passebecq/fabricdatapasstoolbox@82cfb48f59a59d4db89f1072a07575a2865bd3b9`

Branch: `codex/initial-vscode-companion`

This is the strongest existing donor. Reuse/adapt concepts and MIT-licensed code where appropriate from:

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

Do **not** preserve its old product boundary. Fold useful capabilities into the new generic Fabric adapter and generic project/profile model.

Ignore the empty historical branch `codex/v0-vscode-toolbox`.

### FOIL VS Code donor

Read:

`julian-passebecq/foil-ai-extension@4a7c7f09d1f3dc651ba929d49d746a0a8d1246dd`

Useful patterns:

- small Activity Bar/tree extension structure;
- local repo detection;
- file watchers;
- status bar;
- safe command registration;
- opening local control artifacts;
- lightweight project binding.

Do not turn DataPass VS Code into a FOIL-only product. FOIL becomes profile #1.

### Databricks

The official Databricks extension remains the primary client.

Inspect:

`julian-passebecq/databricks-vscode-foil@6dcd49a4d2d592e2d8792c3e539039de16e1a70a`

only to understand useful command IDs / previous experiment behavior.

**Do not copy or repackage Databricks extension source into this project.** The previous fork has the same package identity as the official extension and is now frozen as a reference experiment. Its license is not the basis for this new extension.

DataPass should detect the official extension, inspect available commands at runtime, open/focus it where possible, and use supported Databricks CLI / Asset Bundle workflows for project-specific actions.

FOIL Databricks implementation remains:

`julian-passebecq/foil_databrick_dab@24c821a43168b21cf903b6ee7f39d461eef7617a`

### Power BI

Do not make the old C# PbiBench application the global shell.

Use `julian-passebecq/powerbi_enhanced_dev@d75b7ab9df5bd5289a205390111237481cb4e84e` only as a feature/donor reference.

Keep advanced specialized semantic-model UI external when appropriate; `TabularEditor_J` remains a specialized donor/tool.

Pass 1 Power BI can be lighter than Fabric: workspace/source detection, PBIP/TMDL awareness, curated tool links/actions, and extensible adapter contracts.

## Platform rules

### Fabric

Pass 1 should be real, not a placeholder.

Detect and compose:

- Microsoft Fabric VS Code extension (`fabric.vscode-fabric`);
- Fabric Studio (`GerhardBrueckl.fabricstudio`);
- OneLake-VSCode (`GerhardBrueckl.onelake-vscode`);
- Fabric CLI when installed;
- `fabric-cicd` project/tool availability;
- a manifest-driven curated Microsoft Fabric Toolbox gallery.

Reuse the donor Fabric toolbox catalog / tool-runner approach. Do not copy Microsoft Fabric Toolbox wholesale.

Toolbox entries should support action types such as:

- Open
- Read
- Clone
- Configure
- Run
- Scaffold
- Deploy

based on the asset type.

### Databricks

Detect the official extension and Databricks CLI.

Provide commands for:

- open/focus official Databricks tooling;
- open current project bundle;
- bundle validate;
- bundle deploy;
- bundle run (only when a project explicitly provides a target/job);
- show command / copy command as a safe alternative.

Never silently execute destructive/cloud-changing actions. Make mutation explicit.

### Observability / Grafana

Treat Grafana as **observability as code**.

Detect:

- `gcx`;
- OpenTofu/Terraform;
- local dashboard-as-code project markers.

Surface the intended workflow:

dashboard source -> Grafana Foundation SDK -> `gcx dev serve` -> Git -> deployment via `gcx`, Git Sync or Grafana provider/OpenTofu.

Do not build a Grafana dashboard editor.

### Infrastructure

Detect and surface peer tooling rather than replacing it:

- OpenTofu
- Terraform
- Kubernetes
- Docker
- Remote SSH

Provide project-aware commands/tasks only.

## Project profile system

Implement a small generic profile contract.

FOIL is the first bundled/reference profile, but the extension must not depend on FOIL being present.

A profile should be able to declare:

- id / display name;
- local repo bindings;
- platform bindings;
- optional commands/tasks;
- expected files;
- environment/status hints;
- documentation links;
- safe project actions.

FOIL profile should support at minimum:

- `foil-control-v1` local repo binding;
- `foil_databrick_dab` binding;
- Fabric status placeholder/binding without inventing workspace IDs;
- Oracle/SSH configuration placeholder;
- Grafana/observability project binding;
- links to FOIL runbooks/artifacts.

Do not connect directly to MongoDB from the VS Code extension in Pass 1. FOIL Project Management/Mongo remains durable routing/state outside the extension.

## UI

The Galaxy view should be useful on first launch.

Show cards/sections with concise status:

- Project
- Fabric
- Databricks
- Power BI
- Grafana
- Infrastructure

For each, show Installed / Missing / Configured / Partial / Unbound states and 1–3 high-value actions.

Avoid dashboard clutter. Do not reproduce every vendor feature.

## Safety and secrets

- Do not persist PATs, passwords, client secrets or cloud tokens.
- Prefer vendor authentication flows.
- Any terminal command containing user-entered parameters must be safely quoted/validated.
- Cloud mutation must be explicit and user-triggered.
- If a third-party command ID is not present, fall back cleanly.
- Never claim a runtime/deployment succeeded solely because a command was generated.

## Tests

At minimum add unit tests for:

- tool/extension detection abstractions;
- tool catalog parsing;
- project profile validation;
- command generation/quoting;
- graceful missing-tool behavior;
- Fabric donor migrations you retain.

Do not require live Fabric, Databricks, Grafana or Oracle credentials in CI.

## CI / package

GitHub Actions must:

1. install dependencies;
2. typecheck;
3. run tests;
4. build;
5. package a VSIX;
6. upload the VSIX as an artifact.

No Marketplace publication is required.

## Final deliverables

Return:

1. complete repository ZIP;
2. packaged VSIX;
3. concise `IMPLEMENTATION_STATUS.md` containing:
   - implemented features;
   - tests run and results;
   - known limitations;
   - files/modules reused from donors;
   - third-party integration boundaries;
   - exact next action for the next pass.

Do not return only a patch or instructions for another agent. Complete Pass 1.
