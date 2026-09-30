-- SYNTHETIC FIXTURE
select
    m.order_id,
    m.turbine_id,
    d.site_id,
    m.order_type,
    m.opened_date,
    m.downtime_hours,
    m.cost_eur
from {{ ref('int_maintenance_downtime') }} m
join {{ ref('dim_turbine') }} d on m.turbine_id = d.turbine_id
