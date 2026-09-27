import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WebSocket } from "ws";

import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  createServer
} from "../../server.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

test("socket.io websocket upgrades are not handled by fastify websocket fallback", async () => {
  const app = await createServer({
    browserLifecycleShutdownDelayMs: 0
  });
  let socket = null;

  try {
    await app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const { port } = app.server.address();
    const errors = [];
    const messages = [];

    socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    socket.on("error", (error) => {
      errors.push(error);
    });
    socket.on("message", (message) => {
      messages.push(String(message));
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for socket.io websocket handshake."));
      }, 2000);

      socket.once("message", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    await delay(150);

    assert.equal(errors.length, 0);
    assert.match(messages[0], /^0\{/);
  } finally {
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
    await app.close();
  }
});

test("native browser sockets reject foreign origins and oversized input frames", async (t) => {
  const app = await createServer({ browserLifecycleShutdownDelayMs: 0 });
  t.after(() => app.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const endpoint = `${origin.replace("http:", "ws:")}/api/studio/browser-lifecycle/ws`;
  const foreign = new WebSocket(endpoint, { origin: "https://foreign.example" });
  t.after(() => foreign.terminate());
  assert.equal((await once(foreign, "close"))[0], 1008);
  const local = new WebSocket(endpoint, { origin });
  t.after(() => local.terminate());
  const state = await once(local, "message");
  assert.equal(JSON.parse(String(state[0])).type, "browser-lifecycle-state");
  const closed = once(local, "close");
  local.send("x".repeat(1024 * 1024 + 1));
  assert.equal((await closed)[0], 1009);
});
