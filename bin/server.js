#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import open, { apps } from "open";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  projectSlugFromName
} from "@local/vibe64-core/server/studioProjectContext";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  resolveDefaultLocalEditorSystemRoot
} from "@local/vibe64-core/server/studioRoots";
import { shellQuote } from "@local/vibe64-execution/server";
import { startServer } from "../server.js";
import {
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  VIBE64_RUNTIME_MODE_LOCAL
} from "../server/lib/runtimeProfile.js";

const SERVER_ENTRYPOINT = fileURLToPath(import.meta.url);
const DEFAULT_LOCAL_EDITOR_BROWSER_PORT = 3001;

function shouldOpenBrowser(args = process.argv.slice(2)) {
  for (const arg of args) {
    const normalized = String(arg || "").trim().toLowerCase();
    if (normalized === "--open" || normalized === "--open=true" || normalized === "--open=1") {
      return true;
    }
  }
  return false;
}

function shouldSuppressBrowserOpen(args = process.argv.slice(2)) {
  for (const arg of args) {
    const normalized = String(arg || "").trim().toLowerCase();
    if (normalized === "--no-open" || normalized === "--open=false" || normalized === "--open=0") {
      return true;
    }
  }
  return false;
}

function realCliPath(filePath, realpath = realpathSync) {
  const resolvedPath = path.resolve(String(filePath || ""));
  try {
    return realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function isDirectServerExecution({
  argv = process.argv,
  entrypointPath = SERVER_ENTRYPOINT,
  realpath = realpathSync
} = {}) {
  const cliPath = argv[1];
  if (!cliPath) {
    return false;
  }
  return realCliPath(cliPath, realpath) === realCliPath(entrypointPath, realpath);
}

function unsupportedStartupArg(arg = "") {
  const error = new Error(`Unsupported Vibe64 startup argument: ${String(arg || "").trim()}`);
  error.code = "vibe64_invalid_startup_argument";
  return error;
}

function readRequiredArg(args, index, optionName) {
  const value = String(args[index + 1] || "").trim();
  if (!value) {
    throw unsupportedStartupArg(optionName);
  }
  return value;
}

function parseStartupArgs(args = process.argv.slice(2)) {
  let startupSlug = "";
  let targetRoot = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }
    const normalized = arg.toLowerCase();
    if (
      normalized === "--open" ||
      normalized === "--open=true" ||
      normalized === "--open=1" ||
      normalized === "--no-open" ||
      normalized === "--open=false" ||
      normalized === "--open=0"
    ) {
      continue;
    }
    if (normalized === "--project") {
      const targetArg = readRequiredArg(args, index, arg);
      if (startupSlug || targetRoot) {
        throw unsupportedStartupArg(targetArg);
      }
      targetRoot = path.resolve(targetArg);
      startupSlug = localStartupSlugForTargetRoot(targetRoot);
      index += 1;
      continue;
    }
    if (normalized.startsWith("--project=")) {
      const targetArg = arg.slice("--project=".length).trim();
      if (!targetArg || startupSlug || targetRoot) {
        throw unsupportedStartupArg(arg);
      }
      targetRoot = path.resolve(targetArg);
      startupSlug = localStartupSlugForTargetRoot(targetRoot);
      continue;
    }
    if (arg.startsWith("-")) {
      throw unsupportedStartupArg(arg);
    }
    if (startupSlug || targetRoot) {
      throw unsupportedStartupArg(arg);
    }
    targetRoot = path.resolve(arg);
    startupSlug = localStartupSlugForTargetRoot(targetRoot);
  }
  if (!startupSlug && !targetRoot) {
    targetRoot = process.cwd();
    startupSlug = localStartupSlugForTargetRoot(targetRoot);
  }
  return {
    openOnStart: shouldOpenStartupBrowser(args, {
      targetRoot
    }),
    runtimeMode: VIBE64_RUNTIME_MODE_LOCAL,
    startupSlug,
    targetRoot
  };
}

function shouldOpenStartupBrowser(args = process.argv.slice(2), {
  targetRoot = ""
} = {}) {
  if (shouldSuppressBrowserOpen(args)) {
    return false;
  }
  if (shouldOpenBrowser(args)) {
    return true;
  }
  return Boolean(String(targetRoot || "").trim());
}

function localStartupSlugForTargetRoot(targetRoot = "") {
  const slug = projectSlugFromName(path.basename(path.resolve(targetRoot)));
  return slug || "local-project";
}

async function openBrowser(url) {
  try {
    await open(url, {
      app: {
        name: apps.browser,
        arguments: ["--new-window"]
      }
    });
  } catch {
    try {
      await open(url);
    } catch (error) {
      console.warn(`Could not open browser automatically: ${error.message}`);
    }
  }
}

function serverStartOptions({
  env = process.env,
  openOnStart = false,
  runtimeMode = VIBE64_RUNTIME_MODE_LOCAL,
  startupSlug = "",
  targetRoot = ""
} = {}) {
  const localBrowserOpen = runtimeMode === VIBE64_RUNTIME_MODE_LOCAL && openOnStart === true;
  const envPortConfigured = Boolean(String(env.PORT || "").trim());
  return {
    browserLifecycleShutdown: runtimeMode === VIBE64_RUNTIME_MODE_LOCAL,
    port: localBrowserOpen && !envPortConfigured ? DEFAULT_LOCAL_EDITOR_BROWSER_PORT : undefined,
    runtimeMode,
    strictPort: envPortConfigured,
    startupSlug,
    targetRoot
  };
}

function applyLocalCliRuntimeNamespace({
  env = process.env,
  runtimeMode = VIBE64_RUNTIME_MODE_LOCAL
} = {}) {
  if (runtimeMode !== VIBE64_RUNTIME_MODE_LOCAL) {
    return String(env[VIBE64_RUNTIME_NAMESPACE_ENV] || "").trim();
  }
  const configured = String(env[VIBE64_RUNTIME_NAMESPACE_ENV] || "").trim();
  if (configured) {
    return configured;
  }
  env[VIBE64_RUNTIME_NAMESPACE_ENV] = VIBE64_LOCAL_RUNTIME_NAMESPACE;
  return VIBE64_LOCAL_RUNTIME_NAMESPACE;
}

// Earlier macOS versions kept data in the Linux state folder. Moving it is the
// person's decision, so startup only says how and changes nothing.
function macosDataMoveMessage({
  env = process.env,
  exists = existsSync,
  home = os.homedir(),
  platform = process.platform
} = {}) {
  if (platform !== "darwin" || String(env[VIBE64_SYSTEM_ROOT_ENV] || "").trim()) {
    return "";
  }
  const current = resolveDefaultLocalEditorSystemRoot(home, "darwin");
  const previous = resolveDefaultLocalEditorSystemRoot(home, "linux");
  if (exists(current) || !exists(previous)) {
    return "";
  }
  return [
    `Vibe64 now keeps its data in ${current}.`,
    "Move your existing data there, then start Vibe64 again:",
    `  mv ${shellQuote(previous)} ${shellQuote(current)}`
  ].join("\n");
}

// The local CLI owns the person's default state folder, so it exists before
// the first write there (pressing L, installing a course). An explicitly
// configured root is left to whoever provisioned it.
async function prepareLocalSystemRoot({
  env = process.env,
  home = os.homedir(),
  makeDirectory = mkdir,
  platform = process.platform,
  runtimeMode = VIBE64_RUNTIME_MODE_LOCAL
} = {}) {
  if (runtimeMode !== VIBE64_RUNTIME_MODE_LOCAL || String(env[VIBE64_SYSTEM_ROOT_ENV] || "").trim()) {
    return "";
  }
  const root = resolveDefaultLocalEditorSystemRoot(home, platform);
  await makeDirectory(root, { recursive: true, mode: 0o700 });
  return root;
}

async function main() {
  const dataMoveMessage = macosDataMoveMessage();
  if (dataMoveMessage) {
    console.error(dataMoveMessage);
    process.exitCode = 1;
    return;
  }
  const {
    openOnStart,
    runtimeMode,
    startupSlug,
    targetRoot
  } = parseStartupArgs();
  applyLocalCliRuntimeNamespace({
    runtimeMode
  });
  await prepareLocalSystemRoot({ runtimeMode });
  const app = await startServer(serverStartOptions({
    openOnStart,
    runtimeMode,
    startupSlug,
    targetRoot
  }));
  const url = app.vibe64Url;
  if (url) {
    console.log(`Vibe64 is running at ${url}`);
    if (openOnStart) {
      await openBrowser(url);
    }
    return;
  }
  if (app.vibe64Listen?.transport === "socket") {
    console.log(`Vibe64 is listening on Unix socket ${app.vibe64Listen.socketPath}`);
    if (openOnStart) {
      console.warn("Cannot open a browser for a Unix socket listener. Set VIBE64_PUBLIC_ORIGIN or PORT.");
    }
  }
}

if (isDirectServerExecution()) {
  main().catch((error) => {
    console.error("Failed to start Vibe64 server:", error);
    process.exitCode = 1;
  });
}

export {
  applyLocalCliRuntimeNamespace,
  isDirectServerExecution,
  macosDataMoveMessage,
  parseStartupArgs,
  prepareLocalSystemRoot,
  serverStartOptions,
  shouldOpenBrowser
};
