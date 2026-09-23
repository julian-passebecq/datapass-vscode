# Implementation Status — Pass 6

Date: 2026-09-23
Branch: `codex/pass6-fabric-summary-cicd`
Version: `0.6.0`

## Implemented

### Read-only Fabric environment capture

DataPass can now capture the project-bound Fabric workspace into a local VS Code Output channel using the official `fab` CLI with argument arrays rather than shell interpolation.

The capture runs only:

- `fab get <workspace>.Workspace`
- `fab ls <workspace>.Workspace -l`

It does not mutate Fabric.

### Safe Fabric deployment baseline

The project manifest now supports:

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

The Galaxy can scaffold a Fabric deployment YAML based on the official Fabric CLI / fabric-cicd configuration model.

Safety baseline:

- target workspace must already be declared in the project manifest;
- workspace ID, when used, must be a GUID;
- repository path is calculated relative to the generated config;
- `publish.skip: false` is explicit;
- **`unpublish.skip: true` is explicit** to avoid automatic orphan removal;
- no bulk-publish feature flags are generated.

### Deploy command generation

DataPass can copy:

```bash
fab deploy --config <config> [--target_env <environment>]
```

It does not execute the command.

DataPass does not add:

- `--force`;
- `--bulk_publish`;
- experimental feature flags.

### Manual CI preflight

DataPass can scaffold:

```text
.github/workflows/fabric-preflight.yml
```

The workflow is deliberately:

- `workflow_dispatch` only;
- Azure OIDC based;
- read-only;
- no client secret embedded;
- no deployment step.

It installs `ms-fabric-cli`, binds it to the Azure CLI OIDC session, checks auth status, verifies the project workspace, lists workspace items and verifies that the deployment config exists.

Expected GitHub secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

### Command Palette

Pass 6 adds:

- **DataPass: Fabric Capture Environment Summary**
- **DataPass: Fabric Scaffold Deploy Config**
- **DataPass: Fabric Copy Deploy Command**
- **DataPass: Fabric Scaffold CI Preflight**

## Upstream provenance

Implementation was checked against:

- `microsoft/fabric-cli@0183fbf1809826040ed4805e6163cb51c1613cb9`
  - `docs/commands/fs/deploy.md`
  - `docs/examples/workspace_examples.md`
  - authentication implementation for `--azure-cli`
- `microsoft/fabric-cicd@8d9e6f8025fff5aba484e4b9ecf331a186ae40f2`
  - `docs/how_to/deployment_overview.md`
  - `docs/how_to/config_deployment.md`
  - `docs/example/release_pipeline.md`

## Verification

CI remains the merge gate:

1. dependency installation;
2. strict TypeScript typecheck;
3. unit tests;
4. production build;
5. VSIX packaging;
6. artifact upload.

New tests enforce:

- shell-free Fabric CLI argument construction;
- Fabric deployment manifest validation;
- `unpublish.skip: true`;
- no `--force` / bulk publish in generated deploy commands;
- manual-only, read-only GitHub Actions preflight;
- OIDC secret references without embedded client secrets.

## Deliberately deferred

DataPass still does not automatically run Fabric deployment.

Before enabling an execution button, validate on the user's real environment:

1. desktop VSIX;
2. Fabric CLI authentication;
3. real workspace identity;
4. repository item definitions;
5. generated config;
6. manual copied deployment command in a non-production workspace.

## Next likely pass

- Power BI / semantic-model engineering integration around existing agentic/MCP tools;
- richer project health UI once desktop ergonomics are observed;
- optional Fabric CI/CD execution only after the preflight and manual deployment path are verified.
