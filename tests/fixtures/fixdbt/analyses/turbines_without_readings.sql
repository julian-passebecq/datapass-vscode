-- SYNTHETIC FIXTURE: analysis (compiled only, never materialised).
select t.turbine_id
from {{ ref('dim_turbine') }} t
left join {{ ref('stg_scada_readings') }} r using (turbine_id)
where r.turbine_id is null
