import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

import {
  PREVIEW_APP_REQUEST_MESSAGE_TYPE,
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE
} from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import { injectLaunchPreviewBridge } from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";

// Runs the real injected bridge against a fake frame: only the reduced
// app-request projection may reach the parent, never bodies, queries or text.
const EDITOR_ORIGIN = "https://acme.users.example";

function bridgeFrame({ fetchResult, parentOrigins = [EDITOR_ORIGIN] } = {}) {
  const messages = [];
  const targetOrigins = [];
  const listeners = new Map();
  let clock = 10000;
  const window = {
    location: new URL("https://preview.example/notes"),
    history: {},
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    parent: { postMessage: (value, targetOrigin) => { messages.push(value); targetOrigins.push(targetOrigin); } },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fetch: async (input) => {
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult ?? { status: 400, statusText: "Bad Request", url: String(input?.url || input),
        headers: { get: () => "application/json" }, clone() { return { headers: this.headers, body: null, text: async () => "{\"error\":\"secret body\"}" }; } };
    }
  };
  const html = injectLaunchPreviewBridge("<head></head>", { parentOrigins, targetOrigin: "http://127.0.0.1:4000" });
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/u)[1];
  vm.runInNewContext(script, { window, document: { readyState: "complete", title: "Notes" }, URL, Headers,
    ErrorEvent: class ErrorEvent {}, queueMicrotask, performance: { now: () => clock } });
  return {
    messages,
    targetOrigins,
    post(data, origin) {
      for (const listener of listeners.get("message") || []) listener({ data, origin, source: window.parent });
    },
    appRequests: () => messages.filter(message => message.type === PREVIEW_APP_REQUEST_MESSAGE_TYPE),
    gesture(type = "submit", isTrusted = true) {
      for (const listener of listeners.get(type) || []) listener({ type, isTrusted });
    },
    advance(ms) { clock += ms; },
    fetch: (...args) => window.fetch(...args)
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("a failed non-GET after a trusted submit reports only method, path template, status and failure", async () => {
  const frame = bridgeFrame();
  frame.gesture("submit");
  await frame.fetch("/api/notes/42/tags/3f2a1c9e-1b2c-4d3e-8f90-123456789abc?draft=my-typed-title#x", {
    method: "post", headers: { authorization: "Bearer secret-token" }, body: JSON.stringify({ title: "my typed title" })
  });
  await settle();
  const reported = JSON.parse(JSON.stringify(frame.appRequests()));
  assert.equal(reported.length, 1);
  assert.deepEqual(reported[0], { type: PREVIEW_APP_REQUEST_MESSAGE_TYPE, version: PREVIEW_BRIDGE_VERSION,
    method: "POST", pathTemplate: "/api/notes/:id/tags/:id", status: 400, failure: "http-4xx" });
  assert.doesNotMatch(JSON.stringify(reported), /typed|secret|draft|Bearer/u);
});

test("GET, untrusted or stale gestures, successes and foreign origins are never reported", async () => {
  const frame = bridgeFrame();
  frame.gesture("click");
  await frame.fetch("/api/notes", { method: "GET" });
  await frame.fetch("https://other.example/api/notes", { method: "POST" });
  frame.gesture("click", false);
  frame.advance(5000);
  await frame.fetch("/api/notes", { method: "POST" });
  await settle();
  assert.equal(frame.appRequests().length, 0, "no trusted learner gesture within 3 s");
  const ok = bridgeFrame({ fetchResult: { status: 201, statusText: "Created", url: "https://preview.example/api/notes",
    headers: { get: () => "" }, clone() { return { headers: this.headers, body: null, text: async () => "" }; } } });
  ok.gesture("click");
  await ok.fetch("/api/notes", { method: "POST" });
  await settle();
  assert.equal(ok.appRequests().length, 0, "slice 1 reports failures only");
});

test("a server error and a network failure after a trusted click map to their failure codes", async () => {
  const server = bridgeFrame({ fetchResult: { status: 503, statusText: "Unavailable", url: "https://preview.example/api/notes",
    headers: { get: () => "" }, clone() { return { headers: this.headers, body: null, text: async () => "" }; } } });
  server.gesture("click");
  await server.fetch("/api/notes", { method: "DELETE" });
  const network = bridgeFrame({ fetchResult: new TypeError("Failed to fetch") });
  network.gesture("click");
  await assert.rejects(network.fetch("/api/notes", { method: "PUT" }), /Failed to fetch/u);
  await settle();
  assert.deepEqual(server.appRequests().map(({ method, status, failure }) => ({ method, status, failure })),
    [{ method: "DELETE", status: 503, failure: "http-5xx" }]);
  assert.deepEqual(network.appRequests().map(({ method, status, failure }) => ({ method, status, failure })),
    [{ method: "PUT", status: 0, failure: "network" }]);
});

test("the bridge answers only its editor origins and never addresses a wildcard", async () => {
  const frame = bridgeFrame();
  frame.post({ type: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE, requestId: "foreign" }, "https://evil.example");
  frame.post({ type: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE, requestId: "editor" }, EDITOR_ORIGIN);
  await settle();
  const responses = frame.messages.filter(message => message.type === PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE);
  assert.deepEqual(responses.map(message => message.requestId), ["editor"]);
  assert.ok(frame.messages.some(message => message.type === PREVIEW_BRIDGE_READY_MESSAGE_TYPE));
  assert.ok(frame.targetOrigins.length > 0);
  assert.ok(frame.targetOrigins.every(origin => origin === EDITOR_ORIGIN), "no reply uses targetOrigin *");
});

test("a bridge with no known editor stays silent and ignores every parent", async () => {
  const frame = bridgeFrame({ parentOrigins: [] });
  frame.post({ type: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE, requestId: "any" }, EDITOR_ORIGIN);
  await settle();
  assert.deepEqual(frame.messages, []);
});
