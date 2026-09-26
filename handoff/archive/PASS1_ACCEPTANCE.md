# Pass 1 Acceptance Criteria

Pass 1 is accepted only if the repository contains a runnable, packageable extension and the following behaviors are demonstrated by tests and/or Extension Development Host verification.

## Build

- [ ] `npm install` succeeds.
- [ ] TypeScript typecheck succeeds.
- [ ] Unit tests succeed.
- [ ] Production build succeeds.
- [ ] VSIX packaging succeeds.
- [ ] CI runs all of the above and uploads the VSIX.

## Core shell

- [ ] DataPass Activity Bar container exists.
- [ ] Galaxy/Overview opens without vendor tools installed.
- [ ] UI uses VS Code theme variables and works in light/dark themes.
- [ ] Refresh recomputes tool/project status.
- [ ] Missing integration never prevents activation.
- [ ] Status model distinguishes Installed / Missing / Configured / Partial / Error.

## Tool detection

- [ ] Detect VS Code extensions through `vscode.extensions`.
- [ ] Detect commands through `vscode.commands.getCommands(true)` before invoking third-party commands.
- [ ] CLI detection is isolated/testable and does not hang activation.
- [ ] At minimum detect Databricks CLI, Fabric CLI, `gcx`, OpenTofu/Terraform.
- [ ] Results are visible in Galaxy.

## Fabric adapter

- [ ] Detect `fabric.vscode-fabric`.
- [ ] Detect `GerhardBrueckl.fabricstudio`.
- [ ] Detect `GerhardBrueckl.onelake-vscode`.
- [ ] Open/focus Fabric tooling where supported, with fallback.
- [ ] Fabric Toolbox catalog is manifest/data-driven.
- [ ] At least one script/CLI-style Toolbox action uses guarded runner logic.
- [ ] No Microsoft Fabric Toolbox source tree is vendored wholesale.
- [ ] Useful concepts/code from `fabricdatapasstoolbox/codex/initial-vscode-companion` are consolidated rather than lost.

## Databricks adapter

- [ ] Detect official Databricks extension without depending on the old FOIL fork.
- [ ] Detect Databricks CLI.
- [ ] Open/focus official tooling when available.
- [ ] Generate/show/copy Bundle validate command for a bound project.
- [ ] Deploy/run require explicit user invocation.
- [ ] No Databricks vendor-fork source copied into this extension.

## Power BI adapter

- [ ] Detect PBIP/TMDL/PBIR markers.
- [ ] Show Power BI project/source status.
- [ ] Expose curated links/actions for agentic/reference or specialized tools.
- [ ] Do not embed the old C# PbiBench shell.

## Observability adapter

- [ ] Detect `gcx`.
- [ ] Detect OpenTofu/Terraform.
- [ ] Show Grafana-as-code workflow rather than a dashboard designer.
- [ ] Provide at least one safe action such as opening dashboard source or generating/copying a `gcx dev serve` command.

## Infrastructure adapter

- [ ] Detect OpenTofu/Terraform.
- [ ] Surface Kubernetes/Docker/Remote SSH peer capabilities where detectable.
- [ ] Do not implement replacement infrastructure clients.
- [ ] Mutating IaC commands are never executed automatically.

## Project profiles

- [ ] Generic profile schema/type exists.
- [ ] Extension works with no active profile.
- [ ] FOIL profile exists as profile #1.
- [ ] FOIL can bind local `foil-control-v1` and `foil_databrick_dab` paths.
- [ ] FOIL Fabric workspace remains unknown until a real identity is supplied.
- [ ] No direct MongoDB mutation.
- [ ] No secrets in project-profile source files.

## Security

- [ ] User-provided terminal arguments are validated/quoted.
- [ ] No credential input fields are added merely to simplify vendor auth.
- [ ] Cloud mutations are explicit and user-triggered.
- [ ] Failures report what was attempted without claiming success.

## Documentation / handoff

- [ ] README documents development, Extension Development Host run, tests and VSIX install.
- [ ] Architecture boundary is preserved.
- [ ] `IMPLEMENTATION_STATUS.md` records donor files actually reused and license handling.
- [ ] Missing live-cloud verification is stated explicitly.
- [ ] Final ZIP contains full repository and packaged VSIX.

## Not required in Pass 1

- Marketplace publication.
- Live production Fabric deployment.
- Live Databricks job execution.
- Live Grafana deployment.
- Power BI full semantic-model editor.
- Fabric-native custom workload.
- Direct MongoDB integration.
- Oracle VM full management UI.
- Separate per-platform VSIX packages.
