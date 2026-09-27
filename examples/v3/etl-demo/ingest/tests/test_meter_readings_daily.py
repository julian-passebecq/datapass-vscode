"""The DAG's helpers and task order, checked without Airflow installed."""
import ast
from pathlib import Path

from dags import meter_readings_daily as dag_module

DAG_FILE = Path(__file__).resolve().parents[1] / "dags" / "meter_readings_daily.py"


def test_drop_prefix_is_one_folder_per_day():
    assert dag_module.drop_prefix("2026-09-01") == "meter-readings/2026-09-01/"


def test_quality_sql_counts_sites_of_the_day():
    sql = dag_module.quality_sql("2026-09-01")
    assert "COUNT(DISTINCT site_id) >= 50" in sql
    assert "reading_date = '2026-09-01'" in sql


def test_publish_marker_lists_the_models_in_build_order():
    marker = dag_module.publish_day("2026-09-01")
    assert marker["status"] == "published"
    assert marker["models"] == ["dim_site", "fct_site_energy_daily", "rpt_sites_over_contract"]


def test_tasks_run_in_one_chain():
    tree = ast.parse(DAG_FILE.read_text(encoding="utf-8"))
    chains = [n for n in ast.walk(tree) if isinstance(n, ast.Expr) and isinstance(n.value, ast.BinOp)]
    assert len(chains) == 1
    names, node = [], chains[0].value
    while isinstance(node, ast.BinOp):
        names.insert(0, node.right.id)
        node = node.left
    names.insert(0, node.id)
    assert names == ["wait_for_drop", "extract_to_raw", "run_spark_jobs", "build_models", "check_quality", "publish"]
