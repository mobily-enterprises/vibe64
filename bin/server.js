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
  const app = await startServer({
    strictPort: Boolean(String(process.env.PORT || "").trim())
  });
  const url = app.aiStudioUrl;
  if (url) {
    console.log(`AI Studio is running at ${url}`);
    if (shouldOpenBrowser()) {
      await openBrowser(url);
    }
  }
} catch (error) {
  console.error("Failed to start AI Studio server:", error);
  process.exitCode = 1;
}
