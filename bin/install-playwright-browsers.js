#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  playwrightBrowserInstallCommandArgs,
  playwrightBrowserInstallScript,
  resolvePlaywrightBrowsersPath,
  runVibe64Command
} from "@local/vibe64-execution/server";

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
    "Installs Playwright Chromium into Vibe64's shared browser cache using the shared runtime packs."
  ].join("\n");
}

function installPlaywrightCommand() {
  return playwrightBrowserInstallScript();
}

async function installPlaywrightBrowsers({
  runCommand = runVibe64Command,
  stderr = process.stderr,
  stdout = process.stdout
} = {}) {
  stdout.write(`Installing Playwright Chromium into ${resolvePlaywrightBrowsersPath()}\n`);
  const [command, ...args] = playwrightBrowserInstallCommandArgs();
  const result = await runCommand({
    actor: "daemon",
    args,
    command,
    envPolicy: "deployment",
    mode: "capture",
    purpose: "setup",
    runtimes: ["node22", "playwright"],
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
