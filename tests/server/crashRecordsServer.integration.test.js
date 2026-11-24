import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readVibe64CrashRecords } from "@local/vibe64-core/server/crashRecords";

// A real editor server's crashes, end to end (server.js's crash watch, crashRecords.js, the Studio Health crash
// routes): one that throws an uncaught socket error records it and still exits 1, the next start shows it, one
// killed with SIGKILL is recorded by the start after it, acknowledging clears the banner's count, and a clean stop
// records nothing.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVER = path.join(APP_ROOT, "tests/e2e/support/start-crash-test-server.mjs");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitUntil(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function crashTestServers(t, root, port) {
  const origin = `http://127.0.0.1:${port}`;
  const children = new Set();
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
  });
  return {
    origin,
    async start() {
      const child = spawn(process.execPath, [SERVER], {
        cwd: APP_ROOT,
        env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), VIBE64_CRASH_TEST_ROOT: root },
        stdio: ["ignore", "ignore", "pipe"]
      });
      children.add(child);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
      const exited = once(child, "exit");
      await waitUntil(async () => {
        if (child.exitCode !== null) throw new Error(`The crash test server exited at its start:\n${stderr}`);
        return fetch(`${origin}/api/health`).then((response) => response.ok, () => false);
      }, "the crash test server's health");
      return { child, exited, stderr: () => stderr };
    },
    get: (route) => fetch(`${origin}/api/studio/health/${route}`).then(async (response) => ({ status: response.status, body: await response.json() })),
    post: (route, body) => fetch(`${origin}/api/studio/health/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(async (response) => ({ status: response.status, body: await response.json() }))
  };
}

test("a real server's uncaught error and SIGKILL are both recorded, shown, and acknowledged; a clean stop records none", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-crash-server-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const systemRoot = path.join(root, "state");
  const running = () => readdir(path.join(systemRoot, "crashes", "running"));
  const servers = crashTestServers(t, root, await freePort());

  const first = await servers.start();
  assert.equal((await running()).length, 1, "a running server holds its marker");
  assert.deepEqual(await servers.get("crashes/summary"), {
    status: 200,
    body: { ok: true, canAcknowledge: true, unacknowledged: 0, latest: null }
  });
  await writeFile(path.join(root, "crash-now"), "");
  const [code] = await first.exited;
  assert.equal(code, 1, "the crash still ends the process with Node's own code, for its supervisor to restart it");
  assert.match(first.stderr(), /read ECONNRESET/u, "Node still prints the error");
  const [fatal] = (await readVibe64CrashRecords({ systemRoot })).records;
  assert.equal(fatal.kind, "fatal-error");
  assert.equal(fatal.origin, "uncaughtException");
  assert.deepEqual([fatal.error.message, fatal.error.code], ["read ECONNRESET", "ECONNRESET"]);
  assert.equal(fatal.pid, first.child.pid);
  assert.match(fatal.version, /^vibe64@\d+\.\d+\.\d+/u);
  assert.deepEqual(await running(), [], "a recorded crash leaves no marker");

  const second = await servers.start();
  const summary = await servers.get("crashes/summary");
  assert.equal(summary.status, 200);
  assert.equal(summary.body.unacknowledged, 1);
  assert.equal(summary.body.latest.id, fatal.id);
  assert.equal(summary.body.latest.error.message, "read ECONNRESET");
  assert.equal(summary.body.latest.activeTurns, 0, "the start after the crash counted the turns it left working");
  second.child.kill("SIGKILL");
  await second.exited;

  const third = await servers.start();
  const list = await servers.get("crashes");
  assert.equal(list.status, 200);
  assert.equal(list.body.limit, 100);
  assert.equal(list.body.unacknowledged, 2);
  const [untraced, again] = list.body.records;
  assert.equal(again.id, fatal.id);
  assert.equal(untraced.kind, "stopped-without-trace");
  assert.equal(untraced.pid, second.child.pid);
  assert.equal(untraced.error, null);
  assert.equal(typeof untraced.lastHeartbeatAt, "string");
  assert.equal(untraced.activeTurns, 0);

  assert.equal((await servers.post("crashes/acknowledge", { through: "../../etc" })).status, 400);
  assert.deepEqual(await servers.post("crashes/acknowledge", { through: untraced.id }), {
    status: 200,
    body: { ok: true, acknowledged: 2 }
  });
  assert.deepEqual((await servers.get("crashes/summary")).body, { ok: true, canAcknowledge: true, unacknowledged: 0, latest: null });
  const acknowledged = (await readVibe64CrashRecords({ systemRoot })).records.map((record) => record.acknowledged);
  assert.deepEqual(acknowledged.map((entry) => entry.by.username), [os.userInfo().username, os.userInfo().username]);
  assert.ok(acknowledged.every((entry) => Number.isFinite(Date.parse(entry.at))));

  third.child.kill("SIGTERM");
  const [stopCode] = await third.exited;
  assert.equal(stopCode, 0);
  assert.deepEqual(await running(), [], "a clean stop removes its marker");
  assert.equal((await readVibe64CrashRecords({ systemRoot })).records.length, 2, "and records nothing");
});
