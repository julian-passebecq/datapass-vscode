# V3 sources (capability `sources` S20–S31 and checks of 2026-09-25)

S01–S18 are listed in [../v2.2/08_SOURCES_AND_EVIDENCE.md](../v2.2/08_SOURCES_AND_EVIDENCE.md).

| Id | Source | Used for |
|---|---|---|
| S20 | https://learn.microsoft.com/azure/azure-functions/functions-reference-python | Python v2 model: `function_app.py`, `host.json`, `requirements.txt`; the app deploys as a whole |
| S21 | https://learn.microsoft.com/azure/azure-functions/functions-run-local | Core Tools: `func start`, `func --version`, `func azure functionapp publish` |
| S22 | https://learn.microsoft.com/azure/data-factory/source-control and https://learn.microsoft.com/azure/data-factory/author-visually | ADF Git integration (root folder, collaboration branch), authoring in ADF Studio (https://adf.azure.com); saving to Git is not publishing |
| S23 | https://learn.microsoft.com/azure/data-factory/control-flow-azure-function-activity | Azure Function activity: JSON object response, ~230 s HTTP limit, async pattern for long work |
| S24 | https://learn.microsoft.com/azure/data-factory/connector-mongodb-atlas | MongoDB Atlas connector: upsert replaces documents with the same `_id` |
| S25 | https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurestorage | Azure Storage extension |
| S26 | https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb and https://github.com/microsoft/vscode-cosmosdb/blob/main/CHANGELOG.md | "Azure Cosmos DB" extension (renamed from Azure Databases in 0.28.0; Mongo RU support moved to `ms-azuretools.vscode-documentdb`) |
| S27 | https://www.mongodb.com/docs/mongodb-vscode/ | MongoDB for VS Code (`mongodb.mongodb-vscode`, container `mongoDB`) |
| S28 | https://marketplace.visualstudio.com/items?itemName=ms-ossdata.vscode-pgsql | Microsoft PostgreSQL extension (container `pgObjectExplorer`) |
| S29 | https://marketplace.visualstudio.com/items?itemName=databricks.neon-local-connect and https://github.com/neondatabase/neon_local_vs_code_extension | Neon extension ("Neon - Serverless Postgres", publisher databricks, container `neon-local-connect`) |
| S30 | https://docs.databricks.com/dev-tools/bundles/ | `databricks bundle validate / deploy / run` are separate steps |
| S31 | https://docs.pytest.org/ | `python -m pytest` |
| S32 | https://docs.github.com/actions and the Marketplace listing of `github.vscode-github-actions` | GitHub Actions: manages workflows and runs, YAML validation |
| S33 | https://learn.microsoft.com/azure/devops/pipelines/ and github.com/microsoft/azure-pipelines-vscode `package.json` | Azure Pipelines: `azure-pipelines.yml`; extension publisher `ms-azure-devops`, name `azure-pipelines`, language support only (no view) |
| S34 | https://docs.gitlab.com/ci/ and gitlab.com/gitlab-org/gitlab-vscode-extension `package.json` | GitLab CI/CD: `.gitlab-ci.yml`; extension publisher GitLab, name `gitlab-workflow`, only a `gitlab-duo` view container (no pipeline view) |
| S35 | https://learn.microsoft.com/azure/devops/extend/develop/work-with-urls | Azure DevOps URL forms: `dev.azure.com/{org}` and `{org}.visualstudio.com`; the `_workItems` hub |
| S36 | github.com/microsoft/vscode-pull-request-github `package.json` | GitHub Pull Requests: view containers `github-pull-requests`, `github-pull-request` |
| S37 | github.com/grafana/grafana-vs-code-extension `package.json` and `src/extension.ts` | Grafana extension: no view container; custom editor `grafana.dashboard`; command `grafana-vscode.openUrl(uri?)` → `vscode.openWith` |

## VS Code facts verified for V3

- `contributes.viewsContainers.secondarySidebar` is available to published extensions from VS Code
  **1.106** (proposed-only in 1.104–1.105): https://code.visualstudio.com/updates/v1_106 — hence
  `engines.vscode: ^1.106.0`.
- `workbench.view.extension.<containerId>` exists only while the extension owning the container is
  enabled; DataPass checks `getCommands()` first. Containers: Azure Resources `azure` (used by
  Functions, Storage, Cosmos DB), Databricks `databricksBar`, MongoDB `mongoDB`, Neon
  `neon-local-connect`, PostgreSQL `pgObjectExplorer`, Terraform `terraform`.
- No official Microsoft VS Code extension for Azure Data Factory authoring was found among Microsoft's
  publishers; authoring is ADF Studio in the browser.
- Windows process creation: libuv searches the child's working directory before PATH for a bare
  command, hence absolute executable paths (`src/core/exec.ts`).
- Extension view containers checked on 2026-09-25, from each extension's own `package.json`: GitHub
  Actions `github.vscode-github-actions` declares container `github-actions`; GitHub Pull Requests
  `GitHub.vscode-pull-request-github` declares container `github-pull-requests`; Azure Pipelines
  `ms-azure-devops.azure-pipelines` declares none (language support only); GitLab Workflow
  `GitLab.gitlab-workflow` declares none for pipelines (only `gitlab-duo`); Grafana
  `Grafana.grafana-vscode` declares none (its command opens a custom editor instead).

## Repositories inspected (read-only)

- `julian-passebecq/datapass-vscode` main `91a0850` (0.12.0) — the audited base.
- `julian-passebecq/foil_databrick_dab` main: root `databricks.yml`, `docs/LIVE_TEST.md`,
  `docs/CURRENT_LAB_SCOPE.md` — to confirm F17 (no content copied).
- `julian-passebecq/databricks-vscode-foil` branch `foil-lab-mvp`: file list of
  `packages/databricks-vscode/src/foil-lab/` (compiler, bundle integration) — to name the producer.
- `julian-passebecq/foil-v1-vscode-datapass`: README only at the time of this pass.
