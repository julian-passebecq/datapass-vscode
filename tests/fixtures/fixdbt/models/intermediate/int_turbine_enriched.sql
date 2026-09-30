-- SYNTHETIC FIXTURE
select
    t.turbine_id,
    t.site_id,
    t.model_code,
    coalesce(m.rated_power_kw, t.rated_power_kw)  as rated_power_kw,
    m.manufacturer,
    m.hub_height_m,
    t.commissioned_on
from {{ ref('stg_turbines') }} t
left join {{ ref('seed_turbine_models') }} m on t.model_code = m.model_code
