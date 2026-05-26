import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createReadyStatusCache,
  createRepositoryReadyStatusCache
} from "@local/setup-doctor-core/server/doctorStatusCache";

test("ready status cache reuses only recent ready statuses", () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    const cache = createReadyStatusCache({
      ttlMs: 25
    });
    const readyStatus = {
      ready: true,
      checks: []
    };

    assert.equal(cache.read(), null);
    assert.equal(cache.remember(readyStatus), readyStatus);
    assert.equal(cache.read(), readyStatus);

    now = 1_026;
    assert.equal(cache.read(), null);
  } finally {
    Date.now = originalNow;
  }
});

test("ready status cache clears when a non-ready status is observed", () => {
  const cache = createReadyStatusCache();
  const readyStatus = {
    ready: true,
    checks: []
  };
  const blockedStatus = {
    ready: false,
    checks: []
  };

  cache.remember(readyStatus);
  assert.equal(cache.read(), readyStatus);

  assert.equal(cache.remember(blockedStatus), blockedStatus);
  assert.equal(cache.read(), null);
});

test("repository ready status cache persists ready statuses per doctor and target root", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "ai-studio-doctor-cache-"));

  try {
    const targetRoot = path.join(stateRoot, "target");
    const readyStatus = {
      checks: [],
      ready: true,
      updatedAt: "2026-05-19T00:00:00.000Z"
    };
    const cache = createRepositoryReadyStatusCache({
      doctorId: "project-setup",
      stateRoot,
      targetRoot
    });

    assert.equal(await cache.read(), null);
    assert.equal(await cache.remember(readyStatus), readyStatus);

    const restored = createRepositoryReadyStatusCache({
      doctorId: "project-setup",
      stateRoot,
      targetRoot
    });
    assert.deepEqual(await restored.read(), readyStatus);

    const otherDoctor = createRepositoryReadyStatusCache({
      doctorId: "adapter-setup",
      stateRoot,
      targetRoot
    });
    assert.equal(await otherDoctor.read(), null);

    const blockedStatus = {
      checks: [],
      ready: false
    };
    assert.equal(await restored.remember(blockedStatus), blockedStatus);

    const cleared = createRepositoryReadyStatusCache({
      doctorId: "project-setup",
      stateRoot,
      targetRoot
    });
    assert.equal(await cleared.read(), null);
  } finally {
    await rm(stateRoot, {
      force: true,
      recursive: true
    });
  }
});

test("repository ready status cache keeps blocked statuses briefly in memory only", async () => {
  const originalNow = Date.now;
  const stateRoot = await mkdtemp(path.join(tmpdir(), "ai-studio-doctor-cache-"));
  let now = 1_000;
  Date.now = () => now;

  try {
    const targetRoot = path.join(stateRoot, "target");
    const blockedStatus = {
      checks: [],
      ok: true,
      ready: false
    };
    const cache = createRepositoryReadyStatusCache({
      doctorId: "project-setup",
      recentNotReadyTtlMs: 25,
      stateRoot,
      targetRoot
    });

    assert.equal(await cache.remember(blockedStatus), blockedStatus);
    assert.equal(await cache.read(), blockedStatus);

    const restored = createRepositoryReadyStatusCache({
      doctorId: "project-setup",
      recentNotReadyTtlMs: 25,
      stateRoot,
      targetRoot
    });
    assert.equal(await restored.read(), null);

    now = 1_026;
    assert.equal(await cache.read(), null);
  } finally {
    Date.now = originalNow;
    await rm(stateRoot, {
      force: true,
      recursive: true
    });
  }
});
