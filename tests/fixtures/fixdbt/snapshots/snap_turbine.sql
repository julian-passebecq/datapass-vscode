-- SYNTHETIC FIXTURE
{% snapshot snap_turbine %}
{{ config(unique_key='turbine_id', strategy='check', check_cols=['model_code', 'rated_power_kw', 'site_id']) }}
select * from {{ ref('stg_turbines') }}
{% endsnapshot %}
