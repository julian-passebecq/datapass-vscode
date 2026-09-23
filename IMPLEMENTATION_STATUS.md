# Implementation Status — Pass 4

Date: 2026-09-23
Branch: `codex/pass4-fabric-cli-readonly`

## Implemented

### Official Fabric CLI control surface

DataPass now exposes a small, safe Fabric CLI navigation layer in the Galaxy using the official Microsoft `fab` CLI:

- **Auth status** → `fab auth status`
- **Login** → `fab auth login`
- **List workspaces** → `fab ls`
- **Project workspace** → `fab ls "<workspace>.Workspace" -l`

The project-workspace action is enabled only when:

1. Fabric CLI is detected; and
2. `platforms.fabric.workspaceName` exists in `.datapass/project.json`.

The extension does not collect Fabric credentials. Interactive authentication is owned by Fabric CLI.

### Safety boundary

Pass 4 intentionally stays on the read/navigation side of Fabric CLI.

It does **not** add:

- `fab rm`
- `fab mkdir`
- `fab cp`
- `fab import`
- `fab set`
- direct mutating Fabric REST calls

Those can be introduced later only behind explicit project tasks/confirmation and live verification.

### Existing Fabric operational surfaces retained

- Fabric Studio / Microsoft Fabric / OneLake peer-extension detection;
- Fabric Toolbox gallery;
- guarded Fabric Security Audit;
- guided Fabric Assessment Tool;
- Semantic Model / Fabric Management / DAX MCP setup;
- Python / PowerShell / .NET / MCP readiness.

## Verification

CI remains the merge gate:

1. dependency installation;
2. strict TypeScript typecheck;
3. unit tests;
4. production build;
5. VSIX packaging;
6. artifact upload.

New tests cover official Fabric CLI command generation and workspace suffix handling.

## Current upstream basis

Fabric CLI behavior is aligned with current Microsoft documentation/repository examples:

- `fab auth status`
- `fab auth login`
- `fab ls`
- `fab ls <workspace>.Workspace -l`

DataPass remains a thin orchestrator over the vendor CLI rather than reimplementing Fabric APIs.

## Pending live validation

- install VSIX in desktop VS Code;
- verify Fabric CLI auth status in the user's environment;
- list the user's accessible workspaces;
- add the real FOIL Fabric workspace name to the project manifest only after it is verified;
- inspect that workspace through the Galaxy.

## Next likely pass

After desktop validation:

1. add read-only Fabric item summaries/exportable environment health;
2. add explicit Fabric CI/CD task generation using Fabric CLI / `fabric-cicd`;
3. add a compact project health/handoff export from the Galaxy;
4. deepen Power BI source workflows while keeping heavy model editors external.
