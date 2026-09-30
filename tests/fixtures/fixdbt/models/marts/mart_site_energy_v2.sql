-- SYNTHETIC FIXTURE: version 2 of mart_site_energy (adds availability).
select site_id, kpi_date, energy_mwh, availability_pct
from {{ ref('mart_fleet_availability') }}
