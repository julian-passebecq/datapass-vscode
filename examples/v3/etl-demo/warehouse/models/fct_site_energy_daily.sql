-- fct_site_energy_daily: the daily energy fact, keyed on the site and date dimensions.
-- Inner joins: a day is reported only for a known site and a calendar date.
CREATE OR REPLACE TABLE gold.fct_site_energy_daily AS
SELECT
    e.site_id,
    d.date_key,
    e.reading_date,
    d.is_working_day,
    s.region_name,
    s.tariff_code,
    e.kwh_total,
    e.kwh_peak,
    e.kwh_shoulder,
    e.kwh_offpeak,
    e.peak_demand_kw,
    s.contract_kw,
    e.kwh_rolling_avg,
    e.kwh_total - e.kwh_rolling_avg AS kwh_vs_average,
    e.complete_day
FROM gold.site_energy_daily AS e
INNER JOIN gold.dim_site AS s
    ON s.site_id = e.site_id
INNER JOIN gold.dim_date AS d
    ON d.calendar_date = e.reading_date
WHERE e.reading_date >= DATE '2026-01-01';
