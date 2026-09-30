-- SYNTHETIC FIXTURE
select
    site_id,
    cast(forecast_ts as timestamp) as forecast_ts,
    horizon_h,
    forecast_wind_ms
from {{ source('scada', 'weather_forecast_raw') }}
