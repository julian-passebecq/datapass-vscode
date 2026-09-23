# Implementation Status — Pass 3

Date: 2026-09-23
Branch: `codex/pass3-fabric-ops-mcp`

## Implemented

### Fabric Assessment Tool

DataPass now provides a guided, credential-free launcher for the upstream Microsoft Fabric Assessment Tool:

- detects the `fat` CLI;
- asks for Synapse or Databricks source;
- supports Azure/AWS selection for Databricks;
- accepts an optional workspace name;
- requires an explicit output directory;
- generates the upstream `fat assess ...` command;
- offers **Run** or **Copy command**;
- never asks for or stores passwords, tokens, client secrets or service-principal credentials.

The command builder rejects control characters and keeps cloud mutation/authentication in the upstream tool.

### Fabric / Power BI MCP workspace integration

Curated MCP tools can now be configured into the active VS Code workspace when a local `microsoft/fabric-toolbox` clone is present and the upstream server has already been built/installed:

- Semantic Model MCP Server;
- Microsoft Fabric Management MCP Server;
- DAX Performance Tuner MCP Server.

DataPass:

1. resolves the verified upstream tool layout;
2. verifies the expected executable exists;
3. reads the existing `.vscode/mcp.json`;
4. preserves existing MCP servers;
5. asks before replacing a server with the same name;
6. writes only command/path metadata — no credentials;
7. opens the resulting MCP config for inspection.

If the upstream server is not ready, DataPass opens setup instructions/local source instead of inventing a configuration.

DAX Performance Tuner remains Windows-only, matching its upstream prerequisite.

### Fabric readiness

The Fabric Galaxy now surfaces:

- Fabric CLI;
- Fabric Assessment Tool;
- Python;
- PowerShell 7;
- .NET SDK;
- workspace `.vscode/mcp.json`;
- curated Fabric Toolbox catalog.

## Verification

CI remains the merge gate:

1. dependency install;
2. strict TypeScript typecheck;
3. unit tests;
4. production build;
5. VSIX packaging;
6. artifact upload.

New unit tests cover:

- Fabric Assessment Tool command generation and input sanitization;
- MCP config parsing and non-destructive merging;
- Semantic Model MCP path generation;
- Windows-only DAX MCP enforcement.

## Upstream basis

Workflows were derived from the verified Microsoft Fabric Toolbox snapshot:

`microsoft/fabric-toolbox@c38ea357b804b335d1ed3b558dda38cda778cf70`

Relevant upstream paths:

- `tools/fabric-assessment-tool/README.md`
- `tools/SemanticModelMCPServer/.vscode/mcp.json`
- `tools/MicrosoftFabricMgmtMCPServer/README.md`
- `tools/DAXPerformanceTunerMCPServer/README.md`

No upstream server source is vendored into DataPass.

## Still pending live desktop verification

- install the generated VSIX in the user's desktop VS Code;
- verify detection against the user's actual installed extensions/CLIs;
- run a real non-production Fabric Assessment Tool scan;
- build/configure one MCP server locally and start it through VS Code;
- verify Fabric tenant and Databricks runtime actions independently.

## Next likely pass

After desktop smoke testing:

1. add a read-only Fabric management surface (workspace/items/status) using supported vendor CLI/API tooling;
2. add `fabric-cicd`/Fabric CLI deployment task generation with explicit dry-run/confirmation boundaries;
3. add project-level health/export so the Galaxy can produce a compact environment handoff;
4. deepen Power BI source engineering only where it complements, rather than replaces, specialized tools.
