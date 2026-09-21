import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export function createApp() {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (pathname === "/api/health") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname !== "/") {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const html = await readFile(new URL("./index.html", import.meta.url));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html);
    } catch {
      response.writeHead(500).end("Could not read index.html");
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "3000" }
  } });
  const server = createApp();
  server.listen(Number(values.port), values.host, () => {
    console.log(`Hello Node is running at http://${values.host}:${server.address().port}`);
  });
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
}
