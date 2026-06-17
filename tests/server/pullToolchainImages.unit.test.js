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
  main,
  managedToolchainImages,
  parsePullToolchainImagesArgs,
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

function fakeDockerSpawn(calls = []) {
  return (command, args) => {
    calls.push({
      args,
      command
    });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.pipe = () => {};
    child.stderr.pipe = () => {};
    queueMicrotask(() => child.emit("close", 0));
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

test("pull-toolchain-images parses help and dry-run flags", () => {
  assert.deepEqual(parsePullToolchainImagesArgs(["--dry-run"]), {
    dryRun: true,
    help: false
  });
  assert.deepEqual(parsePullToolchainImagesArgs(["-h"]), {
    dryRun: false,
    help: true
  });
});
