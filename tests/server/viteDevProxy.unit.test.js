import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { createServer as createViteServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import viteConfig from "../../vite.config.mjs";

test("Vite preserves xterm identifiers until xtermjs issue 5800 is fixed", () => {
  const minify = viteConfig.build?.rolldownOptions?.output?.minify;
  assert.equal(minify?.mangle, false);
  assert.equal(minify?.compress, false);
});

test("Vite forwards browser Host and Origin unchanged for native and realtime sockets", async (t) => {
  const upstream = createHttpServer();
  const sockets = new WebSocketServer({ server: upstream });
  sockets.on("connection", (socket, request) => {
    socket.send(JSON.stringify({ host: request.headers.host, origin: request.headers.origin }));
  });
  t.after(() => { sockets.close(); upstream.close(); });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const target = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = Object.fromEntries(["/api", "/socket.io"].map((route) => [route, {
    ...viteConfig.server.proxy[route], target
  }]));
  const vite = await createViteServer({ configFile: false, appType: "custom",
    server: { host: "127.0.0.1", port: 0, proxy }, optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  await vite.listen();
  const host = `127.0.0.1:${vite.httpServer.address().port}`;
  for (const route of ["/api/terminal/ws", "/socket.io/?EIO=4&transport=websocket"]) {
    for (const origin of [`http://${host}`, "https://foreign.example"]) {
      const socket = new WebSocket(`ws://${host}${route}`, { origin });
      t.after(() => socket.terminate());
      const [message] = await once(socket, "message");
      assert.deepEqual(JSON.parse(String(message)), { host, origin });
      const closed = once(socket, "close");
      socket.close();
      await closed;
    }
  }
});

test("Vite sends only the local app entry route through the backend", () => {
  const proxyEntries = viteConfig.server?.proxy || {};
  const appEntryPattern = Object.keys(proxyEntries).find((pattern) =>
    new RegExp(pattern).test("/app")
  );

  assert.ok(appEntryPattern, "Expected a Vite proxy for the local /app entry route.");
  const matchesAppEntry = new RegExp(appEntryPattern);
  assert.equal(matchesAppEntry.test("/app"), true);
  assert.equal(matchesAppEntry.test("/app/"), true);
  assert.equal(matchesAppEntry.test("/app?from=test"), true);
  assert.equal(matchesAppEntry.test("/app/project/local-target"), false);
});
