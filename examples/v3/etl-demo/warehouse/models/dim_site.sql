-- dim_site: one row per site, with its region and its current contract.
-- Left joins with COALESCE: a site without a region or a contract is kept, with a readable default.
CREATE OR REPLACE TABLE gold.dim_site AS
SELECT
    s.site_id,
    s.site_name,
    COALESCE(r.region_name, 'Unassigned') AS region_name,
    COALESCE(r.grid_operator, 'Unknown') AS grid_operator,
    COALESCE(c.contract_kw, 0) AS contract_kw,
    c.tariff_code,
    s.opened_on
FROM ref.sites AS s
LEFT JOIN ref.regions AS r
    ON r.region_code = s.region
LEFT JOIN ref.supply_contracts AS c
    ON c.site_id = s.site_id
   AND c.valid_to IS NULL
WHERE s.closed_on IS NULL;
