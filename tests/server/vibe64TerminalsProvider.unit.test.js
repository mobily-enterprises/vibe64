import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_SERVICE_DATA_ROOT_ENV
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

async function createFailingCodexCommand(root) {
  const binDir = path.join(root, "bin");
  const codexPath = path.join(binDir, "codex");
  await mkdir(binDir, {
    recursive: true
  });
  await writeFile(codexPath, [
    "#!/bin/sh",
    "printf '%s\\n' 'test Codex authentication unavailable' >&2",
    "exit 42",
    ""
  ].join("\n"));
  await chmod(codexPath, 0o755);
  return binDir;
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
    adapter: {},
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

test("terminals provider starts global Codex through the host command path after lazy service creation", async () => {
  await withTemporaryRoot(async (root) => {
    const serviceDataRoot = path.join(root, "services");
    const targetRoot = path.join(root, "project");
    const codexBinDir = await createFailingCodexCommand(root);
    await mkdir(targetRoot, {
      recursive: true
    });

    const app = createProviderApp();
    await withEnv({
      PATH: `${codexBinDir}${path.delimiter}${process.env.PATH || ""}`,
      [VIBE64_SERVICE_DATA_ROOT_ENV]: serviceDataRoot
    }, async () => {
      new Vibe64TerminalsProvider().register(app);
    });

    await withEnv({
      PATH: `${codexBinDir}${path.delimiter}${process.env.PATH || ""}`,
      [VIBE64_SERVICE_DATA_ROOT_ENV]: null
    }, async () => {
      const result = await startGlobalCodexWithRegisteredService({
        app,
        targetRoot
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /test Codex authentication unavailable/u);
      assert.doesNotMatch(result.error, /toolchain|image/u);
      assert.doesNotMatch(result.error, /Codex account storage is not available/u);
    });
  });
});

test("terminals provider reads root env from JSKIT runtime env without resolving a terminal image", async () => {
  await withTemporaryRoot(async (root) => {
    const serviceDataRoot = path.join(root, "services");
    const targetRoot = path.join(root, "project");
    const codexBinDir = await createFailingCodexCommand(root);
    await mkdir(targetRoot, {
      recursive: true
    });

    const app = createProviderApp({
      env: {
        [VIBE64_SERVICE_DATA_ROOT_ENV]: serviceDataRoot
      }
    });
    await withEnv({
      PATH: `${codexBinDir}${path.delimiter}${process.env.PATH || ""}`,
      [VIBE64_SERVICE_DATA_ROOT_ENV]: null
    }, async () => {
      new Vibe64TerminalsProvider().register(app);
      const result = await startGlobalCodexWithRegisteredService({
        app,
        targetRoot
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /test Codex authentication unavailable/u);
      assert.doesNotMatch(result.error, /toolchain|image/u);
      assert.doesNotMatch(result.error, /Codex account storage is not available/u);
    });
  });
});

test("terminals provider reads scoped JSKIT runtime env without resolving a terminal image", async () => {
  await withTemporaryRoot(async (root) => {
    const serviceDataRoot = path.join(root, "services");
    const targetRoot = path.join(root, "project");
    const codexBinDir = await createFailingCodexCommand(root);
    await mkdir(targetRoot, {
      recursive: true
    });

    const app = createProviderApp();
    await withEnv({
      PATH: `${codexBinDir}${path.delimiter}${process.env.PATH || ""}`,
      [VIBE64_SERVICE_DATA_ROOT_ENV]: null
    }, async () => {
      new Vibe64TerminalsProvider().register(app);
      const result = await startGlobalCodexWithRegisteredService({
        app,
        env: {
          [VIBE64_SERVICE_DATA_ROOT_ENV]: serviceDataRoot
        },
        targetRoot
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /test Codex authentication unavailable/u);
      assert.doesNotMatch(result.error, /toolchain|image/u);
      assert.doesNotMatch(result.error, /Codex account storage is not available/u);
    });
  });
});
