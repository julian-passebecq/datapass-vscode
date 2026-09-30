# SYNTHETIC FIXTURE: the Python model of the project (dbt Python model, Databricks adapter).
import pyspark.sql.functions as F


def model(dbt, session):
    dbt.config(materialized="table", submission_method="all_purpose_cluster", create_notebook=False)

    forecast = dbt.ref("stg_weather_forecast")
    kpi = dbt.ref("fct_turbine_kpi_daily")
    turbines = dbt.ref("dim_turbine")

    actual = (
        kpi.join(turbines, "turbine_id")
        .groupBy("site_id", "kpi_date")
        .agg(F.avg("avg_wind_ms").alias("actual_wind_ms"))
    )
    fc = (
        forecast.withColumn("forecast_date", F.to_date("forecast_ts"))
        .groupBy("site_id", "forecast_date", "horizon_h")
        .agg(F.avg("forecast_wind_ms").alias("forecast_wind_ms"))
    )
    joined = fc.join(
        actual, (fc.site_id == actual.site_id) & (fc.forecast_date == actual.kpi_date)
    ).select(
        fc.site_id, fc.forecast_date, fc.horizon_h, fc.forecast_wind_ms, actual.actual_wind_ms
    )
    return joined.withColumn("abs_error_ms", F.abs(F.col("forecast_wind_ms") - F.col("actual_wind_ms")))
