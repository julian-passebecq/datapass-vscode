-- SYNTHETIC FIXTURE
select
    turbine_id,
    site_id,
    model_code,
    rated_power_kw,
    commissioned_on
from {{ source('silver_spark', 'turbine_dim') }}
