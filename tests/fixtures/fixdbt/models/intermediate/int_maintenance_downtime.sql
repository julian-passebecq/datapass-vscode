-- SYNTHETIC FIXTURE
select
    order_id,
    turbine_id,
    order_type,
    downtime_hours,
    cost_eur,
    date(opened_at) as opened_date
from {{ ref('stg_maintenance_orders') }}
where downtime_hours >= 0
