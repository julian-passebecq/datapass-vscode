"""Synthetic Airflow DAG for the V5 acceptance (row 07): wait for orders, load, transform, check, publish, notify."""
from datetime import datetime

from airflow import DAG
from airflow.operators.empty import EmptyOperator
from airflow.operators.email import EmailOperator
from airflow.operators.python import PythonOperator
from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator
from airflow.providers.databricks.operators.databricks import DatabricksSubmitRunOperator
from airflow.sensors.filesystem import FileSensor


def check_counts():
    """Placeholder check (never run by DataPass)."""
    return True


with DAG(
    dag_id="orders_daily",
    schedule="0 5 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
) as dag:
    start = EmptyOperator(task_id="start")
    wait_for_orders = FileSensor(task_id="wait_for_orders", filepath="/landing/orders/_SUCCESS")
    load_bronze = DatabricksSubmitRunOperator(task_id="load_bronze", json={"notebook_task": {"notebook_path": "/Shared/ingest_orders"}})
    build_silver = SQLExecuteQueryOperator(task_id="build_silver", conn_id="lakehouse", sql="select 1")
    build_gold = SQLExecuteQueryOperator(task_id="build_gold", conn_id="lakehouse", sql="select 1")
    check_gold = PythonOperator(task_id="check_gold", python_callable=check_counts)
    notify = EmailOperator(task_id="notify", to="sales@example.invalid", subject="Orders ready", html_content="ok")

    start >> wait_for_orders >> load_bronze >> build_silver >> build_gold >> check_gold >> notify
