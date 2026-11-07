import assert from "node:assert/strict";
import test from "node:test";
import {
  __testables,
  LOCALHOST_CHECK_BYPASS_ENV,
  LOCALHOST_CHECK_BYPASS_REFUSED,
  assertLocalhostCheckBypassAllowed,
  isLocalhostCheckBypassEnabled,
  launchHostArg,
  stripLocalhostCheckBypassArgs
} from "@local/vibe64-core/server/localhostCheckBypass";
import { VIBE64_RUNTIME_NAMESPACE_ENV } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/hostProfile.js";
import { createServer, startServer } from "../../server.js";
import {
  isLocalStudioRequest,
  isLoopbackAddress,
  isTrustedStudioWebSocketRequest,
  originMatchesRequest
} from "@local/vibe64-core/server/localStudioRequest";

const { LOCALHOST_CHECK_BYPASS_FLAG } = __testables;
const CHECKED = Object.freeze({ localhostCheckBypassed: false });

test("localhost check bypass is enabled by the explicit CLI flag", () => {
  assert.equal(isLocalhostCheckBypassEnabled({
    argv: ["node", "server.js", LOCALHOST_CHECK_BYPASS_FLAG],
    env: {}
  }), true);
});

test("websocket origins match exact scheme, host and port through direct TLS and proxied requests", () => {
  const request = {
    protocol: "https", headers: { host: "workspace.example:8443", origin: "https://workspace.example:8443" },
    ip: "10.0.0.8", vibe64User: { username: "owner" }
  };
  assert.equal(isTrustedStudioWebSocketRequest(request, CHECKED), true);
  assert.equal(originMatchesRequest({ ...request, protocol: "http",
    headers: { ...request.headers, "x-forwarded-proto": "https" } }), true);
  assert.equal(originMatchesRequest({ ...request, protocol: undefined, socket: { encrypted: true } }), true);
  for (const origin of [undefined, "", "null", "https://other.example:8443", "https://workspace.example",
    "http://workspace.example:8443", "https://workspace.example:8443/path", "https://owner@workspace.example:8443",
    "https://workspace.example:8443#fragment", "https://workspace.example:8443,https://other.example",
    ["https://workspace.example:8443"], "file://workspace.example:8443"]) {
    assert.equal(isTrustedStudioWebSocketRequest({ ...request, headers: { ...request.headers, origin } }, CHECKED), false, String(origin));
  }
  assert.equal(originMatchesRequest({ ...request, headers: { ...request.headers, host: "workspace.example:8443/path" } }), false);
  assert.equal(originMatchesRequest({ ...request, headers: { ...request.headers, host: ["workspace.example:8443"] } }), false);
});

test("loopback command-line websocket clients may omit Origin but local foreign pages are refused", () => {
  const request = { ip: "127.0.0.1", headers: { host: "localhost:3000" } };
  assert.equal(isTrustedStudioWebSocketRequest(request, CHECKED), true);
  assert.equal(isTrustedStudioWebSocketRequest({ ...request,
    headers: { ...request.headers, origin: "http://localhost:3000" } }, CHECKED), true);
  assert.equal(isTrustedStudioWebSocketRequest({ ...request,
    headers: { ...request.headers, origin: "http://localhost:4000" } }, CHECKED), false);
  assert.equal(isTrustedStudioWebSocketRequest({ ...request,
    headers: { ...request.headers, origin: "http://127.0.0.1:3000" } }, CHECKED), false);
});

test("loopback guard does not treat a DNS hostname with a 127 prefix as an IP address", () => {
  for (const address of ["127.0.0.1", "127.23.45.67", "::1", "::ffff:127.0.0.1", "[::1]:3000"]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const host of ["127.attacker.example", "127.0.0.1.attacker.example", "127.1", "127.0.0.999"]) {
    assert.equal(isLoopbackAddress(host), false, host);
    assert.equal(isTrustedStudioWebSocketRequest({
      ip: "127.0.0.1", headers: { host, origin: `http://${host}` }
    }, CHECKED), false, host);
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

test("localhost check bypass refuses a host that shares or provisions its machine", (t) => {
  t.after(() => configureVibe64Host(null));
  const env = { [LOCALHOST_CHECK_BYPASS_ENV]: "1" };
  for (const profile of [{ sharedGroupAccess: true }, { execHelperPath: "/usr/local/libexec/vibe64-exec" }]) {
    configureVibe64Host(profile);
    assert.throws(() => isLocalhostCheckBypassEnabled({ argv: [], env }), { code: LOCALHOST_CHECK_BYPASS_REFUSED });
    assert.equal(isLocalhostCheckBypassEnabled({ argv: [], env: {} }), false, "without the bypass the host starts");
  }
  configureVibe64Host(null);
  assert.equal(isLocalhostCheckBypassEnabled({ argv: [], env }), true, "a developer's own computer keeps it");
});

test("localhost check bypass refuses a listener beyond loopback or a server that is not a local editor", () => {
  for (const host of ["", "127.0.0.1", "localhost", "::1", "[::1]"]) {
    assert.doesNotThrow(() => assertLocalhostCheckBypassAllowed({ host }), host);
  }
  for (const host of ["0.0.0.0", "::", "192.168.1.20", "studio.example.test"]) {
    assert.throws(() => assertLocalhostCheckBypassAllowed({ host }), { code: LOCALHOST_CHECK_BYPASS_REFUSED }, host);
  }
  assert.throws(() => assertLocalhostCheckBypassAllowed({ local: false }), { code: LOCALHOST_CHECK_BYPASS_REFUSED });
  assert.equal(launchHostArg(["--port", "5174"]), "");
  assert.equal(launchHostArg(["--host", "0.0.0.0"]), "0.0.0.0");
  assert.equal(launchHostArg(["--host=localhost"]), "localhost");
  assert.equal(launchHostArg(["--host"]), "0.0.0.0", "a bare --host listens on every interface");
  assert.equal(launchHostArg(["--host", "--port", "5174"]), "0.0.0.0");
});

test("a server with the localhost check bypassed refuses to start on a public host or as a shared server", async () => {
  const keys = ["HOST", "PORT", LOCALHOST_CHECK_BYPASS_ENV, VIBE64_RUNTIME_NAMESPACE_ENV];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
  process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-bypass";
  delete process.env.HOST;
  delete process.env.PORT;
  try {
    await assert.rejects(startServer({ host: "0.0.0.0", port: 0, strictPort: false }), { code: LOCALHOST_CHECK_BYPASS_REFUSED });
    await assert.rejects(createServer({
      runtimeProfile: Object.freeze({ local: false, mode: "composed", projectCatalogEnabled: true, singleTargetRoot: "" })
    }), { code: LOCALHOST_CHECK_BYPASS_REFUSED });
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test("local Studio request guard blocks non-loopback requests unless the server bypassed the check", () => {
  assert.equal(isLocalStudioRequest({
    headers: {
      host: "example.com",
      origin: "https://example.com"
    },
    ip: "10.0.0.8"
  }, { localhostCheckBypassed: false }), false);
});

test("local Studio request guard accepts authenticated Vibe64 requests from non-loopback hosts", () => {
  assert.equal(isLocalStudioRequest({
    headers: {
      host: "example.com",
      origin: "https://example.com"
    },
    ip: "10.0.0.8",
    vibe64User: {
      email: "owner@example.com"
    }
  }, { localhostCheckBypassed: false }), true);
});

test("local Studio request guard accepts authenticated OS-user Vibe64 requests from non-loopback hosts", () => {
  assert.equal(isLocalStudioRequest({
    headers: {
      host: "person.users.example.test",
      origin: "https://person.users.example.test"
    },
    ip: "10.0.0.8",
    vibe64User: {
      username: "person"
    }
  }, { localhostCheckBypassed: false }), true);
});

test("local Studio request guard accepts non-loopback requests when the server bypassed the check", () => {
  assert.equal(isLocalStudioRequest({
    headers: {
      host: "example.com",
      origin: "https://example.com"
    },
    ip: "10.0.0.8"
  }, { localhostCheckBypassed: true }), true);
});
