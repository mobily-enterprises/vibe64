import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import Fastify from "fastify";
import {
  beginServerStop,
  onServerStopBegins,
  resetServerStop,
  serverStopBegun,
  serverStopSignal
} from "@local/vibe64-execution/server/serverStop";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { registerStopGate, STOPPING_HEADER, stopAcceptingConnections } from "../../server/lib/stopGate.js";

// While the editor stops: a request that still reaches it runs nothing and is answered with 503, Connection: close and
// x-vibe64-stopping, which tells the page it may send it again to the next server; an answer in flight finishes and
// closes its connection; the listener takes no new connection; and the command gateway starts nothing.

function get(port, path) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({ agent: false, host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on("error", reject);
  });
}

test("once the stop begins, a request runs nothing and says it may be sent again, and no new connection or command starts", async (t) => {
  resetServerStop();
  t.after(resetServerStop);
  const app = Fastify({ return503OnClosing: false });
  registerStopGate(app);
  const handled = [];
  let releaseSlow;
  const slowHeld = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  app.post("/write", async () => {
    handled.push("write");
    return { ok: true };
  });
  app.get("/slow", async () => {
    handled.push("slow");
    await slowHeld;
    return { ok: true };
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const { port } = app.server.address();

  const before = await app.inject({ method: "POST", url: "/write", payload: {} });
  assert.equal(before.statusCode, 200);
  assert.equal(before.headers[STOPPING_HEADER], undefined);
  const slow = get(port, "/slow");
  while (!handled.includes("slow")) await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(beginServerStop("SIGTERM"), true);
  assert.equal(beginServerStop("SIGTERM"), false, "the stop begins once");
  stopAcceptingConnections(app.server);

  const refused = await app.inject({ method: "POST", url: "/write", payload: {} });
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.headers[STOPPING_HEADER], "1", "the page may send it again");
  assert.equal(refused.headers.connection, "close");
  assert.equal(refused.headers["retry-after"], "1");
  assert.deepEqual(refused.json(), {
    ok: false,
    code: "vibe64_server_stopping",
    error: "Vibe64 is restarting. It will answer again in a moment."
  });
  assert.deepEqual(handled, ["write", "slow"], "the refused write never reached its handler");

  releaseSlow();
  const finished = await slow;
  assert.equal(finished.status, 200, "a request in flight still finishes");
  assert.equal(finished.headers.connection, "close", "and closes its connection, so the page's next request reaches the next server");
  assert.equal(finished.headers[STOPPING_HEADER], undefined, "an answer that ran is not marked as not run");

  const connection = await get(port, "/slow").then(() => "answered", (error) => error.code);
  assert.equal(connection, "ECONNREFUSED", "the listener takes no new connection");

  const command = await runVibe64Command({ command: process.execPath, args: ["-e", ""], mode: "capture", purpose: "codex" });
  assert.equal(command.ok, false);
  assert.equal(command.code, "vibe64_server_stopping", "the command gateway starts nothing once the stop has begun");
  assert.equal(command.retryable, true);
});

test("the stop's listeners run once, as it begins; a failing one is logged and the rest still run; a new server starts unstopped", (t) => {
  resetServerStop();
  t.after(resetServerStop);
  const calls = [];
  const logged = [];
  const unsubscribeFailing = onServerStopBegins(() => {
    calls.push("failing");
    throw new Error("listener failed");
  });
  const unsubscribe = onServerStopBegins((reason) => calls.push(`first:${reason}`));
  const dropped = onServerStopBegins(() => calls.push("dropped"));
  dropped();
  t.after(() => {
    unsubscribe();
    unsubscribeFailing();
  });
  const signal = serverStopSignal();
  assert.equal(serverStopBegun(), false);

  beginServerStop("SIGTERM", { logger: { error: (fields) => logged.push(fields.event) } });
  assert.deepEqual(calls, ["failing", "first:SIGTERM"], "synchronously, in order, without the unsubscribed one");
  assert.deepEqual(logged, ["vibe64.server.stop_listener_failed"]);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.code, "vibe64_server_stopping");
  onServerStopBegins((reason) => calls.push(`late:${reason}`));
  assert.deepEqual(calls.slice(-1), ["late:SIGTERM"], "a listener that comes after the stop began runs at once");
  beginServerStop("SIGTERM");
  assert.equal(calls.length, 3, "a second begin runs nothing");

  resetServerStop();
  assert.equal(serverStopBegun(), false);
  assert.equal(serverStopSignal().aborted, false);
  beginServerStop("SIGINT");
  assert.deepEqual(calls.slice(-2), ["failing", "first:SIGINT"], "listeners stay subscribed for the next server's stop");
});
