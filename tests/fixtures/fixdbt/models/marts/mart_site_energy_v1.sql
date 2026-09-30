-- SYNTHETIC FIXTURE: version 1 of mart_site_energy.
select site_id, kpi_date, energy_mwh
from {{ ref('mart_fleet_availability') }}
