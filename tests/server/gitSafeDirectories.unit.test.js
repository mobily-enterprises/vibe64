import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  applyGitConfigEntriesToEnv,
  applyGitSafeDirectoriesToEnv,
  gitSafeDirectoryArgs,
  githubSshToHttpsGitEnv
} from "@local/vibe64-execution/server";

test("Git config environment entries append without replacing existing entries", () => {
  const env = applyGitConfigEntriesToEnv({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: ""
  }, [
    {
      key: "safe.directory",
      value: "/srv/app"
    }
  ]);

  assert.deepEqual(env, {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "safe.directory",
    GIT_CONFIG_VALUE_1: "/srv/app"
  });
});

test("safe.directory entries are absolute, resolved, and unique", () => {
  const root = path.join("/", "srv", "app");
  const env = applyGitSafeDirectoriesToEnv({}, [
    root,
    path.join(root, "."),
    "relative"
  ]);

  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
  assert.equal(env.GIT_CONFIG_VALUE_0, root);
  assert.deepEqual(gitSafeDirectoryArgs([root]), [
    "-c",
    `safe.directory=${root}`
  ]);
});

test("GitHub transport config composes with existing Git config entries", () => {
  const env = githubSshToHttpsGitEnv({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: ""
  });

  assert.equal(env.GIT_CONFIG_COUNT, "3");
  assert.equal(env.GIT_CONFIG_KEY_0, "credential.helper");
  assert.equal(env.GIT_CONFIG_KEY_1, "url.https://github.com/.insteadOf");
  assert.equal(env.GIT_CONFIG_KEY_2, "url.https://github.com/.insteadOf");
});
