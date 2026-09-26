# What DataPass checks without running anything

Since 0.22, DataPass reads the common configuration files of a repository and reports mistakes in
**Problems** (source `DataPass`, the rule id as the code). It **parses only**: no child process, no
project code, no network, no sign-in. It therefore works in Restricted Mode (untrusted folder) and
in native repositories that contain no DataPass file at all.

The client's AI can use this page to pre-check its changes before it opens a pull request: every
rule below is a mistake the real tool (the Databricks CLI, Docker, Docker Compose) would reject later.

## When the checks run

| Trigger | What is checked |
|---|---|
| Saving a file (setting `datapass.checks.onSave`, on by default) | That file; for a YAML file inside a bundle, the whole bundle again |
| *DataPass: Check This File* (palette, Explorer right-click) | That file (and its bundle) |
| *DataPass: Check This Repository* (palette, right-click on a workspace root) | Every checkable file of each folder, within the budget; a summary goes to the *DataPass Work* output |

A fixed file clears its diagnostics at the next check. On save, DataPass leaves JSON syntax to VS
Code's own JSON support (an open file already shows its errors) and only clears its earlier ones; the
two commands report JSON files that are not open.

**Budget.** A repository check looks at no more than `datapass.checks.maxFiles` files (2,000 by
default) and skips files over `datapass.checks.maxFileBytes` (1 MB) without reading them. When it
stops early, the workspace folder gets a `checks.incomplete` warning: files beyond the budget were
not checked. Dependency, cache and build folders are never entered (`node_modules`, `.git`, `.venv`,
`__pycache__`, `dist`, `build`, `out`, `target`, `.databricks`, `.terraform` and similar).

## Rules

| Rule id | File | Reported when | Severity |
|---|---|---|---|
| `json.syntax` | `*.json` (not `.datapass/`, not JSON-with-comments files: `tsconfig*.json`, `.vscode/`, `.devcontainer/`, `settings.json`, `launch.json`, `tasks.json`, `extensions.json`…) | The file is not strict JSON (trailing comma, comment, missing quote…); the position of the first error is shown | error |
| `yaml.syntax` | `*.yml`, `*.yaml` (every document of a multi-document file) | The YAML does not parse, or a mapping repeats a key | error |
| `dab.bundle-name` | `databricks.yml` / `databricks.yaml` | `bundle.name` is missing or empty | error |
| `dab.targets` | same | `targets` is not a mapping, more than one target has `default: true`, or a `mode` is not `development` / `production`; no `targets` at all is an information | error / info |
| `dab.include` | same | An `include` entry (path or glob, relative to the bundle folder) matches no file | error |
| `dab.path` | the bundle and every YAML file it includes | A local `notebook_path` (with or without `.py`, `.ipynb`, `.sql`, `.scala`, `.r`), `python_file`, `whl` or pipeline `libraries` `notebook` / `file` path does not exist, relative to the file that declares it | error |
| `dab.var` | same | `${var.name}` is used but `name` is not declared under `variables` | error |
| `docker.from` | `Dockerfile`, `Dockerfile.*`, `*.Dockerfile`, `Containerfile` | There is no `FROM`, or an instruction other than `ARG` comes before the first one | error |
| `docker.copy-source` | same | A `COPY` / `ADD` source does not exist in the build context, taken as the Dockerfile's folder | warning |
| `compose.build-context` | `docker-compose*.yml`, `compose*.yaml` | A service's `build` context folder, or its `dockerfile` in that context, does not exist | error |
| `compose.env-file` | same | A service's `env_file` does not exist (entries with `required: false` are skipped). The file is only looked up, **never read** | error |
| `checks.incomplete` | the workspace folder | The repository check stopped at the file budget | warning |

**What is skipped on purpose** (not checkable without running or signing in): paths with `${…}`
interpolation, workspace paths (`/Workspace/…`, `/Users/…`), URLs and volumes (`dbfs:/`, `s3://`,
`abfss://`), paths leaving the opened folder, notebook paths of jobs with a `git_source` (they are
relative to the Git repository), wheels when the bundle declares `artifacts` (built at deploy time),
`COPY --from=…`, `ADD` of a URL, heredoc bodies, and `COPY` sources that use an `ARG`.

## Databricks bundles: the validate route

Each `dab.*` diagnostic offers a quick fix, *Copy `databricks bundle validate` for this bundle*. It
copies the command for the bundle's folder; DataPass never runs it. Run it yourself in a terminal
where the Databricks CLI is signed in: it checks what DataPass cannot (workspace, permissions,
cluster policies, the resolved configuration of each target).

## A minimal bundle that passes

```yaml
# databricks.yml
bundle:
  name: sales-etl
include:
  - resources/*.yml
variables:
  catalog:
    default: dev_catalog
targets:
  dev:
    mode: development
    default: true
  prod:
    mode: production
```

```yaml
# resources/jobs.yml — paths are relative to this file
resources:
  jobs:
    daily_sales:
      name: daily-sales-${var.catalog}
      tasks:
        - task_key: ingest
          notebook_task:
            notebook_path: ../src/ingest   # src/ingest.py exists
```

## Not checked yet

Python syntax (it needs a vetted parser: V2), notebook formats, Terraform / Bicep, Kubernetes
schemas, GitHub Actions / Azure Pipelines schemas, `.dockerignore` exclusions and a build context
other than the Dockerfile's folder.
