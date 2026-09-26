# 1. Overview: what DataPass is, and the words it uses

## 1.1 What DataPass is

DataPass VS Code is a **workbench** between four parties:

- **the AI** (Claude, ChatGPT, Codex…) that prepares a project in Git — descriptions, native files,
  pull requests;
- **the Git host** (GitHub, Azure DevOps, GitLab) that stores it;
- **the official VS Code extensions and CLIs** (Azure Functions, Databricks, Fabric, Azure CLI,
  Remote - SSH…) that do the real cloud work;
- **the person** (here Julian, a cloud beginner), who reviews, merges and runs.

A project is described once, in a **coordination repository**, by a few JSON files. DataPass reads
them, compares them with what is really on the disk, in Git and on the computer, and shows: the
architecture, what is missing and why, which official tool to open next, and what the AI should do.

The coordination repository (also called the **bridge**) is a light layer: links to the project's
repositories and DataPass JSON, never code. It is where the team and its AIs work, not part of what
the client and its auditor receive; the code lives in the native repositories — preferably one per
sub-project, or one repository with sub-folders ([Repository layout](../PREPARING_A_PROJECT.md#repository-layout)).

## 1.2 What DataPass is not

- Not a deployer: it never deploys, never provisions a cloud resource, never runs a pipeline. It
  opens the official tool, with the right file and target.
- Not a Git client that acts alone: it fetches and fast-forwards only on an explicit click, never
  commits, pushes or merges for you (work-order agents open PRs; the person or, for dev projects,
  the agent merges on green CI).
- Not a secret store: it never reads, stores or shows a secret value. Variable **names** and
  non-secret **ids** only.
- Not a proof: a declaration (`"status": "prepared"`, a checklist tick, an AI saying "done") is
  never shown as verified. DataPass shows what it observed.
- Not an AI API client: the AI exchange is manual (copy/paste, Git, or a work order handed to the
  Claude/Codex desktop app). No paid API is needed.
- Not Mongoku, DiagramCloud or Datapass Mosaic (separate products; Mongoku is frozen and only reads
  `board.json`/`project.json` from GitHub by itself).

## 1.3 Vocabulary

| Word | Meaning | Where |
|---|---|---|
| **Coordination repository** | The small Git repository that describes one project: which repositories, sub-projects, components, environments, tools, ids. It holds no native code. One per project. | `.datapass/*.json`, `AGENTS.md`, `docs/` |
| **Native repository** | A repository holding real code in its native format (Function App, bundle, notebooks, SQL, Terraform). Referenced by its Git remote URL. | `repositories` in project.json |
| **Sub-project** (*scope*) | A work area of the project with an objective, a default repository, its components and a checklist ("Invoice pipeline", "Analytics"). Not necessarily its own repository. | `scopes[]` in project.json |
| **Component** (*item*) | One piece of the architecture: a function, a storage container, a database, a bundle, a notebook, a VM, a CI pipeline, a manual step. | `items[]` in graph.json |
| **Artifact** | The files of a component: its repository, folder (`root`), expected files, entry file, generated outputs. | `items[].artifacts` |
| **Operation** | Something the person can do on a component through an official tool, in a phase: read → develop → test → validate → deploy → run → publish. Identified by a **capability** id (`azure-functions.deploy`). Deploy/run/publish name an environment. | `items[].operations[]` |
| **Environment** | Where things are deployed: `dev`, `prod`… A review done for `dev` never counts for `prod`. | `environments[]` |
| **ID map** | The non-secret ids of the project (tenant, subscriptions, resource groups, workspaces, accounts), one value per environment. | `identifiers[]` |
| **Toolchain** | The tools and versions the project needs (CLIs, VS Code extensions, apps, Python libraries), compared with the computer. | `toolchain.tools[]` |
| **Connection** | A sign-in (az, fab, databricks), a Git binding (a Fabric workspace ↔ a folder) or a named cloud connection. Declared, sign-ins checked read-only on request. | `connections[]` |
| **Resource / binding** | A shared machine (a VM, a container host) declared once, and how each sub-project uses it (folder, repository, env names, processes). | `resources[]`, `bindings[]` |
| **Module** | A part of DataPass a project switches off when unused: `fabric`, `databricks`, `azure`, `databases`, `infrastructure`, `powerbi`, `grafana`, `airflow`, add-ons `mongoku`, `diagramcloud`, and the AI switches `workOrders`, `pilot`. | `modules` |
| **Profile** | An **artifact profile** is the convention for a kind of native unit (`azure-functions.python` expects `function_app.py`, `host.json`, `requirements.txt`). A *project profile* (`project.profile: "foil"`) is an older, consumer-specific setting. | `artifacts.profile` |
| **Provider** | The service behind a component (`azure-functions`, `cosmos-nosql`, `mongodb-atlas`, `databricks`, `vm`…): decides the official tool and whether DataPass has operations for it. | `items[].provider` |
| **Domain pack** | Optional declarative vocabulary and forms for a business domain. Data only, no code. | `domainPacks` |
| **Project type** | `dev`, `work` (client projects: the person merges, work orders off unless allowed) or `perso`. | `project.type` |
| **Work order** | A written task DataPass prepares for Claude Code or Codex (goal, repositories, branch, rules), handed to the desktop app; the agent returns `result.json` and PRs. | `.datapass/local/work-orders/` (machine-local) |
| **Work log** | The committed summary of the work orders (ids, titles, statuses, PR links). | `.datapass/work-log.json` |
| **Board, options, sheet** | Optional: kanban of tasks/bugs; architecture alternatives with costs; volumes, columns, formulas, runtimes. | `.datapass/board.json`, `options.json`, `sheet.json` |
| **Catalog / hub** | Optional list of projects (one per company or client) for *Switch Project*. | `.datapass/catalog.json` in a hub repository |

## 1.4 How the files fit

```text
hub repository (optional)      .datapass/catalog.json ──► lists coordination repositories
        │
coordination repository        .datapass/project.json   identity, type, modules, repositories,
(one per project)                                       environments, scopes, ID map, toolchain,
                                                        connections, resources/bindings, localEnv
                               .datapass/graph.json     components, their files, operations, relations
                               .datapass/board.json     tasks and bugs            (optional)
                               .datapass/options.json   architecture alternatives (optional)
                               .datapass/sheet.json     volumes, formulas, runtimes (optional)
                               .datapass/work-log.json  written by DataPass
                               .datapass/local/         machine-local, git-ignored, never prepared by an AI
                               .vscode/extensions.json  the toolchain's extensions
                               AGENTS.md, docs/
        │ by Git remote URL
native repositories            function_app.py, databricks.yml, notebooks, ADF JSON, SQL, Terraform…
```

Next: [02 — what the client's AI prepares](02_WHAT_THE_AI_PREPARES.md).
