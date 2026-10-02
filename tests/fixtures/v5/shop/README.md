# Shop lakehouse (synthetic V5 acceptance fixture)

A fake online shop: orders land as CSV, a PySpark notebook loads them to bronze, dbt builds
silver (`stg_orders`) and gold (`fct_orders`), a daily pipeline runs both with a retry, and a
semantic model serves the BI report. Every name and value here is invented for DataPass tests.
`v5/shop-bare` is this folder without `.datapass/` and `samples/` (built at test time).
