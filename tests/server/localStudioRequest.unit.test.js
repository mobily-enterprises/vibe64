import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALHOST_CHECK_BYPASS_ENV,
  LOCALHOST_CHECK_BYPASS_FLAG,
  isLocalhostCheckBypassEnabled,
  stripLocalhostCheckBypassArgs
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  isLocalStudioRequest,
  isLoopbackAddress,
  isTrustedStudioWebSocketRequest,
  originMatchesRequest
} from "@local/vibe64-core/server/localStudioRequest";

test("localhost check bypass is enabled by the explicit CLI flag", () => {
  assert.equal(isLocalhostCheckBypassEnabled({
    argv: ["node", "server.js", LOCALHOST_CHECK_BYPASS_FLAG],
    env: {}
  }), true);
});

test("websocket origins match exact scheme, host and port through direct TLS and hosted proxy requests", () => {
  const request = {
    protocol: "https", headers: { host: "workspace.example:8443", origin: "https://workspace.example:8443" },
    ip: "10.0.0.8", vibe64User: { username: "owner" }
  };
  assert.equal(isTrustedStudioWebSocketRequest(request), true);
  assert.equal(originMatchesRequest({ ...request, protocol: "http",
    headers: { ...request.headers, "x-forwarded-proto": "https" } }), true);
  assert.equal(originMatchesRequest({ ...request, protocol: undefined, socket: { encrypted: true } }), true);
  for (const origin of [undefined, "", "null", "https://other.example:8443", "https://workspace.example",
    "http://workspace.example:8443", "https://workspace.example:8443/path", "https://owner@workspace.example:8443",
    "https://workspace.example:8443#fragment", "https://workspace.example:8443,https://other.example",
    ["https://workspace.example:8443"], "file://workspace.example:8443"]) {
    assert.equal(isTrustedStudioWebSocketRequest({ ...request, headers: { ...request.headers, origin } }), false, String(origin));
  }
  assert.equal(originMatchesRequest({ ...request, headers: { ...request.headers, host: "workspace.example:8443/path" } }), false);
  assert.equal(originMatchesRequest({ ...request, headers: { ...request.headers, host: ["workspace.example:8443"] } }), false);
});

test("loopback command-line websocket clients may omit Origin but local foreign pages are refused", () => {
  const request = { ip: "127.0.0.1", headers: { host: "localhost:3000" } };
  assert.equal(isTrustedStudioWebSocketRequest(request), true);
  assert.equal(isTrustedStudioWebSocketRequest({ ...request,
    headers: { ...request.headers, origin: "http://localhost:3000" } }), true);
  assert.equal(isTrustedStudioWebSocketRequest({ ...request,
    headers: { ...request.headers, origin: "http://localhost:4000" } }), false);
  assert.equal(isTrustedStudioWebSocketRequest({ ...request,
    headers: { ...request.headers, origin: "http://127.0.0.1:3000" } }), false);
});

test("loopback guard does not treat a DNS hostname with a 127 prefix as an IP address", () => {
  for (const address of ["127.0.0.1", "127.23.45.67", "::1", "::ffff:127.0.0.1", "[::1]:3000"]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const host of ["127.attacker.example", "127.0.0.1.attacker.example", "127.1", "127.0.0.999"]) {
    assert.equal(isLoopbackAddress(host), false, host);
    assert.equal(isTrustedStudioWebSocketRequest({
      ip: "127.0.0.1", headers: { host, origin: `http://${host}` }
    }), false, host);
  }
});

test("localhost check bypass is enabled by the explicit environment variable", () => {
  assert.equal(isLocalhostCheckBypassEnabled({
    argv: [],
    env: {
      [LOCALHOST_CHECK_BYPASS_ENV]: "true"
    }
  }), true);
});

test("localhost check bypass flag is stripped before launching Vite", () => {
  assert.deepEqual(stripLocalhostCheckBypassArgs([
    "--host",
    "0.0.0.0",
    LOCALHOST_CHECK_BYPASS_FLAG,
    "--port",
    "5174"
  ]), [
    "--host",
    "0.0.0.0",
    "--port",
    "5174"
  ]);
});

test("local Studio request guard defaults to blocking non-loopback requests", () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
  try {
    assert.equal(isLocalStudioRequest({
      headers: {
        host: "example.com",
        origin: "https://example.com"
      },
      ip: "10.0.0.8"
    }), false);
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});

test("local Studio request guard accepts authenticated Vibe64 requests from non-loopback hosts", () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
  try {
    assert.equal(isLocalStudioRequest({
      headers: {
        host: "example.com",
        origin: "https://example.com"
      },
      ip: "10.0.0.8",
      vibe64User: {
        email: "owner@example.com"
      }
    }), true);
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});

test("local Studio request guard accepts authenticated OS-user Vibe64 requests from non-loopback hosts", () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
  try {
    assert.equal(isLocalStudioRequest({
      headers: {
        host: "mercmobily.users.vibe64.dev",
        origin: "https://mercmobily.users.vibe64.dev"
      },
      ip: "10.0.0.8",
      vibe64User: {
        username: "mercmobily"
      }
    }), true);
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});

test("local Studio request guard accepts non-loopback requests when bypass is explicit", () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  process.env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
  try {
    assert.equal(isLocalStudioRequest({
      headers: {
        host: "example.com",
        origin: "https://example.com"
      },
      ip: "10.0.0.8"
    }), true);
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});
