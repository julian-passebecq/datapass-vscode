# SYNTHETIC FIXTURE (foil-synthetic): fabricated, never executed. Not a client payload.
"""Classic operators: bronze -> silver via Databricks job then SQL."""
from datetime import datetime
from airflow import DAG
from airflow.providers.databricks.operators.databricks import DatabricksRunNowOperator
from airflow.providers.databricks.operators.databricks_sql import DatabricksSqlOperator
from airflow.operators.empty import EmptyOperator

with DAG("wind_classic_daily", start_date=datetime(2026, 9, 1), schedule="@daily", catchup=False) as dag:
    start = EmptyOperator(task_id="start")
    ingest = DatabricksRunNowOperator(task_id="bronze_ingest", job_id=91001, databricks_conn_id="dbw_foilsyn")
    clean = DatabricksSqlOperator(
        task_id="silver_scada_clean",
        databricks_conn_id="dbw_foilsyn",
        sql_endpoint_name="wh_wind_sql",
        sql="INSERT OVERWRITE wind_syn.silver.scada_clean SELECT turbine_id, ts, wind_speed_ms, power_kw FROM wind_syn.bronze.scada_raw WHERE power_kw >= 0",
    )
    kpi = DatabricksSqlOperator(
        task_id="gold_turbine_kpi_daily",
        databricks_conn_id="dbw_foilsyn",
        sql_endpoint_name="wh_wind_sql",
        sql="INSERT OVERWRITE wind_syn.gold.turbine_kpi_daily SELECT d.turbine_id, DATE(c.ts) AS day, AVG(c.power_kw) AS avg_power_kw FROM wind_syn.silver.scada_clean c JOIN wind_syn.silver.turbine_dim d ON c.turbine_id = d.turbine_id GROUP BY d.turbine_id, DATE(c.ts)",
    )
    start >> ingest >> clean >> kpi
