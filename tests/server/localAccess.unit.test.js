import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";

import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { startServer } from "../../server.js";
import {
  LOCAL_ACCESS_HEADER,
  LOCAL_ACCESS_QUERY_PARAMETER,
  LOCAL_ACCESS_TOKEN_ENV,
  localAccessCookieName,
  localAccessTokenForStart,
  resolveLocalAccessToken
} from "../../server/lib/localAccess.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

async function upgradeStatus(url, headers = {}) {
  const socket = new WebSocket(url, { headers });
  // Ending a refused handshake reports an error; the status is the outcome.
  socket.on("error", () => {});
  const [outcome] = await Promise.race([
    once(socket, "open").then(() => ["open"]),
    once(socket, "unexpected-response").then(([, response]) => [response.statusCode])
  ]);
  socket.terminate();
  return outcome;
}

test("a TCP server lets in only requests that carry this start's access key", async () => {
  const previousToken = process.env[LOCAL_ACCESS_TOKEN_ENV];
  delete process.env[LOCAL_ACCESS_TOKEN_ENV];
  const app = await startServer({ host: "127.0.0.1", port: 0, strictPort: false });
  try {
    const startUrl = new URL(app.vibe64Url);
    const token = startUrl.searchParams.get(LOCAL_ACCESS_QUERY_PARAMETER);
    assert.ok(token && token.length >= 32, "the printed address carries the key");
    const origin = startUrl.origin;
    const cookieName = localAccessCookieName(app.vibe64Listen.port);

    // Another local process or account: loopback, but no key.
    const refused = await fetch(`${origin}/app`, { redirect: "manual" });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).errors[0].code, "vibe64_local_access_required");
    const wrongKey = await fetch(`${origin}/app`, { headers: { cookie: `${cookieName}=${"x".repeat(token.length)}` }, redirect: "manual" });
    assert.equal(wrongKey.status, 403);
    assert.equal((await fetch(`${origin}/api/health`)).status, 200, "health stays open for start-up checks");

    // The browser opens the printed address once and keeps the cookie.
    const opened = await fetch(app.vibe64Url, { redirect: "manual" });
    assert.equal(opened.status, 302);
    assert.equal(opened.headers.get("location"), "/app");
    assert.match(opened.headers.get("set-cookie"), new RegExp(`^${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax$`, "u"));
    const withCookie = await fetch(`${origin}/app`, { headers: { cookie: `${cookieName}=${token}` }, redirect: "manual" });
    assert.doesNotMatch(await withCookie.text(), /vibe64_local_access_required/u);
    const withHeader = await fetch(`${origin}/app`, { headers: { [LOCAL_ACCESS_HEADER]: token }, redirect: "manual" });
    assert.doesNotMatch(await withHeader.text(), /vibe64_local_access_required/u);

    // Terminal and realtime sockets need the key as well.
    const socketUrl = `ws://127.0.0.1:${app.vibe64Listen.port}/socket.io/?EIO=4&transport=websocket`;
    assert.equal(await upgradeStatus(socketUrl), 403);
    assert.equal(await upgradeStatus(socketUrl, { cookie: `${cookieName}=${token}` }), "open");
  } finally {
    await app.close();
    if (previousToken == null) delete process.env[LOCAL_ACCESS_TOKEN_ENV];
    else process.env[LOCAL_ACCESS_TOKEN_ENV] = previousToken;
  }
});

test("each start makes a new key unless a long enough one is configured", () => {
  const first = resolveLocalAccessToken({ env: {} });
  assert.notEqual(resolveLocalAccessToken({ env: {} }), first);
  const configured = "k".repeat(40);
  assert.equal(resolveLocalAccessToken({ env: { [LOCAL_ACCESS_TOKEN_ENV]: configured } }), configured);
  assert.throws(() => resolveLocalAccessToken({ env: { [LOCAL_ACCESS_TOKEN_ENV]: "1" } }), { code: "vibe64_local_access_token_invalid" });
});

test("only a local editor on a TCP port needs a start's access key", () => {
  const tcp = { transport: "tcp" };
  const local = { local: true };
  assert.ok(localAccessTokenForStart({ env: {}, listenTarget: tcp, runtimeProfile: local }).length >= 32);
  assert.equal(localAccessTokenForStart({ env: {}, listenTarget: { transport: "socket" }, runtimeProfile: local }), "");
  // A host that signs its people in serves them through its own proxy.
  assert.equal(localAccessTokenForStart({ env: {}, listenTarget: tcp, runtimeProfile: { local: false } }), "");
  assert.equal(localAccessTokenForStart({ env: {}, listenTarget: tcp, required: false, runtimeProfile: local }), "");
});
