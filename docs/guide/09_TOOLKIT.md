# 9. The toolkit: tools, prices and recipes (DataPass ≥ 0.23)

For the AI that maintains a client's **hub repository**, and for the person who reads it in DataPass.
Field-by-field reference: [PREPARING_A_PROJECT.md section 14](../PREPARING_A_PROJECT.md). Complete,
test-validated example: [`examples/v3/hub/.datapass/toolkit/`](../../examples/v3/hub/.datapass/toolkit/)
(`tools.json`, `recipes/fabric.json`, with the MCP servers and the read-only MCP recipe) and the Sales BI board whose cards name those recipes
([`examples/v3/sales-bi/.datapass/board.json`](../../examples/v3/sales-bi/.datapass/board.json)).

## What it is

A shared knowledge base about the tools and services a project uses: what each tool is for, who
publishes it, when to use it and when not, how to install it (a command to copy), and **what is
free and what costs how much**, with the date the price was read. Recipes add the steps of a job
(for example a bulk edit of a Fabric Copy Job), one route per way of doing it, each route naming
its tools.

DataPass only **reads and shows** this knowledge: in the Workbench's Toolkit view, in a
component's Details ("Tools and what they cost"), on board cards that name a recipe, next to the
official tools an architecture option adds, and in the AI pack of a card. It never runs anything
from it: install commands and recipe commands are copied, never executed.

Comparing architectures (for example Azure Databricks vs Databricks vs Fabric notebooks, with prices
and consequences) is the client AI's work: it writes the comparison in `.datapass/options.json`
(costs with a `source` and an `asOf` date), and the toolkit gives it dated prices to start from.

## Where the files live

```text
hub repository   .datapass/catalog.json            the projects (exists since 0.13)
                 .datapass/toolkit/tools.json       tools, recipes, datapassRequests
                 .datapass/toolkit/recipes/*.json   more recipes (same format)
```

DataPass finds them in the project folder itself (when the coordination repository is also the hub)
and in the `toolkit/` folder beside each catalog listed in the `datapass.catalogs` setting. Without
any hub, DataPass shows its **built-in baseline**: every tool it knows, with descriptions and prices
read on 2026-09-26. A hub entry with the same id changes what is shown (marked "changed by the hub");
what DataPass probes on the computer stays the extension's.

## Rules for the AI that writes them

1. Every file starts with `"format": "datapass.toolkit"` and `"version": "1"`. Optional
   `"requires": { "datapass": ">=0.23.0" }` when the file needs a given DataPass.
2. **Never invent a price.** Read it on the vendor's official pricing page, write `checkedAt` (the
   date you read it) and `pricingUrl`. A figure you could not read there is `"unknown"`. `priceModel`
   is `free`, `freemium`, `paid`, `included` (a free tool that needs a paid service, such as a Fabric
   capacity or a Claude plan) or `unknown`. Say in `tiers[].features` which AI features need credits
   or a paid plan.
3. **Never invent a field.** Unknown fields make an entry invalid. When the format cannot say what the
   project needs, add an entry to `datapassRequests` (`title`, `why`, `example`): DataPass lists it as
   "Needs a newer DataPass", and it becomes input for the next DataPass version.
4. Tool ids are `family.name` in lowercase (`cli.fab`, `ext.fabric-studio`, `acc.fabric-toolbox`). A
   new tool needs `label` and `kind`. A new tool may reuse one of DataPass's probes (`"probe": "cli.az"`);
   any other probe id refuses the entry.
5. Links are `https://`, without credentials or tokens. Install commands are one line.
6. Keep ids stable: board cards name recipes (`"recipe"`, `"route"`) and other projects read the same hub.

## How it is updated

- **ChatGPT (DataPass-guided):** in the hub folder, *Copy a DataPass File for the AI* → *toolkit
  catalogue* → "Check the free tiers and prices" or "Add or correct tools and recipes"; paste the
  answer in the AI exchange. The import is strict: one invalid entry, a credential-shaped text or a
  local path refuses the whole file; otherwise you see a diff, a backup is kept, and you confirm.
- **An agent (Claude Code, Codex):** a pull request on the hub repository.
- DataPass reads the files again after *Get updates* or when they change.

## MCP servers and the official Power BI agentic route

An MCP server gives an agent host (GitHub Copilot, Copilot CLI, Claude Code, Codex…) tools that act
on a platform. The toolkit describes them like any other tool (`"kind": "mcp-server"`); DataPass
never installs one, never registers one in `mcp.json` and never builds an allowlist from toolkit data.
The example hub carries these entries, each read on its official page on 2026-09-26:

| Id | What it is | Where it runs · transport | Side effects |
|---|---|---|---|
| `mcp.fabric-core` | Fabric Core MCP Server: workspaces, items, folders, workspace roles (preview) | Microsoft-hosted · Streamable HTTP | reads-remote, writes-remote, credential-prompt |
| `mcp.fabric-local` | Fabric MCP Server (local): offline API docs, OneLake, items, Fabric Data Factory | your machine, started by the host · stdio | reads-remote, writes-remote, credential-prompt |
| `mcp.fabric-iq` | Fabric IQ MCP: find Power BI reports and models, read metadata, run DAX; read-only (GA) | Microsoft-hosted · Streamable HTTP | reads-remote, credential-prompt |
| `ext.powerbi-modeling-mcp` (built-in) | Power BI Authoring MCP, formerly Modeling: the local option (preview) | your machine · stdio | reads-remote, writes-remote, credential-prompt |
| `mcp.powerbi-authoring-hosted` | Power BI Authoring MCP, hosted option (preview) | Microsoft-hosted · Streamable HTTP | reads-remote, writes-remote, credential-prompt |
| `plugin.powerbi-authoring` | Microsoft's `powerbi-authoring` plugin (Skills for Fabric): skills plus the local Authoring MCP | GitHub Copilot CLI, with compatibility files for other hosts | installs-software, reads-remote, writes-remote, credential-prompt |
| `mcp.azure` | Azure MCP Server: Azure resources, not Fabric items | your machine, started by the host | reads-remote, writes-remote, credential-prompt |

Things people confuse, and the entries that say so:

- **Authoring is not report layout.** The Power BI Authoring MCP changes semantic models only; report
  pages and visuals are the report-authoring skills editing PBIR files. Register the local *or* the
  hosted authoring server for one agent, not both (Microsoft warns about overlapping tools).
- **Azure MCP is not Fabric.** Fabric MCP's Data Factory tools do not control an Azure Data Factory
  factory, and Azure MCP does not manage Fabric workspaces.
- **Not MCP servers:** Fabric Studio (`ext.fabric-studio`) is a community extension; the data-goblin
  plugins (`plugin.power-bi-agentic-development`) ship no MCP server; `acc.fabric-toolbox` is a
  collection (with two sample MCP servers among many other items); `py.semantic-link-labs` is a
  notebook library.
- **A local server does not keep data local.** Metadata, schemas and query rows go to the client and
  then to its model provider. Read-only still exposes them.

Rules for an MCP entry: `verified.on` with the date the official page was read; `sideEffects`
(`reads-remote`, `writes-remote`, `credential-prompt`); `useWhen` / `avoidWhen`; the hosts, the
transport, the endpoint and the data risk in `note`. The format has no transport, endpoint or hosts
fields and no "sends data to the model" side effect yet: the example asks for them in
`datapassRequests`, so do not invent fields for them.

The recipe `mcp.fabric-sample.inspect-readonly` ("Inspect a Fabric sample's metadata through an MCP
server (read-only)") walks one evidence chain per route (Fabric IQ, Fabric Core list-only, local
Authoring with `--readonly` on a PBIP copy): **known** (the entry and its date) → **installed** →
**registered** (the host's configuration) → **connected** → **authenticated** (which account) →
**operation verified** (the tools called, on the sample). An entry in `mcp.json` proves only
"registered".

## What DataPass does with a file it does not fully understand

| Case | What you see |
|---|---|
| One entry is invalid (unknown field, a price without `checkedAt`, a bad link) | The entry is skipped and listed with its reason under Toolkit → *Files read*; the rest is used |
| `requires.datapass` asks for a newer DataPass | The file is listed under *Needs a newer DataPass*; **none** of its entries is used |
| `"version"` is newer than DataPass reads | Same: listed, nothing used |
| A card names a recipe the toolkit does not have | A warning in the project's problems; the board still works |
