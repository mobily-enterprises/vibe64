import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../server.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

async function withTemporaryPackageRoot(packageName, callback) {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-studio-target-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "0.0.0",
      private: true,
      scripts: {
        test: "echo ok"
      }
    }, null, 2)
  );

  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

test("server defaults to loopback host", () => {
  const previousHost = process.env.HOST;
  delete process.env.HOST;
  try {
    assert.equal(resolveRuntimeEnv().HOST, "127.0.0.1");
  } finally {
    if (previousHost == null) {
      delete process.env.HOST;
    } else {
      process.env.HOST = previousHost;
    }
  }
});

test("GET /api/health returns built-in health response", async () => {
  const app = await createServer();
  const response = await app.inject({
    method: "GET",
    url: "/api/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);

  await app.close();
});

test("GET /api/studio/current-app inspects the current JSKIT app", async () => {
  const app = await createServer();
  const response = await app.inject({
    method: "GET",
    url: "/api/studio/current-app"
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.packageJson.name, "jskit-ai-studio");
  assert.equal(payload.packageJson.exists, true);
  assert.equal(payload.jskitLock.exists, true);
  assert.equal(payload.config.tenancyMode, "none");
  assert.equal(payload.runtimeNeeds.auth, false);
  assert.equal(payload.runtimeNeeds.workspaces, false);
  assert.equal(payload.runtimeNeeds.database, false);
  assert.equal(payload.isJskitApp, true);

  await app.close();
});

test("GET /api/studio/current-app inspects the launch cwd when Studio runs from another app", async () => {
  await withTemporaryPackageRoot("external-target-app", async (targetRoot) => {
    const previousCwd = process.cwd();
    const previousInitCwd = process.env.INIT_CWD;
    process.chdir(targetRoot);
    delete process.env.INIT_CWD;

    let app;
    try {
      app = await createServer();
      const response = await app.inject({
        method: "GET",
        url: "/api/studio/current-app"
      });

      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.rootPath, targetRoot);
      assert.equal(payload.packageJson.name, "external-target-app");
    } finally {
      if (app) {
        await app.close();
      }
      process.chdir(previousCwd);
      if (previousInitCwd == null) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = previousInitCwd;
      }
    }
  });
});

test("GET /api/studio/current-app honors JSKIT_STUDIO_TARGET_ROOT when server cwd is Studio", async () => {
  await withTemporaryPackageRoot("env-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const response = await app.inject({
        method: "GET",
        url: "/api/studio/current-app"
      });

      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.rootPath, targetRoot);
      assert.equal(payload.packageJson.name, "env-target-app");
    } finally {
      if (app) {
        await app.close();
      }
      if (previousTargetRoot == null) {
        delete process.env.JSKIT_STUDIO_TARGET_ROOT;
      } else {
        process.env.JSKIT_STUDIO_TARGET_ROOT = previousTargetRoot;
      }
    }
  });
});

test("GET /api/studio/bootstrap reports mandatory bootstrap checks", async () => {
  const app = await createServer();
  const response = await app.inject({
    method: "GET",
    url: "/api/studio/bootstrap"
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.checks), true);
  assert.equal(payload.checks.some((check) => check.id === "docker"), true);
  assert.equal(payload.checks.some((check) => check.id === "toolchain-image"), true);
  assert.equal(payload.checks.some((check) => check.id === "mysql-capability"), true);
  assert.equal(payload.checks.some((check) => check.id === "gh-auth"), true);
  assert.equal(payload.checks.some((check) => check.id === "codex-auth"), true);
  assert.equal(payload.checks.some((check) => check.id === "mysql-database"), false);

  await app.close();
});
