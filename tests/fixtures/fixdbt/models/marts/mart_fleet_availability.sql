-- SYNTHETIC FIXTURE
{{ config(materialized='view') }}

select
    d.site_id,
    k.kpi_date,
    avg(k.availability_pct)            as availability_pct,
    sum(k.energy_mwh)                  as energy_mwh,
    coalesce(sum(m.downtime_hours), 0) as downtime_hours
from {{ ref('fct_turbine_kpi_daily') }} k
join {{ ref('dim_turbine') }} d on k.turbine_id = d.turbine_id
left join {{ ref('fct_maintenance_downtime') }} m
       on m.turbine_id = k.turbine_id and m.opened_date = k.kpi_date
group by 1, 2
