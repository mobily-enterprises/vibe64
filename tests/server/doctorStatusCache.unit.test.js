import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadyStatusCache
} from "../../server/lib/doctorStatusCache.js";

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
