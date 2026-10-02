# FIXORC copy — SYNTHETIC FIXTURE (STDA1a)

Byte copies from datapass-vscode-common main `5986560`, never executed:

- `airflow/dags/wind_classic_daily.py` from `packages/analyzers-airflow/tests/fixtures/foil-synthetic-airflow/dags/`;
- `airflow-facts.json`: that file's entry of `packages/analyzers-airflow/tests/fixtures/airflow-facts.json` (CPython AST facts recorded by Common's `record-facts.py`; the tests replay them, no Python runs);
- `databricks/` and `adf/` from `packages/analyzers-orchestration/tests/fixtures/foil-synthetic-orchestration/`.

The expected edges are Common's `EXPECTED.md` rows D1–D5 and F1–F3; `tests/orchestration.test.ts` asserts a subset plus the `@daily` schedule fact.
