import { spawn } from "node:child_process";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { startCodexHistoryAdapter } from "./codexHistoryAdapter.js";

// This entrypoint is the managed execution's leader. The transport and Codex
// share that execution's lifetime, independently of application subscribers.
const [runtimeDir, command, ...args] = process.argv.slice(2);
const token = process.env.VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN;
const descriptor = path.join(runtimeDir, "history-adapter.json");
const adapter = await startCodexHistoryAdapter({ token });
await writeFile(`${descriptor}.tmp`, JSON.stringify({ baseUrl: adapter.baseUrl, runtimeToken: token }), { mode: 0o600 });
await rename(`${descriptor}.tmp`, descriptor);
const child = spawn(command, args, { stdio: "inherit" });
let stopping = false;
let forceExit;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  void adapter.close();
  child.kill(signal);
  forceExit = setTimeout(() => child.kill("SIGKILL"), 5000);
  forceExit.unref();
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop("SIGINT"));
adapter.server.on("error", () => { process.exitCode = 1; stop(); });
const result = await new Promise((resolve) => {
  child.once("error", () => resolve({ code: 1 }));
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
clearTimeout(forceExit);
await adapter.close();
await rm(descriptor, { force: true });
process.exitCode ||= result.code ?? (stopping ? 0 : 1);
