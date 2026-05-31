#!/usr/bin/env node
import open, { apps } from "open";
import process from "node:process";
import { startServer } from "../server.js";

function shouldOpenBrowser(args = process.argv.slice(2)) {
  for (const arg of args) {
    const normalized = String(arg || "").trim().toLowerCase();
    if (normalized === "--no-open" || normalized === "--open=false" || normalized === "--open=0") {
      return false;
    }
  }
  return true;
}

function parseStartupArgs(args = process.argv.slice(2)) {
  let targetRoot = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }
    if (arg === "--target" && index + 1 < args.length) {
      targetRoot = String(args[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      targetRoot = arg.slice("--target=".length).trim();
      continue;
    }
    if (!arg.startsWith("-") && !targetRoot) {
      targetRoot = arg;
    }
  }
  return {
    openOnStart: shouldOpenBrowser(args),
    targetRoot
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

try {
  const {
    openOnStart,
    targetRoot
  } = parseStartupArgs();
  const app = await startServer({
    browserLifecycleShutdown: openOnStart,
    strictPort: Boolean(String(process.env.PORT || "").trim()),
    targetRoot
  });
  const url = app.vibe64Url;
  if (url) {
    console.log(`Vibe64 is running at ${url}`);
    if (openOnStart) {
      await openBrowser(url);
    }
  }
} catch (error) {
  console.error("Failed to start Vibe64 server:", error);
  process.exitCode = 1;
}
