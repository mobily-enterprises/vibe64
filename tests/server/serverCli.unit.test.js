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
import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";
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
  prepareLocalSystemRoot,
  serverStartOptions,
  shouldOpenBrowser
} from "../../bin/server.js";

function expectedCurrentDirectoryStartupSlug() {
  return projectSlugFromName(path.basename(path.resolve(".")));
}

test("server CLI starts local editor mode for the current directory with no target", () => {
  assert.deepEqual(parseStartupArgs([]), {
    openOnStart: true,
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
    openOnStart: true,
    startupSlug: "alpha_1",
    targetRoot: path.resolve("alpha_1")
  });
  assert.deepEqual(parseStartupArgs(["--no-open", "beta-2"]), {
    openOnStart: false,
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.deepEqual(parseStartupArgs(["--open", "beta-2"]), {
    openOnStart: true,
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.deepEqual(parseStartupArgs(["--project", "beta-2"]), {
    openOnStart: true,
    startupSlug: "beta-2",
    targetRoot: path.resolve("beta-2")
  });
  assert.deepEqual(parseStartupArgs(["--project=beta-2"]), {
    openOnStart: true,
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
    openOnStart: true,
    startupSlug: expectedCurrentDirectoryStartupSlug(),
    targetRoot: path.resolve(".")
  });
  assert.deepEqual(parseStartupArgs(["/tmp/My App"]), {
    openOnStart: true,
    startupSlug: "my-app",
    targetRoot: path.resolve("/tmp/My App")
  });
  assert.deepEqual(parseStartupArgs(["--no-open", "."]), {
    openOnStart: false,
    startupSlug: expectedCurrentDirectoryStartupSlug(),
    targetRoot: path.resolve(".")
  });
  assert.deepEqual(parseStartupArgs(["--open", "../app"]), {
    openOnStart: true,
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
    startupSlug: "vibe64",
    targetRoot: "/workspace/vibe64"
  }), {
    browserLifecycleShutdown: true,
    port: 3001,
    runtimeMode: "local",
    startupSlug: "vibe64",
    strictPort: false,
    targetRoot: "/workspace/vibe64"
  });
  assert.deepEqual(serverStartOptions({
    env: {},
    openOnStart: false,
    startupSlug: "vibe64",
    targetRoot: "/workspace/vibe64"
  }), {
    browserLifecycleShutdown: true,
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
    startupSlug: "vibe64",
    targetRoot: "/workspace/vibe64"
  }), {
    browserLifecycleShutdown: true,
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
    env: missingEnv
  }), VIBE64_LOCAL_RUNTIME_NAMESPACE);
  assert.equal(missingEnv[VIBE64_RUNTIME_NAMESPACE_ENV], VIBE64_LOCAL_RUNTIME_NAMESPACE);

  const configuredEnv = {
    [VIBE64_RUNTIME_NAMESPACE_ENV]: "owner-a"
  };
  assert.equal(applyLocalCliRuntimeNamespace({
    env: configuredEnv
  }), "owner-a");
  assert.equal(configuredEnv[VIBE64_RUNTIME_NAMESPACE_ENV], "owner-a");
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

test("server CLI creates the default local state folder before starting, and only that one", async () => {
  const made = [];
  const makeDirectory = async (root, options) => { made.push([root, options]); };
  const root = resolveDefaultLocalEditorSystemRoot("/home/person", "linux");
  assert.equal(await prepareLocalSystemRoot({ env: {}, home: "/home/person", platform: "linux", makeDirectory }), root);
  assert.deepEqual(made, [[root, { recursive: true, mode: 0o700 }]]);
  assert.equal(await prepareLocalSystemRoot({ env: { VIBE64_SYSTEM_ROOT: "/srv/state" }, home: "/home/person", makeDirectory }), "");
  assert.equal(made.length, 1);
});
