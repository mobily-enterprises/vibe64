import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";

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
import {
  imageRepository,
  main,
  managedToolchainImages,
  parsePullToolchainImagesArgs,
  pruneOldManagedToolchainImages,
  pullManagedToolchainImages
} from "../../bin/pull-toolchain-images.js";

function captureWritable() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    }
  });
  stream.text = () => output;
  return stream;
}

function fakeDockerSpawn(calls = [], {
  failArgs = new Set(),
  stdoutByArgs = {}
} = {}) {
  return (command, args) => {
    const key = args.join("\0");
    calls.push({
      args,
      command
    });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.pipe = (target) => {
      child.stdout.on("data", (chunk) => target.write(chunk));
    };
    child.stderr.pipe = (target) => {
      child.stderr.on("data", (chunk) => target.write(chunk));
    };
    queueMicrotask(() => {
      if (stdoutByArgs[key]) {
        child.stdout.emit("data", stdoutByArgs[key]);
      }
      child.emit("close", failArgs.has(key) ? 1 : 0);
    });
    return child;
  };
}

test("managed toolchain image pull list uses the runtime image identities", () => {
  assert.deepEqual(managedToolchainImages(), [
    STUDIO_BASE_TOOLCHAIN_IMAGE,
    JSKIT_TOOLCHAIN_IMAGE,
    LARAVEL_TOOLCHAIN_IMAGE,
    CPP_TOOLCHAIN_IMAGE
  ]);
});

test("pull-toolchain-images supports dry-run output for local Docker setup", async () => {
  const stdout = captureWritable();
  const exitCode = await main({
    argv: ["--dry-run"],
    stdout
  });

  assert.equal(exitCode, 0);
  assert.equal(stdout.text(), `${managedToolchainImages().join("\n")}\n`);
});

test("pull-toolchain-images pulls every managed image in order", async () => {
  const calls = [];
  await pullManagedToolchainImages({
    spawnImpl: fakeDockerSpawn(calls),
    stderr: captureWritable(),
    stdout: captureWritable()
  });

  assert.deepEqual(calls, managedToolchainImages().map((image) => ({
    args: ["pull", image],
    command: "docker"
  })));
});

test("pull-toolchain-images prunes only older local tags for managed repositories", async () => {
  const currentImages = managedToolchainImages();
  const baseRepository = imageRepository(STUDIO_BASE_TOOLCHAIN_IMAGE);
  const jskitRepository = imageRepository(JSKIT_TOOLCHAIN_IMAGE);
  const calls = [];
  const stdoutByArgs = {
    [["image", "ls", baseRepository, "--format", "{{.Repository}}:{{.Tag}}"].join("\0")]:
      [
        STUDIO_BASE_TOOLCHAIN_IMAGE,
        `${baseRepository}:0.1.0`
      ].join("\n"),
    [["image", "ls", jskitRepository, "--format", "{{.Repository}}:{{.Tag}}"].join("\0")]:
      [
        JSKIT_TOOLCHAIN_IMAGE,
        `${jskitRepository}:0.1.0`
      ].join("\n")
  };
  for (const image of currentImages.slice(2)) {
    stdoutByArgs[["image", "ls", imageRepository(image), "--format", "{{.Repository}}:{{.Tag}}"].join("\0")] = `${image}\n`;
  }

  const removed = await pruneOldManagedToolchainImages({
    spawnImpl: fakeDockerSpawn(calls, {
      stdoutByArgs
    }),
    stderr: captureWritable(),
    stdout: captureWritable()
  });

  assert.deepEqual(removed, [
    `${baseRepository}:0.1.0`,
    `${jskitRepository}:0.1.0`
  ]);
  assert.deepEqual(
    calls.filter((call) => call.args[0] === "image" && call.args[1] === "rm").map((call) => call.args),
    [
      ["image", "rm", `${baseRepository}:0.1.0`],
      ["image", "rm", `${jskitRepository}:0.1.0`]
    ]
  );
  assert.equal(
    calls.some((call) => call.args.includes(STUDIO_BASE_TOOLCHAIN_IMAGE) && call.args[1] === "rm"),
    false
  );
});

test("pull-toolchain-images can prune old tags after pulling current images", async () => {
  const currentImages = managedToolchainImages();
  const calls = [];
  const stdoutByArgs = Object.fromEntries(currentImages.map((image) => [
    ["image", "ls", imageRepository(image), "--format", "{{.Repository}}:{{.Tag}}"].join("\0"),
    `${image}\n`
  ]));

  const exitCode = await main({
    argv: ["--prune-old"],
    stderr: captureWritable(),
    stdout: captureWritable(),
    spawnImpl: fakeDockerSpawn(calls, {
      stdoutByArgs
    })
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls.slice(0, currentImages.length), currentImages.map((image) => ({
    args: ["pull", image],
    command: "docker"
  })));
  assert.equal(calls.some((call) => call.args[0] === "image" && call.args[1] === "rm"), false);
});

test("pull-toolchain-images parses help and dry-run flags", () => {
  assert.deepEqual(parsePullToolchainImagesArgs(["--dry-run"]), {
    dryRun: true,
    help: false,
    pruneOld: false
  });
  assert.deepEqual(parsePullToolchainImagesArgs(["-h"]), {
    dryRun: false,
    help: true,
    pruneOld: false
  });
  assert.deepEqual(parsePullToolchainImagesArgs(["--prune-old"]), {
    dryRun: false,
    help: false,
    pruneOld: true
  });
});
