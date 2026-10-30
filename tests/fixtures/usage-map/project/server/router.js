export class Router {
  constructor() {
    this.routes = new Map();
  }

  get(path, handler) {
    this.add("GET", path, handler);
  }

  post(path, handler) {
    this.add("POST", path, handler);
  }

  add(method, path, handler) {
    this.routes.set(`${method} ${path}`, handler);
  }

  async handle(request, response) {
    const handler = this.routes.get(`${request.method} ${new URL(request.url, "http://local").pathname}`);
    const body = handler ? await handler(request) : { error: "Not found" };
    response.end(JSON.stringify(body));
  }
}
