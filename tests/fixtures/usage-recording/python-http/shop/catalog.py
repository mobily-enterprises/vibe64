from shop.decorators import checked, traced

ITEMS = (
    {"id": "7", "name": "Lamp", "price": 30},
    {"id": "8", "name": "Desk", "price": 120},
    {"id": "9", "name": "Chair", "price": 75},
)


class Shelf:
    def __init__(self, items):
        self.items = list(items)

    @property
    def cheapest(self):
        return min(self.items, key=lambda item: item["price"])

    @staticmethod
    def label(item):
        return "%s (%d)" % (item["name"], item["price"])


@traced
@checked
def list_items():
    shelf = Shelf(ITEMS)
    return {"items": [Shelf.label(item) for item in sorted(shelf.items, key=lambda item: item["price"])],
            "cheapest": shelf.cheapest["name"]}


@traced
def item_detail(item_id):
    return next((describe(item) for item in ITEMS if item["id"] == item_id), None)


def describe(item):
    return {"name": item["name"], "price": item["price"]}
