// A real Vibe64 server for serverStopBudget.integration.test.js, busy the way a workspace's editor is when a release
// stops it: a request still waiting on a long command it started, a long command a background job started, and a
// poller that starts a short command every 50 ms, as the page's and the editor's own work did on mercmobily's
// release-10 stop (24 Nov 2026), when the editor started twelve helper calls after SIGTERM and took 3.33 s to stop.
// Every command goes through the editor's one command gateway. What happens is appended to events.log in the folder
// the test gives (VIBE64_STOP_TEST_ROOT): "<epoch ms> <event> [<detail>]".
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { runVibe64Command } from "@local/vibe64-execution/server";
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

const STOP_SIGNALS = ["SIGINT", "SIGTERM"];
const exitOnStopSignal = (signal) => process.exit(128 + (signal === "SIGINT" ? 2 : 15));
for (const signal of STOP_SIGNALS) process.once(signal, exitOnStopSignal);
try {
  await startServer({
    ...playwrightServerStartOptions({ cwd: project }),
    managedSourceRoot: path.join(root, "projects"),
    systemRoot: path.join(root, "state"),
    localAccessKey: false,
    async createInstalledRuntime(options) {
      const runtime = await createInstalledRuntime(options);
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

// The background job's long command.
void longCommand("background").then((result) => mark("background-ended", result.code || (result.ok ? "ok" : "failed")));
// The poller: each start that reached a process says so itself ("poll-ran", at the time its process began); one the
// gateway refused is "poll-refused".
setInterval(() => {
  void command(["-e", "require('node:fs').appendFileSync(process.argv[1], `${Math.round(performance.timeOrigin)} poll-ran\\n`)", events], 10_000)
    .then((result) => {
      if (result.ok !== true) mark("poll-refused", result.code || "failed");
    });
}, 50).unref();
mark("ready", String(process.pid));
