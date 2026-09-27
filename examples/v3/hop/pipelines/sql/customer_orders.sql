-- Completed order lines with customer and product details, for the sales dashboard.
-- Two joins: order lines to customers (inner), order lines to products (left).
SELECT
    o.order_id,
    o.order_date,
    c.customer_id,
    c.segment,
    o.quantity,
    p.product_name,
    p.category,
    o.quantity * o.unit_price AS line_amount
FROM sales.order_lines AS o
INNER JOIN sales.customers AS c
    ON c.customer_id = o.customer_id
LEFT JOIN catalog.products AS p
    ON p.product_id = o.product_id
   AND p.valid_to IS NULL
WHERE o.status = 'completed'
  AND o.order_date >= DATE '2026-01-01';
