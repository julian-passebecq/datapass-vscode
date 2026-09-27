"""The rules the Spark jobs apply, tested as plain Python (no Spark needed)."""
import csv
from datetime import date
from pathlib import Path

import rules

SAMPLE = Path(__file__).resolve().parents[1] / "sample" / "meter_readings.csv"


def test_valid_reading_needs_a_value_in_range_and_an_accepted_flag():
    assert rules.is_valid_reading(1.25, "A")
    assert rules.is_valid_reading(0.0, "e")
    assert not rules.is_valid_reading(None, "A")
    assert not rules.is_valid_reading(-0.1, "A")
    assert not rules.is_valid_reading(rules.MAX_KWH_PER_READING + 1, "A")
    assert not rules.is_valid_reading(2.0, "F")


def test_tariff_bands_cover_the_day():
    bands = [rules.tariff_band(h) for h in range(24)]
    assert bands.count("peak") == 4
    assert bands.count("shoulder") == 10
    assert bands.count("offpeak") == 10
    assert rules.tariff_band(17) == "peak" and rules.tariff_band(21) == "offpeak"


def test_demand_is_four_times_a_quarter_hour():
    assert rules.demand_kw(12.5) == 50.0


def test_rolling_window_includes_the_day():
    assert rules.rolling_window(date(2026, 9, 7)) == (date(2026, 9, 1), date(2026, 9, 7))


def test_over_contract_ignores_sites_without_a_contract():
    assert rules.over_contract(120.0, 100.0)
    assert not rules.over_contract(80.0, 100.0)
    assert not rules.over_contract(120.0, None)


def test_sample_drop_keeps_the_expected_rows():
    with SAMPLE.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    kept = [r for r in rows if rules.is_valid_reading(float(r["Kwh"]) if r["Kwh"] else None, r["Quality"])]
    assert len(rows) == 10
    assert len(kept) == 7
