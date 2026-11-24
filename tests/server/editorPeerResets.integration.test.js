// A peer that resets a connection never ends the editor. On 24 Nov a workspace's editor exited with `read ECONNRESET`,
// an "Unhandled 'error' event" on a Socket, and every AI turn it ran was cut off: Node takes its own error listener off
// a WebSocket upgrade's connection before it hands it over, and the editor's WebSocket routes add one only at their
// handshake, after every Fastify hook, a host's sign-in check among them. The editor here is the real server in a
// process of its own, run as a host runs it, with a held sign-in check; each case resets one of its connections, and
// the process must keep running and close the connection's other side. Nor does an address that is not one, sent to
// the Preview, end it.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { connect as netConnect } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { VIBE64_RUNTIME_NAMESPACE_ENV } from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const EDITOR = fileURLToPath(new URL("../fixtures/peerResetEditorServer.js", import.meta.url));
const BROWSER_LIFECYCLE_PATH = "/api/studio/browser-lifecycle/ws";
const UPGRADE_WARNING = "vibe64.server.upgrade_socket_error";
// How long a reset that the editor handles in silence gets to reach it: a loopback reset takes well under a millisecond.
const RESET_SETTLE_MS = 200;
const WAIT_MS = 20_000;

test("a peer's reset of any editor connection, or an address that is not one, leaves the editor running", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-peer-reset-"));
  let editor = null;
  t.after(async () => {
    await editor?.kill();
    await rm(root, { force: true, recursive: true });
  });
  editor = await startEditor(root);
  const origin = `http://127.0.0.1:${editor.port}`;

  await t.test("an upgrade reset while a host's sign-in check holds it", async () => {
    const socket = await rawUpgrade(editor.port, BROWSER_LIFECYCLE_PATH, { origin });
    await editor.next("held");
    socket.resetAndDestroy();
    // The editor either logs the reset or, without a listener of its own, ends.
    await editor.untilEndedOr(() => editor.warnings().length === 1);
    editor.assertRunning();
    const [warning] = editor.warnings();
    assert.equal(warning.level, 40, "logged at warn");
    assert.equal(warning.error.code, "ECONNRESET");
    assert.equal(warning.path, BROWSER_LIFECYCLE_PATH);
    await editor.ask("release", "released");
    await editor.settle();
    editor.assertRunning();
  });

  await t.test("an upgrade of an address no route serves, reset while held", async () => {
    const socket = await rawUpgrade(editor.port, "/api/no-such-websocket?key=secret", { origin });
    await editor.next("held");
    socket.resetAndDestroy();
    await editor.untilEndedOr(() => editor.warnings().length === 2);
    editor.assertRunning();
    assert.equal(editor.warnings()[1].path, "/api/no-such-websocket", "the warning never logs an address's query");
    await editor.ask("release", "released");
    await editor.settle();
    editor.assertRunning();
  });

  await t.test("an open editor WebSocket reset by the browser", async () => {
    const browser = connectWebSocket(`ws://127.0.0.1:${editor.port}${BROWSER_LIFECYCLE_PATH}`, { origin });
    // The editor sends its state as soon as the check lets the upgrade through.
    const state = once(browser.socket, "message");
    await editor.next("held");
    await editor.ask("release", "released");
    await withTimeout(state, "the editor's WebSocket opened");
    browser.connection().resetAndDestroy();
    await editor.settle();
    editor.assertRunning();
    await waitFor(async () => (await editor.ask("state", "state")).editorWebSockets === 0, "the editor closed its WebSocket");
  });

  await t.test("a realtime (Socket.IO) WebSocket reset by the browser", async () => {
    const browser = connectWebSocket(`ws://127.0.0.1:${editor.port}/socket.io/?EIO=4&transport=websocket`, { origin });
    await withTimeout(once(browser.socket, "message"), "Socket.IO opened");
    browser.connection().resetAndDestroy();
    await editor.settle();
    editor.assertRunning();
  });

  await t.test("a Preview WebSocket reset by the browser closes the app's side", async () => {
    const browser = connectWebSocket(previewWebSocketHref(editor.previewHref));
    await withTimeout(once(browser.socket, "open"), "the Preview's WebSocket opened");
    assert.equal(await echo(browser.socket, "before"), "echo:before");
    browser.connection().resetAndDestroy();
    await editor.settle();
    editor.assertRunning();
    await waitFor(async () => (await editor.ask("state", "state")).appSockets === 0, "the Preview closed the app's side");
  });

  await t.test("a Preview WebSocket reset by the app closes the browser's side", async () => {
    const browser = connectWebSocket(previewWebSocketHref(editor.previewHref));
    await withTimeout(once(browser.socket, "open"), "the Preview's WebSocket opened");
    assert.equal(await echo(browser.socket, "before"), "echo:before");
    const closed = once(browser.socket, "close");
    await editor.ask("reset-app", "app-reset");
    await withTimeout(closed, "the Preview closed the browser's side");
    editor.assertRunning();
  });

  await t.test("a Preview request or upgrade whose address is not one is refused", async () => {
    const preview = new URL(editor.previewHref);
    const port = Number(preview.port);
    const request = await rawExchange(port, ["GET // HTTP/1.1", `Host: ${preview.host}`, "Connection: close"]);
    await editor.settle();
    editor.assertRunning();
    assert.match(request, /^HTTP\/1\.1 400 /u);
    const upgrade = await rawExchange(port, [
      "GET // HTTP/1.1",
      `Host: ${preview.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`
    ]);
    await editor.settle();
    editor.assertRunning();
    assert.match(upgrade, /^HTTP\/1\.1 400 Bad Request/u);
  });

  await t.test("a request reset before its head ends", async () => {
    const socket = netConnect({ host: "127.0.0.1", port: editor.port });
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${editor.port}\r\n`);
    await delay(50);
    socket.resetAndDestroy();
    await editor.settle();
    editor.assertRunning();
  });

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await editor.stop(), { code: 0, signal: null });
  assert.doesNotMatch(editor.stderr, /Unhandled 'error' event/u);
});

/** The editor in a child process: its output kept, its messages read in order. */
async function startEditor(root) {
  const child = fork(EDITOR, [root], {
    env: { ...process.env, [VIBE64_RUNTIME_NAMESPACE_ENV]: "unit-owner" },
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const output = { stderr: "", stdout: "" };
  child.stdout.on("data", (chunk) => {
    output.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk;
  });
  const messages = [];
  child.on("message", (message) => messages.push(message));
  let exit = null;
  const exited = once(child, "exit").then(([code, signal]) => {
    exit = { code, signal };
    return exit;
  });
  const report = () => `exit ${JSON.stringify(exit)}\nstderr:\n${output.stderr}\nstdout:\n${output.stdout.slice(-4000)}`;
  const warnings = () => output.stdout.split("\n")
    .filter((line) => line.includes(UPGRADE_WARNING))
    .map((line) => JSON.parse(line));

  async function next(type) {
    let message = null;
    await waitFor(() => {
      assert.equal(exit, null, `the editor ended while the test waited for "${type}":\n${report()}`);
      const index = messages.findIndex((candidate) => candidate.type === type);
      if (index >= 0) [message] = messages.splice(index, 1);
      return Boolean(message);
    }, `the editor sent "${type}":\n${report()}`);
    return message;
  }

  const ready = await next("ready");
  return {
    port: ready.port,
    previewHref: ready.previewHref,
    get stderr() {
      return output.stderr;
    },
    next,
    warnings,
    async ask(message, answer) {
      child.send(message);
      return next(answer);
    },
    assertRunning() {
      assert.equal(exit, null, `the editor ended:\n${report()}`);
    },
    async settle() {
      await Promise.race([exited, delay(RESET_SETTLE_MS)]);
    },
    async untilEndedOr(check) {
      await waitFor(() => exit !== null || check(), `the editor ended or logged the reset:\n${report()}`);
    },
    async stop() {
      if (exit) return exit;
      child.send("exit");
      return withTimeout(exited, `the editor exited when told:\n${report()}`);
    },
    async kill() {
      if (exit) return;
      child.kill("SIGKILL");
      await exited;
    }
  };
}

/** A raw connection that has sent a WebSocket upgrade's whole head. */
async function rawUpgrade(port, requestPath, { origin }) {
  const socket = netConnect({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write([
    `GET ${requestPath} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
    `Origin: ${origin}`,
    "",
    ""
  ].join("\r\n"));
  return socket;
}

/** What a server answers a raw request head, read until it closes the connection. */
async function rawExchange(port, headLines) {
  const socket = netConnect({ host: "127.0.0.1", port });
  let answer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    answer += chunk;
  });
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write([...headLines, "", ""].join("\r\n"));
  await withTimeout(once(socket, "close"), "the server answered and closed the connection");
  return answer;
}

/** A WebSocket whose own connection the test can reset. */
function connectWebSocket(href, { origin } = {}) {
  let connection = null;
  const socket = new WebSocket(href, {
    ...(origin ? { origin } : {}),
    createConnection: (options) => {
      connection = netConnect(options);
      return connection;
    }
  });
  socket.on("error", () => {});
  return { socket, connection: () => connection };
}

function previewWebSocketHref(previewHref) {
  const url = new URL(previewHref);
  url.protocol = "ws:";
  return url.href;
}

async function echo(socket, text) {
  const reply = once(socket, "message");
  socket.send(text);
  return String((await withTimeout(reply, "the Preview's app answered"))[0]);
}

async function waitFor(check, description) {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `timed out waiting until ${description}`);
    await delay(25);
  }
}

async function withTimeout(promise, description) {
  const timeout = delay(WAIT_MS, "timeout", { ref: false });
  const result = await Promise.race([promise, timeout]);
  assert.notEqual(result, "timeout", `timed out waiting until ${description}`);
  return result;
}
