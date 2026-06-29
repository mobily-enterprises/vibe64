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

function imageRepository(image = "") {
  const normalized = String(image || "").trim();
  const withoutDigest = normalized.split("@")[0] || normalized;
  const lastSlashIndex = withoutDigest.lastIndexOf("/");
  const tagSeparatorIndex = withoutDigest.indexOf(":", lastSlashIndex + 1);
  return tagSeparatorIndex > -1 ? withoutDigest.slice(0, tagSeparatorIndex) : withoutDigest;
}

function parsePullToolchainImagesArgs(argv = []) {
  const args = new Set(argv);
  return {
    dryRun: args.has("--dry-run"),
    help: args.has("--help") || args.has("-h"),
    pruneOld: args.has("--prune-old")
  };
}

function usage() {
  return [
    "Usage: node ./bin/pull-toolchain-images.js [--dry-run] [--prune-old]",
    "",
    "Pulls the managed Vibe64 toolchain images required by local Docker workspaces.",
    "With --prune-old, removes older local tags for the same managed image repositories when Docker allows it."
  ].join("\n");
}

function runDocker(args = [], {
  dockerCommand = "docker",
  spawnImpl = spawn,
  stderr = process.stderr,
  stdout = process.stdout,
  writeOutput = true
} = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const child = spawnImpl(dockerCommand, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.on?.("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on?.("data", (chunk) => {
      errorOutput += String(chunk);
    });
    if (writeOutput) {
      child.stdout?.pipe(stdout);
      child.stderr?.pipe(stderr);
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          code,
          stderr: errorOutput,
          stdout: output
        });
        return;
      }
      const error = new Error(`docker ${args.join(" ")} exited with status ${code}`);
      error.code = code;
      error.stderr = errorOutput;
      error.stdout = output;
      reject(error);
    });
  });
}

function pullImage(image, options = {}) {
  options.stdout?.write?.(`Pulling ${image}\n`);
  return runDocker(["pull", image], options);
}

async function localImageRefsForRepository(repository = "", options = {}) {
  if (!repository) {
    return [];
  }
  const result = await runDocker([
    "image",
    "ls",
    repository,
    "--format",
    "{{.Repository}}:{{.Tag}}"
  ], {
    ...options,
    writeOutput: false
  });
  return uniqueImages(result.stdout.split(/\r?\n/u))
    .filter((image) => !image.endsWith(":<none>"));
}

async function removeOldImage(image = "", {
  stderr = process.stderr,
  stdout = process.stdout,
  ...options
} = {}) {
  stdout.write(`Removing old managed toolchain image ${image}\n`);
  try {
    await runDocker(["image", "rm", image], {
      ...options,
      stderr,
      stdout
    });
    return true;
  } catch (error) {
    stderr.write(`Could not remove old managed toolchain image ${image}: ${error?.message || error}\n`);
    return false;
  }
}

async function pullManagedToolchainImages(options = {}) {
  for (const image of managedToolchainImages()) {
    await pullImage(image, options);
  }
}

async function pruneOldManagedToolchainImages(options = {}) {
  const currentImages = managedToolchainImages();
  const currentSet = new Set(currentImages);
  const repositories = uniqueImages(currentImages.map(imageRepository));
  const removed = [];
  for (const repository of repositories) {
    const localImages = await localImageRefsForRepository(repository, options);
    for (const image of localImages) {
      if (currentSet.has(image)) {
        continue;
      }
      if (await removeOldImage(image, options)) {
        removed.push(image);
      }
    }
  }
  return removed;
}

async function main({
  argv = process.argv.slice(2),
  stderr = process.stderr,
  stdout = process.stdout,
  ...dockerOptions
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
    ...dockerOptions,
    stderr,
    stdout
  });
  if (options.pruneOld) {
    await pruneOldManagedToolchainImages({
      ...dockerOptions,
      stderr,
      stdout
    });
  }
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
  imageRepository,
  isDirectCliExecution,
  localImageRefsForRepository,
  main,
  managedToolchainImages,
  parsePullToolchainImagesArgs,
  pullImage,
  pullManagedToolchainImages,
  pruneOldManagedToolchainImages,
  removeOldImage,
  runDocker
};
