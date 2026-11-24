import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { startServer } from "../../../server.js";
import { playwrightServerStartOptions } from "./start-web-server.mjs";

// A Vibe64 server for the crash tests (tests/server/crashRecordsServer.integration.test.js and
// tests/e2e/crash-banner.spec.ts). Its state stays in VIBE64_CRASH_TEST_ROOT across its restarts, which the test
// removes. Once a file named crash-now appears there, the server crashes as workspace pass's did on 24 Nov 2026: a
// socket emits an 'error' event nobody listens to (read ECONNRESET), thrown from a timer, which nothing catches.
// Started with PORT and HOST, as the browser-test launcher starts start-web-server.mjs.

const STOP_SIGNALS = ["SIGINT", "SIGTERM"];
const root = String(process.env.VIBE64_CRASH_TEST_ROOT || "").trim();
if (!path.isAbsolute(root)) {
  console.error("start-crash-test-server.mjs needs VIBE64_CRASH_TEST_ROOT, an absolute folder the test owns.");
  process.exit(2);
}

const exitOnStopSignal = (signal) => process.exit(128 + os.constants.signals[signal]);
for (const signal of STOP_SIGNALS) process.once(signal, exitOnStopSignal);
try {
  await startServer({
    ...playwrightServerStartOptions(),
    managedSourceRoot: path.join(root, "projects"),
    systemRoot: path.join(root, "state"),
    localAccessKey: false
  });
  for (const signal of STOP_SIGNALS) process.on(signal, () => {});
} finally {
  for (const signal of STOP_SIGNALS) process.off(signal, exitOnStopSignal);
}

const trigger = path.join(root, "crash-now");
setInterval(() => {
  if (!existsSync(trigger)) return;
  rmSync(trigger, { force: true });
  const reset = Object.assign(new Error("read ECONNRESET"), { errno: -104, code: "ECONNRESET", syscall: "read" });
  new net.Socket().emit("error", reset);
}, 50).unref();
