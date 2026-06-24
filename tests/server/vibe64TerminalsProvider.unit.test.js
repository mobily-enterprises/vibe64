import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  Vibe64TerminalsProvider
} from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsProvider.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-terminals-provider-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

async function withEnv(values = {}, callback) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createProviderApp({
  env = null
} = {}) {
  const services = new Map();
  return {
    actions() {},
    has(token) {
      return token === "jskit.env" && env !== null;
    },
    make(token) {
      if (token === "jskit.env" && env !== null) {
        return env;
      }
      throw new Error(`Unexpected app lookup: ${token}`);
    },
    service(id, factory) {
      services.set(id, factory);
    },
    services
  };
}

async function startGlobalCodexWithRegisteredService({
  app,
  env = null,
  targetRoot
} = {}) {
  const runtime = {
    adapter: {
      async getTerminalToolchainSpec() {
        return {
          image: "vibe64-test-image-that-must-not-exist:never",
          label: "test missing toolchain"
        };
      }
    },
    projectConfig: {}
  };
  const projectService = {
    async createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return targetRoot;
    }
  };
  const scope = {
    has(token) {
      return token === "jskit.env" && env !== null;
    },
    make(token) {
      if (token === "jskit.env" && env !== null) {
        return env;
      }
      assert.equal(token, "feature.vibe64-project.service");
      return projectService;
    }
  };

  const serviceFactory = app.services.get("feature.vibe64-terminals.service");
  const service = serviceFactory(scope);
  return service.startGlobalCodexTerminal();
}

test("terminals provider captures provider-home env before lazy service creation", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const targetRoot = path.join(root, "project");
    await mkdir(path.join(providerHomesRoot, "codex"), {
      recursive: true
    });
    await mkdir(targetRoot, {
      recursive: true
    });

    const app = createProviderApp();
    await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    }, async () => {
      new Vibe64TerminalsProvider().register(app);
    });

    await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: null
    }, async () => {
      const result = await startGlobalCodexWithRegisteredService({
        app,
        targetRoot
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /test missing toolchain image vibe64-test-image-that-must-not-exist:never is missing/u);
      assert.doesNotMatch(result.error, /Codex account storage is not available/u);
    });
  });
});

test("terminals provider reads provider-home env from JSKIT runtime env", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const targetRoot = path.join(root, "project");
    await mkdir(path.join(providerHomesRoot, "codex"), {
      recursive: true
    });
    await mkdir(targetRoot, {
      recursive: true
    });

    const app = createProviderApp({
      env: {
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      }
    });
    await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: null
    }, async () => {
      new Vibe64TerminalsProvider().register(app);
      const result = await startGlobalCodexWithRegisteredService({
        app,
        targetRoot
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /test missing toolchain image vibe64-test-image-that-must-not-exist:never is missing/u);
      assert.doesNotMatch(result.error, /Codex account storage is not available/u);
    });
  });
});

test("terminals provider reads scoped JSKIT runtime env during lazy service creation", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const targetRoot = path.join(root, "project");
    await mkdir(path.join(providerHomesRoot, "codex"), {
      recursive: true
    });
    await mkdir(targetRoot, {
      recursive: true
    });

    const app = createProviderApp();
    await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: null
    }, async () => {
      new Vibe64TerminalsProvider().register(app);
      const result = await startGlobalCodexWithRegisteredService({
        app,
        env: {
          [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
        },
        targetRoot
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /test missing toolchain image vibe64-test-image-that-must-not-exist:never is missing/u);
      assert.doesNotMatch(result.error, /Codex account storage is not available/u);
    });
  });
});
