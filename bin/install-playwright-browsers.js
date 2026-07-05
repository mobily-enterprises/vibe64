#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioPlaywrightBrowsersPath
} from "@local/studio-terminal-core/server/studioToolHome";

import {
  runDocker
} from "./pull-toolchain-images.js";

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
    "Installs Playwright Chromium into Vibe64's shared browser cache using the managed base toolchain image."
  ].join("\n");
}

function installPlaywrightDockerArgs({
  browsersPath = studioPlaywrightBrowsersPath(),
  image = STUDIO_BASE_TOOLCHAIN_IMAGE
} = {}) {
  const resolvedBrowsersPath = path.resolve(String(browsersPath || ""));
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    "-v",
    `${resolvedBrowsersPath}:${resolvedBrowsersPath}`,
    "-e",
    `PLAYWRIGHT_BROWSERS_PATH=${resolvedBrowsersPath}`,
    image,
    "bash",
    "-lc",
    "playwright install chromium && find \"$PLAYWRIGHT_BROWSERS_PATH\" -maxdepth 4 -type f \\( -name chrome -o -name chrome-headless-shell \\) | head -n 1"
  ];
}

async function installPlaywrightBrowsers({
  browsersPath = studioPlaywrightBrowsersPath(),
  stderr = process.stderr,
  stdout = process.stdout,
  ...dockerOptions
} = {}) {
  const resolvedBrowsersPath = path.resolve(String(browsersPath || ""));
  mkdirSync(resolvedBrowsersPath, {
    recursive: true
  });
  stdout.write(`Installing Playwright Chromium into ${resolvedBrowsersPath}\n`);
  return runDocker(installPlaywrightDockerArgs({
    browsersPath: resolvedBrowsersPath
  }), {
    ...dockerOptions,
    stderr,
    stdout
  });
}

async function main({
  argv = process.argv.slice(2),
  stderr = process.stderr,
  stdout = process.stdout,
  ...dockerOptions
} = {}) {
  const options = parseInstallPlaywrightArgs(argv);
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const args = installPlaywrightDockerArgs();
  if (options.dryRun) {
    stdout.write(`docker ${args.join(" ")}\n`);
    return 0;
  }

  await installPlaywrightBrowsers({
    ...dockerOptions,
    stderr,
    stdout
  });
  return 0;
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
  installPlaywrightDockerArgs,
  isDirectCliExecution,
  main,
  parseInstallPlaywrightArgs
};
