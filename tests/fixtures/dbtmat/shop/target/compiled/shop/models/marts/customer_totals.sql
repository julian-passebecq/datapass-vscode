select customer_id, sum(amount) as total
from "warehouse"."dbt_dev"."stg_orders"
group by customer_id;
