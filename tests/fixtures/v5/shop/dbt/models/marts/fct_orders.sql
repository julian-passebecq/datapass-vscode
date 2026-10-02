-- Gold: one row per customer and day, for the sales report.
select
    customer_id,
    order_date,
    count(*)                                             as orders,
    sum(amount)                                          as revenue,
    sum(case when status = 'returned' then 1 else 0 end) as returns
from {{ ref('stg_orders') }}
group by customer_id, order_date
