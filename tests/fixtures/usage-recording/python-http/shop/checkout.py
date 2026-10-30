from shop.catalog import ITEMS, describe
from shop.decorators import traced

CART = ("7", "9")


@traced
def place_order(order):
    lines = [line_total(line) for line in order.get("lines", [])]
    return {"accepted": bool(order.get("card")), "total": sum(lines)}


def line_total(line):
    prices = {item["id"]: item["price"] for item in ITEMS}
    return prices.get(str(line.get("id")), 0) * int(line.get("quantity", 1))


def cart_summary():
    return {"lines": [describe(item) for item in ITEMS if item["id"] in CART]}
