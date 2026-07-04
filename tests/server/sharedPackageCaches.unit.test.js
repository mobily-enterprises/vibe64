import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  packageManagerCacheDockerArgs,
  packageManagerCacheEnv,
  packageManagerCacheMountDockerArgs,
  resolveVibe64SharedCacheRoot
} from "@local/studio-terminal-core/server/sharedPackageCaches";

test("shared package caches default to explicit /var cache paths", () => {
  assert.equal(resolveVibe64SharedCacheRoot({
    env: {}
  }), DEFAULT_VIBE64_SHARED_CACHE_ROOT);
  assert.deepEqual(packageManagerCacheEnv(["npm", "composer", "pip", "ruby"], {
    env: {}
  }), {
    BUNDLE_USER_CACHE: "/var/cache/vibe64/ruby",
    COMPOSER_CACHE_DIR: "/var/cache/vibe64/composer",
    PIP_CACHE_DIR: "/var/cache/vibe64/pip",
    npm_config_cache: "/var/cache/vibe64/npm"
  });
});

test("shared package caches can be namespaced by the daemon launcher", () => {
  const root = path.join("/tmp", "vibe64-cache-owner-a");
  const env = {
    [VIBE64_SHARED_CACHE_ROOT_ENV]: root
  };

  assert.equal(resolveVibe64SharedCacheRoot({
    env
  }), root);
  assert.deepEqual(packageManagerCacheEnv(["npm", "composer"], {
    env
  }), {
    COMPOSER_CACHE_DIR: `${root}/composer`,
    npm_config_cache: `${root}/npm`
  });
  assert.deepEqual(packageManagerCacheMountDockerArgs(["npm"], {
    env
  }), [
    "-v",
    `${root}:${root}`
  ]);
});

test("shared package cache Docker args include one mount plus selected env values", () => {
  assert.deepEqual(packageManagerCacheDockerArgs(["npm", "composer"], {
    env: {}
  }), [
    "-v",
    "/var/cache/vibe64:/var/cache/vibe64",
    "-e",
    "npm_config_cache=/var/cache/vibe64/npm",
    "-e",
    "COMPOSER_CACHE_DIR=/var/cache/vibe64/composer"
  ]);
});
