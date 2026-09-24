# DataPass VS Code V2 — Architecture, Product Vision and Claude Handoff

Date: 2026-09-24  
Repository: `julian-passebecq/datapass-vscode`  
Verified V1 baseline: `v0.8.0` on `main`, commit `9ef9034ec5a60635403fe35304915a5d00743a8b`  
Primary V2 pilot: **FOIL**  
Audience: Claude / next implementation agent

---

## 0. Executive summary

DataPass VS Code V2 is a **custom project/control layer inside VS Code** for operating real data/cloud projects much faster while continuing to use the strongest official or specialist tools for each platform.

It is **not** a replacement for Microsoft Fabric, Databricks, Power BI, Grafana, Oracle Cloud, Azure, Docker, GitHub, Azure DevOps, GitLab, Vercel, Cloudflare, etc.

The key proposition is:

> DataPass understands the project, its architecture, its repositories, its cloud resources, its workstreams, its required accounts/environment/secrets references, its current checklist, and what the user wants to work on. Then it routes the user into the correct official VS Code extension, CLI, repository or web console with the right context already prepared.

V2 is deliberately **AI-assisted but not agentic**.

The user will normally talk to ChatGPT/Claude outside the extension, because conversational AI is better for detailed explanations, screenshots, troubleshooting and iterative discussion. DataPass provides a low-cost/manual bridge:

1. select a project/workspace/scope in DataPass;
2. click **Copy AI Context**;
3. paste into ChatGPT/Claude and explain the goal;
4. AI returns a structured JSON/YAML/text plan and/or project files;
5. click **Import AI Plan** in DataPass;
6. DataPass validates and previews the changes;
7. the user prepares missing credentials/accounts/configuration;
8. DataPass provides a concise checklist and buttons into the official tools;
9. the user checks completed steps, records blockers/problems;
10. click **Copy Current Status** and return to AI for detailed next guidance.

V3 may add an agent/MCP layer. V2 must **not depend on MCP or paid autonomous AI execution**.

---

## 1. Do not confuse this with Datapass Mosaic

There are two different products.

### DataPass VS Code

Repository: `julian-passebecq/datapass-vscode`

Purpose:

- operate real projects;
- organize project/cloud context;
- prepare official tools;
- manage Git/configuration/checklists;
- understand project architecture;
- route into Fabric/Databricks/Azure/VM/Grafana/etc.;
- bridge project state to/from external AI.

### Datapass Mosaic

Separate project/extension.

Purpose:

- coding/learning/data-engineering environment;
- notebooks/labs/simulated or educational tooling;
- not the control-plane product described here.

Mosaic can have its own Git strategy later, possibly GitLab if useful for learning GitLab CI. Do not merge these products merely because both live in VS Code.

---

## 2. Preserve the good V1 architecture

The current v0.8 code already has the correct fundamental direction:

- one VSIX;
- core shell plus platform adapters;
- Galaxy/control-plane view;
- project manifest at `.datapass/project.json`;
- FOIL as profile #1;
- Microsoft Fabric adapter;
- Databricks adapter;
- Power BI adapter;
- Grafana/observability adapter;
- infrastructure adapter;
- CLI/extension detection;
- review-first actions;
- no secrets in source-controlled manifest;
- safe fallback when peer tooling is missing;
- official/specialist extensions remain primary clients;
- Grafana treated as code, not as a custom dashboard designer;
- Git/project repositories remain authoritative;
- no central database required.

Do **not** rewrite the extension from scratch.

V2 should primarily change:

- project model;
- project navigation;
- work-scope model;
- AI import/export;
- management/access/environment UX;
- checklist/session UX;
- resource/workspace graph;
- provider/repository flexibility;
- richer infrastructure/apps/Grafana project context.

---

## 3. Why this product belongs in VS Code

The user is managing a growing number of real cloud components and repeatedly loses time answering basic contextual questions:

- Which Fabric workspace is this?
- Which Databricks bundle/repository belongs to this part?
- Which VM is used by Wind vs Hydro?
- Which `.env` file applies here?
- Which account/email must I use?
- Which credentials are required?
- Which repo is GitHub vs Azure DevOps?
- Where is Grafana?
- Which app URL is production/staging?
- What is already configured?
- What should I do first today?
- Which official extension should I open?
- What did ChatGPT ask me to prepare?
- What failed last time?
- What context should I paste back into AI?

VS Code is a good control surface because the user is already there for:

- Git;
- local project files;
- DAB/Databricks;
- Fabric source/project files;
- Power BI source projects;
- IaC;
- Docker/Kubernetes;
- Remote SSH;
- terminal/CLI work;
- JSON/YAML configuration;
- code review/diff;
- official cloud extensions.

DataPass adds the missing **cross-platform project meaning**.

---

## 4. Core architecture rule: typed graph, not rigid hierarchy

Do not hard-code a universal hierarchy such as:

```text
Company > Project > Subproject > Module > Version
```

FOIL already shows why this is too rigid.

Different projects need different granularities. Instead implement a **typed project graph/tree with references**.

Useful node types may include:

- organization;
- project;
- domain;
- workstream;
- product;
- workspace;
- component;
- app;
- platform;
- environment;
- resource;
- repository;
- deployment;
- version.

The exact list can evolve. The important rule is:

> Hierarchy is for human navigation; relationships and bindings carry the real architecture.

A node can have:

- parent;
- children;
- dependencies;
- resource bindings;
- repository bindings;
- links;
- environments;
- versions;
- tags;
- owner/mode;
- AI context/instructions;
- checklist templates;
- provider references;
- official-tool references.

### Example

```text
FOIL
├── Wind
│   ├── Real-time
│   │   ├── MQTT
│   │   ├── Fabric streaming
│   │   ├── Grafana
│   │   └── Oracle VM usage
│   ├── 3D
│   │   ├── React app
│   │   ├── 3D modelling
│   │   ├── API
│   │   └── Oracle VM usage
│   └── Analytics
│       ├── Fabric
│       └── Power BI
│
├── Hydro
│   ├── Pipelines
│   ├── Notebooks
│   ├── Power BI
│   └── Oracle VM usage
│
└── Shared / Resources
    ├── Oracle tenancy
    ├── physical Oracle VM
    ├── Grafana instance
    ├── identity/accounts
    └── shared storage
```

The daily tree may show Oracle VM under Wind and Hydro because that is how the user thinks about it, while the architecture graph knows both are bindings to the same physical resource.

---

## 5. Resource vs binding: critical V2 abstraction

A real resource should be defined once.

Example:

```yaml
resources:
  foil-oracle-prod:
    type: vm
    provider: oracle
    sshHostRef: foil-prod
```

Then functional areas bind to it with their own configuration.

```yaml
bindings:
  - id: wind-runtime
    node: foil/wind
    resource: foil-oracle-prod
    runtimeProfile: wind

  - id: hydro-runtime
    node: foil/hydro
    resource: foil-oracle-prod
    runtimeProfile: hydro
```

This allows:

- same VM, different Docker Compose files;
- same VM, different `.env` requirements;
- same Grafana instance, different dashboard folders;
- same storage account, different project areas;
- same Fabric workspace, different workstreams if appropriate.

The UI can duplicate the **representation** without duplicating the **resource truth**.

---

## 6. Workspace/window rule

The user wants a simple mental model:

> **One VS Code window = one active DataPass workspace/scope maximum.**

Originally this was described as one subproject per window, but V2 should generalize it to a configurable **workspace node**.

Examples:

```text
VS Code Window 1
FOIL / Wind / Real-time

VS Code Window 2
FOIL / Hydro / Analytics

VS Code Window 3
FOIL / Website

VS Code Window 4
DATAPASS / some-workspace
```

Inside a single window there can still be many editor tabs:

- Fabric item 1;
- Fabric item 2;
- Databricks bundle files;
- terminal;
- Git;
- Mermaid architecture;
- DataPass checklist;
- official extension explorers.

A workspace can contain multiple related platforms if that is functionally correct. Do **not** force “one platform = one window”.

### Exclusive local lock

A workspace should normally not be active in two DataPass-controlled VS Code windows simultaneously.

Use a local lock/registry, not Neon.

Possible implementation:

- lock files under `ExtensionContext.globalStorageUri`;
- key: `projectId--workspaceId`;
- include PID/window/session metadata;
- stale-lock detection after crash;
- “Open existing / Read context / Take over” UX if needed.

Do not build distributed locking in V2.

---

## 7. Management modes: DataPass can know something without managing it

Every major node/component should support a management mode such as:

- `managed` — DataPass prepares/configures/version-controls it;
- `assisted` — DataPass understands it and provides actions/checklists, but another tool performs most work;
- `reference-only` — visible in architecture/quick links but not operated by DataPass;
- `external` — primarily a link to an external system/conversation/site;
- `disabled` — hidden/inactive for current project.

This is important for front-end projects and existing mature systems.

Example:

```yaml
website:
  type: app
  mode: reference-only
  repo: ...
  productionUrl: ...
  provider: vercel
```

The user may continue coding that React site through ordinary ChatGPT conversations. DataPass still provides macro visibility, links, Git identity, deployment location and dependency context.

---

## 8. Recommended V2 modules

### 8.1 Portfolio / Projects

Responsibilities:

- show organizations/projects;
- show project status;
- open a project;
- display workstreams/workspaces;
- recent work;
- project quick links;
- current Git provider(s);
- current cloud providers;
- choose what to work on today.

FOIL is the first serious pilot.

### 8.2 Project Graph / Architecture

Responsibilities:

- macro architecture;
- hierarchical browsing;
- dependencies;
- shared resources;
- platform/resource bindings;
- work scope visualization;
- small diagrams.

Use a canonical JSON model as source of truth.

Generate Mermaid for:

- lightweight diagrams;
- AI export;
- documentation;
- architecture preview.

Do **not** make Mermaid source the only editable project model.

A React/tree/graph UI can be added incrementally. Start simple if necessary.

### 8.3 Daily Work / Start My Day

This should become a first-class experience.

Flow:

1. Choose project.
2. Choose active workspace/scope.
3. Choose or import objective.
4. Run preflight.
5. Show missing prerequisites.
6. Show checklist.
7. Open required tools.
8. Mark steps done/blocked/problem.
9. Record short notes.
10. Export current status back to AI.

Suggested statuses:

- todo;
- in-progress;
- done;
- blocked;
- problem;
- skipped.

Each step should allow a small note.

Example:

```text
[✓] Git repository clean
[✓] Microsoft signed in
[!] Fabric workspace not confirmed
[x] Oracle SSH failed
    Note: key accepted but port 22 timed out
[ ] Open Fabric extension
[ ] Create/verify Eventstream
```

### 8.4 AI Handoff

One well-designed collapsible panel.

Actions:

- Copy AI Context
- Copy Selected Scope
- Copy Preflight
- Copy Checklist
- Copy Problems
- Copy Full Session Status
- Export JSON
- Export YAML
- Export Markdown
- Import from Clipboard
- Import File
- Preview AI Plan
- Apply Accepted Config/Files

Detailed troubleshooting remains in ChatGPT/Claude.

The extension should never require the user to manually assemble ten unrelated snippets.

### 8.5 Quick Access / Management

Per project/workspace, typed links such as:

**Cloud**
- Azure Portal;
- Fabric workspace;
- Databricks workspace;
- OCI Console;
- GCP Console / BigQuery if a future project uses them.

**Repositories**
- GitHub;
- Azure DevOps;
- GitLab.

**Operations**
- Grafana;
- Vercel;
- Cloudflare;
- Netlify;
- CI/CD.

**Apps**
- production;
- staging;
- API;
- Swagger;
- admin UI.

**Management**
- billing;
- IAM;
- secrets console;
- documentation.

Links belong to the project graph and can inherit from parent nodes.

### 8.6 Accounts / Access

The user is starting from near zero for some services and needs the extension to answer:

- which account/email;
- whether authenticated;
- what kind of credential is required;
- where to configure it;
- which official login action/tool to use.

Separate three concepts:

1. **Account identity**
   - Microsoft account;
   - GitHub identity;
   - Azure DevOps organization;
   - OCI tenancy/user;
   - Databricks account/workspace identity.

2. **Credential**
   - SSH key;
   - service-account token;
   - API token;
   - client credential.

3. **Environment/config**
   - workspace ID;
   - host name;
   - URL;
   - API endpoint;
   - non-secret resource identifier.

Do not dump all three into `.env`.

### 8.7 Environment / `.env` management

The user explicitly gets lost in multiple VM/application `.env` files.

V2 should provide an environment requirements view.

Version-control:

- `.env.example`;
- required variable names;
- descriptions;
- environment templates;
- non-secret IDs where appropriate.

Do not version-control:

- actual secrets;
- personal tokens;
- private keys.

Example UI:

```text
FOIL / Wind / VM / Environment

✓ WIND_API_PORT
✓ MODEL_PATH
✓ MQTT_HOST
⚠ FABRIC_WORKSPACE_ID missing
⚠ GRAFANA_TOKEN reference missing

[Open template]
[Open local .env]
[Compare]
[Copy missing list]
```

The extension should be able to tell AI **which variables are missing without exporting their secret values**.

### 8.8 Credential storage

Do not build a password manager.

V2 may use:

- vendor authentication;
- Azure CLI/session;
- Databricks auth;
- OCI CLI/config;
- SSH agent/config;
- VS Code `SecretStorage` only where a feature truly needs a local secret.

Possible future integrations:

- 1Password;
- Bitwarden;
- Azure Key Vault;
- HashiCorp Vault.

Project Git files should store references/requirements, never plaintext passwords.

Example:

```yaml
auth:
  oracle:
    method: ssh-agent
  grafana:
    method: secret-reference
    ref: grafana/foil/service-account
```

### 8.9 Git / Repository Management

Git is the core durable storage technology for V2.

DataPass must support different Git providers per project/workspace/component.

Possible providers:

- GitHub;
- Azure DevOps Repos;
- GitLab;
- generic Git remote.

Do not force one provider for the whole application.

Possible FOIL example:

```text
FOIL / Fabric      → Azure DevOps (if chosen)
FOIL / Databricks  → GitHub
FOIL / Grafana     → GitHub
FOIL / Infra       → GitHub
```

This gives the user practical exposure to Azure DevOps without forcing Grafana or every repo into it.

The local working tree is still normal Git regardless of remote provider.

DataPass should display:

- repository;
- remote/provider;
- branch;
- clean/dirty;
- ahead/behind if easy;
- last commit;
- quick link;
- open source control;
- optional recommended branch/workflow.

Do not build a second Git client.

### 8.10 Fabric module

DataPass must remain a companion to the Fabric ecosystem.

Known/important tools from the current source map:

- official Microsoft Fabric VS Code extension;
- Microsoft Fabric CLI;
- `microsoft/fabric-toolbox`;
- `microsoft/fabric-cicd`;
- `gbrueckl/FabricStudio`;
- `gbrueckl/OneLake-VSCode`;
- Fabric Extensibility Toolkit only where appropriate.

Important product distinction:

- **Fabric Toolbox** is primarily a repository/catalog of tools, accelerators, scripts and samples. It does not give the user one complete project-management UI. DataPass can curate and route into those assets.
- **FabricStudio** is a specialist/community VS Code experience from Gerhard Brueckl and should remain a companion, not be copied wholesale.
- **OneLake-VSCode** is another specialist companion for OneLake interaction.
- The official Microsoft extension remains primary where it has the supported experience.

DataPass V2 should:

- detect installed Fabric-related extensions/CLIs;
- show Not configured / Partial / Ready;
- bind the selected FOIL Fabric workspace;
- show workspace quick link;
- prepare local Git/project files;
- prepare/scaffold safe configuration;
- provide concise steps such as “Open Fabric extension”;
- export missing setup context to AI;
- let AI propose Fabric-related files/config;
- preview/review before writing;
- keep mutations explicit.

Do not attempt to recreate the Fabric UI.

### 8.11 Databricks module

Primary client:

- official Databricks VS Code extension.

Automation/project model:

- Databricks CLI;
- Declarative Automation Bundles / DAB;
- existing FOIL repository `julian-passebecq/foil_databrick_dab`.

DataPass V2 should:

- detect the official extension;
- detect CLI;
- detect `databricks.yml` / bundle root;
- display bundle target;
- show repo/branch;
- prepare AI-generated DAB files in Git;
- validate before deploy where possible;
- provide concise checklist;
- open the official extension;
- keep deploy/run user-triggered.

Do not resurrect the historical vendor-extension fork as a product.

### 8.12 Power BI module

Power BI remains relevant for FOIL reporting.

Use VS Code where useful for:

- PBIP;
- TMDL/PBIR;
- Git;
- semantic-model source;
- validation;
- automation;
- agentic/source workflows.

Specialist editing can remain external where better.

DataPass should primarily provide project context, Git, links, readiness and the relationship to the Fabric/FOIL workstream.

### 8.13 Grafana module

The user expects Grafana to be hosted/cloud-hosted and currently does not know how to configure it.

Therefore V2 needs more than “open Grafana docs”, but still must not become a dashboard designer.

Target model:

```text
Git dashboard/config source
    ↓
gcx / Foundation SDK
    ↓
preview/validate
    ↓
Grafana provider and/or Git Sync
    ↓
Hosted Grafana / Grafana Cloud
```

V2 should help the beginner establish:

- Which Grafana instance belongs to the project?
- What is its URL?
- How is authentication configured?
- What datasource(s) does it use?
- Where do dashboard source files live?
- Which repository owns them?
- How are dashboards deployed/synchronized?
- Which folders/dashboards belong to Wind vs Hydro?
- Is configuration complete?

Potential UI:

```text
FOIL / Grafana

Instance       ⚠ not configured
Repository     ✓ bound
Generator      ✓ configured
Git Sync       ? unknown
Datasource     ⚠ define

[Setup checklist]
[Open Grafana]
[Open dashboard source]
[Preview]
[Copy AI context]
```

Do not require Neon for DataPass.

If Grafana later uses PostgreSQL/Neon as **one datasource for actual monitoring/business data**, that is a Grafana/data architecture decision, not an extension persistence requirement.

Grafana should also consume appropriate native sources directly where applicable (Azure monitoring, Prometheus, etc.). Claude should not invent Neon merely to give DataPass a database.

### 8.14 Infrastructure / IaC module

This is explicitly required in V2.

Organize around:

**IaC**
- OpenTofu/Terraform;
- Bicep for Azure where useful;
- future Pulumi/CloudFormation only if a real project needs them.

**Containers**
- Docker;
- Docker Compose;
- container registries;
- Kubernetes/K3s.

**Compute**
- generic VM abstraction;
- OCI VM first;
- future Azure VM / AWS EC2 / generic SSH.

**Network**
- DNS;
- ports;
- VNet/VPC metadata;
- reverse proxy;
- public/private endpoints.

**Runtime**
- systemd/processes;
- Docker containers;
- K3s;
- logs;
- volumes;
- health checks.

DataPass supplies project context and safe commands/tool routing. It is not Docker Desktop or a Kubernetes replacement.

### 8.15 VM module

Implement a **generic VM model** with Oracle Cloud/OCI as FOIL pilot.

The user is not confident configuring Oracle yet, so the module must include setup/readiness.

Possible status:

```text
FOIL / Wind / Oracle VM

OCI account      ⚠ confirm
OCI CLI          ○ missing
SSH config       ✓ foil-prod
SSH key          ✓ available
Connectivity     ? not tested
K3s              ? unknown
Docker           ? unknown
Env profile      ⚠ 2 missing variables
Grafana agent    ? not configured
```

Quick actions may include:

- open OCI console;
- open SSH config;
- connect via Remote SSH;
- test SSH;
- open remote terminal;
- open project Docker Compose;
- copy status to AI.

All mutating infrastructure operations remain explicit and review-first.

### 8.16 Shared VM represented under Wind and Hydro

The user prefers to see the VM where it is used.

Example daily view:

```text
FOIL
├── Wind
│   └── Infrastructure
│       ├── Oracle VM
│       ├── Docker
│       ├── Compose
│       └── IaC
│
└── Hydro
    └── Infrastructure
        ├── Oracle VM
        ├── Docker
        ├── Compose
        └── IaC
```

The physical VM may be the same resource, but each binding can have distinct:

- Compose file;
- environment template;
- ports;
- containers;
- volumes;
- deployment version;
- runtime status.

Architecture view can reveal the shared physical resource.

### 8.17 Apps / Frontend module

Add a generic **Apps** module, not a React-only module.

Possible app types:

- React;
- Next.js;
- Vue/Vite;
- Streamlit;
- Gradio;
- static website;
- Databricks App;
- future cloud-native app types.

Responsibilities:

- source repo;
- owner/workstream;
- runtime;
- hosting provider;
- production/staging URL;
- environment;
- API dependencies;
- deployment links;
- management mode.

Example:

```text
FOIL / 3D App
├── type: React
├── mode: assisted/reference-only
├── repo: GitHub
├── hosting: Vercel
├── production URL
├── API → Oracle VM
└── Grafana dashboard
```

For a Streamlit app owned by Databricks:

```text
Optimization UI
├── type: Streamlit
├── owner platform: Databricks
├── source: DAB
└── deployment: Databricks
```

The Apps module gives macro visibility. The Databricks adapter still owns Databricks-specific operations.

### 8.18 Hosting/free-tier visibility

Useful providers may include:

- Vercel;
- Cloudflare;
- Netlify;
- Oracle Free Tier / low-cost resources;
- other project-specific free tiers.

V2 should at minimum support:

- provider binding;
- quick link;
- plan label if manually configured/detected;
- project resources;
- production URL;
- notes.

Do not hard-code fast-changing commercial quotas as permanent truth.

Live usage APIs can be added only where reliable and worth the implementation cost.

---

## 9. Storage and persistence model

### 9.1 Durable project truth: Git

Most V2 data is configuration, documentation or generated files and belongs in Git.

Examples:

- DataPass manifest;
- graph/workspace definitions;
- repository/provider bindings without secrets;
- quick links;
- `.env.example`;
- checklist templates;
- AI instructions/context;
- Mermaid/docs;
- DAB files;
- Fabric source/configuration;
- IaC;
- Docker Compose;
- Grafana dashboard source;
- app configuration;
- scripts.

Git gives:

- history;
- diffs;
- branches;
- review;
- rollback;
- remote backup;
- portability;
- provider independence.

This is much more appropriate than introducing Neon/Mongo/MotherDuck for JSON configuration.

### 9.2 Local extension state

Use VS Code local persistence for:

- expanded/collapsed UI;
- last selected project;
- recent workspaces;
- current daily checklist state;
- session notes not yet accepted as durable;
- local tool paths;
- temporary cache;
- workspace lock registry.

Use `workspaceState` / `globalState` / storage URIs appropriately.

### 9.3 Secrets

Use:

- vendor auth;
- OS/SSH mechanisms;
- `SecretStorage` only when needed.

Never commit plaintext secrets.

### 9.4 No mandatory database in V2

Do not require:

- Neon;
- MongoDB Atlas;
- MotherDuck;
- DuckLake.

They may be used by actual projects or Grafana datasources independently.

A central operational database could be reconsidered in V3 only if there is a concrete need such as cross-device sessions, fleet telemetry, audit analytics or multi-user collaboration.

---

## 10. Suggested repository layout

Do not over-fragment on day one, but V2 may evolve toward:

```text
project-root/
├── .datapass/
│   ├── project.json
│   ├── workspaces/
│   │   ├── wind-realtime.json
│   │   └── hydro-analytics.json
│   ├── checklists/
│   │   ├── wind-start.json
│   │   └── grafana-setup.json
│   ├── ai/
│   │   ├── project-context.md
│   │   ├── fabric.instructions.md
│   │   ├── databricks.instructions.md
│   │   └── infrastructure.instructions.md
│   └── diagrams/
│       └── architecture.mmd
│
├── .env.example
├── infra/
├── apps/
├── fabric/
├── databricks/
└── ...
```

This is illustrative, not a mandate. Preserve existing owning repositories rather than forcing a monorepo.

### Canonical format recommendation

Keep canonical DataPass configuration as JSON initially because:

- V1 already has JSON schema validation;
- VS Code has excellent JSON schema support;
- migration is easier.

Support AI import/export as:

- JSON;
- YAML;
- Markdown/text.

Do not needlessly change the canonical file format just because AI can emit YAML.

---

## 11. Git provider architecture

A project can use multiple remotes/providers.

Model provider per repository/binding, not globally.

Examples:

```yaml
repositories:
  fabric:
    provider: azure-devops
    remote: ...
  databricks:
    provider: github
    remote: ...
  grafana:
    provider: github
    remote: ...
```

Azure DevOps is particularly useful to explore with FOIL/Fabric if chosen, because it gives the user real experience with:

- Azure Repos;
- pipelines;
- Boards if later useful;
- Microsoft ecosystem integration.

GitHub can remain used for DataPass itself, Databricks, Grafana or other repositories.

GitLab is also a valid provider, but do not introduce it into FOIL without a concrete reason. It may be a better learning provider for Mosaic later.

---

## 12. AI exchange schema and safety

V2 needs a versioned import/export contract.

Possible conceptual export:

```yaml
schemaVersion: 1
kind: datapass-context

project:
  id: foil
  title: FOIL

workspace:
  id: wind-realtime

objective:
  text: "Connect real-time wind data to Fabric"

architecture:
  relevantNodes: [...]

repositories:
  - id: ...
    provider: github
    branch: ...

tools:
  fabricExtension: ready
  fabricCli: ready
  oracleSsh: partial

accounts:
  microsoft:
    status: ready
  oracle:
    status: missing

environment:
  required:
    - MQTT_HOST
    - FABRIC_WORKSPACE_ID
  missing:
    - FABRIC_WORKSPACE_ID

checklist:
  - id: ...
    status: ...

problems:
  - ...

links:
  - label: Fabric Workspace
    url: ...

security:
  secretsExported: false
```

Possible AI response:

```yaml
schemaVersion: 1
kind: datapass-plan

objective:
  ...

prerequisites:
  - ...

tasks:
  - ...

fileChanges:
  - path: ...
    operation: create
    content: ...

recommendedTools:
  - fabric

notes:
  - ...
```

### Import behavior

Never blindly apply an AI response.

Flow:

1. parse;
2. validate schema;
3. reject unsupported fields/unsafe paths;
4. scan for obvious secret material;
5. show diff/preview;
6. allow selective acceptance;
7. write accepted files/config;
8. refresh checklist/state.

Prevent path traversal and writes outside allowed workspace roots.

---

## 13. Checklist vs detailed documentation

The extension does **not** need to become a full interactive course.

VS Code should contain concise structured steps:

```text
1. [✓] Sign in to Microsoft
2. [ ] Open Fabric extension
3. [ ] Confirm FOIL workspace
4. [ ] Create/verify Eventstream
5. [!] MQTT connection blocked
       Add a note...
```

For detailed instructions, screenshots and troubleshooting, user exports the status to ChatGPT/Claude.

This division of labor is intentional:

- DataPass = structure + state + project context;
- AI chat = detailed explanation + adaptive troubleshooting.

---

## 14. Start My Day / preflight workflow

This should be one of V2's signature workflows.

Example:

```text
DataPass
→ FOIL
→ Wind / Real-time
→ Start work
```

Preflight sections:

### Git

- repo exists;
- branch;
- dirty files;
- remote;
- optional pull/fetch warning.

### Tools

- required extension installed;
- CLI installed;
- versions where useful.

### Accounts

- Microsoft;
- OCI;
- GitHub/Azure DevOps;
- Databricks;
- Grafana.

### Environment

- required variable names;
- missing variables;
- local file presence.

### Access

- SSH;
- cloud workspace binding;
- Grafana URL/auth reference;
- app deployment binding.

### Tasks

- imported/current objective;
- checklist;
- known blockers.

Result:

```text
READY: 8
MISSING: 3

Missing:
- Confirm OCI login
- Add FABRIC_WORKSPACE_ID
- Confirm Grafana instance URL

[Copy missing prerequisites]
[Copy full AI context]
```

The user can paste that into ChatGPT and ask what to do next.

---

## 15. V2 UI direction

Do not return to a giant diagnostic dump.

Keep the v0.8 health-first Galaxy idea, but evolve it into project/workspace control.

Suggested sidebar structure:

```text
DATAPASS
────────────────────────
FOIL
Wind / Real-time      ▾
────────────────────────

START / TODAY
3 missing prerequisites
5 remaining tasks
[Prepare session]

ARCHITECTURE
[small diagram / open full]

QUICK ACCESS
Fabric  Oracle  Grafana
GitHub  Azure   App

CHECKLIST
✓ Git
! OCI Login
○ Fabric Workspace
○ Eventstream

MODULES
▸ Fabric
▸ Databricks
▸ Azure
▸ Grafana
▸ Infrastructure
▸ Apps
▸ Management

AI HANDOFF
▸ Copy / Import / Export
```

Cards/panels should be collapsible.

Avoid showing every tool detail until expanded.

---

## 16. FOIL pilot — purpose

FOIL is a strong pilot because it is exactly the kind of project that becomes difficult to operate without a cross-tool project layer.

It combines:

- edge/VM infrastructure;
- streaming/real-time;
- local/edge processing;
- Azure services;
- Microsoft Fabric;
- OneLake;
- Spark/notebooks;
- vector/search/RAG;
- Power BI;
- Databricks work;
- Grafana/observability;
- front-end/3D applications;
- multiple repositories;
- multiple auth systems;
- multiple environments;
- likely different Wind and Hydro configurations.

The goal is **not** to redesign FOIL around DataPass.

DataPass should make existing and future FOIL systems easier to understand and operate.

---

## 17. FOIL high-level architecture supplied by the user

Current conceptual architecture:

```text
                    ORACLE EDGE
                    OCI VM / K3s
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     Machine         Environment        Airflow
        │                │                │
        └────────────── MQTT ─────────────┘
                         │
                  Polars / DuckDB
                         │
                         ▼
                       AZURE
                         │
        ┌────────────────┼──────────────────┐
        │                │                  │
        ▼                ▼                  ▼
     IoT/Event       Data Factory       STUDIES/FILES
        │                │                  │
        ▼                ▼              OneLake
   Eventstream        OneLake               │
        │                │          extraction / embeddings
    Eventhouse           │                  │
        │          Fabric Data Factory      ▼
        │                │             COSMOS DB
        │           Spark/Notebook     vector + BM25
        └───────┬────────┘             hybrid RAG
                ▼
             Power BI
```

Interpret this as a **working architecture concept**, not a promise that every Azure product name/binding is already final.

Important points requiring validation during implementation/configuration:

- exact Azure IoT/Event service choice;
- exact Fabric workspaces;
- exact OneLake/lakehouse structure;
- how Fabric Data Factory vs Azure Data Factory responsibilities divide;
- exact Cosmos DB account/vector/search configuration;
- exact Oracle VM/K3s runtime topology;
- exact Airflow placement;
- exact MQTT broker placement;
- whether Wind and Hydro share a physical VM;
- exact Grafana instance/datasources;
- exact app hosting topology.

DataPass should help surface and resolve these unknowns rather than silently invent values.

---

## 18. FOIL functional view for DataPass

A likely human-oriented structure:

```text
FOIL
│
├── Wind
│   ├── Real-time
│   │   ├── Machine / telemetry
│   │   ├── MQTT
│   │   ├── Edge processing
│   │   ├── Fabric Eventstream/Eventhouse
│   │   ├── Power BI
│   │   ├── Grafana
│   │   └── Oracle VM binding
│   │
│   ├── 3D / modelling
│   │   ├── modelling service
│   │   ├── API
│   │   ├── React/frontend
│   │   └── Oracle VM binding
│   │
│   └── Analytics
│       ├── Fabric pipelines
│       ├── OneLake
│       ├── Spark/notebooks
│       └── Power BI
│
├── Hydro
│   ├── ingestion/pipelines
│   ├── Fabric/OneLake
│   ├── notebooks
│   ├── dashboarding
│   └── Oracle VM binding
│
├── Studies / Documents / RAG
│   ├── OneLake files
│   ├── extraction
│   ├── embeddings
│   └── Cosmos DB hybrid search/vector/BM25
│
├── Databricks / R&D
│   └── DAB-managed workloads as applicable
│
├── Apps / Website
│   ├── FOIL public/new website
│   └── other React/Streamlit applications
│
└── Shared resources
    ├── Oracle tenancy / physical VM(s)
    ├── identity/accounts
    ├── Git providers
    ├── Grafana instance
    └── shared networking/storage
```

Do not lock this exact tree prematurely. It is a good starting representation.

---

## 19. FOIL + Fabric tooling vision

Claude should understand the complete tool composition.

### Official/supported primary paths

- Microsoft Fabric VS Code extension;
- Fabric CLI;
- Fabric Git/source formats;
- `microsoft/fabric-cicd` where appropriate.

### Microsoft Fabric Toolbox

Repository: `microsoft/fabric-toolbox`

It is a repository of tools, accelerators, scripts and samples from Fabric CAT.

DataPass already curates examples such as:

- Cost Analysis;
- Platform Monitoring;
- Unified Admin Monitoring;
- Spark Monitoring;
- Security Audit;
- Assessment Tool;
- Semantic Model MCP Server;
- Fabric Management MCP Server;
- DAX Performance Tuner;
- Real-Time Intelligence/Eventstream accelerator;
- CI/CD accelerators.

Important V2 rule:

> Toolbox assets should be discoverable and project-aware inside DataPass, but DataPass should not vendor the entire repository or pretend the Toolbox has one integrated UI.

### Specialist developer extensions previously identified

- `gbrueckl/FabricStudio`
- `gbrueckl/OneLake-VSCode`

These are useful peer/specialist VS Code experiences. DataPass can detect/link/open them where they improve the workflow.

Do not copy them into DataPass without a strong reason and license review.

---

## 20. FOIL + Databricks vision

Existing repository:

- `julian-passebecq/foil_databrick_dab`

Use:

- official Databricks VS Code extension;
- Databricks CLI;
- DAB;
- Git.

The custom DataPass layer should know why the bundle exists and which FOIL workstream it belongs to.

A typical AI-assisted flow:

1. select FOIL / Databricks workspace;
2. export context;
3. tell ChatGPT what Databricks workload is needed;
4. AI produces DAB YAML/Python/file changes;
5. import/preview in DataPass;
6. write accepted files to Git working tree;
7. validate bundle;
8. open official Databricks extension;
9. user deploys/runs explicitly;
10. record result/blocker;
11. export status to AI.

---

## 21. FOIL + Oracle/edge vision

The Oracle/edge side is especially important because the user is currently less familiar with its configuration.

DataPass should help establish a repeatable path:

```text
OCI account/tenancy
→ OCI console / optional OCI CLI
→ VM resource
→ SSH configuration
→ Remote SSH
→ K3s/Docker runtime
→ services
→ MQTT
→ Airflow
→ Polars/DuckDB
→ network path toward Azure/Fabric
```

The extension should not assume all of this is already configured.

It should show setup gaps and export them to AI.

Example:

```text
Oracle Edge Setup

✓ VM resource declared
? OCI account binding
✓ SSH alias
! SSH test failed
? K3s installed
? MQTT broker configured
? Airflow configured
✓ wind .env.example
! 2 required variables missing

[Copy setup context]
[Open OCI]
[Open SSH config]
[Connect via Remote SSH]
```

---

## 22. FOIL + Grafana vision

The user wants DataPass to help configure Grafana from a beginner starting point.

DataPass should know:

- hosted instance URL;
- project/folder mapping;
- Git source location;
- generator/config path;
- deployment/sync mechanism;
- required auth reference;
- datasource inventory;
- dashboard ownership by workstream.

It should guide setup structurally, while ChatGPT provides detailed instructions.

Possible FOIL dashboards:

- edge/VM health;
- MQTT/message health;
- K3s/Docker;
- streaming pipeline health;
- Fabric-related monitoring where appropriate;
- business/operational metrics where appropriate.

Do not assume all data belongs in Neon. Use appropriate native/project data sources.

---

## 23. Front-end and application management

FOIL will likely have a new website and may have React/3D/Streamlit interfaces.

DataPass should not force these to be developed through DataPass.

It should answer:

- what app exists;
- where source is;
- who owns it;
- where it is hosted;
- what environment it uses;
- which API/backend it calls;
- production/staging URLs;
- provider dashboard quick link;
- how it relates to Wind/Hydro/etc.

An app can be `reference-only` and still be useful in the project graph.

---

## 24. Versions

Do not make “version” a fixed hierarchy level.

Sometimes a version covers a full architecture:

```text
Wind 3D
└── v1
    ├── Fabric
    └── Oracle
```

Sometimes individual components version independently:

```text
Wind 3D
├── Oracle runtime v2
└── Fabric pipeline v3
```

Use version metadata and optional version nodes where they actually clarify the project.

Git remains the definitive file/version history.

---

## 25. V2 readiness/status model

Every adapter/resource should strive for a common readiness vocabulary:

- Not configured
- Partial
- Ready
- Attention
- Unavailable

Avoid opaque numeric health scores.

For each missing requirement, provide:

- plain-language reason;
- safe action if available;
- link/tool to open;
- ability to include it in AI export.

---

## 26. Proposed migration from manifest v1

Current manifest v1 is platform-centric.

V2 needs a more expressive model but should preserve backward compatibility long enough to migrate existing FOIL configuration.

Possible V2 concepts:

- `project`;
- `nodes`;
- `resources`;
- `bindings`;
- `repositories`;
- `workspaces`;
- `links`;
- `checklists`;
- `platforms/adapters`.

Claude should design a schema that:

- remains readable;
- remains JSON-schema validated;
- supports partial projects;
- supports unknown future adapters;
- avoids secrets;
- avoids forcing a monorepo;
- supports relative paths;
- can be generated/imported by AI safely.

Consider automatic v1 → v2 interpretation rather than destructive migration.

---

## 27. Implementation strategy

Recommended order:

### Pass V2.1 — domain model

- design schema v2;
- preserve v1 compatibility;
- node/resource/binding/workspace types;
- repository/provider model;
- management modes;
- tests.

### Pass V2.2 — project/workspace UX

- project selector;
- workspace selector;
- one-workspace-per-window model;
- local locking;
- quick access;
- basic architecture/tree.

### Pass V2.3 — Daily Work

- Start My Day;
- preflight;
- checklist;
- blockers/problems;
- notes;
- local session persistence.

### Pass V2.4 — AI Handoff

- versioned export;
- JSON/YAML/Markdown;
- clipboard UX;
- import parser;
- validation;
- preview/diff;
- selective apply;
- secret/path safety.

### Pass V2.5 — Management

- accounts/access requirements;
- environment variable requirements;
- `.env.example` comparison;
- credential references;
- links/providers.

### Pass V2.6 — FOIL Fabric/Databricks

- bind real FOIL contexts;
- validate official extension routing;
- DAB flow;
- Fabric project files;
- Toolbox/FabricStudio/OneLake companion links;
- concise setup checklists.

### Pass V2.7 — FOIL Infra/Oracle/Docker

- VM generic resource;
- OCI profile;
- SSH/Remote SSH;
- Docker/Compose/K3s context;
- Wind/Hydro runtime bindings;
- setup/readiness export.

### Pass V2.8 — Grafana

- hosted instance binding;
- Git dashboard source;
- datasource/config readiness;
- gcx/Foundation SDK/provider/Git Sync flow;
- setup checklist.

### Pass V2.9 — Apps

- generic application model;
- React/Streamlit;
- Vercel/Cloudflare links;
- reference-only mode;
- project dependency display.

This order is guidance, not a rigid contract. Claude can combine passes when code structure makes it more efficient.

---

## 28. V2 acceptance scenario: Fabric from an AI conversation

A representative target workflow:

1. User opens DataPass.
2. Selects FOIL.
3. Selects Wind / Real-time.
4. Clicks Copy AI Context.
5. In ChatGPT: “I want to configure the Fabric side for this real-time path.”
6. ChatGPT sees architecture, current tool status and known bindings.
7. ChatGPT returns a DataPass plan payload.
8. User pastes it into Import AI Plan.
9. DataPass shows:
   - 3 prerequisites;
   - 6 tasks;
   - proposed files/config;
   - official tools to use.
10. User accepts safe file changes.
11. Preflight says Microsoft login/Fabric workspace/other config missing.
12. User prepares them.
13. DataPass checklist says “Open Fabric extension”.
14. Button opens/focuses the official extension or relevant workspace.
15. User performs the cloud-side action.
16. User checks task as done or marks a problem with a note.
17. Copy Current Status.
18. Paste to ChatGPT.
19. ChatGPT gives the next detailed step.

If V2 supports this cleanly, the architecture is working.

---

## 29. V2 acceptance scenario: Oracle beginner setup

1. User selects FOIL / Wind / Edge.
2. DataPass reports OCI/SSH/K3s/MQTT readiness.
3. Missing items are explicit.
4. User exports status to AI.
5. ChatGPT explains exactly how to set up OCI/SSH.
6. User follows instructions, using DataPass quick links/buttons.
7. DataPass refreshes the readiness state.
8. The VM can then be opened via Remote SSH.
9. Wind-specific Docker/env configuration is shown.
10. Hydro can later bind the same physical VM with a different runtime profile.

The user should no longer need to remember “which VM/.env/account was this?”

---

## 30. V2 acceptance scenario: Grafana beginner setup

1. User selects FOIL / Observability.
2. Grafana card says Not configured/Partial.
3. It shows which facts are missing: instance URL, auth reference, repo path, deployment/sync method, datasources.
4. User clicks Copy Grafana Setup Context.
5. ChatGPT explains how to create/configure the hosted Grafana instance.
6. User records non-secret bindings in DataPass.
7. Dashboard source is Git-versioned.
8. Preview/validate actions work.
9. Deployment/sync remains explicit.
10. Wind/Hydro dashboards are visible through project bindings.

---

## 31. V3 / future agent and MCP

V2 does **not** need MCP.

However, V2 architecture should make future MCP/agent support easy by ensuring all important actions have structured inputs/outputs.

Future V3 possibilities:

- DataPass MCP server exposing project graph/readiness/checklist;
- agent calls to supported vendor tools;
- direct ChatGPT/Claude integration;
- automated context retrieval;
- autonomous safe-read workflows;
- approval-gated ChangeSets;
- richer telemetry/history;
- optional remote/shared state.

Do not block V2 waiting for an MCP design.

Do not assume MCP itself implies a specific AI cost model. Cost depends on the model/provider/agent usage. V2 intentionally avoids this dependency.

---

## 32. Explicit V2 non-goals

Do not add these unless the user changes direction:

- mandatory Neon;
- mandatory MongoDB;
- mandatory MotherDuck;
- mandatory DuckLake;
- always-on AI service;
- autonomous cloud mutation;
- MCP requirement;
- custom password vault;
- replacement Fabric UI;
- replacement Databricks UI;
- replacement Grafana designer;
- replacement Docker/Kubernetes UI;
- huge built-in tutorial system;
- forced monorepo;
- forced GitHub-only provider;
- forced fixed 4-level project hierarchy;
- duplicated physical resources just because they appear in multiple functional trees.

---

## 33. Open questions / points of uncertainty for Claude

These are intentional unknowns. Do not invent answers silently.

### Project/schema

1. Exact v2 JSON schema shape.
2. Whether workspaces should live inline in `project.json` or split into files.
3. How much daily checklist state should remain local vs optionally committed.
4. Best representation of inheritance from project → workstream → component.
5. Exact UI for graph/tree initially; simple tree may be better than a complex canvas for first pass.

### VS Code window locking

6. Best robust local lock mechanism across extension-host processes.
7. Exact stale-PID detection across Windows/macOS/Linux.
8. Whether “read-only second window” is useful or unnecessary for V2.

### Git

9. Exact FOIL repositories that should use GitHub vs Azure DevOps.
10. Whether FOIL Fabric should migrate/use Azure DevOps as a learning/production choice.
11. Exact branch strategy per FOIL component.

### Fabric

12. Exact Microsoft Fabric VS Code command IDs and supported handoff actions should be re-verified before coding.
13. Exact FOIL Fabric workspace name/ID is not yet authoritative in this repo.
14. Exact division between Azure Data Factory and Fabric Data Factory in FOIL.
15. Which Fabric Toolbox assets should be first-class FOIL actions vs reference links.

### Oracle/edge

16. Exact OCI VM count and topology.
17. Whether Wind and Hydro share one physical VM or will have separate VMs.
18. Exact K3s/Docker layout.
19. MQTT broker location/config.
20. Airflow deployment location.
21. OCI account/tenancy/region details.
22. Which OCI actions can be safely detected without storing credentials.

### Grafana

23. Exact hosted Grafana choice/instance does not appear fully configured yet.
24. Exact datasource list.
25. Exact Git Sync/provider strategy.
26. Whether a Grafana Cloud free tier is sufficient is a current commercial/product question and should be verified when configuring, not hard-coded.
27. Whether Grafana should monitor both edge infrastructure and Fabric/Azure through separate data sources.

### Apps

28. Exact repository/hosting for the upcoming FOIL website.
29. Whether the 3D app is part of that site or a separate app.
30. Which Streamlit apps are Databricks-owned vs generic.

### AI exchange

31. Exact import schema and file-operation security limits.
32. Whether AI plans should be stored durably in Git after acceptance or remain local by default.
33. Whether the user wants a permanent session history in V2; avoid adding a database until this need is demonstrated.

---

## 34. Important implementation discipline

- Start from current `main`.
- Keep CI green.
- Add tests for every new parser/schema/migration.
- Never store secrets in fixture manifests.
- Keep mutations review-first.
- Use official extension commands/CLIs rather than vendor-source copying.
- Preserve licensing/notice requirements.
- Keep donor references in `handoff/SOURCE_MAP.md`.
- Prefer simple useful UI over an overbuilt graph editor.
- Every feature should answer a concrete daily user problem.
- A project/resource can be known without being managed.
- A missing integration must degrade into a useful “what is missing / what to do next” state.
- AI-generated files must be inspectable as normal Git changes.

---

## 35. Product success criterion

The extension succeeds when the user can open VS Code in the morning, select:

```text
FOIL → Wind → Real-time
```

and immediately see:

- where they are;
- the relevant architecture;
- relevant repositories;
- relevant cloud workspaces/resources;
- the Oracle/VM runtime involved;
- Fabric/Databricks/Grafana status;
- which account/access is needed;
- which environment variables are missing;
- current Git state;
- today's checklist;
- blockers;
- quick links;
- the correct official extension/tool to open;
- a one-click AI context export.

The user should then be able to work with ChatGPT/Claude as the detailed guide, while DataPass remains the **persistent, versioned, project-aware cockpit** that keeps the entire system coherent.

That is the V2 vision.
