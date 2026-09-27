"""Business rules shared by the Spark jobs, as plain Python so they are tested without Spark.

The jobs use the same constants inside Spark expressions; the functions below are the reference
behaviour the tests pin down.
"""
from __future__ import annotations

from datetime import date, timedelta

# A 15-minute reading above this is a meter fault, not consumption (largest site: 2 MW).
MAX_KWH_PER_READING = 500.0
# Quality flags sent by the meter vendor: A = actual, E = estimated, F = failed.
ACCEPTED_QUALITY = ("A", "E")
# Tariff bands, by local hour of the reading's start.
PEAK_HOURS = range(17, 21)
SHOULDER_HOURS = range(7, 17)
ROLLING_DAYS = 7


def is_valid_reading(kwh: float | None, quality: str | None) -> bool:
    """A reading is kept when it has a value in [0, MAX_KWH_PER_READING] and an accepted flag."""
    if kwh is None or quality is None:
        return False
    return 0.0 <= kwh <= MAX_KWH_PER_READING and quality.upper() in ACCEPTED_QUALITY


def tariff_band(local_hour: int) -> str:
    """peak 17:00-21:00, shoulder 07:00-17:00, offpeak otherwise."""
    if local_hour in PEAK_HOURS:
        return "peak"
    if local_hour in SHOULDER_HOURS:
        return "shoulder"
    return "offpeak"


def demand_kw(kwh_15min: float) -> float:
    """Average demand over a 15-minute interval."""
    return kwh_15min * 4.0


def rolling_window(day: date, days: int = ROLLING_DAYS) -> tuple[date, date]:
    """First and last day of the trailing window that ends on `day` (both included)."""
    return day - timedelta(days=days - 1), day


def over_contract(peak_kw: float, contract_kw: float | None) -> bool:
    """A site without a contract value is never flagged."""
    return contract_kw is not None and contract_kw > 0 and peak_kw > contract_kw
