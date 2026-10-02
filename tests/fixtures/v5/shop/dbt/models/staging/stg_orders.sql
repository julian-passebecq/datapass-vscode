-- Silver: typed, deduplicated orders.
with source as (
    select * from {{ source('bronze', 'orders_raw') }}
),
typed as (
    select
        cast(order_id as bigint)        as order_id,
        cast(customer_id as bigint)     as customer_id,
        cast(order_date as date)        as order_date,
        cast(amount as decimal(12, 2))  as amount,
        status,
        row_number() over (partition by order_id order by _ingested_at desc) as rn
    from source
)
select order_id, customer_id, order_date, amount, status
from typed
where rn = 1
