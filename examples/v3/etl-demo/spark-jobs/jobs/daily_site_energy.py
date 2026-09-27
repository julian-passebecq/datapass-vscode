"""Spark job 2 of 2: daily energy per site, with a 7-day rolling average and a rank per region.

silver.meter_readings + ref.sites -> gold.site_energy_daily (Delta).
Synthetic example (Harbourlight Energy Analytics, a fictional company).
"""
import argparse
from datetime import date

from pyspark.sql import SparkSession, Window
from pyspark.sql import functions as F

from rules import ROLLING_DAYS, rolling_window

READINGS_TABLE = "silver.meter_readings"
SITES_TABLE = "ref.sites"
OUTPUT_TABLE = "gold.site_energy_daily"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Daily energy per site.")
    parser.add_argument("--reading-date", required=True, help="YYYY-MM-DD, the Airflow run date")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    day = date.fromisoformat(args.reading_date)
    first_day, last_day = rolling_window(day)
    spark = SparkSession.builder.appName("daily-site-energy").getOrCreate()

    # Read the trailing window of clean readings (the rolling average needs the previous days).
    readings = (
        spark.read.table(READINGS_TABLE)
        .where(F.col("reading_date").between(F.lit(first_day), F.lit(last_day)))
        .where(F.col("site_id").isNotNull())
    )
    sites = spark.read.table(SITES_TABLE).select("site_id", "site_name", "region", "contract_kw")

    # One row per site and day: energy per tariff band, total energy and peak demand.
    per_day = readings.groupBy("site_id", "reading_date").agg(
        F.sum("kwh").alias("kwh_total"),
        F.sum(F.when(F.col("tariff_band") == "peak", F.col("kwh")).otherwise(0.0)).alias("kwh_peak"),
        F.sum(F.when(F.col("tariff_band") == "shoulder", F.col("kwh")).otherwise(0.0)).alias("kwh_shoulder"),
        F.sum(F.when(F.col("tariff_band") == "offpeak", F.col("kwh")).otherwise(0.0)).alias("kwh_offpeak"),
        F.max("demand_kw").alias("peak_demand_kw"),
        F.count("*").alias("intervals"),
    )

    # Attach the site's region and contract; only known sites are reported.
    with_site = per_day.join(sites, on="site_id", how="inner")

    # Trailing average over ROLLING_DAYS days, and the day's rank within the region.
    trailing = (
        Window.partitionBy("site_id")
        .orderBy(F.col("reading_date").cast("timestamp").cast("long"))
        .rangeBetween(-(ROLLING_DAYS - 1) * 86400, 0)
    )
    by_region = Window.partitionBy("region", "reading_date").orderBy(F.col("kwh_total").desc())
    enriched = (
        with_site.withColumn("kwh_rolling_avg", F.avg("kwh_total").over(trailing))
        .withColumn("rank_in_region", F.dense_rank().over(by_region))
        .withColumn("over_contract", F.col("peak_demand_kw") > F.col("contract_kw"))
        .withColumn("complete_day", F.col("intervals") >= 96)
    )

    # Keep only the day being processed, then overwrite that day in the gold table.
    result = enriched.where(F.col("reading_date") == F.lit(day)).select(
        "site_id", "site_name", "region", "reading_date",
        "kwh_total", "kwh_peak", "kwh_shoulder", "kwh_offpeak",
        "peak_demand_kw", "contract_kw", "over_contract",
        "kwh_rolling_avg", "rank_in_region", "complete_day",
    )
    (
        result.write.format("delta")
        .mode("overwrite")
        .option("replaceWhere", f"reading_date = '{args.reading_date}'")
        .saveAsTable(OUTPUT_TABLE)
    )


if __name__ == "__main__":
    main()
