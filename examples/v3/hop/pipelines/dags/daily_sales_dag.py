"""Airflow DAG: land the orders, run the daily sales job, check it, tell the team."""
from datetime import datetime

from airflow import DAG
from airflow.operators.empty import EmptyOperator
from airflow.providers.databricks.operators.databricks import DatabricksRunNowOperator
from airflow.providers.common.sql.operators.sql import SQLCheckOperator

with DAG(
    dag_id="daily_sales",
    schedule="0 6 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["sales", "example"],
) as dag:
    wait_for_orders = EmptyOperator(task_id="wait_for_orders")

    run_daily_sales = DatabricksRunNowOperator(
        task_id="run_daily_sales",
        job_name="daily-sales",
        notebook_params={"job.run_date": "{{ ds }}"},
    )

    check_rows = SQLCheckOperator(
        task_id="check_rows",
        conn_id="warehouse",
        sql="SELECT COUNT(*) > 0 FROM reporting.daily_sales_by_region WHERE order_date = '{{ ds }}'",
    )

    notify = EmptyOperator(task_id="notify_team")

    wait_for_orders >> run_daily_sales >> check_rows >> notify
