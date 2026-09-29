import { spawn } from "node:child_process";
import { rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startCodexHistoryAdapter } from "./codexHistoryAdapter.js";
import { prepareCodexModelCatalog } from "./codexModelCatalog.js";

// This entrypoint is the managed execution's leader. The transport and Codex
// share that execution's lifetime, independently of application subscribers.
const [runtimeDir, command, ...args] = process.argv.slice(2);
const token = process.env.VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN;
const descriptor = path.join(runtimeDir, "history-adapter.json");
const startup = new AbortController();
const abortStartup = () => startup.abort();
process.once("SIGTERM", abortStartup);
process.once("SIGINT", abortStartup);
const catalogPath = await prepareCodexModelCatalog({
  command,
  runtimeDir,
  bundled: process.env.VIBE64_CODEX_MODEL_CATALOG_SOURCE === "bundled",
  signal: startup.signal
});
const adapter = await startCodexHistoryAdapter({ token, codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex") });
await writeFile(`${descriptor}.tmp`, JSON.stringify({ baseUrl: adapter.baseUrl, runtimeToken: token }), { mode: 0o600 });
await rename(`${descriptor}.tmp`, descriptor);
const child = spawn(command, [...args, "-c", `model_catalog_json=${JSON.stringify(catalogPath)}`], { stdio: "inherit" });
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
process.removeListener("SIGTERM", abortStartup);
process.removeListener("SIGINT", abortStartup);
if (startup.signal.aborted) stop();
adapter.server.on("error", () => { process.exitCode = 1; stop(); });
const result = await new Promise((resolve) => {
  child.once("error", () => resolve({ code: 1 }));
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
clearTimeout(forceExit);
await adapter.close();
await rm(descriptor, { force: true });
process.exitCode ||= result.code ?? (stopping ? 0 : 1);
