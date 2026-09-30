-- SYNTHETIC FIXTURE
{{ config(meta={'owner': 'wind-analytics', 'powerbi_semantic_model': 'sm_wind_kpi'}) }}

select
    h.turbine_id                                         as turbine_id,
    date(h.hour_ts)                                      as kpi_date,
    sum(h.energy_kwh) / 1000.0                           as energy_mwh,
    avg(h.avg_wind_ms)                                   as avg_wind_ms,
    {{ capacity_factor('sum(h.energy_kwh) / 1000.0', 'max(d.rated_power_kw)', 24) }} as capacity_factor,
    1 - sum(h.fault_minutes) / 1440.0                    as availability_pct,
    sum(h.fault_minutes)                                 as fault_minutes
from {{ ref('int_scada_hourly') }} h
join {{ ref('dim_turbine') }} d on h.turbine_id = d.turbine_id
group by 1, 2
