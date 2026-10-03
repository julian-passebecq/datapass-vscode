"""Synthetic Airflow DAG for the V5 acceptance hole case (row 07): an operator of a kind DataPass does not know."""
from datetime import datetime

from airflow import DAG
from airflow.operators.empty import EmptyOperator
from acme_plugins.zorb import ZorbOperator

with DAG(
    dag_id="odd_operators",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
) as dag:
    begin = EmptyOperator(task_id="begin")
    zorb_step = ZorbOperator(task_id="zorb_step", level=3)

    begin >> zorb_step
