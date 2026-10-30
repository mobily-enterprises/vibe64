// A small stdlib web app for the Node.js usage recorder tests. It prints the
// port it listens on, then serves the routes in lib/routes.mjs.
import http from "node:http";

import { handleRequest, housekeeping } from "./lib/routes.mjs";

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    response.statusCode = 500;
    response.end(String(error?.message || error));
  });
});

setInterval(housekeeping, 100).unref();

server.listen(Number(process.env.PORT || 0), "127.0.0.1", () => {
  process.stdout.write(`LISTENING ${server.address().port}\n`);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
