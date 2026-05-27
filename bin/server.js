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
  const openOnStart = shouldOpenBrowser();
  const app = await startServer({
    browserLifecycleShutdown: openOnStart,
    strictPort: Boolean(String(process.env.PORT || "").trim())
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
