"""Airflow DAG: wait for the meter vendor's daily drop, copy it to raw, clean and aggregate it with
Spark on Databricks, build the warehouse models, check them and publish the day.

Synthetic example (Harbourlight Energy Analytics, a fictional company). The module imports without
Airflow installed so its helpers can be tested; the DAG object is built only when Airflow is present.
"""
from __future__ import annotations

from datetime import datetime, timedelta

LANDING_CONTAINER = "landing"
DROP_PREFIX = "meter-readings"
COPY_PIPELINE = "pl_copy_meter_drop"
SPARK_JOB_NAME = "meter-energy"
WAREHOUSE_MODELS = ("dim_site", "fct_site_energy_daily", "rpt_sites_over_contract")
MIN_SITES_PER_DAY = 50


def drop_prefix(ds: str) -> str:
    """Blob prefix of one day's drop, for example meter-readings/2026-09-01/."""
    return f"{DROP_PREFIX}/{ds}/"


def quality_sql(ds: str) -> str:
    """True when at least MIN_SITES_PER_DAY sites have a row for the day."""
    return (
        f"SELECT COUNT(DISTINCT site_id) >= {MIN_SITES_PER_DAY} "
        f"FROM gold.fct_site_energy_daily WHERE reading_date = '{ds}'"
    )


def publish_day(ds: str, **_context) -> dict:
    """The marker the API reads to know a day is complete."""
    return {"reading_date": ds, "status": "published", "models": list(WAREHOUSE_MODELS)}


try:
    from airflow import DAG
    from airflow.operators.python import PythonOperator
    from airflow.providers.common.sql.operators.sql import SQLCheckOperator
    from airflow.providers.databricks.operators.databricks import DatabricksRunNowOperator
    from airflow.providers.databricks.operators.databricks_sql import DatabricksSqlOperator
    from airflow.providers.microsoft.azure.operators.data_factory import AzureDataFactoryRunPipelineOperator
    from airflow.providers.microsoft.azure.sensors.wasb import WasbPrefixSensor
except ImportError:  # the tests import this file without Airflow
    DAG = None

DEFAULT_ARGS = {"owner": "data-platform", "retries": 2, "retry_delay": timedelta(minutes=10)}

if DAG is not None:
    with DAG(
        dag_id="meter_readings_daily",
        schedule="30 5 * * *",
        start_date=datetime(2026, 1, 1),
        catchup=False,
        default_args=DEFAULT_ARGS,
        template_searchpath=["/opt/airflow/repos/warehouse"],
        tags=["energy", "example"],
    ) as dag:
        wait_for_drop = WasbPrefixSensor(
            task_id="wait_for_drop",
            wasb_conn_id="landing_storage",
            container_name=LANDING_CONTAINER,
            prefix=DROP_PREFIX + "/{{ ds }}/",
            mode="reschedule",
            poke_interval=600,
            timeout=6 * 3600,
        )

        extract_to_raw = AzureDataFactoryRunPipelineOperator(
            task_id="extract_to_raw",
            azure_data_factory_conn_id="data_factory",
            pipeline_name=COPY_PIPELINE,
            parameters={"reading_date": "{{ ds }}"},
        )

        run_spark_jobs = DatabricksRunNowOperator(
            task_id="run_spark_jobs",
            databricks_conn_id="databricks",
            job_name=SPARK_JOB_NAME,
            job_parameters={"reading_date": "{{ ds }}"},
        )

        build_models = DatabricksSqlOperator(
            task_id="build_models",
            databricks_conn_id="databricks",
            sql_endpoint_name="analytics-warehouse",
            sql=[f"models/{name}.sql" for name in WAREHOUSE_MODELS],
        )

        check_quality = SQLCheckOperator(
            task_id="check_quality",
            conn_id="databricks_sql",
            sql=quality_sql("{{ ds }}"),
        )

        publish = PythonOperator(
            task_id="publish",
            python_callable=publish_day,
            op_kwargs={"ds": "{{ ds }}"},
        )

        wait_for_drop >> extract_to_raw >> run_spark_jobs >> build_models >> check_quality >> publish
