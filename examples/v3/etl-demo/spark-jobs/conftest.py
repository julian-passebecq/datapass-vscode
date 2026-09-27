"""The jobs import `rules` the way Databricks runs them (the job's folder on the path)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "jobs"))
