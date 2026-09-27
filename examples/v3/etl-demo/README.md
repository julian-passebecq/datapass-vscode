# Energy ETL demo (example)

A realistic, fully synthetic data-engineering client to exercise DataPass — in particular **DataPass Hop**
(guide page [12 — DataPass Hop](../../../docs/guide/12_DATAPASS_HOP.md)) — on real-looking pipelines.
*Harbourlight Energy Analytics* is fictional: every name, id and link is made up (links go to
`example.com`), there are no credentials, and nothing here connects to a network.

Smart meters report energy every 15 minutes. Each morning the vendor drops yesterday's readings in a
storage container; Data Factory copies them to raw, two PySpark jobs clean and aggregate them on
Databricks, three SQL models build the warehouse tables, and an Airflow DAG runs it all in order. A
small container API serves the result; a Power BI report is a placeholder.

| Folder | What it is (a native repository in a real project) |
|---|---|
| `ingest/` | Airflow DAG `meter_readings_daily`: sensor → Data Factory copy → Spark jobs → SQL models → quality check → publish. Imports without Airflow installed. |
| `spark-jobs/` | Two PySpark jobs (`clean_meter_readings.py`, `daily_site_energy.py`: read, clean, deduplicate with a window, join a dimension, aggregate, rolling window, write Delta), the Databricks bundle `databricks.yml`, the shared rules and a small sample drop. |
| `warehouse/` | Three SQL models: `dim_site` (left joins with COALESCE), `fct_site_energy_daily` (a fact joined to two dimensions), `rpt_sites_over_contract` (a semi-join filter). |
| `infra/` | `main.bicep`: storage (landing, raw, lakehouse), Databricks workspace, Data Factory and its role on the lake. Declarations only. |
| `api/` | `Dockerfile` and a read-only FastAPI app over the published extract. |
| `bridge/` | The DataPass files: `project.json` (manifest v5: six repositories, toolchain, connections), `graph.json` (components per provider), `options.json` (variants A local Spark / B Databricks / C Fabric), `links.json`, and `understanding/` — one DataPass Hop explanation per native file (both Spark jobs, the three SQL models, the DAG, the Dockerfile). |

## Open it in DataPass

Open **`etl-demo.code-workspace`** in VS Code (*File → Open Workspace from File…*): the bridge comes
first, then the native repositories. DataPass loads the project from `bridge/.datapass/`. Try:

- the architecture diagram, and the variant switch in the status bar (A → B → C: preview only,
  nothing is written or deployed);
- a Spark job, a SQL model, the DAG or the Dockerfile: its explanation sits at
  `bridge/.datapass/understanding/<repository>/<path>.json` and is **ok** while the file is unchanged;
  edit the code and it turns **stale** until the explanation is rewritten;
- *Project links* (all fictional).

## Tests

- `python -m pytest -q` from this folder: the DAG's helpers and task order, and the Spark rules on
  the sample drop. Neither Spark nor Airflow is needed (CI runs it).
- `tests/etlDemo.test.ts` in the extension: the bridge validates (runtime and editor schemas, 0
  errors) and every explanation is **ok** against its native file.

Validating the real thing (`databricks bundle validate`, `az deployment group what-if`) needs the
official tools and an account; deploying stays a person's action in those tools.
