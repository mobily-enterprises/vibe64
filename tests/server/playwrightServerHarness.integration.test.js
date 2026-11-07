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
import { E2E_SERVERS_READY, SERVER_COUNT_ENV } from "../e2e/support/e2e-servers.mjs";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HARNESS = path.join(APP_ROOT, "tests/e2e/support/start-web-server.mjs");
const LAUNCHER = path.join(APP_ROOT, "tests/e2e/support/start-web-servers.mjs");

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

test("a repeated stop request during shutdown still lets the server remove its folder", async (t) => {
  const harness = await startHarness(t);
  await harness.ready();
  harness.child.kill("SIGTERM");
  harness.child.stdin.end();
  harness.child.kill("SIGTERM");
  await harness.stopped();
  assert.equal(harness.child.signalCode, null, "a repeated SIGTERM must not end the process before its shutdown");
  assert.deepEqual(await serverFolders(harness.tmp), []);
});

test("the server stops and removes its folder when Playwright exits without stopping it", async (t) => {
  const harness = await startHarness(t);
  await harness.ready();
  harness.child.stdin.end();
  await harness.stopped();
  assert.deepEqual(await serverFolders(harness.tmp), []);
});

// Two free ports in a row: the launcher serves workers on PLAYWRIGHT_PORT and the next one.
async function freePortPair() {
  for (;;) {
    const port = await freePort();
    const next = net.createServer();
    const listening = await new Promise((resolve) => {
      next.once("error", () => resolve(false));
      next.listen(port + 1, "127.0.0.1", () => resolve(true));
    });
    if (!listening) continue;
    next.close();
    await once(next, "close");
    return port;
  }
}

// The launcher as Playwright starts it for two workers.
async function startLauncher(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vibe64-launcher-test-"));
  const port = await freePortPair();
  const child = spawn(process.execPath, [LAUNCHER], {
    cwd: APP_ROOT,
    detached: true,
    env: { ...process.env, PLAYWRIGHT_PORT: String(port), [SERVER_COUNT_ENV]: "2", TMPDIR: tmp },
    stdio: ["pipe", "pipe", "ignore"]
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await rm(tmp, { force: true, recursive: true });
  });
  return {
    child,
    exited,
    ports: [port, port + 1],
    tmp,
    async ready() {
      await waitUntil(() => stdout.includes(E2E_SERVERS_READY), "the launcher's ready line");
    },
    async stopped() {
      const timeout = delay(DEFAULT_SHUTDOWN_TIMEOUT_MS + 5_000).then(() => {
        throw new Error("The launcher did not exit.");
      });
      await Promise.race([exited, timeout]);
    }
  };
}

test("Playwright waits for the launcher's ready line, not for one server's health", () => {
  assert.equal(playwrightConfig.webServer.url, undefined);
  assert.match(`${E2E_SERVERS_READY} on 4173, 4174`, playwrightConfig.webServer.wait.stdout);
});

test("the launcher starts one server per worker and SIGTERM stops them all and removes their folders", async (t) => {
  const launcher = await startLauncher(t);
  await launcher.ready();
  for (const port of launcher.ports) {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).ok, true);
  }
  assert.equal((await serverFolders(launcher.tmp)).length, 2);
  // As Playwright's gracefulShutdown: SIGTERM to the launcher and its servers together.
  process.kill(-launcher.child.pid, "SIGTERM");
  await launcher.stopped();
  assert.deepEqual(await serverFolders(launcher.tmp), []);
});

test("the launcher stops its servers when Playwright exits without stopping it", async (t) => {
  const launcher = await startLauncher(t);
  await launcher.ready();
  launcher.child.stdin.end();
  await launcher.stopped();
  assert.deepEqual(await serverFolders(launcher.tmp), []);
});

test("the launcher refuses a port that already answers, starting no server", async (t) => {
  const port = await freePortPair();
  const occupant = net.createServer((socket) => socket.end());
  occupant.listen(port + 1, "127.0.0.1");
  await once(occupant, "listening");
  t.after(() => occupant.close());
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vibe64-launcher-test-"));
  t.after(() => rm(tmp, { force: true, recursive: true }));
  const child = spawn(process.execPath, [LAUNCHER], {
    cwd: APP_ROOT,
    env: { ...process.env, PLAYWRIGHT_PORT: String(port), [SERVER_COUNT_ENV]: "2", TMPDIR: tmp },
    stdio: ["pipe", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`Port ${port + 1} is already in use`, "u"));
  assert.deepEqual(await serverFolders(tmp), []);
});
