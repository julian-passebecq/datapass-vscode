-- SYNTHETIC FIXTURE: the incremental model of the project.
{{ config(materialized='incremental', unique_key=['turbine_id', 'hour_ts'], incremental_strategy='merge') }}

select
    r.turbine_id,
    date_trunc('hour', r.reading_ts)                                  as hour_ts,
    avg(r.power_kw)                                                   as avg_power_kw,
    sum(r.energy_kwh_10min)                                           as energy_kwh,
    avg(r.wind_speed_ms)                                              as avg_wind_ms,
    sum(case when a.is_fault then 10 else 0 end)                      as fault_minutes
from {{ ref('stg_scada_readings') }} r
left join {{ ref('seed_alarm_codes') }} a on r.status_code = a.status_code
{% if is_incremental() %}
where r.reading_ts > (select max(hour_ts) from {{ this }})
{% endif %}
group by 1, 2
