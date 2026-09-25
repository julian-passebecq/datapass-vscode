# V3 architecture

## 1. The layer DataPass occupies

```text
   ChatGPT / Claude ──prepares──► GitHub (coordination repo + native repos)
          ▲                             │ clone / fetch / fast-forward (explicit)
          │ preparation pack            ▼
          │ (bounded, reviewed)   DataPass VS Code ──observes──► disk + Git (read-only)
          │                             │
          └──────── you ◄───────────────┤ shows: architecture, files found/missing, what each step needs
                     │                  │ routes: open file · open folder window · official tool
                     ▼                  ▼
          official extensions / CLIs / portals (Databricks, Fabric, Azure Functions, ADF Studio,
          Cosmos DB, MongoDB, PostgreSQL/Neon…) ── do the cloud work, own sign-in and deployment
```

DataPass holds no credentials, runs no project code, deploys nothing and pushes nothing. It is
useful offline: reading the architecture and the files needs no account.

## 2. Model

```text
catalog (optional, hub repo)      datapass.catalog          projects → coordination repository URL
project (coordination repo)       manifest v3               repositories · environments · scopes · docs · modules
  sub-project = scope             scopes[]                  objective · itemRefs · repoRef · checklist · docs
    component = graph item        graph 0.2 items[]         kind · provider · status · docs · checklist
      artifacts                   items[].artifacts         repoRef · root · profile · entry · files · generated
      operations                  items[].operations        capability · environment · target names
    relations                     graph relations           consumes/produces/feeds · invokes/orchestrates · dependsOn…
```

Each layer adds only what the previous could not say. Native definitions stay authoritative: a
graph relation does not replace an ADF activity; DataPass never becomes an executable ETL DSL.

### States (orthogonal, never one "green")

| Axis | Values | Source |
|---|---|---|
| Declared intent | planned · in-progress · prepared · active · retired | graph item `status` (what someone says) |
| Repository | local · not cloned (unbound) · planned · missing · wrong clone · no Git · not inspected (Restricted Mode) | observation |
| File | found · missing · not cloned · repo planned · not checked · to generate | observation |
| Component availability | complete · incomplete · generation-needed · unbound · planned-repo · unknown | derived |
| Operation | ready · blocked · needs-review · needs-config · unknown · unsupported | preflight per phase and environment |
| Result | worked / failed / not tried, stale when files or target changed | your record |

### Operations and phases

Every capability has a phase: read → develop → test → validate → deploy → run → publish. A
component operation is evaluated with: the tools on this machine, the component's repository and the
files required for that phase, the environment (required for deploy/run/publish), the declared target
names, and your reviews for that exact target digest. Remote-only operations (browse a database, open
ADF Studio) do not need the clone (`localFiles: false`).

## 3. Repositories on a real machine

- The manifest names repositories by **remote identity**; local paths are machine state.
- Resolution order: coordination folder → a clone you located (`.datapass/local/repositories.json`)
  → the declared path (legacy/monorepo) → an open workspace folder or a sibling folder (or a folder in
  `datapass.projectsFolders`) **whose Git origin matches**. A folder named like the repository but
  with another origin is a "wrong clone", never trusted.
- Planned repositories are part of the architecture before they exist.
- The "AI finished" loop: Prepare AI context → PR → merge → **Check for updates** (`git fetch`) →
  **Get updates** (`git merge --ff-only @{u}`, commits listed first; refused on divergence or local
  changes to tracked files) → re-inspection → changed components' reviews and results must be redone.
  VS Code's Sync (pull + push) is never used.

### One repository or several?

| Keep a folder in the same repository when… | Use a separate repository when… |
|---|---|
| same people, permissions, CI and release rhythm | different permissions, owners or release cadence |
| the native tool is happy in a subfolder (Databricks bundles, Functions with a project subpath) | the native tool binds to a repository root or branch (Fabric Git integration per workspace, ADF collaboration branch) |
| the code is small and tightly coupled | the code is reused by several projects |

A project always has one coordination repository (it can be the same repository as the code for a
monorepo). A hub repository with `.datapass/catalog.json` lists projects across companies; it never
aggregates their manifests.

## 4. Workbench layout

```text
┌ activity bar: DataPass ┬──────────── editor ────────────┬ secondary side bar ┐
│ Project (tree)         │ function_app.py / databricks.yml│ Details             │
│  sub-projects          │ (opened from the tree, the      │  selection, files,  │
│   components           │  diagram or the details)        │  steps by phase,    │
│    files ✓ ✗ ☁ ⚙       │                                 │  checklist, actions │
│  Repositories          ├─────────── panel ───────────────┤                     │
│  Problems              │ Architecture: diagram of the    │                     │
│ Work (legacy, folded)  │ selected sub-project            │                     │
│ Galaxy (folded)        │                                 │                     │
└────────────────────────┴─────────────────────────────────┴─────────────────────┘
```

- One selection (sub-project, component) is shared by the tree, the diagram, the details and the
  Workbench tab (the overview dashboard). Views can be moved by the person; *Workbench Layout* only
  focuses them.
- The diagram is laid out for the width it has (narrower boxes and two-line labels before any
  zoom-out; 100 % on demand). It never runs anything.
- Webviews use the theme variables, a strict CSP with nonce, `textContent` only, and an allowlist of
  commands whose arguments are re-validated against the project map.

## 5. Security boundaries kept from V2.x, and new ones

- Discovery reads names, stats, bounded bytes (content digests) and Git state; it never imports DAG
  Python, runs notebooks, evaluates YAML or executes project code.
- **New:** executables are resolved from absolute PATH entries only; Git runs with
  `core.fsmonitor=false`; Restricted Mode runs no Git at all.
- **New:** target values are resource names; credential-shaped values are rejected by the graph parser.
- Reviews and results are bound to operation, environment, target names and file digests.
- AI context is built from allowlisted fields, scrubbed, bounded and previewed; the person copies it.
