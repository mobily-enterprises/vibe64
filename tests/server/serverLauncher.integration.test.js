import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const PUBLIC_ROOT = path.resolve(import.meta.dirname, "../..");

// What `npx vibe64`, `npm start` and `npm run server` run, started as a person starts it, with no APP_ENV or NODE_ENV
// of its own. The pinned JSKIT refuses a server without APP_ENV and loads every module Vibe64 imports from it, so this
// is the start a JSKIT update has to keep working.
test("Vibe64's own start command starts it as production under the pinned JSKIT", { timeout: 150_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "v64-launcher-"));
  // A Unix socket path holds at most 107 bytes and TMPDIR can be a long path, so the runtime folder goes under /tmp.
  const runtimeDir = await mkdtemp(path.join(process.platform === "win32" ? tmpdir() : "/tmp", "v64-xdg-"));
  const project = path.join(root, "project");
  await mkdir(project);
  // PORT=0: the server binds a free port itself and prints the address it serves, so no port is chosen here first.
  const namespace = `launcher-${process.pid}-${Date.now()}`;
  const inherited = { ...process.env };
  delete inherited.APP_ENV;
  delete inherited.NODE_ENV;
  const child = spawn(process.execPath, ["bin/server.js", "--no-open", project], {
    cwd: PUBLIC_ROOT,
    env: {
      ...inherited, PORT: "0", HOST: "127.0.0.1", VIBE64_LOG_LEVEL: "info",
      VIBE64_SYSTEM_ROOT: path.join(root, "state"), VIBE64_RUNTIME_NAMESPACE: namespace, XDG_RUNTIME_DIR: runtimeDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (data) => { logs += data; });
  child.stderr.on("data", (data) => { logs += data; });
  const exited = once(child, "exit");
  try {
    const deadline = Date.now() + 90_000;
    while (!logs.includes("Vibe64 is running at")) {
      if (child.exitCode !== null || child.signalCode !== null) assert.fail(`Vibe64 stopped before it started:\n${logs}`);
      if (Date.now() > deadline) assert.fail(`Vibe64 did not start within 90 s:\n${logs}`);
      await delay(100);
    }
    assert.match(logs, /APP_ENV is production: email, SMS, push notifications, webhooks, connector writes and payments act for real\./u, logs);
    const address = new URL(logs.match(/Vibe64 is running at (\S+)/u)[1]);
    assert.notEqual(address.port, "0", logs);
    const health = await fetch(new URL("/api/health", address));
    assert.equal(health.status, 200);
    assert.ok(health.headers.get("strict-transport-security"), "a production server sends HSTS");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    // The server's own shutdown ends it; one that overruns is killed rather than left running.
    const overrun = setTimeout(() => child.kill("SIGKILL"), 15_000);
    await exited;
    clearTimeout(overrun);
    await rm(root, { recursive: true, force: true });
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
