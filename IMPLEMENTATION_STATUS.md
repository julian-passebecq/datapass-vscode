# Implementation Status — Pass 1 Core

Date: 2026-09-23
Branch: `codex/pass1-control-plane`

## Implemented in this slice

- single DataPass VS Code extension shell;
- DataPass Activity Bar + Galaxy webview;
- common platform status/action model;
- injectable CLI detection with timeout/failure degradation;
- Microsoft Fabric adapter with official/community extension detection, Fabric CLI detection, and manifest-driven Fabric Toolbox catalog;
- Databricks adapter using the official extension identity + CLI + Asset Bundle project detection;
- Power BI source adapter for PBIP/TMDL/PBIR markers;
- Grafana observability-as-code adapter for `gcx` + OpenTofu/Terraform + generator binding;
- infrastructure adapter for OpenTofu/Terraform/Docker/Kubernetes/Remote SSH peer tooling;
- generic project profile contract and FOIL profile #1;
- safe command generation/copy actions for Databricks Bundles, Grafana preview and OpenTofu;
- CI for typecheck, tests, build and VSIX packaging.

## Donor use

No donor source file was copied verbatim in this slice.

Patterns were reimplemented from:

- `julian-passebecq/fabricdatapasstoolbox@82cfb48f59a59d4db89f1072a07575a2865bd3b9` — extension detection, graceful command fallback, curated toolbox/catalog and guarded tool runner concepts;
- `julian-passebecq/foil-ai-extension@4a7c7f09d1f3dc651ba929d49d746a0a8d1246dd` — lightweight Activity Bar, status, local repo binding and workspace detection concepts.

The Databricks vendor fork was inspected only as a command/reference experiment. No Databricks vendor source is included.

## Not yet live-verified

- real Microsoft Fabric tenant commands;
- real Databricks authentication/deploy/run;
- Grafana `gcx` against a live instance;
- Oracle VM Remote SSH;
- packaged VSIX installation in the user's desktop VS Code.

## Next pass

1. Make CI green and package the VSIX.
2. Exercise the Galaxy in Extension Development Host.
3. Deepen Fabric Toolbox actions by migrating the proven guarded runner subset from the old Fabric prototype.
4. Add local project manifest support so FOIL and future projects can declare tool bindings without putting secrets in source control.
5. Live-test FOIL Databricks and Fabric paths only after the generic shell is stable.
