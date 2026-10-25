import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  acquireProjectSessionPolicyLock,
  acquireProjectSourceMutationLock,
  releaseProjectLock,
  runProjectSessionPolicyExclusive,
  runProjectSourceExclusive
} from "../../packages/vibe64-project/src/server/projectSourceMutationLock.js";

const lockModuleUrl = pathToFileURL(path.resolve(
  "packages/vibe64-project/src/server/projectSourceMutationLock.js"
)).href;

function lockChild(root, mode) {
  const source = mode === "hold"
    ? `
      import { acquireProjectSourceMutationLock, releaseProjectLock } from ${JSON.stringify(lockModuleUrl)};
      const lock = await acquireProjectSourceMutationLock(process.argv[1], { timeoutMs: 5000 });
      process.stdout.write("READY\\n");
      await new Promise((resolve) => process.stdin.once("data", resolve));
      await releaseProjectLock(lock);
    `
    : `
      import { acquireProjectSourceMutationLock, releaseProjectLock } from ${JSON.stringify(lockModuleUrl)};
      const lock = await acquireProjectSourceMutationLock(process.argv[1], { timeoutMs: 5000 });
      process.stdout.write("ACQUIRED\\n");
      await releaseProjectLock(lock);
    `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source, root], {
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function sessionPolicyLockChild(root, mode) {
  const source = mode === "hold"
    ? `
      import { acquireProjectSessionPolicyLock, releaseProjectLock } from ${JSON.stringify(lockModuleUrl)};
      const lock = await acquireProjectSessionPolicyLock(process.argv[1], { timeoutMs: 5000 });
      process.stdout.write("READY\\n");
      await new Promise((resolve) => process.stdin.once("data", resolve));
      await releaseProjectLock(lock);
    `
    : `
      import { acquireProjectSessionPolicyLock, releaseProjectLock } from ${JSON.stringify(lockModuleUrl)};
      const lock = await acquireProjectSessionPolicyLock(process.argv[1], { timeoutMs: 5000 });
      process.stdout.write("ACQUIRED\\n");
      await releaseProjectLock(lock);
    `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source, root], {
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function waitForOutput(child, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timer = setTimeout(() => reject(new Error(
      `Timed out waiting for ${expected}; stdout=${output}; stderr=${errors}`
    )), 5_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (!output.includes(expected)) {
        clearTimeout(timer);
        reject(new Error(`Child exited ${code}; stdout=${output}; stderr=${errors}`));
      }
    });
  });
}

test("project source operations serialize on one filesystem lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-lock-"));
  const order = [];
  let releaseFirst;
  const firstCanFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  try {
    const first = runProjectSourceExclusive(root, async () => {
      order.push("first-start");
      await firstCanFinish;
      order.push("first-finish");
    });
    while (!order.length) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const second = runProjectSourceExclusive(root, async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(order, ["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "first-finish", "second"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("separate processes contend on the same project source lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-lock-process-"));
  let holder;
  let contender;
  try {
    holder = lockChild(root, "hold");
    await waitForOutput(holder, "READY");
    contender = lockChild(root, "acquire");
    let contenderAcquired = false;
    const acquired = waitForOutput(contender, "ACQUIRED").then(() => {
      contenderAcquired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(contenderAcquired, false);
    holder.stdin.end("release\n");
    await acquired;
    assert.equal(contenderAcquired, true);
  } finally {
    holder?.kill("SIGTERM");
    contender?.kill("SIGTERM");
    await rm(root, { force: true, recursive: true });
  }
});

test("session policy operations use a distinct lock from source mutations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-lock-distinct-"));
  let sourceLock;
  let sessionPolicyLock;
  try {
    sourceLock = await acquireProjectSourceMutationLock(root);
    sessionPolicyLock = await acquireProjectSessionPolicyLock(root, {
      timeoutMs: 500
    });
    assert.notEqual(sourceLock.lockPath, sessionPolicyLock.lockPath);
    assert.equal(path.basename(sourceLock.lockPath), "source-mutation.lock");
    assert.equal(path.basename(sessionPolicyLock.lockPath), "session-policy.lock");
  } finally {
    if (sessionPolicyLock) {
      await releaseProjectLock(sessionPolicyLock);
    }
    if (sourceLock) {
      await releaseProjectLock(sourceLock);
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("session policy operations serialize in one process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-policy-lock-"));
  const order = [];
  let releaseFirst;
  const firstCanFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  try {
    const first = runProjectSessionPolicyExclusive(root, async () => {
      order.push("first-start");
      await firstCanFinish;
      order.push("first-finish");
    });
    while (!order.length) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const second = runProjectSessionPolicyExclusive(root, async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(order, ["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "first-finish", "second"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("separate processes contend on the same project session policy lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-policy-lock-process-"));
  let holder;
  let contender;
  try {
    holder = sessionPolicyLockChild(root, "hold");
    await waitForOutput(holder, "READY");
    contender = sessionPolicyLockChild(root, "acquire");
    let contenderAcquired = false;
    const acquired = waitForOutput(contender, "ACQUIRED").then(() => {
      contenderAcquired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(contenderAcquired, false);
    holder.stdin.end("release\n");
    await acquired;
    assert.equal(contenderAcquired, true);
  } finally {
    holder?.kill("SIGTERM");
    contender?.kill("SIGTERM");
    await rm(root, { force: true, recursive: true });
  }
});

test("a dead lock owner is reclaimed without a recursive repair", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-lock-"));
  try {
    const first = await acquireProjectSourceMutationLock(root);
    await releaseProjectLock(first);
    const second = await acquireProjectSourceMutationLock(root);
    assert.equal(await releaseProjectLock(second), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
