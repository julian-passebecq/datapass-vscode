"""Spark job 1 of 2: clean one day of raw meter readings into the silver table.

raw.meter_readings (parquet copied by Data Factory) -> silver.meter_readings (Delta).
Synthetic example (Harbourlight Energy Analytics, a fictional company).
"""
import argparse

from pyspark.sql import SparkSession, Window
from pyspark.sql import functions as F

from rules import ACCEPTED_QUALITY, MAX_KWH_PER_READING, PEAK_HOURS, SHOULDER_HOURS

RAW_PATH = "abfss://raw@sthlenergydev.dfs.core.windows.net/meter-readings"
METERS_TABLE = "ref.meters"
OUTPUT_TABLE = "silver.meter_readings"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean one day of meter readings.")
    parser.add_argument("--reading-date", required=True, help="YYYY-MM-DD, the Airflow run date")
    parser.add_argument("--raw-path", default=RAW_PATH)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    spark = SparkSession.builder.appName("clean-meter-readings").getOrCreate()

    # Read the day's raw readings and the meter register (meter -> site, time zone).
    raw = spark.read.parquet(f"{args.raw_path}/reading_date={args.reading_date}")
    meters = spark.read.table(METERS_TABLE).select("meter_id", "site_id", "time_zone")

    # Types and names: the vendor sends strings and UTC timestamps.
    typed = raw.select(
        F.col("MeterId").cast("string").alias("meter_id"),
        F.to_timestamp("IntervalStartUtc").alias("reading_ts_utc"),
        F.col("Kwh").cast("double").alias("kwh"),
        F.upper(F.col("Quality")).alias("quality"),
        F.to_timestamp("ReceivedAtUtc").alias("received_at"),
    )

    # Drop meter faults and failed readings (same rule as rules.is_valid_reading).
    valid = typed.where(
        F.col("kwh").isNotNull()
        & F.col("kwh").between(0.0, MAX_KWH_PER_READING)
        & F.col("quality").isin(*ACCEPTED_QUALITY)
    )

    # The vendor resends corrected intervals: keep the latest version of each interval.
    latest_first = Window.partitionBy("meter_id", "reading_ts_utc").orderBy(F.col("received_at").desc())
    deduped = (
        valid.withColumn("version_rank", F.row_number().over(latest_first))
        .where(F.col("version_rank") == 1)
        .drop("version_rank")
    )

    # Attach each meter to its site; a meter missing from the register is kept with no site.
    with_site = deduped.join(F.broadcast(meters), on="meter_id", how="left")

    # The reading date is the UTC day (the raw partition); the tariff band uses local time.
    local_ts = F.from_utc_timestamp("reading_ts_utc", F.coalesce(F.col("time_zone"), F.lit("UTC")))
    hour = F.hour(local_ts)
    cleaned = (
        with_site.withColumn("reading_date", F.to_date("reading_ts_utc"))
        .withColumn(
            "tariff_band",
            F.when(hour.between(PEAK_HOURS.start, PEAK_HOURS.stop - 1), "peak")
            .when(hour.between(SHOULDER_HOURS.start, SHOULDER_HOURS.stop - 1), "shoulder")
            .otherwise("offpeak"),
        )
        .withColumn("demand_kw", F.col("kwh") * 4.0)
        .select("meter_id", "site_id", "reading_ts_utc", "reading_date", "tariff_band", "kwh", "demand_kw", "quality")
    )

    # Overwrite only the day being processed, so a rerun replaces it instead of doubling it.
    (
        cleaned.write.format("delta")
        .mode("overwrite")
        .option("replaceWhere", f"reading_date = '{args.reading_date}'")
        .saveAsTable(OUTPUT_TABLE)
    )


if __name__ == "__main__":
    main()
