"""Synthetic Airflow DAG for DataPass tests: wait for a file, extract, transform on Databricks, load, notify."""
from datetime import datetime

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.email import EmailOperator
from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator
from airflow.providers.databricks.operators.databricks import DatabricksSubmitRunOperator
from airflow.sensors.filesystem import FileSensor

with DAG(
    dag_id="etl_daily",
    schedule="0 6 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
) as dag:
    wait_for_file = FileSensor(task_id="wait_for_file", filepath="/data/in/orders.csv")

    extract = BashOperator(task_id="extract", bash_command="python extract.py")

    transform_spark = DatabricksSubmitRunOperator(
        task_id="transform_spark",
        json={"notebook_task": {"notebook_path": "/Shared/transform"}},
    )

    load_sql = SQLExecuteQueryOperator(
        task_id="load_sql",
        conn_id="warehouse",
        sql="INSERT INTO sales SELECT * FROM staging_sales",
    )

    notify = EmailOperator(task_id="notify", to="team@example.com", subject="ETL done", html_content="ok")

    wait_for_file >> extract >> transform_spark >> load_sql >> notify
