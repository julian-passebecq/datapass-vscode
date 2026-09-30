# dbt fixture: foil_syn_wind (synthetic)

SYNTHETIC FIXTURE. A dbt Core project shaped like a real wind-energy client repo (Databricks adapter, catalog `wind_syn`) over the Aeolus Wind Demo tenant of `foil-synthetic`.
It reads the bronze and silver tables listed in `ids.json` (`wind_syn.bronze.scada_raw`, `wind_syn.silver.turbine_dim`) and feeds the Power BI
model `sm_wind_kpi` / report `rpt_wind_fleet`. Nothing here was ever executed against a warehouse.

| Path | What |
|---|---|
| `dbt_project.yml`, `profiles.yml`, `packages.yml` | project, placeholder profile (token is `SYNTHETIC_ONLY_NOT_A_CREDENTIAL`), no packages |
| `models/sources.yml`, `models/docs.md` | 3 sources + 1 Spark-written source (5 tables), freshness, docs blocks |
| `models/staging`, `intermediate`, `marts` | 15 models: views, ephemeral, one incremental (`int_scada_hourly`), tables, one view mart, one Python model (`fct_forecast_accuracy.py`), enforced contract + constraints on `fct_turbine_kpi_daily`, versioned `mart_site_energy` (v1 deprecated, v2 latest), MetricFlow time spine |
| `models/groups.yml`, `models/marts/semantic.yml`, `models/marts/unit_tests.yml`, `models/marts/versions.yml` | DBT2 additions: 2 groups with model access, 2 semantic models, 4 metrics (3 simple, 1 derived), 1 saved query, 2 unit tests |
| `models/marts/exposures.yml` | 3 exposures (2 dashboards, 1 ml) |
| `seeds/`, `snapshots/`, `macros/`, `analyses/` | 2 seeds, 1 snapshot (check strategy), 3 macros, 1 analysis |
| `tests/` | singular tests (one `severity: warn`) and the custom generic test `positive_value`; more generic tests in the yml files |
| `target/manifest.json` | **real** `dbt parse` output (dbt-core 1.12.3, manifest schema v12) with `compiled_code` merged from an offline DuckDB `dbt compile`, re-quoted for Databricks |
| `target/catalog.json` | catalog v1, written from the manifest with Databricks types and table stats |
| `target/run_results.json` | run-results v6 for one `dbt build` (43 success, 1 warn) |
| `target/semantic_manifest.json` | real `dbt parse` semantic manifest (same semantic layer as `manifest.json`) |
| `EXPECTED.md` | the lineage edges an extractor must find (golden graph seed) |
| `tools/build-target.py` | regenerates and validates the three artifacts with dbt's own classes (needs dbt-core, dbt-databricks, dbt-duckdb) |

Mart names are reused by FIXBI: `dim_turbine`, `fct_turbine_kpi_daily`, `fct_maintenance_downtime`, `fct_forecast_accuracy`, `mart_fleet_availability`.

Format references (opened before writing): https://docs.getdbt.com/reference/artifacts/manifest-json,
https://docs.getdbt.com/reference/artifacts/catalog-json, https://docs.getdbt.com/reference/artifacts/run-results-json,
https://schemas.getdbt.com/dbt/manifest/v12.json, https://schemas.getdbt.com/dbt/catalog/v1.json, https://schemas.getdbt.com/dbt/run-results/v6.json.
