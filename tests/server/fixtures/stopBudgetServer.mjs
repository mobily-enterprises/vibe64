// A real Vibe64 server for serverStopBudget.integration.test.js, busy the way a workspace's editor is when a release
// stops it: a request still waiting on a long command it started, a long command a background job started, and a poller
// that starts a short command every 50 ms, as the page's and the editor's own work did on a hosted workspace's
// release-10 stop (24 Nov 2026), when the editor started twelve helper calls after SIGTERM and took 3.33 s to stop.
// Every command goes through the editor's one command gateway. It also runs a terminal whose process ignores SIGTERM and
// SIGHUP, as one that takes its time over its own shutdown does. What happens is appended to events.log in the folder
// the test gives (VIBE64_STOP_TEST_ROOT): "<epoch ms> <event> [<detail>]", the stop's own timeline among them, in the
// order the server lives it: SIGTERM's arrival ("sigterm"), the stop's first moment ("stop-began", with whether the
// listener still listens and whether the command gate is shut), each signal the server sends a process group
// ("signal <group> <signal>") and its exit ("exit <code>"). With VIBE64_STOP_TEST_STALL_CLOSE=1 its Fastify close waits
// on work that never ends (a timer keeps the process alive, as such work does), so its stop overruns the deadline;
// VIBE64_STOP_TEST_DEADLINE_MS sets that deadline.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { serverStopBegun } from "@local/vibe64-execution/server/serverStop";
import { startTerminalSession } from "@local/vibe64-execution/server/terminalSessions";
import { startServer } from "../../../server.js";
import { playwrightServerStartOptions } from "../../e2e/support/start-web-server.mjs";

const root = String(process.env.VIBE64_STOP_TEST_ROOT || "").trim();
if (!path.isAbsolute(root)) {
  console.error("stopBudgetServer.mjs needs VIBE64_STOP_TEST_ROOT, an absolute folder the test owns.");
  process.exit(2);
}
const project = path.join(root, "project");
mkdirSync(project, { recursive: true });
const events = path.join(root, "events.log");
const mark = (event, detail = "") => appendFileSync(events, `${Date.now()} ${event}${detail ? ` ${detail}` : ""}\n`);

// A command that says it runs (its pid, in the log) and then runs for a minute.
const LONG_COMMAND = "require('node:fs').appendFileSync(process.argv[1], `${Date.now()} child-running ${process.argv[2]} ${process.pid}\\n`);" +
  " setInterval(() => {}, 1000);";
function command(args, timeout) {
  return runVibe64Command({ command: process.execPath, args, cwd: project, mode: "capture", purpose: "codex", timeout });
}
const longCommand = (name) => command(["-e", LONG_COMMAND, events, name], 60_000);
const STUBBORN_TERMINAL = "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});" +
  " require('node:fs').appendFileSync(process.argv[1], `${Date.now()} terminal-running ${process.pid}\\n`);" +
  " setInterval(() => {}, 1000);";

// Each signal to a process group, as it is sent (a probe, signal 0, is not one).
const sendSignal = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid < 0 && typeof signal === "string") mark("signal", `${-pid} ${signal}`);
  return sendSignal(pid, signal);
};
process.on("exit", (code) => mark("exit", String(code)));
let fastify = null;

const STOP_SIGNALS = ["SIGINT", "SIGTERM"];
const exitOnStopSignal = (signal) => process.exit(128 + (signal === "SIGINT" ? 2 : 15));
for (const signal of STOP_SIGNALS) process.once(signal, exitOnStopSignal);
try {
  await startServer({
    ...playwrightServerStartOptions({ cwd: project }),
    managedSourceRoot: path.join(root, "projects"),
    systemRoot: path.join(root, "state"),
    localAccessKey: false,
    ...(process.env.VIBE64_STOP_TEST_DEADLINE_MS ? { shutdownTimeoutMs: Number(process.env.VIBE64_STOP_TEST_DEADLINE_MS) } : {}),
    async createInstalledRuntime(options) {
      const runtime = await createInstalledRuntime(options);
      fastify = options.fastify;
      if (process.env.VIBE64_STOP_TEST_STALL_CLOSE === "1") {
        options.fastify.addHook("onClose", () => new Promise(() => { setInterval(() => {}, 1000); }));
      }
      // The request that waits on its long command, as a page's request waits on a helper call.
      options.fastify.get("/api/stop-test/slow", async () => {
        mark("slow-request-started");
        const result = await longCommand("slow-request");
        mark("slow-request-ended", result.code || (result.ok ? "ok" : "failed"));
        return { ok: result.ok === true };
      });
      return runtime;
    }
  });
} finally {
  for (const signal of STOP_SIGNALS) process.off(signal, exitOnStopSignal);
}
// The stop's second signal (a supervisor's, say) must not end the process before its own stop does.
for (const signal of STOP_SIGNALS) process.on(signal, () => {});
// SIGTERM's arrival, before the server's own handler runs, and the stop's first moment, as soon as that handler's
// synchronous part has run and before anything it started has.
process.prependListener("SIGTERM", () => mark("sigterm"));
process.on("SIGTERM", () => mark("stop-began", `listening=${fastify.server.listening} gate=${serverStopBegun()}`));

// The terminal: it says it runs (its pid, in the log) once it ignores both signals.
startTerminalSession({
  args: ["-e", STUBBORN_TERMINAL, events],
  command: process.execPath,
  commandPreview: "stop test terminal",
  cwd: project,
  namespace: "stop-test"
});
// The background job's long command.
void longCommand("background").then((result) => mark("background-ended", result.code || (result.ok ? "ok" : "failed")));
// The poller: each call is numbered as it is made ("poll-call <n>"); a call that reached a process says so from it
// ("poll-ran <n>"), and one the gateway refused is "poll-refused <n> <code>".
let polls = 0;
setInterval(() => {
  const poll = String(++polls);
  mark("poll-call", poll);
  void command(["-e", "require('node:fs').appendFileSync(process.argv[1], `${Date.now()} poll-ran ${process.argv[2]}\\n`)", events, poll], 10_000)
    .then((result) => {
      if (result.ok !== true) mark("poll-refused", `${poll} ${result.code || "failed"}`);
    });
}, 50).unref();
mark("ready", String(process.pid));
