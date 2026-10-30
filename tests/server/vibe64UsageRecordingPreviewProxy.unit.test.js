import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";

import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { stopActiveUsageRecording } from "@local/vibe64-usage-recording/server/activeRecordings";
import {
  USAGE_RECORDING_INTERACTION_HEADER,
  USAGE_RECORDING_REQUEST_HEADER
} from "@local/vibe64-usage-recording/shared/contract";
import { createService } from "../../packages/vibe64-usage-recording/src/server/service.js";
import {
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  createLaunchPreviewProxyRegistry
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";

const SESSION_ID = "session-proxy";
const SECRETS = ["SECRET_AUTHORIZATION", "SECRET_COOKIE", "SECRET_QUERY", "SECRET_BODY", "token="];
const inProject = (operation) => runWithProjectRequestContext({ slug: "demo" }, operation);

async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 5000;
  let value = await read();
  while (!predicate(value)) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
    await delay(15);
    value = await read();
  }
  return value;
}

// An application that answers every request with the headers it was sent.
async function echoTarget(t) {
  const upgrades = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(request.headers));
    });
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    upgrades.push(request.headers);
    sockets.handleUpgrade(request, socket, head, (websocket) => websocket.close());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    sockets.close();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, upgrades };
}

async function readAllFiles(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) contents.push(await readFile(path.join(entry.parentPath, entry.name), "utf8"));
  }
  return contents.join("\n");
}

test("the Preview proxy numbers recorded requests and no request content reaches a recording", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-proxy-"));
  const sessionRoot = path.join(root, "state/roots", SESSION_ID);
  const sourceRoot = path.join(root, "state/sessions/active", SESSION_ID, "source");
  await mkdir(sessionRoot, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  const session = {
    sessionId: SESSION_ID, status: "active", sessionRoot,
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: "managed_session_source" }
  };
  const service = createService({
    events: { publish: async () => {} },
    projectService: { createRuntime: async () => ({ getSession: async () => session }) },
    terminals: {
      usageRecordingTargets: async () => ({ ok: true, previewTargetId: "web", targets: [
        { id: "web", label: "Web app", web: true, available: true, disabledReason: "", runtimes: ["nodejs"], parameters: [] }
      ] }),
      startOutputTargetTerminal: async () => ({ ok: true })
    },
    timing: { eventMs: 0, pollMs: 10, readyMs: 60_000, stopIdleMs: 50 }
  });
  const call = (method, input = {}) => inProject(() => service[method]({ sessionId: SESSION_ID, ...input }));
  const registry = createLaunchPreviewProxyRegistry();
  t.after(async () => {
    await registry.closeAll();
    await stopActiveUsageRecording("project:demo", SESSION_ID);
    await delay(100);
    await rm(root, { force: true, recursive: true });
  });

  const target = await echoTarget(t);
  const preview = await inProject(() => registry.ensure({ sessionId: SESSION_ID, targetHref: `${target.origin}/`, terminalSessionId: "terminal-1" }));
  const token = new URL(preview.href).searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM);
  const send = async (pathname, { headers = {}, method = "GET", body } = {}) => {
    const url = new URL(pathname, new URL(preview.href).origin);
    url.searchParams.set(PREVIEW_PROXY_TOKEN_QUERY_PARAM, token);
    const response = await fetch(url, { body, headers: { Accept: "application/json", ...headers }, method });
    assert.equal(response.status, 200);
    return response.json();
  };
  const forged = { [USAGE_RECORDING_REQUEST_HEADER]: "r_999999", [USAGE_RECORDING_INTERACTION_HEADER]: "i_0009" };

  // Without a recording, the proxy passes no recording header either way.
  const before = await send("/api/ping", { headers: forged });
  assert.equal(before[USAGE_RECORDING_REQUEST_HEADER], undefined);
  assert.equal(before[USAGE_RECORDING_INTERACTION_HEADER], undefined);

  const { recording } = await call("start", { targetId: "preview" });
  const first = await send("/api/items?token=SECRET_QUERY&page=2", {
    headers: { ...forged, Authorization: "Bearer SECRET_AUTHORIZATION", Cookie: "session=SECRET_COOKIE", [USAGE_RECORDING_INTERACTION_HEADER]: "i_0001" }
  });
  const second = await send("/api/items", {
    body: JSON.stringify({ password: "SECRET_BODY" }),
    headers: { "Content-Type": "application/json", [USAGE_RECORDING_INTERACTION_HEADER]: "i_1;drop" },
    method: "POST"
  });
  // A script the page loads is counted, not numbered or logged.
  const script = await send("/assets/bundle", { headers: { ...forged, "Sec-Fetch-Dest": "script" } });
  assert.equal(script[USAGE_RECORDING_REQUEST_HEADER], undefined);
  assert.equal((await call("readCurrent")).recording.requestLog.assets, 1);
  assert.deepEqual([first[USAGE_RECORDING_REQUEST_HEADER], second[USAGE_RECORDING_REQUEST_HEADER]], ["r_000001", "r_000002"]);
  assert.equal(first[USAGE_RECORDING_INTERACTION_HEADER], undefined);
  assert.equal(second[USAGE_RECORDING_INTERACTION_HEADER], undefined);

  // A WebSocket upgrade is not a recorded request and carries no recording header.
  const websocketUrl = new URL(preview.href);
  websocketUrl.protocol = "ws:";
  const websocket = new WebSocket(websocketUrl, { headers: forged });
  await new Promise((resolve) => websocket.once("close", resolve).once("error", resolve));
  assert.equal(target.upgrades.length, 1);
  assert.equal(target.upgrades[0][USAGE_RECORDING_REQUEST_HEADER], undefined);
  assert.equal(target.upgrades[0][USAGE_RECORDING_INTERACTION_HEADER], undefined);

  const directory = path.join(sessionRoot, "usage-recordings", recording.id);
  const logged = await waitFor(async () => (await readFile(path.join(directory, "requests.ndjson"), "utf8").catch(() => ""))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line)), (rows) => rows.length === 2, "the request log");
  assert.deepEqual(logged.map(({ id, method, path: requestPath, status, interaction }) => ({ id, method, path: requestPath, status, interaction })), [
    { id: "r_000001", method: "GET", path: "/api/items", status: 200, interaction: "i_0001" },
    { id: "r_000002", method: "POST", path: "/api/items", status: 200, interaction: null }
  ]);

  await call("stop", { recordingId: recording.id });
  await waitFor(async () => (await call("readCurrent")).recording?.state, (state) => state === "stopped", "the stopped recording");
  const after = await send("/api/ping", { headers: forged });
  assert.equal(after[USAGE_RECORDING_REQUEST_HEADER], undefined);

  // Privacy: no header, cookie, query or body of any request is in any recording file.
  const stored = await readAllFiles(path.join(sessionRoot, "usage-recordings"));
  assert.ok(stored.includes("/api/items"));
  for (const secret of SECRETS) assert.equal(stored.includes(secret), false, secret);
});
