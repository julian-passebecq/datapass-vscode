-- SYNTHETIC FIXTURE: singular test comparing the mart with the staging total.
{{ config(severity='warn') }}
with kpi as (select sum(energy_mwh) as e from {{ ref('fct_turbine_kpi_daily') }}),
     scada as (select sum(energy_kwh_10min) / 1000 as e from {{ ref('stg_scada_readings') }})
select kpi.e as kpi_mwh, scada.e as scada_mwh from kpi cross join scada
where abs(kpi.e - scada.e) > 0.5
