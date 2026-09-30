-- SYNTHETIC FIXTURE
select
    cast(turbine_id as string)          as turbine_id,
    cast(ts as timestamp)               as reading_ts,
    cast(power_kw as double)            as power_kw,
    cast(wind_speed_ms as double)       as wind_speed_ms,
    cast(rotor_rpm as double)           as rotor_rpm,
    cast(status_code as int)            as status_code,
    cast(power_kw as double) / 6.0      as energy_kwh_10min,
    ingested_at
from {{ source('scada', 'scada_raw') }}
where ts >= '{{ var("history_start") }}'
