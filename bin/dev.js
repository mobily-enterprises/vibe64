#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import {
  LOCALHOST_CHECK_BYPASS_ENV,
  hasLocalhostCheckBypassArg,
  stripLocalhostCheckBypassArgs
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  REMOTE_STUDIO_RUNTIME_ENV,
  hasRemoteStudioRuntimeArg,
  stripRemoteStudioRuntimeArgs
} from "@local/vibe64-core/server/studioRuntimeLocation";

const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const rawArgs = process.argv.slice(2);
const bypassLocalhostCheck = hasLocalhostCheckBypassArg(rawArgs);
const remoteStudioRuntime = hasRemoteStudioRuntimeArg(rawArgs);
const viteArgs = stripRemoteStudioRuntimeArgs(stripLocalhostCheckBypassArgs(rawArgs));
const env = {
  ...process.env
};

if (bypassLocalhostCheck) {
  env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
}
if (remoteStudioRuntime) {
  env[REMOTE_STUDIO_RUNTIME_ENV] = "1";
}

const child = spawn(process.execPath, [viteBin, ...viteArgs], {
  env,
  stdio: "inherit"
});

let forwardedSignal = false;

function forwardSignal(signal) {
  if (forwardedSignal) {
    return;
  }
  forwardedSignal = true;
  child.kill(signal);
}

process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = Number(code || 0);
});
