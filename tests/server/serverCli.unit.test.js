import assert from "node:assert/strict";
import test from "node:test";

import {
  browserUrlForListenAddress,
  browserUrlForPublicOrigin,
  startupBrowserPath
} from "../../server.js";
import {
  isDirectServerExecution,
  parseStartupArgs,
  serverStartOptions,
  shouldOpenBrowser
} from "../../bin/server.js";

test("server CLI starts management mode with no slug", () => {
  assert.deepEqual(parseStartupArgs([]), {
    openOnStart: false,
    startupSlug: ""
  });
  assert.equal(startupBrowserPath(), "/app/manage");
  assert.equal(
    browserUrlForListenAddress("http://127.0.0.1:3001"),
    "http://127.0.0.1:3001/app/manage"
  );
  assert.equal(
    browserUrlForPublicOrigin("https://tonymobily.vibe64.dev"),
    "https://tonymobily.vibe64.dev/app/manage"
  );
});

test("server CLI accepts one project slug and opens development mode", () => {
  assert.deepEqual(parseStartupArgs(["alpha_1"]), {
    openOnStart: false,
    startupSlug: "alpha_1"
  });
  assert.deepEqual(parseStartupArgs(["--no-open", "beta-2"]), {
    openOnStart: false,
    startupSlug: "beta-2"
  });
  assert.deepEqual(parseStartupArgs(["--open", "beta-2"]), {
    openOnStart: true,
    startupSlug: "beta-2"
  });
  assert.equal(startupBrowserPath({
    startupSlug: "alpha_1"
  }), "/app/alpha_1");
  assert.equal(
    browserUrlForListenAddress("http://0.0.0.0:3001", {
      startupSlug: "beta-2"
    }),
    "http://127.0.0.1:3001/app/beta-2"
  );
  assert.equal(
    browserUrlForPublicOrigin("https://tonymobily.vibe64.dev/", {
      startupSlug: "beta-2"
    }),
    "https://tonymobily.vibe64.dev/app/beta-2"
  );
});

test("server CLI rejects target paths and unsupported startup flags", () => {
  for (const args of [
    ["/tmp/app"],
    ["../app"],
    ["Example"],
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

test("server CLI never enables shutdown from browser lifecycle", () => {
  assert.deepEqual(serverStartOptions({
    env: {
      PORT: "3000"
    },
    startupSlug: "alpha_1"
  }), {
    browserLifecycleShutdown: false,
    startupSlug: "alpha_1",
    strictPort: true
  });
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
