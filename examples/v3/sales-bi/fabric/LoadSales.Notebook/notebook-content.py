# Fabric notebook source
# METADATA ********************
# META {"dependencies": {"lakehouse": {"default_lakehouse": "c0ffee00-1111-4222-8333-444455556666", "default_lakehouse_workspace_id": "5e1d7c42-8a3b-4f60-9d2e-1b4c6a8e0d11"}}}

# CELL ********************
df = spark.read.option("header", True).csv("Files/drop/sales.csv")
df.write.mode("overwrite").saveAsTable("sales")
