"""Daily sales job: orders of the day, joined to stores, summed per region."""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.appName("daily-sales").getOrCreate()
run_date = spark.conf.get("job.run_date", "2026-01-01")

# Read the raw orders and the store reference table.
orders = spark.read.table("raw.orders")
stores = spark.read.table("ref.stores")

# Keep the day's completed orders only.
completed = (
    orders
    .where(F.col("order_date") == F.lit(run_date))
    .where(F.col("status") == "completed")
    .select("order_id", "store_id", "amount", "order_date")
)

# Attach each order to its store and region.
with_region = completed.join(
    stores.select("store_id", "region", "store_name"),
    on="store_id",
    how="inner",
)

# One row per region: revenue and order count.
by_region = (
    with_region
    .groupBy("region", "order_date")
    .agg(
        F.sum("amount").alias("revenue"),
        F.countDistinct("order_id").alias("orders"),
    )
)

# Overwrite the day's partition of the reporting table.
(
    by_region.write
    .mode("overwrite")
    .option("replaceWhere", f"order_date = '{run_date}'")
    .saveAsTable("reporting.daily_sales_by_region")
)
