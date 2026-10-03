"""Synthetic FastAPI orders service for the V5 acceptance (row 04): four endpoints, read statically, never run."""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="orders")

ORDERS: dict[int, dict] = {}


class OrderIn(BaseModel):
    customer_id: int
    amount: float


@app.get("/orders")
def list_orders(limit: int = 50):
    return list(ORDERS.values())[:limit]


@app.get("/orders/{order_id}")
def get_order(order_id: int):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="order not found")
    return ORDERS[order_id]


@app.post("/orders", status_code=201)
def create_order(order: OrderIn):
    order_id = len(ORDERS) + 1
    ORDERS[order_id] = {"id": order_id, **order.model_dump()}
    return ORDERS[order_id]


@app.get("/customers/{customer_id}/orders")
def customer_orders(customer_id: int):
    return [o for o in ORDERS.values() if o["customer_id"] == customer_id]
