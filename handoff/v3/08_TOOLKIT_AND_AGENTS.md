# Toolkit, toolchain and agents: proposal (2026-09-25)

> **Status: proposal.** Written after Julian asked (1) how to use the community tools around Fabric,
> Power BI and Databricks without putting them into DataPass or forking them, (2) whether a
> "DataPass Cloud" studio that explains when and how to use each tool makes sense, and (3) how
> DataPass should handle a project's ids, CLIs, extensions and versions, and connections, including
> with coding agents such as Codex and Claude Code. The decisions in section 9 are Julian's; nothing
> here is accepted until it is recorded there. Written against main 0.15.1 while 0.16.0 (PR #24)
> and 0.17.0 (branch `claude/v017-windows-views`, which adds `07_WINDOWS_AND_POWER_OPS.md`) are in
> flight. To keep those branches free of conflicts, this file is not linked from the other handoff
> documents yet: the first pass that implements it adds the links.
>
> **Update (0.18.0):** 0.16.0 and 0.17.0 are merged (PR #24, #25) and this proposal is merged (PR #26),
> now linked from `V3_HANDOFF.md` and `06_VISION_AND_READINESS.md`. The 0.18 pass of section 8
> (toolchain, ID map, connections) is implemented; its contract is `docs/PREPARING_A_PROJECT.md`
> section 12. Sections 5.1, 5.2 and 5.4 (catalogue, recipes, hub repository) are the later **toolkit
> catalogue** pass: Julian's order in `09_AI_MODES_WORK_ORDERS_GIT.md` §13.1 makes 0.19.0 the Git
> module, then AI-2 work orders, then this catalogue (with each tool's free tier and pricing). The
> "0.19" of section 8 below is superseded by that order.

> **Update (0.21.0):** sections 5.1, 5.2 and 5.4 are implemented (the toolkit catalogue pass): format
> `datapass.toolkit` 1, a built-in baseline with dated prices, the hub layer, recipes resolved per
> project, `recipe` / `route` on board items, "Needs a newer DataPass". Contract:
> `docs/PREPARING_A_PROJECT.md`; what was built: IMPLEMENTATION_STATUS.md. Two small differences
> from the draft above: `install` entries are `{ method, id | tool | command, platform, where }`;
> a route's `if` is `{ fact }` or `{ tool }` (installed). Prices use `priceModel`, `freeTier`,
> `pricingUrl`, `tiers[]` and `checkedAt` on each tool.

## 1. Short answer

- **Yes to the idea, as a layer of knowledge inside DataPass.** No second application, no forks, no
  second extension in another window. Community tools are installed from their own Marketplace,
  PyPI or GitHub pages and do their own work. DataPass knows what each one is for and says, per
  project and per step, which one to use, when, how, and what to check.
- DataPass already has half of it (section 2). Three pieces of data are missing:
  1. a **catalogue**: what each tool is, who publishes it, what it is for, how it fits the official
     tools, and when it was last verified;
  2. **recipes**: step-by-step workflows per module (develop, pipelines, CI/CD, monitoring…), where
     each step names its tool and a fallback;
  3. the project's **toolchain**: the tools and versions it needs, its identifiers per environment
     (the "ID map"), and the connections and sign-ins to make.
- VS Code already packages extensions: extension packs, workspace recommendations
  (`.vscode/extensions.json`), and a Profile per workspace (see 0.17). DataPass bundles nothing.
- A chat AI gets the relevant excerpt through the existing JSON exchange and answers with work items
  that name a recipe. Coding agents (Codex, Claude Code, GitHub Copilot) read `AGENTS.md` or
  `CLAUDE.md` and skills in the repository. Recipes can later be exported as skills, so the person
  and the agent follow the same steps.

## 2. What DataPass already has (source, main 0.15.1)

| Area | Where | What it does | Gap |
|---|---|---|---|
| Tool registry | `src/core/capabilities/tools.ts` | 40 tools (extensions, CLIs, desktop apps, workspace files) with a publisher (`microsoft`, `vendor`, `community`); a probe says present, absent or unknown, and the version seen | Hard-coded TypeScript; no required version; no install hint; community coverage is Fabric Studio and OneLake only; no Python libraries, accelerators or agent plugins |
| Operation registry | `src/core/capabilities/registry.ts` | Per operation: phase, required and optional tools, facts, human reviews, side effects, action mode (open, copy a command, run read-only, manual), fallback, sources, qualification | One operation at a time: the choice between routes (Git integration, CLI or Fabric Studio) is not expressed; no fabric-cicd or semantic-link-labs route |
| Manifest v4 | `localEnv`, `identifiers` | Env files and variable names (set, empty or missing, never a value); non-secret ids with an `envKey` | One value per identifier (no environments); no toolchain, no versions, no connections |
| Readiness | Project view | Deterministic checks; optional companions (Mongoku, DiagramCloud) | No "tools and versions" or "connections" checks |
| AI exchange | packs, *Copy a DataPass File for the AI*, *Import the AI's Answer* | Bounded context; validated import with a diff and a backup | No tool knowledge in the packs |
| Power BI agents | `src/core/powerbiAgentic.ts` | Copilot CLI commands for the `data-goblin/power-bi-agentic-development` marketplace | Lists 6 plugins; the marketplace has 11 today and also targets Claude Code. This drift is why tool knowledge should be dated data, not code |
| Fabric CI | `src/core/fabricWorkflow.ts` | A Fabric preflight GitHub Actions workflow with the official `fab` CLI | — |
| MCP | `src/core/mcp.ts`, tool `ws.mcp` | Reads a workspace MCP configuration | — |

## 3. The tools Julian listed, sorted (checked on GitHub on 2026-09-25)

A tool with "no UI" is a library, a script, a notebook or a report template. It is used from a
Fabric notebook, a terminal or a CI pipeline by following its README, and that is exactly where a
recipe helps.

### Use now (Fabric and Power BI core)

| Tool | What it is | How it fits the official tools |
|---|---|---|
| **Fabric Studio**, `GerhardBrueckl.fabricstudio` (2.25.2) | Community VS Code extension: workspace browser; a `fabric://` file system that opens an item's definition as files to edit and publish; API notebooks (`%api` REST calls); Spark notebooks against a lakehouse; Fabric Git integration in VS Code's Source Control; deployment pipelines; hover on Fabric GUIDs; guest tenants | Complements the official *Microsoft Fabric* (`fabric.vscode-fabric`) and *Fabric Data Engineering* (`SynapseVSCode.synapse`) extensions. Already an optional tool in DataPass (`ext.fabric-studio`) |
| **Power BI Studio**, `GerhardBrueckl.powerbi-vscode` (2.12.0) | Community extension for the Power BI service: workspaces, reports and semantic models with their operations (rebind, clone, refresh…); live TMDL editing of a published model (needs .NET 7 or later and a Premium or Fabric capacity); DAX, TMSL and REST notebooks; capacities, gateways, deployment pipelines | Complements Power BI Desktop and the TMDL extension. Not in the DataPass registry yet |
| **OneLake**, `GerhardBrueckl.onelake-vscode` (0.4.0) | Opens OneLake (lakehouse files) as a folder in VS Code | Already in DataPass (`ext.onelake`) |
| **Power BI extension pack**, `GerhardBrueckl.powerbi-vscode-extensionpack` (0.5.0) | Installs Power BI Studio, Fabric Studio, OneLake, Data Table, DAX language, and two Microsoft extensions: **TMDL** (`analysis-services.tmdl`) and **Power BI Modeling MCP** (`analysis-services.powerbi-modeling-mcp`) | The one-click route: one recommendation instead of seven |
| **fabric-cicd**, `microsoft/fabric-cicd` (`pip install fabric-cicd`) | Python library that deploys the items of a Git folder (the layout Fabric Git integration writes) to a workspace; `parameter.yml` replaces ids and values per environment; runs in GitHub Actions or Azure Pipelines | The code-first CI/CD route, next to deployment pipelines (portal) and `fab`. `gbrueckl/fabric-cicd` is a personal fork: use Microsoft's |
| **Fabric CLI**, `microsoft/fabric-cli` (`pip install ms-fabric-cli`) | Official CLI: browse workspaces like folders, `export` and `import` items, call the REST API with authentication handled, sign in as a user, a service principal or a managed identity | Already in DataPass (`cli.fab`) |
| **semantic-link-labs**, `microsoft/semantic-link-labs` (`sempy_labs`) | Python library used **inside Fabric notebooks**: Best Practice Analyzer, VertiPaq statistics, Direct Lake migration, report rebinding, admin APIs | Governance and quality of semantic models. `gbrueckl/semantic-link-labs` is a fork: use Microsoft's |
| **power-bi-agentic-development**, `data-goblin` (940★) | Plugin marketplace for **Claude Code and GitHub Copilot CLI**: skills, sub-agents and validation hooks for PBIP, TMDL and PBIR, semantic models, reports, Tabular Editor, Fabric CLI, Fabric admin, ETL, paginated reports, custom visuals | The agent side of Power BI work. DataPass already builds its Copilot install commands |

### Useful later, once a real tenant or capacity exists: `microsoft/fabric-toolbox` (Fabric CAT, 911★)

| Area | Content | Needs |
|---|---|---|
| Monitoring and cost | **FUAM** (Fabric Unified Admin Monitoring), **FCA** (Fabric Cost Analysis), platform and Spark monitoring with Real-Time Intelligence, workspace monitoring report templates, warehouse query and capacity correlation | Fabric administrator rights, a capacity |
| Accelerators | CI/CD (Git-based deployments, deployment pipelines, branch out to a new workspace), BCDR, warehouse backup and recovery, RTI Eventhouse and Eventstream, Policy Weaver (mirrors Databricks and Snowflake access policies to Fabric), Dataflow Gen2 migration, Power Query ODBC→ADBC advisor | Depends on the accelerator |
| Tools | Semantic Model Audit, DAX performance testing, MCP servers (semantic model, Fabric management, DAX performance tuner), Fabric assessment, security audit, lineage extractor, load test, `MicrosoftFabricMgmt` PowerShell module | Mostly workspace or admin rights |
| Samples and scripts | Notebooks (workspace size, connection management, refreshing SQL endpoint tables, creating warehouses and SQL databases…), warehouse SQL scripts, OneLake samples | A workspace |

`gbrueckl/Fabric.Toolbox` is a small personal collection (an environment library manager and a
notebook): use it only for a specific need.

### Learning material, not tools

- `gbrueckl/FabConAtlantaProDev` (a fork of `slammini/FabConAtlantaProDev`): the FabCon Atlanta
  workshop *Power BI Mastery: End-to-End Analytics for Pro Developers*, with labs on PBIP, TMDL,
  PBIR, AI and DevOps. The best first Power BI mini-project.
- `data-goblin/powerbi-macguyver-toolbox`: PBIP report templates (bar, line, KPI) and Tabular
  Editor scripts. Useful as examples when building reports.

### Skip

- `pbi-tools`: source control for `.pbix` files, from before the PBIP format. For new projects, PBIP
  in Desktop, Git integration and fabric-cicd cover it. Keep it only for a legacy `.pbix`-only
  project.
- `gbrueckl/Databricks.API.PowerShell`: replaced by the official Databricks CLI, SDK, bundles and
  extension.
- `data-goblin/pbi-search` is archived; `gbrueckl/gbrueckl` is a profile page; and the two forks
  above.

### The official baseline these tools sit on

The Microsoft Fabric and Fabric Data Engineering extensions, TMDL, Power BI Desktop (Windows), the
Power BI Modeling MCP server and `fab`; the Databricks extension, CLI and bundles; the Azure
extensions and `az`. These stay the default route. A community tool is chosen when it saves real
time, as in the Copy Job case below.

## 4. The Copy Job example, written as a recipe

The situation from the r/MicrosoftFabric thread: lower-case every destination table and column of
a Copy Job, which takes eight hours by hand in the portal. Every Fabric item has a **definition**:
a few files (`copyjob-content.json`, `.platform`) that the REST API returns base64-encoded
(`POST …/copyJobs/{id}/getDefinition`). Nobody needs to call that API by hand, because the tools
below decode the files.

| Route | When | Steps |
|---|---|---|
| 1. Git integration (official) | The workspace is connected to a repository | The files are in the repository → the AI edits them (JSON exchange or pull request) → review the diff → commit → *Update all* in the workspace |
| 2. `fab` (official CLI) | No Git connection | `fab export <ws>.Workspace/<item>.CopyJob -o <folder>` → edit → `fab import <ws>.Workspace/<item>.CopyJob -i <folder>/<item>.CopyJob`. The import creates or modifies the item and drops its sensitivity label |
| 3. Fabric Studio (community) | No Git connection, and a UI is preferred | Open the item under `fabric://` → edit its JSON → publish |
| 4. REST API by hand | Nothing else is possible | `getDefinition` → decode → edit → `updateDefinition` |

In every route: export a backup first, change one environment at a time, and check the result in
the portal. DataPass picks the applicable route from the project's facts (whether a Git binding is
declared, which tools are installed) and gives the steps. When the files are in a repository it
reads, DataPass prepares the AI pack with the JSON and imports the answer with a diff and a backup.
For routes 2 and 3, the edit happens in those tools.

## 5. Proposed model

### 5.1 Catalogue

One entry per tool:

```json
{ "id": "ext.fabric-studio", "label": "Fabric Studio", "kind": "vscode-extension",
  "publisher": "community", "maintainer": "Gerhard Brueckl",
  "links": { "repo": "https://github.com/gbrueckl/FabricStudio",
             "marketplace": "https://marketplace.visualstudio.com/items?itemName=GerhardBrueckl.fabricstudio" },
  "verified": { "on": "2026-09-25", "version": "2.25.2" },
  "status": "active",
  "install": [ { "method": "marketplace", "id": "GerhardBrueckl.fabricstudio" },
               { "method": "extension-pack", "tool": "pack.powerbi-gbrueckl" } ],
  "modules": ["develop", "pipelines", "cicd", "admin"],
  "complements": ["ext.fabric", "ext.fabric-data-engineering", "cli.fab"],
  "sideEffects": ["reads-remote", "writes-remote", "credential-prompt"],
  "useWhen": "Edit an item definition without Git, run REST calls, manage deployment pipelines from VS Code.",
  "avoidWhen": "The workspace is connected to Git: edit the files in the repository instead." }
```

- Kinds: `vscode-extension`, `extension-pack`, `cli`, `python-library`, `powershell-module`,
  `desktop-app`, `notebook-collection`, `accelerator`, `report-template`, `agent-plugin`,
  `mcp-server`, `learning`.
- Status: `active`, `maintenance`, `archived`, `superseded` (with the replacement), or `fork` (with
  the upstream).
- `tools.ts` stays the probe layer for what DataPass can observe. Notebooks, accelerators and
  learning material have no probe, and the catalogue says so.

### 5.2 Recipes

```json
{ "id": "fabric.item-definition.bulk-edit", "module": "pipelines",
  "title": "Bulk-edit a Fabric item definition (Copy Job, pipeline…)",
  "when": "Many repetitive changes in one item's JSON.",
  "routes": [
    { "id": "git", "if": { "fact": "fabric.gitBinding" }, "tools": ["cli.git"],
      "steps": ["Get updates", "Ask the AI to edit the files (pack)", "Review the diff", "Commit", "Update all in the workspace"] },
    { "id": "fab", "tools": ["cli.fab"],
      "steps": [ { "text": "Export a backup and a working copy", "copy": "fab export <ws>.Workspace/<item>.CopyJob -o <folder>" },
                 "Edit the JSON",
                 { "text": "Import it back", "copy": "fab import <ws>.Workspace/<item>.CopyJob -i <folder>/<item>.CopyJob" } ] },
    { "id": "fabric-studio", "tools": ["ext.fabric-studio"], "steps": ["Open the item under fabric://", "Edit", "Publish"] }
  ],
  "checks": ["A backup exists", "One environment at a time", "The item opens and runs in the portal"],
  "risks": ["Publishing or importing replaces the definition in the workspace immediately", "fab import drops the sensitivity label"],
  "practice": "testlab: copy-job-bulk-edit" }
```

When a step is an existing DataPass operation, it names its capability (for example
`"capability": "fabric.items.deploy"`). Recipes add no execution engine: DataPass still opens,
copies a command or explains.

Modules, with their sub-modules:

1. **Develop:** notebooks, semantic models (TMDL), reports (PBIR), SQL.
2. **Data and storage:** lakehouse and OneLake, warehouse, mirroring, Delta tables.
3. **Pipelines and orchestration:** Data Factory pipelines, Copy jobs, Dataflows, Databricks jobs,
   Airflow.
4. **CI/CD and deployment:** Git integration, deployment pipelines, fabric-cicd, `fab`, Databricks
   bundles.
5. **Monitoring and cost:** FUAM, FCA, capacity metrics, workspace monitoring; Grafana is optional.
6. **Governance, quality and security:** Best Practice Analyzer, Semantic Model Audit, security
   audit, Policy Weaver.
7. **Administration:** capacities, gateways, connections, tenant settings.
8. **AI and agents:** MCP servers, skills and plugins, `AGENTS.md`.

### 5.3 The project's toolchain, ID map and connections (manifest v5 draft)

```json
{
  "schemaVersion": 5,
  "toolchain": {
    "tools": [
      { "tool": "cli.fab", "version": ">=1.0" },
      { "tool": "py.fabric-cicd", "where": "ci" },
      { "tool": "pack.powerbi-gbrueckl", "optional": true }
    ]
  },
  "identifiers": [
    { "id": "ws-sales", "label": "Sales workspace", "provider": "fabric", "kind": "workspace",
      "values": { "dev": "11111111-1111-1111-1111-111111111111", "prod": "22222222-2222-2222-2222-222222222222" } },
    { "id": "tenant", "label": "Entra tenant", "provider": "azure", "kind": "tenant", "value": "33333333-3333-3333-3333-333333333333" }
  ],
  "connections": [
    { "id": "azure-signin", "kind": "sign-in", "tool": "cli.az", "identifier": "tenant" },
    { "id": "dbx-dev", "kind": "sign-in", "tool": "cli.databricks", "profile": "project-dev", "environment": "dev" },
    { "id": "sales-git", "kind": "git-binding", "provider": "fabric", "identifier": "ws-sales", "environment": "dev",
      "repoRef": "bi", "folder": "fabric", "branch": "dev" },
    { "id": "sales-sql", "kind": "cloud-connection", "provider": "fabric", "name": "conn-sales-sql", "environment": "dev" }
  ]
}
```

- **Toolchain.** Tools are named by catalogue id, with an optional version range, `optional`, and
  `where`: `local` (the default), `ci`, or `fabric` for a library used in Fabric notebooks. DataPass
  compares this with what it probes, for example "fab 1.2.0 ≥ 1.0 ✓", or "Databricks CLI missing"
  with `winget install Databricks.DatabricksCLI` to copy. A mismatch is a warning on the phases
  that need the tool, never on reading. DataPass never installs anything.
- **`.vscode/extensions.json`.** The AI keeps this file in the repository, in line with the
  toolchain. DataPass compares the two and offers VS Code's *Show Recommended Extensions*. With
  0.17's company workspace and a VS Code Profile per company, the extension set follows the window.
- **ID map.** An identifier gets `values` per environment. It is still never a secret, and the v4
  rules on names and values apply to each value. The person sees which GUID is which (like Fabric
  Studio's GUID hover, but across the project), and the AI refers to logical ids. Later, DataPass
  can check, read-only, that a fabric-cicd `parameter.yml` replaces every dev id with the target's.
  It does so only on files it reads, and never writes one.
- **Connections.** These are what must be signed in or bound, with the checks DataPass may run
  read-only and without a prompt: `az account show` (tenant and subscription against the ID map),
  `databricks auth profiles` (the profile exists and is valid), and `fab auth status`. DataPass
  never reads credential files (`.databrickscfg` tokens, the Azure token cache). A Git binding or a
  cloud connection it cannot observe is shown as "declared, not checked", with the portal page
  where it can be verified. Secrets stay in Power Ops.

### 5.4 Where it lives: the hub repository (Julian's direction, 2026-09-25)

Julian wants ChatGPT to keep the tool knowledge up to date by itself, without a new build of the
extension, and to be told when a change is too big for the files alone. So the catalogue and the
recipes live in the **hub repository** (the optional repository that already holds
`.datapass/catalog.json`, the list of projects), next to it:

```text
hub repository   .datapass/catalog.json            projects (exists)
                 .datapass/toolkit/tools.json       catalogue (5.1)
                 .datapass/toolkit/recipes/*.json   recipes (5.2)
```

Each file carries `"format": "datapass.toolkit"`, a format `version`, and optionally
`"requires": { "datapass": ">=<the version that ships the catalogue>" }`.

- **Who updates it.** ChatGPT through the JSON exchange (*Copy a DataPass File for the AI* → answer →
  *Import the AI's Answer*, validated, with a diff and a backup), or a coding agent through a pull
  request. DataPass reads the files after *Get updates*. No extension release is involved.
- **What the files can change on their own:** tools (descriptions, links, status, versions seen,
  install commands shown to copy, modules, `useWhen` / `avoidWhen`), recipes and their routes,
  recommended version ranges. That covers new tools, archived tools, new workflows, and corrections.
- **What needs a new DataPass version:** anything DataPass would *do* rather than *show*: a new
  automatic check (a probe runs a program on the PC, so the program and its arguments stay in the
  reviewed extension, and a hub entry can only point to a probe id the extension knows), a new field
  or format version, a new action, a new kind of connection check.
- **How the AI says "DataPass must be updated".** Unknown fields are errors, so the AI never
  invents one. When the format cannot express what a project needs, it adds an entry to
  `datapassRequests` in the toolkit file: `{ "title", "why", "example" }`. DataPass lists these
  requests in the toolkit view as "Needs a newer DataPass". A file that requires a newer DataPass or
  a newer format version is shown as such, and its unsupported entries are skipped, never guessed.
  The requests are the input of the next DataPass pass in this repository.
- **Trust.** The hub's content is data from an AI: it is validated against the schema, never
  executed, and its labels (publisher, "official", status) are shown as the hub's claims. Install
  commands are only copied. The extension keeps a small built-in baseline (the probes and the
  official tools), so DataPass works without a hub. An entry the hub overrides is marked as changed
  by the hub.

## 6. The AI and coding agents

- **Chat AI (ChatGPT, Claude) through the JSON exchange.** Packs gain the toolchain state, the ID
  map (logical ids and non-secret values), the connection states (names and states only), and the
  recipes relevant to the question. The AI answers with board items (0.16's `board.json`) that
  name a `recipe` and a route, and DataPass shows each card's steps and tools. Adding `recipe` to
  board items is a board contract change for the toolkit pass.
- **Coding agents in the repositories (Codex, Claude Code, GitHub Copilot).** Codex and Copilot
  read `AGENTS.md`. Claude Code reads `CLAUDE.md`, which can import `AGENTS.md`. All three can load
  skills written as `SKILL.md` folders, the format of the data-goblin plugins; the folder each
  agent reads depends on its version. The coordination repository's `AGENTS.md` points agents to
  `docs/PREPARING_A_PROJECT.md` and `.datapass/*.json`. Agents work on branches and open pull
  requests, and DataPass's *Check for updates* / *Get updates* loop is unchanged. Later, a recipe
  can be exported as a skill, so the person (in DataPass) and the agent (in its own tool) follow
  the same steps.
- **MCP servers** (Power BI Modeling MCP, the fabric-toolbox servers, Azure MCP) are catalogue
  entries with their side effects. Many of them write to the tenant, so they are never
  prerequisites, and DataPass never configures them silently.

## 7. What not to do

- No fork, no copy of community code, no re-implementation of Fabric Studio or Power BI Studio.
- No second extension and no dedicated window for the toolkit: extensions only talk to each other
  inside one window, and 0.17 already gives one window and one Profile per company.
- No catalogue of cards. Tools appear where they are needed (a component's Details, Readiness, the
  Options comparison, a board card), as in the V3 workbench.
- No automatic install, sign-in or deploy, and no generation of native files such as
  `parameter.yml`.

## 8. Passes, after 0.16 and 0.17

| Pass | Content |
|---|---|
| **0.18: toolchain, ID map, connections** (implemented in 0.18.0) | Manifest v5 (`toolchain`, per-environment `values`, `connections`) with an upgrade and a backup; Readiness sections *Tools & versions* and *Connections*; the read-only checks above; the `.vscode/extensions.json` comparison; new AI pack fields; a `PREPARING_A_PROJECT.md` section; negative tests (a secret-looking value in any environment, credential files never opened, unknown tools); the data-goblin plugin list refreshed to 11 |
| **Toolkit catalogue** (planned as "0.19" here; now after AI-2, see 09 §13.1) | Catalogue and recipes as dated data (Fabric and Power BI first, then Databricks and Azure), read from the hub repository (section 5.4) over a built-in baseline, shown in Details, board cards and Options; `recipe` on board items; the "Needs a newer DataPass" list from `datapassRequests` |
| Mini-projects (testlab) | 1. Copy Job bulk edit with a backup (Fabric trial workspace) · 2. PBIP and Git with the FabCon workshop · 3. fabric-cicd from dev to prod with `parameter.yml` and the ID map · 4. Databricks bundle validate → deploy → run · 5. FUAM on a trial tenant (optional, admin) |
| Later | Recipes exported as skills for agents (D4); the read-only DataPass MCP server, already listed as later |

## 9. Decisions for Julian

| # | Question | Recommendation |
|---|---|---|
| D1 | Where do the catalogue and recipes live? | **Julian's direction (2026-09-25): the hub repository**, so ChatGPT updates them without an extension release, and says through `datapassRequests` when DataPass itself must change (section 5.4). The extension keeps a small built-in baseline of probes and official tools |
| D2 | Name | A **Toolkit** module in DataPass, rather than a separate "DataPass Cloud" product |
| D3 | First stack | Fabric and Power BI (the densest and most confusing community tooling, and the Copy Job case), then Databricks (whose official route of extension, CLI and bundles is already covered), then Azure |
| D4 | Recipes as skills for Codex, Claude and Copilot | Later, after the toolkit catalogue pass |

## 10. Sources (checked on 2026-09-25)

- GitHub metadata and READMEs, read with `gh`: `microsoft/fabric-toolbox`, `pbi-tools/pbi-tools`,
  `gbrueckl/FabricStudio`, `gbrueckl/PowerBI-VSCode`, `gbrueckl/OneLake-VSCode`,
  `gbrueckl/PowerBI-VSCode-ExtensionPack` (its `package.json` `extensionPack` list),
  `gbrueckl/Fabric.Toolbox`, `gbrueckl/fabric-cicd` (fork), `gbrueckl/semantic-link-labs` (fork),
  `gbrueckl/FabConAtlantaProDev` (fork), `gbrueckl/Databricks.API.PowerShell`,
  `data-goblin/power-bi-agentic-development`, `data-goblin/pbi-search` (archived),
  `data-goblin/powerbi-macguyver-toolbox`, `microsoft/fabric-cicd`, `microsoft/semantic-link-labs`,
  `microsoft/fabric-cli` (`docs/commands/fs/export.md`, `import.md`).
- Fabric REST API, *Items - Get Copy Job Definition* (Microsoft Learn), as pasted by Julian.
- The r/MicrosoftFabric thread *Fabric Studio for VS Code is freaking amazing* (a user story, not
  documentation).
- Codex skills and `AGENTS.md`: [OpenAI Developers, "Using skills to accelerate OSS maintenance"](https://developers.openai.com/blog/skills-agents-sdk)
  and community guides; check the folder the installed version reads.
