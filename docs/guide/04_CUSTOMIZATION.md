# 4. Customizing a project: profiles, providers, packs, VMs, environments

Everything here is declared in the same files as [02](02_WHAT_THE_AI_PREPARES.md); nothing is a
plug-in and nothing runs code. When the model has no place for something, write it in
`docs/ARCHITECTURE.md` and `AGENTS.md` — never invent a JSON field (unknown fields are errors).

## 4.1 Artifact profiles: "what files does this component need?"

A graph component's `artifacts.profile` names a convention: the expected files, the entry file and
the usual operations. Pick the closest one; complete it with `files` (extra files, with
`requiredFor` phases) and `entry`.

| Profile | Use for |
|---|---|
| `azure-functions.python` | A Python Function App (`function_app.py`, `host.json`, `requirements.txt`) |
| `databricks.bundle` | A Databricks Asset Bundle (`databricks.yml`) |
| `adf.factory` | An Azure Data Factory Git folder (`pipeline/`, `linkedService/`…) |
| `azure-storage.container`, `cosmos-nosql.container`, `mongodb.database`, `postgres.migrations` | Data stores, with their definition files |
| `python.script`, `python.package`, `jupyter.notebook` | Python code and notebooks |
| `fabric.item`, `powerbi.pbip` | Fabric items in Git format, Power BI projects |
| `terraform`, `bicep` | Infrastructure as code |
| `airflow.dags`, `github-actions`, `azure-pipelines`, `gitlab-ci` | Orchestration and CI |
| `json-schema`, `docs`, `generic` | Contracts, documentation, anything else |

A **project profile** (`project.profile`, e.g. `"foil"`) is older: it only selects built-in settings
for one consumer. Do not add one for a new client.

## 4.2 Providers: "which service is this?"

`provider` on a component chooses the official tool DataPass routes to and whether it has
operations (`operations`), files only (`files`) or nothing (`unsupported`, shown but never "ready").
The list is in [02 §2.3](02_WHAT_THE_AI_PREPARES.md#23-datapassgraphjson--the-components-version-02).
A service DataPass does not know: `"provider": "other"` plus `docs` pointing at its portal. Never
pick a wrong provider to get a green state (Cosmos DB for NoSQL, Cosmos DB for MongoDB and MongoDB
Atlas are three different services; Azure Data Factory is not Fabric Data Factory).

## 4.3 Domain packs (opt-in, declarative)

`"domainPacks": ["builtin:<namespace>"]` or a workspace-relative `.datapass/packs/<name>.json`
(schema `datapass-domain-pack.schema.json`) adds a vocabulary, forms and facets for a business
domain. A pack is data only — no code, expressions or install steps. Most client projects need none.

## 4.4 Environments and the ID map

Declare only the environments that exist (`dev` first). Anything that differs per environment
goes into the **ID map** (`identifiers[].values`), and operations name the environment:

- one subscription per environment → one identifier `sub-data` with `values: { dev, prod }`;
- the same tenant everywhere → `value` (one value);
- a resource name per environment in an operation target (`"functionApp": "func-invoices-dev"`) →
  one operation per environment, each with its own `environment` and `target`.

A connection naming an identifier with per-environment values must name its `environment`.

## 4.5 Resources such as VMs — worked example with two VMs

A **resource** is a machine or host declared once in `project.json` (`resources[]`: `id`, `kind` —
`vm`, `container-host`, `kubernetes-cluster`, `database`, `workspace`, `other` —, `title`,
`provider`, `ssh.host`). A **binding** says how one sub-project uses it (`bindings[]`: `resource`,
`scopes`, `folder` — absolute on the host —, `repository`, `compose`, `env` — variable **names** —,
`processes`). When two sub-projects share one VM, DataPass says that restarting it affects both.

`ssh.host` is an **alias of the person's `~/.ssh/config`** — never `user@address`, a port, an IP
with credentials or a key path. The person writes the real host, user and key in their SSH config
([03](03_CE_QUE_JULIAN_PREPARE.md)). To also get the VM on the diagram, with *Open over SSH*,
add a graph component with `provider: "vm"` and the operation `infra.remote.ssh`
(`target: { "sshHost": "<alias>", "folder": "/opt/…" }`). The `infrastructure` module must stay on.

The client has an **API VM** on Azure (runs the review web app in Docker) and a **workers VM** on
Oracle Cloud (runs a nightly Python job), in `dev` only for now:

<!-- example: two-vms project -->
```json
{
  "schemaVersion": 5,
  "project": { "id": "invoice-reader", "title": "Invoice reader", "type": "work" },
  "modules": { "infrastructure": true },
  "repositories": {
    "review-app": { "label": "Review web app", "remote": { "url": "https://github.com/example-org/invoice-review-app" } },
    "workers": { "label": "Nightly workers", "remote": { "url": "https://github.com/example-org/invoice-workers" } }
  },
  "environments": [ { "id": "dev", "title": "Development" } ],
  "graph": ".datapass/graph.json",
  "scopes": [
    { "id": "review", "title": "Review app", "repoRef": "review-app", "itemRefs": ["vm-api", "review-web"] },
    { "id": "batch", "title": "Nightly batch", "repoRef": "workers", "itemRefs": ["vm-workers", "nightly"] }
  ],
  "resources": [
    { "id": "vm-api", "kind": "vm", "title": "API VM (Azure, Ubuntu 22.04, B2s)", "provider": "azure", "ssh": { "host": "invoice-api-dev" } },
    { "id": "vm-workers", "kind": "vm", "title": "Workers VM (Oracle Cloud, Ampere A1, 2 OCPU / 12 GB)", "provider": "oci", "ssh": { "host": "invoice-workers-dev" } }
  ],
  "bindings": [
    { "id": "review-on-api", "resource": "vm-api", "scopes": ["review"], "folder": "/opt/invoice/review", "repository": "review-app",
      "compose": "docker-compose.yml", "env": ["MONGODB_URI", "REVIEW_BASE_URL"], "processes": ["review-web", "caddy"] },
    { "id": "batch-on-workers", "resource": "vm-workers", "scopes": ["batch"], "folder": "/home/ubuntu/invoice-workers", "repository": "workers",
      "env": ["MONGODB_URI"], "processes": ["nightly.timer"] }
  ],
  "identifiers": [
    { "id": "vm-api-name", "label": "API VM name (Azure)", "provider": "azure", "kind": "item", "values": { "dev": "vm-invoice-api-dev" } },
    { "id": "vm-workers-ocid", "label": "Workers VM instance (OCI)", "provider": "oci", "kind": "item",
      "values": { "dev": "ocid1.instance.oc1.eu-frankfurt-1.anexampleinstance" } }
  ],
  "toolchain": { "tools": [ { "tool": "ext.remote-ssh" }, { "tool": "cli.ssh" }, { "tool": "ext.containers", "optional": true }, { "tool": "cli.docker", "where": "ci" } ] }
}
```

<!-- example: two-vms graph -->
```json
{
  "format": "datapass.graph",
  "version": "0.2",
  "items": [
    { "id": "vm-api", "kind": "resource", "label": "API VM", "provider": "vm",
      "operations": [ { "capability": "infra.remote.ssh", "environment": "dev", "target": { "sshHost": "invoice-api-dev", "folder": "/opt/invoice/review" } } ] },
    { "id": "vm-workers", "kind": "resource", "label": "Workers VM", "provider": "vm",
      "operations": [ { "capability": "infra.remote.ssh", "environment": "dev", "target": { "sshHost": "invoice-workers-dev", "folder": "/home/ubuntu/invoice-workers" } } ] },
    { "id": "review-web", "kind": "application", "label": "Review web app (Docker)", "provider": "docker",
      "artifacts": { "root": ".", "files": [ "Dockerfile", "docker-compose.yml" ] } },
    { "id": "nightly", "kind": "script", "label": "Nightly job", "provider": "python",
      "artifacts": { "profile": "python.script", "root": ".", "entry": "nightly.py" } }
  ],
  "relations": [
    { "id": "r1", "source": "review-web", "target": "vm-api", "relation": "runsOn" },
    { "id": "r2", "source": "nightly", "target": "vm-workers", "relation": "runsOn" }
  ]
}
```

What each piece is for:

| Parameter | Where | Who fills it |
|---|---|---|
| The VM's SSH alias (`invoice-api-dev`) | `resources[].ssh.host` and the graph target `sshHost` (same value) | The AI proposes the alias; the person writes the matching `Host` block in `~/.ssh/config`. |
| Size, OS, region | `resources[].title` (text) and `sheet.json` `runtimes[]` (`host`, `specs`, `os`, `region`, `access`: the alias) | The AI, from the client's decision — never invented. |
| Folder on the VM | `bindings[].folder`, graph target `folder` | The AI. |
| Env variable **names** on the VM | `bindings[].env` | The AI; values stay on the VM or in the vault. |
| Azure VM name, OCI instance id | `identifiers[]` (`kind: "item"`), per environment | The AI from the portal, if the client gives it; ids only. |
| SSH user, IP address, private key | **Nowhere in Git.** `~/.ssh/config` of the person | The person. |

A second environment (`prod`) for the same role is a **second resource** (`vm-api-prod`, alias
`invoice-api-prod`) and a second operation with `"environment": "prod"`: resources and bindings have
no per-environment field (see [07](07_KNOWN_LIMITS.md)).

Refused — a user name and address instead of an SSH alias:

<!-- refused: project -->
```json
{ "schemaVersion": 5, "project": { "id": "p", "title": "P" },
  "resources": [ { "id": "vm-api", "kind": "vm", "ssh": { "host": "azureuser@20.50.10.4" } } ] }
```

Refused — a value in a binding's env list:

<!-- refused: project -->
```json
{ "schemaVersion": 5, "project": { "id": "p", "title": "P" },
  "resources": [ { "id": "vm-api", "kind": "vm", "ssh": { "host": "invoice-api-dev" } } ],
  "bindings": [ { "id": "b1", "resource": "vm-api", "env": [ "MONGODB_URI=mongodb+srv://user:pw@cluster0.example.net" ] } ] }
```

Refused — the legacy `platforms.oracle.sshHost` with a user and address (it takes an alias too):

<!-- refused: project -->
```json
{ "schemaVersion": 5, "project": { "id": "p", "title": "P" }, "platforms": { "oracle": { "sshHost": "opc@130.61.0.10" } } }
```

## 4.6 Older blocks still read

- `platforms.oracle.sshHost` — an SSH alias; DataPass turns it into a resource `oracle-vm`. New
  projects use `resources[]` instead.
- `platforms.fabric`, `platforms.databricks`, `platforms.grafana`, `platforms.infrastructure`,
  `platforms.airflow`, `platforms.powerbi` — settings for the older Work view operations (workspace
  name, bundle root, Grafana URL and dashboards…). Use them only when a check or an operation asks.
- `apps[]` (external apps with their repository and hosting page), `links[]` (https pages).
