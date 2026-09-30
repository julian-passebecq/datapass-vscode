# EXPECTED: lineage edges an extractor must find (golden graph seed)

SYNTHETIC FIXTURE. Derived from `target/manifest.json` (dbt parse, dbt-core 1.12.3, Databricks adapter) and checked by hand against
the SQL. Node ids are dbt `unique_id`s without the `foil_syn_wind.` package part; the physical relation is
`wind_syn`.`<schema>`.`<alias>`. An extractor working from artifacts (DBT1) and one working without them (DBT2/DBT3) must both find
every edge marked **must**; edges marked *artifact-only* need `manifest.json` or `catalog.json`.

## 1. Node inventory (must)
| Kind | Count | Ids |
|---|---|---|
| source (5 tables, 3 sources + 1 Spark-written) | 5 | `scada.scada_raw`, `scada.weather_forecast_raw`, `cmms.maintenance_orders_raw`, `silver_spark.turbine_dim`, `silver_spark.scada_clean` (declared, never read: orphan source) |
| seed | 2 | `seed_turbine_models`, `seed_alarm_codes` |
| model staging (view) | 4 | `stg_scada_readings`, `stg_turbines`, `stg_maintenance_orders`, `stg_weather_forecast` |
| model intermediate | 3 | `int_scada_hourly` (**incremental**, merge), `int_turbine_enriched` and `int_maintenance_downtime` (ephemeral: no relation, injected as CTE) |
| model marts | 5 | `dim_turbine`, `fct_turbine_kpi_daily` (contract enforced), `fct_maintenance_downtime`, `mart_fleet_availability` (view), `fct_forecast_accuracy` (**Python model**) |
| snapshot | 1 | `snap_turbine` (check strategy) |
| analysis | 1 | `turbines_without_readings` (compiled, no relation) |
| tests | 26 | 24 generic-style (unique, not_null, relationships, accepted_values, custom `positive_value`, source tests) and 2 singular (`assert_no_negative_power`, `assert_kpi_energy_matches_scada`, the latter `severity: warn`) |
| macros (project) | 3 + 1 test | `capacity_factor` (calls `safe_divide`), `safe_divide`, `generate_schema_name`, generic test `positive_value` |
| exposures | 3 | `wind_fleet_dashboard` (dashboard), `maintenance_report` (dashboard), `forecast_model_review` (ml) |
| docs blocks | 3 | `scada_source`, `turbine_kpi`, `capacity_factor` |

## 2. Table-level edges `parent -> child` (kind `reads`, must)
```
source:scada.scada_raw                    -> stg_scada_readings
source:silver_spark.turbine_dim           -> stg_turbines
source:cmms.maintenance_orders_raw        -> stg_maintenance_orders
source:scada.weather_forecast_raw         -> stg_weather_forecast
stg_scada_readings + seed_alarm_codes     -> int_scada_hourly
stg_turbines + seed_turbine_models        -> int_turbine_enriched
stg_maintenance_orders                    -> int_maintenance_downtime
int_turbine_enriched                      -> dim_turbine
int_scada_hourly + dim_turbine            -> fct_turbine_kpi_daily      (macro capacity_factor -> safe_divide)
int_maintenance_downtime + dim_turbine    -> fct_maintenance_downtime
fct_turbine_kpi_daily + dim_turbine + fct_maintenance_downtime -> mart_fleet_availability
stg_weather_forecast + fct_turbine_kpi_daily + dim_turbine     -> fct_forecast_accuracy   (dbt.ref() in Python, no SQL)
stg_turbines                              -> snap_turbine
dim_turbine + stg_scada_readings          -> turbines_without_readings (analysis)
```
Python model: the three edges come from `dbt.ref("...")` calls in `models/marts/fct_forecast_accuracy.py`, found by static AST only.

## 3. Cross-layer edges (must, the join with the rest of the tenant)
- `source:silver_spark.turbine_dim` is the Spark table `wind_syn.silver.turbine_dim` (ids.json) written by the notebooks: dbt source node and Spark dataset must resolve to one canonical dataset identity. Same for `source:scada.scada_raw` = `wind_syn.bronze.scada_raw`.
- Materialised relations: `wind_syn.dbt_syn_staging.*` (views), `wind_syn.dbt_syn_marts.*` (tables/view), `wind_syn.dbt_syn_seeds.*`, `wind_syn.dbt_syn_snapshots.snap_turbine`.
- Exposure edges (kind `exposes`): `fct_turbine_kpi_daily`, `mart_fleet_availability`, `dim_turbine` -> `wind_fleet_dashboard`; `fct_maintenance_downtime` -> `maintenance_report`; `fct_forecast_accuracy` -> `forecast_model_review`.
- `wind_fleet_dashboard` names Power BI report `rpt_wind_fleet` and `fct_turbine_kpi_daily` meta names semantic model `sm_wind_kpi` (both in ids.json): the BI extractor (FIXBI/BI1) must connect them to the mart.

## 4. Test edges (kind `tests`, must)
Each test points at the model/source column(s) it guards: `unique|not_null` on `dim_turbine.turbine_id`, `stg_turbines.turbine_id`,
`fct_maintenance_downtime.order_id`, `stg_maintenance_orders.order_id`, `seed_*` keys, sources `scada.scada_raw.turbine_id`, `cmms.maintenance_orders_raw.order_id` (2);
`relationships` `fct_turbine_kpi_daily.turbine_id -> dim_turbine.turbine_id` and `stg_scada_readings.turbine_id -> stg_turbines.turbine_id` (two parents);
`accepted_values` `stg_scada_readings.status_code`, `stg_maintenance_orders.order_type`; `positive_value` on `fct_turbine_kpi_daily.energy_mwh` and `stg_turbines.rated_power_kw`;
singular `assert_no_negative_power` -> `stg_scada_readings`; `assert_kpi_energy_matches_scada` -> `fct_turbine_kpi_daily` + `stg_scada_readings`.

## 5. Column-level edges (`derives`, must from SQL; the catalog only supplies types)
| Target column | Sources | Transform |
|---|---|---|
| `stg_scada_readings.energy_kwh_10min` | `scada_raw.power_kw` | `cast(power_kw as double) / 6.0` |
| `stg_scada_readings.reading_ts` | `scada_raw.ts` | cast |
| `stg_maintenance_orders.downtime_hours` | `maintenance_orders_raw.closed_at`, `.opened_at` | `(unix_timestamp(closed_at) - unix_timestamp(opened_at)) / 3600` |
| `int_scada_hourly.hour_ts` | `stg_scada_readings.reading_ts` | `date_trunc('hour', ...)` |
| `int_scada_hourly.energy_kwh` | `stg_scada_readings.energy_kwh_10min` | `sum` |
| `int_scada_hourly.avg_power_kw` | `stg_scada_readings.power_kw` | `avg` |
| `int_scada_hourly.avg_wind_ms` | `stg_scada_readings.wind_speed_ms` | `avg` |
| `int_scada_hourly.fault_minutes` | `seed_alarm_codes.is_fault` (via join on `status_code` = `stg_scada_readings.status_code`) | `sum(case when is_fault then 10 else 0 end)` |
| `int_turbine_enriched.rated_power_kw` | `seed_turbine_models.rated_power_kw`, `stg_turbines.rated_power_kw` | `coalesce` |
| `dim_turbine.*` | same-named columns of `int_turbine_enriched` | passthrough; filter `rated_power_kw >= var(rated_power_floor_kw)=100` |
| `fct_turbine_kpi_daily.kpi_date` | `int_scada_hourly.hour_ts` | `date()` |
| `fct_turbine_kpi_daily.energy_mwh` | `int_scada_hourly.energy_kwh` | `sum(...) / 1000` |
| `fct_turbine_kpi_daily.avg_wind_ms` | `int_scada_hourly.avg_wind_ms` | `avg` |
| `fct_turbine_kpi_daily.capacity_factor` | `int_scada_hourly.energy_kwh`, `dim_turbine.rated_power_kw` | macro `capacity_factor` -> `safe_divide` (only visible in compiled code / after macro expansion) |
| `fct_turbine_kpi_daily.availability_pct` | `int_scada_hourly.fault_minutes` | `1 - sum(...) / 1440` |
| `fct_turbine_kpi_daily.fault_minutes` | `int_scada_hourly.fault_minutes` | `sum` |
| `fct_maintenance_downtime.site_id` | `dim_turbine.site_id` | join on `turbine_id` |
| `fct_maintenance_downtime.downtime_hours|cost_eur|order_type|opened_date` | `int_maintenance_downtime.*` | passthrough |
| `mart_fleet_availability.availability_pct` | `fct_turbine_kpi_daily.availability_pct` | `avg` grouped by `dim_turbine.site_id`, `kpi_date` |
| `mart_fleet_availability.energy_mwh` | `fct_turbine_kpi_daily.energy_mwh` | `sum` |
| `mart_fleet_availability.downtime_hours` | `fct_maintenance_downtime.downtime_hours` | `coalesce(sum(...), 0)`; join on `turbine_id` and `opened_date = kpi_date` |
| `fct_forecast_accuracy.actual_wind_ms` | `fct_turbine_kpi_daily.avg_wind_ms` | PySpark `groupBy(site_id, kpi_date).agg(avg)`, `site_id` from `dim_turbine` |
| `fct_forecast_accuracy.forecast_wind_ms` | `stg_weather_forecast.forecast_wind_ms` | PySpark `avg` |
| `fct_forecast_accuracy.abs_error_ms` | `forecast_wind_ms`, `actual_wind_ms` (same model) | `abs(a - b)` |
| `snap_turbine.dbt_scd_id|dbt_valid_from|dbt_valid_to|dbt_updated_at` | none (generated by dbt) | snapshot metadata columns |

## 6. Gaps the AI fill-in layer should be asked about (`lineage.gap.v1`)
- Column lineage of `fct_forecast_accuracy` is PySpark DataFrame code: static AST gets the model-level edges, the column edges are *partial* (join on expressions, `.select` with aliases).
- `capacity_factor` macro call: complete only if Jinja macros are expanded (compiled code available with `manifest.json`); the no-manifest fallback marks it *partial*.
- `fct_turbine_kpi_daily.meta.powerbi_semantic_model` is free-form metadata, not an edge until a BI extractor confirms it.

## 7. Artifact facts to assert (`run_results.json`, `catalog.json`)
- `run_results.json`: `args.which = build`, 44 results (2 seeds, 4 + 3 + 8 models, 1 snapshot, 26 tests; the analysis is not executed), all `success` except `test.foil_syn_wind.assert_kpi_energy_matches_scada` = `warn` (`failures: 1`). Evidence origin `artifact-import`, no `runtime-observed` claims.
- `catalog.json`: one entry per non-ephemeral model/seed/snapshot and per source, with Databricks types (`string`, `double`, `int`, `bigint`, `date`, `timestamp`, `boolean`) and `num_rows`/`bytes` stats on tables.

## 8. DBT2: semantic layer, contracts, access/groups/versions, unit tests (artifact mode, must)
Added for DBT2 (common copy of FIXDBT, regenerated with the same `tools/build-target.py`, dbt-core 1.12.3). Direction is upstream -> consumer.
- Semantic models are logical datasets `foil_syn_wind.semantic_model.<name>`, read (`reads`) from their model relation. Their entities, dimensions and measures are fields derived (`derives`) from the model columns: `turbine_kpi` (on `fct_turbine_kpi_daily`: entity `turbine` <- `turbine_id`, dimension `kpi_date`, measures `energy_mwh`, `fault_minutes`, `capacity_factor_avg` <- `capacity_factor`, aggregate) and `turbine` (on `dim_turbine`: `turbine`, `site_id`, `manufacturer`).
- Metrics are `measure` nodes: `Total energy (MWh)` <- `energy_mwh`, `Fault minutes` <- `fault_minutes`, `Average capacity factor` <- `capacity_factor_avg`; derived `Fault hours` <- `Fault minutes`.
- Saved query `fleet_daily_energy` is a `visual` node reading `Total energy (MWh)`, `Fault hours` and dimension `turbine.site_id` (`metric_time` adds no edge).
- Enforced contract on `fct_turbine_kpi_daily`: 7 `contract <column>: <type>` test nodes, one per typed column (the schema fact); constraints `primary_key (turbine_id, kpi_date)` and `not_null (turbine_id)`.
- Access/groups/versions: `access ...` test nodes on `dim_turbine`, `fct_turbine_kpi_daily`, `int_turbine_enriched` (private), `fct_maintenance_downtime` (group maintenance), `metricflow_time_spine`, and both versions of `mart_site_energy` (v1 `deprecated 2026-12-31`). v2 carries the unversioned unique id as alias.
- Unit tests `test_kpi_energy_rollup` and `test_stg_turbines_passthrough`: `tests` -> the model and the columns of their expected rows.
- Without `manifest.json` (DBT3 static fallback): contracts, constraints, access/groups/versions and unit tests come from the YAML with the same ids; one `*-needs-manifest` hole per semantic model, metric and saved query, on its YAML line.
