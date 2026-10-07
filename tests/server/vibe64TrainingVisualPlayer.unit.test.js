import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { MessageChannel } from "node:worker_threads";
import test from "node:test";
import { createTrainingVisualPlayer } from "../../packages/vibe64-training/src/client/visualPlayer.js";
import { alternateVisualResource } from "../fixtures/trainingVisualFixture.js";

async function fixture(t, options = {}) {
  const listeners = new Set();
  const transfers = [];
  const requests = [];
  const view = { crypto: webcrypto, atob, btoa, MessageChannel,
    addEventListener(name, listener) { assert.equal(name, "message"); listeners.add(listener); },
    removeEventListener(name, listener) { assert.equal(name, "message"); listeners.delete(listener); } };
  const attributes = new Map([["allow", "microphone"], ["src", "/old-preview"]]);
  const iframe = { ownerDocument: { defaultView: view }, srcdoc: "",
    setAttribute(name, value) { attributes.set(name, value); }, removeAttribute(name) { attributes.delete(name); },
    contentWindow: { postMessage(value, origin, ports) { assert.equal(origin, "*"); transfers.push({ value, port: ports[0] }); } } };
  const player = createTrainingVisualPlayer({ iframe, resource: alternateVisualResource(), attemptId: "attempt-one", ...options });
  t.after(() => { player.dispose(); for (const { port } of transfers) port.close(); });
  function handshake(overrides = {}, source = iframe.contentWindow) {
    const payload = JSON.parse(iframe.srcdoc.match(/\)\((\{"playerInstanceId".*), url => import\(url\)\);<\/script>/u)[1]);
    const data = { type: "vibe64-visual-handshake", protocolVersion: 1, playerInstanceId: payload.playerInstanceId, token: payload.token, ...overrides };
    for (const listener of [...listeners]) listener({ source, data });
  }
  function connect() {
    handshake();
    const connection = transfers.at(-1);
    connection.port.onmessage = ({ data }) => requests.push(data);
    connection.port.start();
    return connection;
  }
  function reply(type, fields = {}, connection = transfers.at(-1)) {
    connection.port.postMessage({ protocolVersion: 1, playerInstanceId: connection.value.playerInstanceId, type, state: "idle", ...fields });
  }
  async function until(predicate) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, "channel operation did not arrive");
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  }
  async function ready() {
    connect();
    reply("ready", { commands: ["advance", "probe", "stall"], description: "Waiting", state: transfers.at(-1).value.init.initialState });
    await player.ready;
  }
  async function request(type, from = 0) {
    await until(() => requests.slice(from).some(value => value.type === type));
    return requests.slice(from).find(value => value.type === type);
  }
  return { player, iframe, attributes, listeners, transfers, requests, handshake, connect, reply, until, ready, request };
}

test("opaque sandbox handshake requires the exact window, nonce, instance and bounded ready declaration", async t => {
  const f = await fixture(t);
  assert.equal(f.attributes.get("sandbox"), "allow-scripts");
  assert.equal(f.attributes.get("referrerpolicy"), "no-referrer");
  assert.equal(f.attributes.has("allow"), false);
  assert.equal(f.attributes.has("src"), false);
  assert.match(f.iframe.srcdoc, /connect-src 'none'/u);
  assert.doesNotMatch(f.iframe.srcdoc, /allow-same-origin/u);
  f.handshake({}, {});
  f.handshake({ token: "wrong" });
  f.handshake({ protocolVersion: 2 });
  f.handshake({ extra: true });
  assert.equal(f.transfers.length, 0);
  f.connect();
  f.handshake();
  assert.equal(f.transfers.length, 1);
  for (const fields of [{ playerInstanceId: "other" }, { commands: ["advance"] }, { description: "x".repeat(2001) }, { extra: true }]) {
    f.reply("ready", { commands: ["advance", "probe", "stall"], description: "Waiting", ...fields });
  }
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.player.state.phase, "loading");
  f.reply("ready", { commands: ["advance", "probe", "stall"], description: "Waiting" });
  await f.player.ready;
  assert.equal(f.player.state.phase, "ready");
});

test("accepted is provisional; identical pending retries share a promise and completion refreshes current semantic display", async t => {
  const f = await fixture(t);
  await f.ready();
  const input = { commandId: "one", name: "advance", parameters: { label: "Arrived" } };
  const promise = f.player.command(input);
  assert.equal(f.player.command(input), promise);
  let settled = false;
  promise.then(() => { settled = true; });
  await f.request("command");
  f.reply("accepted", { commandId: "one" });
  await f.until(() => f.player.state.phase === "accepted");
  assert.equal(settled, false);
  f.reply("completed", { commandId: "one", state: "idle", description: "Invalid completion state" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false);
  f.reply("completed", { commandId: "one", state: "shown", description: "Arrived" });
  assert.equal((await promise).state, "shown");
  const snapshot = await f.request("snapshot");
  f.reply("snapshot", { requestId: snapshot.requestId, state: "shown", description: "Arrived", paused: false, labels: { caption: "Arrived" } });
  await f.until(() => f.player.state.description === "Arrived");
  assert.equal(f.requests.filter(value => value.type === "command").length, 1);
});

test("completed retry asks the authored controller again and its old receipt never rewinds the display", async t => {
  const f = await fixture(t);
  await f.ready();
  const input = { commandId: "one", name: "advance", parameters: { label: "First" } };
  const first = f.player.command(input);
  await f.request("command");
  f.reply("accepted", { commandId: "one" });
  f.reply("completed", { commandId: "one", state: "shown", description: "First" });
  await first;
  const refresh = await f.request("snapshot");
  f.reply("snapshot", { requestId: refresh.requestId, state: "shown", description: "Current", paused: false, labels: { caption: "Current" } });
  await f.until(() => f.player.state.description === "Current");
  const from = f.requests.length;
  const retry = f.player.command(input);
  assert.equal((await f.request("command", from)).commandId, "one");
  f.reply("completed", { commandId: "one", state: "shown", description: "First" });
  assert.equal((await retry).description, "First");
  assert.equal(f.player.state.description, "Current");
  const current = await f.request("snapshot", from);
  f.reply("snapshot", { requestId: current.requestId, state: "shown", description: "Current", paused: false, labels: { caption: "Current" } });
  await assert.rejects(f.player.command({ ...input, parameters: { label: "Different" } }), /different input/u);
});

test("descriptor bounds and snapshot validation reject undeclared or malformed input before channel delivery", async t => {
  const f = await fixture(t);
  await f.ready();
  for (const input of [
    { commandId: "a", name: "unknown" },
    { commandId: "a", name: "advance", parameters: {} },
    { commandId: "a", name: "advance", parameters: { label: "x".repeat(25) } },
    { commandId: "a", name: "advance", parameters: { label: "valid", extra: "no" } },
    { commandId: "a", name: "advance", parameters: { label: "line\nbreak" } }
  ]) await assert.rejects(f.player.command(input));
  assert.equal(f.requests.length, 0);
  const instanceId = f.player.state.playerInstanceId;
  for (const value of [{ state: "outside", paused: false, labels: {} }, { state: "idle", paused: false, labels: { caption: "x".repeat(257) } }, { state: "idle", paused: "yes", labels: {} }]) {
    assert.throws(() => f.player.restore(value), /semantic state/u);
  }
  assert.equal(f.player.state.playerInstanceId, instanceId);
  const request = f.player.snapshot();
  const message = await f.request("snapshot");
  f.reply("snapshot", { requestId: message.requestId, description: "Waiting", paused: false, labels: { caption: "x".repeat(257) } });
  f.reply("snapshot", { requestId: message.requestId, description: "Waiting", paused: false, labels: { caption: "Waiting" } });
  const result = await request;
  result.labels.caption = "External mutation";
  const restoring = f.player.restore();
  const connection = f.connect();
  assert.equal(connection.value.init.snapshot.labels.caption, "Waiting");
  f.reply("ready", { commands: ["advance", "probe", "stall"], description: "Waiting" });
  await restoring;
});

test("restore retires pending work, rejects late old-instance messages and cannot replay a forgotten receipt", async t => {
  const f = await fixture(t);
  await f.ready();
  const old = f.transfers.at(-1);
  const pending = f.player.command({ commandId: "one", name: "stall" });
  const rejection = assert.rejects(pending, /instance changed/u);
  await f.request("command");
  const restoring = f.player.restore({ state: "shown", paused: true, labels: { caption: "Saved" } }, true);
  await rejection;
  const connection = f.connect();
  assert.notEqual(connection.value.playerInstanceId, old.value.playerInstanceId);
  assert.equal(connection.value.init.reducedMotion, true);
  assert.deepEqual(connection.value.init.snapshot, { state: "shown", paused: true, labels: { caption: "Saved" } });
  f.reply("ready", { commands: ["advance", "probe", "stall"], state: "shown", description: "Saved" });
  await restoring;
  f.reply("ready", { commands: ["advance", "probe", "stall"], description: "Stale" }, old);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.player.state.description, "Saved");
  await assert.rejects(f.player.command({ commandId: "one", name: "stall" }), /receipt are gone/u);
  assert.equal(f.requests.filter(value => value.type === "command").length, 1);
});

test("failed commands retain their reason and request timeout retires the channel without replay", async t => {
  const f = await fixture(t, { timeoutMs: 60 });
  await f.ready();
  const failure = f.player.command({ commandId: "failed", name: "probe" });
  const rejected = assert.rejects(failure, error => error.code === "interrupted" && /Stopped/u.test(error.message));
  await f.request("command");
  f.reply("failed", { commandId: "failed", code: "interrupted", description: "Stopped" });
  await rejected;
  const refresh = await f.request("snapshot");
  f.reply("snapshot", { requestId: refresh.requestId, paused: false, labels: { caption: "Waiting" }, description: "Waiting" });
  const stall = f.player.command({ commandId: "stall", name: "stall" });
  const timeout = assert.rejects(stall, /not confirm.*not be replayed/u);
  await f.until(() => f.requests.some(value => value.commandId === "stall"));
  f.reply("accepted", { commandId: "stall" });
  await timeout;
  assert.equal(f.player.state.phase, "failed");
  assert.equal(f.iframe.srcdoc, "");
  assert.equal(f.listeners.size, 0);
});

test("64 input identities stay bounded without evicting retry fences; observer errors do not block disposal", async t => {
  const f = await fixture(t, { onState() { throw new Error("observer failed"); } });
  await f.ready();
  let from = 0;
  for (let index = 0; index < 64; index++) {
    const commandId = `command-${index}`;
    const result = f.player.command({ commandId, name: "probe" });
    await f.request("command", from);
    f.reply("accepted", { commandId });
    f.reply("completed", { commandId, description: "Waiting" });
    await result;
    const refresh = await f.request("snapshot", from);
    f.reply("snapshot", { requestId: refresh.requestId, description: "Waiting", paused: false, labels: { caption: "Waiting" } });
    await f.until(() => f.requests.some(value => value.requestId === refresh.requestId));
    from = f.requests.length;
  }
  await assert.rejects(f.player.command({ commandId: "command-65", name: "probe" }), /64 command-ID limit/u);
  await assert.rejects(f.player.command({ commandId: "command-0", name: "stall" }), /different input/u);
  f.player.dispose();
  f.player.dispose();
  assert.equal(f.player.state.phase, "disposed");
  assert.equal(f.listeners.size, 0);
  assert.equal(f.iframe.srcdoc, "");
});

test("invalid encoded resource or descriptor is rejected before an iframe is mutated", async t => {
  for (const mutate of [resource => { resource.svg.encoding = "utf8"; }, resource => { resource.controller.bytes = "invalid"; },
    resource => { resource.visual.states = Array(33).fill("idle"); }, resource => { resource.visual.commands[0].parameters[0].maxLength = 257; }]) {
    const resource = alternateVisualResource();
    mutate(resource);
    const iframe = { ownerDocument: { defaultView: { atob, btoa } }, srcdoc: "unchanged" };
    assert.throws(() => createTrainingVisualPlayer({ iframe, resource, attemptId: "attempt-one" }));
    assert.equal(iframe.srcdoc, "unchanged");
  }
  const f = await fixture(t, { timeoutMs: 20 });
  await assert.rejects(f.player.ready, /did not become ready/u);
  assert.equal(f.player.state.phase, "failed");
});
