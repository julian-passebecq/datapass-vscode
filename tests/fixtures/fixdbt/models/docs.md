{% docs scada_source %}
SYNTHETIC FIXTURE. Raw SCADA readings landed by `pl_hourly_scada` into the bronze schema of the `wind_syn` catalog.
{% enddocs %}

{% docs turbine_kpi %}
Daily KPIs per turbine: energy produced (MWh), capacity factor and availability. Consumed by `sm_wind_kpi` and `rpt_wind_fleet`.
{% enddocs %}

{% docs capacity_factor %}
Produced energy divided by the energy at rated power over the same period, between 0 and 1.
{% enddocs %}
