"""Read-only API over the published daily energy extract (no database access, no credentials)."""
import os
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException

app = FastAPI(title="Energy API (example)")


@lru_cache(maxsize=1)
def energy() -> pd.DataFrame:
    return pd.read_parquet(os.environ.get("DATA_PATH", "/data/site_energy_daily.parquet"))


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/sites/{site_id}/energy")
def site_energy(site_id: str, days: int = 7) -> list[dict]:
    rows = energy()[energy()["site_id"] == site_id].sort_values("reading_date").tail(days)
    if rows.empty:
        raise HTTPException(status_code=404, detail="unknown site")
    return rows[["reading_date", "kwh_total", "peak_demand_kw", "over_contract"]].astype(str).to_dict("records")
