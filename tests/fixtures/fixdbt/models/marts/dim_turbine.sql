-- SYNTHETIC FIXTURE
select
    turbine_id,
    site_id,
    model_code,
    manufacturer,
    hub_height_m,
    rated_power_kw,
    commissioned_on
from {{ ref('int_turbine_enriched') }}
where rated_power_kw >= {{ var('rated_power_floor_kw') }}
