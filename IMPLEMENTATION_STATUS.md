# Implementation Status — Pass 2

Date: 2026-09-23
Branch: `codex/pass2-toolbox-manifest`

## Implemented

### Generic project contract

- source-controlled `.datapass/project.json`;
- JSON Schema / editor validation;
- generic and FOIL templates;
- relative repository/path resolution;
- real filesystem checks for repository bindings;
- project runbook/documentation links;
- live manifest watcher;
- local VS Code settings remain explicit overrides;
- no credential fields are introduced.

### Adapter routing from project manifest

- Fabric workspace/toolbox context;
- Databricks repository / Bundle root / default target context;
- Grafana generator and watch-path context;
- infrastructure root;
- Oracle SSH alias through project state / actions.

### Fabric Toolbox Galaxy

Curated catalog expanded to 12 assets verified against:

`microsoft/fabric-toolbox@c38ea357b804b335d1ed3b558dda38cda778cf70`

Categories currently include:

- Monitoring
- Operations
- Migration
- Agentic / MCP
- Real-time
- CI/CD

The Galaxy renders item description, kind, source and upstream verification ref.

Supported generic actions:

- Open upstream asset;
- copy upstream repository clone command;
- open local/upstream configuration instructions.

Guarded executable path:

- Fabric Security Audit.

Scaffold/deploy and unsupported run actions remain intentionally disabled pending tested workflows.

## Verification

CI is the merge gate and runs:

1. dependency installation;
2. strict TypeScript typecheck;
3. unit tests;
4. production build;
5. VSIX packaging;
6. artifact upload.

New unit coverage includes the portable project-manifest contract and path resolution.

## Donor / upstream discipline

No vendor extension source was copied.

Architecture and patterns continue to draw from:

- `fabricdatapasstoolbox/codex/initial-vscode-companion` for project-state, catalog and guarded-runner concepts;
- `foil-ai-extension` for lightweight local project binding;
- Microsoft Fabric Toolbox as an upstream tool catalog, not vendored code.

The old `databricks-vscode-foil` fork remains reference-only.

## Not yet live-verified

- desktop VS Code install/smoke test by the user;
- real Microsoft Fabric tenant operations;
- Databricks authentication/deploy/run;
- Grafana `gcx` against a live instance;
- Oracle VM Remote SSH;
- executable workflows for the Fabric Assessment Tool, MCP servers, CI/CD accelerators or monitoring deployments.

## Next action

Install the Pass 2 VSIX in the user's real VS Code and validate:

1. Galaxy rendering;
2. detection of installed Fabric/Databricks/OpenTofu/Remote SSH extensions and CLIs;
3. creation/loading of `.datapass/project.json`;
4. FOIL repository binding;
5. Fabric Toolbox gallery and Security Audit workflow.

After that smoke test, deepen only the platform workflows that prove useful in the real desktop environment.
