import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  projectSlugFromName
} from "@local/vibe64-core/server/studioProjectContext";
import {
  browserUrlForListenAddress,
  browserUrlForPublicOrigin,
  resolveServerRuntimeProfile,
  startupBrowserPath
} from "../../server.js";
import {
  applyLocalCliRuntimeNamespace,
  isDirectServerExecution,
  parseStartupArgs,
  serverStartOptions,
  shouldOpenBrowser
} from "../../bin/server.js";

function expectedCurrentDirectoryStartupSlug() {
  return projectSlugFromName(path.basename(path.resolve(".")));
}

test("server CLI starts local editor mode for the current directory with no target", () => {
  assert.deepEqual(parseStartupArgs([]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: expectedCurrentDirectoryStartupSlug(),
    targetRoot: path.resolve(".")
  });
  assert.equal(startupBrowserPath(), "/app");
  assert.equal(
    browserUrlForListenAddress("http://127.0.0.1:3001"),
    "http://127.0.0.1:3001/app"
  );
  assert.equal(
    browserUrlForPublicOrigin("https://tonymobily.vibe64.dev"),
    "https://tonymobily.vibe64.dev/app"
  );
});

test("server CLI accepts one target directory and opens local editor mode", () => {
  assert.deepEqual(parseStartupArgs(["alpha_1"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "alpha_1",
    targetRoot: path.resolve("alpha_1")
  });
  assert.deepEqual(parseStartupArgs(["--no-open", "beta-2"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: false,
    runtimeMode: "local",
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.deepEqual(parseStartupArgs(["--open", "beta-2"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.deepEqual(parseStartupArgs(["--project", "beta-2"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.deepEqual(parseStartupArgs(["--project=beta-2"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.equal(startupBrowserPath({
    startupSlug: "alpha_1"
  }), "/app/project/alpha_1");
  assert.equal(
    browserUrlForListenAddress("http://0.0.0.0:3001", {
      startupSlug: "beta-2"
    }),
    "http://127.0.0.1:3001/app/project/beta-2"
  );
  assert.equal(
    browserUrlForPublicOrigin("https://tonymobily.vibe64.dev/", {
      startupSlug: "beta-2"
    }),
    "https://tonymobily.vibe64.dev/app/project/beta-2"
  );
});

test("server CLI accepts target paths as local editor mode", () => {
  assert.deepEqual(parseStartupArgs(["."]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: expectedCurrentDirectoryStartupSlug(),
    targetRoot: path.resolve(".")
  });
  assert.deepEqual(parseStartupArgs(["/tmp/My App"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "my-app",
    targetRoot: path.resolve("/tmp/My App")
  });
  assert.deepEqual(parseStartupArgs(["--no-open", "."]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: false,
    runtimeMode: "local",
    startupSlug: expectedCurrentDirectoryStartupSlug(),
    targetRoot: path.resolve(".")
  });
  assert.deepEqual(parseStartupArgs(["--open", "../app"]), {
    jskitLockPath: ".jskit/lock.json",
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "app",
    targetRoot: path.resolve("../app")
  });
});

test("server CLI rejects invalid slugs and unsupported startup flags", () => {
  for (const args of [
    ["alpha", "beta"],
    ["--target", "/tmp/app"],
    ["--target=/tmp/app"],
    ["--projects-root=/tmp/vibe64"]
  ]) {
    assert.throws(
      () => parseStartupArgs(args),
      /startup|Unsupported/u,
      `Expected startup args to be rejected: ${args.join(" ")}`
    );
  }
});

test("server CLI browser-open flags are explicit", () => {
  assert.equal(shouldOpenBrowser(["alpha"]), false);
  assert.equal(shouldOpenBrowser(["--open", "alpha"]), true);
  assert.equal(shouldOpenBrowser(["--open=true", "alpha"]), true);
  assert.equal(shouldOpenBrowser(["--open=1", "alpha"]), true);
  assert.equal(shouldOpenBrowser(["--no-open", "alpha"]), false);
  assert.equal(shouldOpenBrowser(["--open=false", "alpha"]), false);
  assert.equal(shouldOpenBrowser(["--open=0", "alpha"]), false);
});

test("server CLI enables browser lifecycle shutdown for local editor mode", () => {
  assert.deepEqual(serverStartOptions({
    env: {},
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "vibe64",
    targetRoot: "/workspace/vibe64"
  }), {
    browserLifecycleShutdown: true,
    jskitLockPath: ".jskit/lock.json",
    port: 3001,
    runtimeMode: "local",
    startupSlug: "vibe64",
    strictPort: false,
    targetRoot: "/workspace/vibe64"
  });
  assert.deepEqual(serverStartOptions({
    env: {},
    openOnStart: false,
    runtimeMode: "local",
    startupSlug: "vibe64",
    targetRoot: "/workspace/vibe64"
  }), {
    browserLifecycleShutdown: true,
    jskitLockPath: ".jskit/lock.json",
    port: undefined,
    runtimeMode: "local",
    startupSlug: "vibe64",
    strictPort: false,
    targetRoot: "/workspace/vibe64"
  });
  assert.deepEqual(serverStartOptions({
    env: {
      PORT: "4567"
    },
    openOnStart: true,
    runtimeMode: "local",
    startupSlug: "vibe64",
    targetRoot: "/workspace/vibe64"
  }), {
    browserLifecycleShutdown: true,
    jskitLockPath: ".jskit/lock.json",
    port: undefined,
    runtimeMode: "local",
    startupSlug: "vibe64",
    strictPort: true,
    targetRoot: "/workspace/vibe64"
  });
});

test("server CLI supplies a reserved local runtime namespace only when env is missing", () => {
  const missingEnv = {};
  assert.equal(applyLocalCliRuntimeNamespace({
    env: missingEnv,
    runtimeMode: "local"
  }), VIBE64_LOCAL_RUNTIME_NAMESPACE);
  assert.equal(missingEnv[VIBE64_RUNTIME_NAMESPACE_ENV], VIBE64_LOCAL_RUNTIME_NAMESPACE);

  const configuredEnv = {
    [VIBE64_RUNTIME_NAMESPACE_ENV]: "owner-a"
  };
  assert.equal(applyLocalCliRuntimeNamespace({
    env: configuredEnv,
    runtimeMode: "local"
  }), "owner-a");
  assert.equal(configuredEnv[VIBE64_RUNTIME_NAMESPACE_ENV], "owner-a");

  const onlineEnv = {};
  assert.equal(applyLocalCliRuntimeNamespace({
    env: onlineEnv,
    runtimeMode: "composed"
  }), "");
  assert.equal(Object.hasOwn(onlineEnv, VIBE64_RUNTIME_NAMESPACE_ENV), false);
});

test("server accepts an explicit runtime profile from a composed product", () => {
  const externalProfile = Object.freeze({
    authRequired: true,
    local: false,
    mode: "composed",
    projectCatalogEnabled: true,
    singleTargetRoot: ""
  });

  assert.deepEqual(resolveServerRuntimeProfile({
    runtimeProfile: externalProfile
  }), externalProfile);

  assert.deepEqual(resolveServerRuntimeProfile({
    createRuntimeProfile({ mode, targetRoot }) {
      assert.equal(mode, "composed");
      assert.equal(targetRoot, "");
      return externalProfile;
    },
    runtimeMode: "composed"
  }), externalProfile);
});

test("server CLI detects direct execution without starting when imported", () => {
  const entrypointPath = "/pkg/bin/server.js";
  const symlinkPath = "/workspace/app/node_modules/vibe64/bin/server.js";
  const realpath = (filePath) => filePath === symlinkPath ? entrypointPath : filePath;

  assert.equal(isDirectServerExecution({
    argv: ["/usr/bin/node", symlinkPath],
    entrypointPath,
    realpath
  }), true);
  assert.equal(isDirectServerExecution({
    argv: ["/usr/bin/node", "/tmp/test.js"],
    entrypointPath,
    realpath
  }), false);
});
