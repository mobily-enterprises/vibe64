import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALHOST_CHECK_BYPASS_ENV,
  LOCALHOST_CHECK_BYPASS_FLAG,
  isLocalhostCheckBypassEnabled,
  stripLocalhostCheckBypassArgs
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  isLocalStudioRequest
} from "@local/vibe64-core/server/localStudioRequest";

test("localhost check bypass is enabled by the explicit CLI flag", () => {
  assert.equal(isLocalhostCheckBypassEnabled({
    argv: ["node", "server.js", LOCALHOST_CHECK_BYPASS_FLAG],
    env: {}
  }), true);
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
