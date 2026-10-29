import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import playwrightConfig from "../../playwright.config.mjs";
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from "../../server.js";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HARNESS = path.join(APP_ROOT, "tests/e2e/support/start-web-server.mjs");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function serverFolders(tmp) {
  return (await readdir(tmp)).filter(name => name.startsWith("vibe64-e2e-"));
}

async function waitUntil(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

// The harness as Playwright starts it: its own TMPDIR, a port and a stdin pipe.
async function startHarness(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vibe64-harness-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, [HARNESS], {
    cwd: APP_ROOT,
    env: { ...process.env, PORT: String(port), TMPDIR: tmp },
    stdio: ["pipe", "ignore", "ignore"]
  });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await rm(tmp, { force: true, recursive: true });
  });
  await waitUntil(async () => (await serverFolders(tmp)).length === 1, "the server's temporary folder");
  return {
    child,
    tmp,
    async ready() {
      await waitUntil(() => fetch(`http://127.0.0.1:${port}/api/health`).then(response => response.ok, () => false), "the server's health");
    },
    async stopped() {
      const timeout = delay(DEFAULT_SHUTDOWN_TIMEOUT_MS + 5_000).then(() => {
        throw new Error("The harness did not exit.");
      });
      await Promise.race([exited, timeout]);
    }
  };
}

test("Playwright stops its server with SIGTERM and waits for the server's own shutdown", () => {
  assert.equal(playwrightConfig.webServer.gracefulShutdown?.signal, "SIGTERM");
  assert.ok(playwrightConfig.webServer.gracefulShutdown.timeout > DEFAULT_SHUTDOWN_TIMEOUT_MS);
});

test("SIGTERM after startup removes the server's temporary folder", async (t) => {
  const harness = await startHarness(t);
  await harness.ready();
  harness.child.kill("SIGTERM");
  await harness.stopped();
  assert.deepEqual(await serverFolders(harness.tmp), []);
});

test("SIGTERM during startup removes the server's temporary folder", async (t) => {
  const harness = await startHarness(t);
  harness.child.kill("SIGTERM");
  await harness.stopped();
  assert.deepEqual(await serverFolders(harness.tmp), []);
});

test("the server stops and removes its folder when Playwright exits without stopping it", async (t) => {
  const harness = await startHarness(t);
  await harness.ready();
  harness.child.stdin.end();
  await harness.stopped();
  assert.deepEqual(await serverFolders(harness.tmp), []);
});
