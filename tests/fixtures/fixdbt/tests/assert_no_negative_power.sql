-- SYNTHETIC FIXTURE: singular test, fails when a reading has negative power.
select turbine_id, reading_ts, power_kw
from {{ ref('stg_scada_readings') }}
where power_kw < 0
