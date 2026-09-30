{# SYNTHETIC FIXTURE #}
{% macro capacity_factor(energy_mwh, rated_kw, hours) -%}
    {{ safe_divide(energy_mwh ~ ' * 1000', rated_kw ~ ' * ' ~ hours) }}
{%- endmacro %}
