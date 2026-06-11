#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import open, { apps } from "open";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  normalizeProjectSlug,
  projectSlugFromName
} from "@local/vibe64-core/server/studioProjectContext";
import { startServer } from "../server.js";
import {
  VIBE64_RUNTIME_MODE_HOSTED,
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
      const slugArg = String(args[index + 1] || "").trim();
      if (!slugArg) {
        throw unsupportedStartupArg(arg);
      }
      if (startupSlug || targetRoot) {
        throw unsupportedStartupArg(slugArg);
      }
      startupSlug = normalizeStartupSlug(slugArg);
      index += 1;
      continue;
    }
    if (normalized.startsWith("--project=")) {
      const slugArg = arg.slice("--project=".length).trim();
      if (!slugArg || startupSlug || targetRoot) {
        throw unsupportedStartupArg(arg);
      }
      startupSlug = normalizeStartupSlug(slugArg);
      continue;
    }
    if (arg.startsWith("-")) {
      throw unsupportedStartupArg(arg);
    }
    if (startupSlug || targetRoot) {
      throw unsupportedStartupArg(arg);
    }
    if (isStartupPathArgument(arg)) {
      targetRoot = path.resolve(arg);
      startupSlug = localStartupSlugForTargetRoot(targetRoot);
    } else {
      startupSlug = normalizeStartupSlug(arg);
    }
  }
  return {
    openOnStart: shouldOpenStartupBrowser(args, {
      targetRoot
    }),
    runtimeMode: targetRoot ? VIBE64_RUNTIME_MODE_LOCAL : VIBE64_RUNTIME_MODE_HOSTED,
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

function normalizeStartupSlug(value = "") {
  try {
    return normalizeProjectSlug(value);
  } catch (error) {
    error.message = `Vibe64 startup slug is invalid: ${error.message}`;
    throw error;
  }
}

function isStartupPathArgument(value = "") {
  const arg = String(value || "").trim();
  return arg === "." ||
    arg === ".." ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith("~/") ||
    path.isAbsolute(arg) ||
    /[\\/]/u.test(arg);
}

function localStartupSlugForTargetRoot(targetRoot = "") {
  const slug = projectSlugFromName(path.basename(path.resolve(targetRoot)));
  return slug ? normalizeProjectSlug(slug) : "local-project";
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
  runtimeMode = VIBE64_RUNTIME_MODE_HOSTED,
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

async function main() {
  const {
    openOnStart,
    runtimeMode,
    startupSlug,
    targetRoot
  } = parseStartupArgs();
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
  isDirectServerExecution,
  parseStartupArgs,
  serverStartOptions,
  shouldOpenBrowser
};
