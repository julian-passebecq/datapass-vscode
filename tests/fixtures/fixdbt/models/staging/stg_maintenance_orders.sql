-- SYNTHETIC FIXTURE
select
    order_id,
    turbine_id,
    opened_at,
    closed_at,
    order_type,
    cost_eur,
    (unix_timestamp(closed_at) - unix_timestamp(opened_at)) / 3600.0 as downtime_hours
from {{ source('cmms', 'maintenance_orders_raw') }}
where closed_at is not null
