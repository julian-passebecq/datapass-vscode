-- rpt_sites_over_contract: last 30 days per site, only for sites whose peak demand went over
-- their contract at least once (a semi-join: the filter does not add columns or duplicate rows).
CREATE OR REPLACE VIEW gold.rpt_sites_over_contract AS
SELECT
    f.site_id,
    s.site_name,
    f.region_name,
    s.contract_kw,
    MAX(f.peak_demand_kw) AS max_demand_kw,
    SUM(f.kwh_total) AS kwh_30d,
    SUM(CASE WHEN f.peak_demand_kw > f.contract_kw THEN 1 ELSE 0 END) AS days_over
FROM gold.fct_site_energy_daily AS f
INNER JOIN gold.dim_site AS s
    ON s.site_id = f.site_id
LEFT SEMI JOIN (
    SELECT DISTINCT site_id
    FROM gold.fct_site_energy_daily
    WHERE contract_kw > 0
      AND peak_demand_kw > contract_kw
) AS breaches
    ON breaches.site_id = f.site_id
WHERE f.reading_date >= DATE_SUB(CURRENT_DATE(), 30)
GROUP BY f.site_id, s.site_name, f.region_name, s.contract_kw;
