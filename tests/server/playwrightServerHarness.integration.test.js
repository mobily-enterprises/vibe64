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

// The harness as JSKIT's browser-test launcher starts it for a worker: its own
// TMPDIR, PORT and HOST, no stdin, and its output piped.
async function startHarness(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vibe64-harness-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, [HARNESS], {
    cwd: APP_ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), TEST_PARALLEL_INDEX: "0", TMPDIR: tmp },
    stdio: ["ignore", "ignore", "ignore"]
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

test("Playwright stops the browser-test servers with SIGTERM, which each server's own shutdown handles", () => {
  assert.equal(playwrightConfig.webServer.gracefulShutdown?.signal, "SIGTERM");
});

test("a server started without stdin serves until SIGTERM, which removes its temporary folder", async (t) => {
  const harness = await startHarness(t);
  await harness.ready();
  assert.equal(harness.child.exitCode, null, "a server without stdin must not stop itself");
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

test("a repeated stop during shutdown still lets the server remove its folder", async (t) => {
  const harness = await startHarness(t);
  await harness.ready();
  // Playwright signals the whole process group, and the launcher passes the stop on.
  harness.child.kill("SIGTERM");
  harness.child.kill("SIGTERM");
  await harness.stopped();
  assert.equal(harness.child.signalCode, null, "a repeated SIGTERM must not end the process before its shutdown");
  assert.deepEqual(await serverFolders(harness.tmp), []);
});
