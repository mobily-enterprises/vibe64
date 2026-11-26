import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer, createSignalShutdownHandler } from "../../server.js";
import { __testables as browserLifecycleTestables } from "../../server/lib/browserLifecycle.js";
import { STOP_DRAIN_MS } from "../../server/lib/stopGate.js";

const { BROWSER_LIFECYCLE_WEBSOCKET_PATH } = browserLifecycleTestables;
const SHUTDOWN_TIMEOUT_MS = 3000;
const EVENT_STREAM_PATH = "/test/open-event-stream";

/**
 * A WebSocket whose peer never answers, as a browser behind a slow edge or a proxied socket may not: it reads all the
 * editor sends, its close frame included, and sends nothing back.
 */
async function openSilentWebSocket(address, pathname) {
  const url = new URL(address);
  const socket = net.connect({ host: url.hostname, port: Number(url.port) });
  socket.on("error", () => {});
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    `GET ${pathname} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
    `Origin: ${url.origin}`,
    "",
    ""
  ].join("\r\n"));
  const head = await new Promise((resolve, reject) => {
    socket.once("data", chunk => resolve(chunk.toString("latin1")));
    socket.once("end", () => reject(new Error("The WebSocket upgrade was refused.")));
  });
  assert.match(head, /^HTTP\/1\.1 101 /u, head);
  socket.on("data", () => {});
  return socket;
}

/** An event stream the server keeps open, read until its first event. */
async function openEventStream(address) {
  const request = http.get(`${address}${EVENT_STREAM_PATH}`);
  request.on("error", () => {});
  const response = await new Promise((resolve, reject) => {
    request.once("response", resolve);
    request.once("error", reject);
  });
  assert.equal(response.statusCode, 200);
  response.on("error", () => {});
  await new Promise(resolve => response.once("data", resolve));
  return { request, response };
}

const closed = emitter => new Promise(resolve => emitter.once("close", resolve));

test("a stop with an open WebSocket whose peer never answers, and an open event stream, ends within its drain", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-stop-open-connections-"));
  // Work the closed server left running can recreate its state folder after the removal below.
  process.once("exit", () => rmSync(temporaryRoot, { force: true, recursive: true }));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `stop-open-connections-${process.pid}`;
  let app = null;
  let socket = null;
  let stream = null;
  const logged = [];
  const exits = [];

  try {
    app = await createServer({
      managedSourceRoot: path.join(temporaryRoot, "managed"),
      projectsRoot: path.join(temporaryRoot, "projects"),
      systemRoot: path.join(temporaryRoot, "state")
    });
    app.get(EVENT_STREAM_PATH, (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { "cache-control": "no-cache", "content-type": "text/event-stream" });
      reply.raw.write("event: open\ndata: {}\n\n");
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = await openSilentWebSocket(address, BROWSER_LIFECYCLE_WEBSOCKET_PATH);
    stream = await openEventStream(address);
    const socketClosed = closed(socket);
    const streamClosed = closed(stream.response);
    const log = app.log;
    const handler = createSignalShutdownHandler({
      app: Object.assign(Object.create(app), {
        log: {
          ...log,
          error: (fields, message) => logged.push({ fields, message }),
          info() {},
          warn() {}
        }
      }),
      capabilityRuntime: app.vibe64CapabilityRuntime,
      beforeClose() {},
      closeRuntimeTerminals() {},
      exitProcess: code => exits.push(code),
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS
    });

    const startedAt = performance.now();
    await Promise.race([
      handler("SIGTERM"),
      new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS + 500))
    ]);
    const elapsedMs = performance.now() - startedAt;

    assert.deepEqual(logged.filter(({ fields }) => fields?.event === "vibe64.server.shutdown_timeout")
      .map(({ fields }) => fields.pendingOperations), []);
    assert.deepEqual(exits, [0]);
    await Promise.all([socketClosed, streamClosed]);
    // The drain ends both connections; the stop is done well before its deadline.
    assert.ok(elapsedMs < STOP_DRAIN_MS + 1500, `the stop took ${Math.round(elapsedMs)} ms`);
  } finally {
    socket?.destroy();
    stream?.request.destroy();
    await app?.close().catch(() => null);
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
