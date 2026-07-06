#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  runHostCommand,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  studioPlaywrightBrowsersPath
} from "@local/studio-terminal-core/server/studioToolHome";

function parseInstallPlaywrightArgs(argv = []) {
  const args = new Set(argv);
  return {
    dryRun: args.has("--dry-run"),
    help: args.has("--help") || args.has("-h")
  };
}

function usage() {
  return [
    "Usage: node ./bin/install-playwright-browsers.js [--dry-run]",
    "",
    "Installs Playwright Chromium into Vibe64's shared browser cache using the host Playwright installation."
  ].join("\n");
}

function installPlaywrightCommand({
  browsersPath = studioPlaywrightBrowsersPath()
} = {}) {
  const resolvedBrowsersPath = path.resolve(String(browsersPath || ""));
  return [
    `export PLAYWRIGHT_BROWSERS_PATH=${shellQuote(resolvedBrowsersPath)}`,
    "npx playwright install chromium",
    "find \"$PLAYWRIGHT_BROWSERS_PATH\" -maxdepth 4 -type f \\( -name chrome -o -name chrome-headless-shell \\) | head -n 1"
  ].join("\n");
}

async function installPlaywrightBrowsers({
  browsersPath = studioPlaywrightBrowsersPath(),
  stderr = process.stderr,
  stdout = process.stdout
} = {}) {
  const resolvedBrowsersPath = path.resolve(String(browsersPath || ""));
  mkdirSync(resolvedBrowsersPath, {
    recursive: true
  });
  stdout.write(`Installing Playwright Chromium into ${resolvedBrowsersPath}\n`);
  const result = await runHostCommand("bash", ["-lc", installPlaywrightCommand({
    browsersPath: resolvedBrowsersPath
  })], {
    env: {
      PLAYWRIGHT_BROWSERS_PATH: resolvedBrowsersPath
    },
    timeout: 300_000
  });
  if (result.output) {
    stdout.write(`${result.output}\n`);
  }
  if (!result.ok) {
    stderr.write(`${result.output || "Playwright browser install failed."}\n`);
  }
  return result;
}

async function main({
  argv = process.argv.slice(2),
  stderr = process.stderr,
  stdout = process.stdout,
  ...installOptions
} = {}) {
  const options = parseInstallPlaywrightArgs(argv);
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const command = installPlaywrightCommand();
  if (options.dryRun) {
    stdout.write(`${command}\n`);
    return 0;
  }

  const result = await installPlaywrightBrowsers({
    ...installOptions,
    stderr,
    stdout
  });
  return result.ok ? 0 : result.exitCode || 1;
}

function isDirectCliExecution({
  argv = process.argv,
  entrypointUrl = import.meta.url
} = {}) {
  return Boolean(argv[1]) && path.resolve(argv[1]) === fileURLToPath(entrypointUrl);
}

if (isDirectCliExecution()) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error?.message || error}\n`);
      process.exitCode = 1;
    });
}

export {
  installPlaywrightBrowsers,
  installPlaywrightCommand,
  isDirectCliExecution,
  main,
  parseInstallPlaywrightArgs
};
