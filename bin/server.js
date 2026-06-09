#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import open, { apps } from "open";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  normalizeProjectSlug
} from "@local/vibe64-core/server/studioProjectContext";
import { startServer } from "../server.js";

const SERVER_ENTRYPOINT = fileURLToPath(import.meta.url);

function shouldOpenBrowser(args = process.argv.slice(2)) {
  for (const arg of args) {
    const normalized = String(arg || "").trim().toLowerCase();
    if (normalized === "--open" || normalized === "--open=true" || normalized === "--open=1") {
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
    if (arg.startsWith("-")) {
      throw unsupportedStartupArg(arg);
    }
    if (startupSlug) {
      throw unsupportedStartupArg(arg);
    }
    try {
      startupSlug = normalizeProjectSlug(arg);
    } catch (error) {
      error.message = `Vibe64 startup slug is invalid: ${error.message}`;
      throw error;
    }
  }
  return {
    openOnStart: shouldOpenBrowser(args),
    startupSlug
  };
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
  startupSlug = ""
} = {}) {
  return {
    browserLifecycleShutdown: false,
    strictPort: Boolean(String(env.PORT || "").trim()),
    startupSlug
  };
}

async function main() {
  const {
    openOnStart,
    startupSlug
  } = parseStartupArgs();
  const app = await startServer(serverStartOptions({
    startupSlug
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
