#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  CPP_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/cpp/toolchainIdentity";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/jskit/toolchainIdentity";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/laravel/toolchainIdentity";

const MANAGED_TOOLCHAIN_IMAGES = Object.freeze([
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  JSKIT_TOOLCHAIN_IMAGE,
  LARAVEL_TOOLCHAIN_IMAGE,
  CPP_TOOLCHAIN_IMAGE
]);

function uniqueImages(images = []) {
  return [...new Set(images.map((image) => String(image || "").trim()).filter(Boolean))];
}

function managedToolchainImages() {
  return uniqueImages(MANAGED_TOOLCHAIN_IMAGES);
}

function parsePullToolchainImagesArgs(argv = []) {
  const args = new Set(argv);
  return {
    dryRun: args.has("--dry-run"),
    help: args.has("--help") || args.has("-h")
  };
}

function usage() {
  return [
    "Usage: node ./bin/pull-toolchain-images.js [--dry-run]",
    "",
    "Pulls the managed Vibe64 toolchain images required by host provisioning."
  ].join("\n");
}

function pullImage(image, {
  dockerCommand = "docker",
  spawnImpl = spawn,
  stderr = process.stderr,
  stdout = process.stdout
} = {}) {
  return new Promise((resolve, reject) => {
    stdout.write(`Pulling ${image}\n`);
    const child = spawnImpl(dockerCommand, ["pull", image], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker pull ${image} exited with status ${code}`));
    });
  });
}

async function pullManagedToolchainImages(options = {}) {
  for (const image of managedToolchainImages()) {
    await pullImage(image, options);
  }
}

async function main({
  argv = process.argv.slice(2),
  stderr = process.stderr,
  stdout = process.stdout
} = {}) {
  const options = parsePullToolchainImagesArgs(argv);
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const images = managedToolchainImages();
  if (options.dryRun) {
    stdout.write(`${images.join("\n")}\n`);
    return 0;
  }

  await pullManagedToolchainImages({
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
  isDirectCliExecution,
  main,
  managedToolchainImages,
  parsePullToolchainImagesArgs,
  pullImage,
  pullManagedToolchainImages
};
