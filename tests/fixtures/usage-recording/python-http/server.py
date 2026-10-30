"""Usage recording fixture: a stdlib http.server application.

Serves on 127.0.0.1 at a free port and prints the port as its first line.
Every route pauses briefly, so concurrent requests overlap.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from shop import catalog, checkout, timing


def route(method, path, body):
    if method == "POST" and path == "/checkout":
        return checkout.place_order(json.loads(body or b"{}"))
    if path == "/catalog":
        return catalog.list_items()
    if path.startswith("/item/"):
        return catalog.item_detail(path.rsplit("/", 1)[-1])
    if path == "/cart":
        return checkout.cart_summary()
    return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply(route("GET", self.path.split("?", 1)[0], b""))

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        self.reply(route("POST", self.path.split("?", 1)[0], body))

    def reply(self, payload):
        timing.pause()
        data = json.dumps(payload).encode()
        self.send_response(404 if payload is None else 200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print(server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
