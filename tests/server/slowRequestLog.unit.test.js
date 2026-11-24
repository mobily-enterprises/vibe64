// On 24 Nov 2026 a chat send in a hosted session waited inside its request for the workspace preparation, and the
// edge in front of the workspace ended it after a minute ("Request failed with status 504."). Nothing in the
// editor's log said that request had been waiting: every answer that comes late, and every request whose client
// gave up before its answer, is now logged with its route and how long it took from its arrival.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import Fastify from "fastify";
import { registerSlowRequestLog } from "../../server/lib/slowRequestLog.js";

function recordingLogger() {
  const lines = [];
  const record = (level) => (fields, message) => lines.push({ level, message, ...fields });
  const logger = { debug() {}, error: record("error"), info: record("info"), warn: record("warn"), child: () => logger };
  return { lines, logger };
}

async function slowServer(logger) {
  const app = Fastify();
  registerSlowRequestLog(app, { logger, slowMs: 100 });
  app.get("/quick/:id", async () => ({ ok: true }));
  app.post("/slow/:sessionId/agent-message", async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true };
  });
  app.get("/never/:id", () => new Promise(() => {}));
  await app.listen({ host: "127.0.0.1", port: 0 });
  return app;
}

test("a late answer and a request its client gave up on are logged with their route and time from arrival", async () => {
  const { lines, logger } = recordingLogger();
  const app = await slowServer(logger);
  try {
    assert.equal((await app.inject({ method: "GET", url: "/quick/1?token=secret" })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/slow/s1/agent-message?token=secret" })).statusCode, 200);
    const late = lines.filter(({ event }) => event === "vibe64.server.slow_answer");
    assert.equal(late.length, 1, "only the late answer is logged");
    assert.equal(late[0].level, "warn");
    assert.equal(late[0].method, "POST");
    assert.equal(late[0].route, "/slow/:sessionId/agent-message");
    assert.equal(late[0].statusCode, 200);
    assert.ok(late[0].elapsedMs >= 100);

    // A client (the edge) that ends the request before its answer.
    const { port } = app.server.address();
    await new Promise((resolve) => {
      const request = http.get({ host: "127.0.0.1", port, path: "/never/2?token=secret" });
      request.on("error", resolve);
      setTimeout(() => { request.destroy(); }, 150);
    });
    const deadline = Date.now() + 5_000;
    while (!lines.some(({ event }) => event === "vibe64.server.request_abandoned") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const abandoned = lines.find(({ event }) => event === "vibe64.server.request_abandoned");
    assert.ok(abandoned, "a request its client gave up on is logged");
    assert.equal(abandoned.level, "warn");
    assert.equal(abandoned.route, "/never/:id");
    assert.ok(abandoned.elapsedMs >= 100);
    assert.equal(JSON.stringify(lines).includes("secret"), false, "a query is never logged");
  } finally {
    await app.close();
  }
});
