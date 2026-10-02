# Fabric notebook source

# METADATA ********************
# META {"kernel_info": {"name": "synapse_pyspark"}}

# CELL ********************
# Load the raw order files into the bronze table (append only).
from pyspark.sql import functions as F

raw = spark.read.option("header", True).csv("Files/landing/orders/*.csv")
bronze = raw.withColumn("_ingested_at", F.current_timestamp())
bronze.write.mode("append").saveAsTable("bronze.orders_raw")

# CELL ********************
# Row count for the run log.
print(spark.table("bronze.orders_raw").count())
