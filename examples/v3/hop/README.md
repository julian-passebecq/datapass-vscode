# DataPass Hop (example)

A bridge that explains three native files visually, in the `datapass.understanding` format
(schema: `schemas/datapass-understanding.schema.json`, contract: `docs/PREPARING_A_PROJECT.md`, section "DataPass Hop").

- `pipelines/` is the native repository (repository key `pipelines` in the manifest):
  - `jobs/daily_sales.py`: a PySpark job (read → filter → join → aggregate → write);
  - `sql/customer_orders.sql`: a SQL query with two joins (inner, left);
  - `dags/daily_sales_dag.py`: an Airflow DAG with four tasks.
- `bridge/` holds the DataPass files. Each explanation sits at
  `.datapass/understanding/<repository key>/<native path>.json`, for example
  `bridge/.datapass/understanding/pipelines/jobs/daily_sales.py.json`.

Each explanation lists vertical steps tied to line ranges (1-based, inclusive), the links between
steps and, for SQL, the joins. `target.sha256` is the SHA-256 of the native file with line endings
normalised to LF: when the code changes, DataPass shows the explanation as **stale** until the AI
rewrites it. Nothing here is parsed as code or run.
