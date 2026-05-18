import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../server.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

async function withTemporaryPackageRoot(packageName, callback) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-studio-target-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: packageName,
      private: true,
      scripts: {
        test: "echo ok"
      },
      version: "0.0.0"
    }, null, 2),
    "utf8"
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

async function withTargetRoot(targetRoot, callback) {
  const previousTargetRoot = process.env.AI_STUDIO_TARGET_ROOT;
  process.env.AI_STUDIO_TARGET_ROOT = targetRoot;

  let app;
  try {
    app = await createServer();
    return await callback(app);
  } finally {
    if (app) {
      await app.close();
    }
    if (previousTargetRoot == null) {
      delete process.env.AI_STUDIO_TARGET_ROOT;
    } else {
      process.env.AI_STUDIO_TARGET_ROOT = previousTargetRoot;
    }
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

test("current-app route reports the selected target root before project type setup", async () => {
  await withTemporaryPackageRoot("external-target-app", async (targetRoot) => {
    await withTargetRoot(targetRoot, async (app) => {
      const blocked = await app.inject({
        headers: {
          host: "example.com"
        },
        method: "GET",
        url: "/api/studio/current-app"
      });
      assert.equal(blocked.statusCode, 403);
      assert.equal(blocked.json().errors[0].code, "studio_local_request_required");

      const response = await app.inject({
        method: "GET",
        url: "/api/studio/current-app"
      });
      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.root, targetRoot);
      assert.equal(payload.ready, false);
      assert.equal(payload.projectType.status, "missing");
    });
  });
});

test("AI Studio project routes persist project type and plain-file config", async () => {
  await withTemporaryPackageRoot("configured-target-app", async (targetRoot) => {
    await withTargetRoot(targetRoot, async (app) => {
      const beforeType = await app.inject({
        method: "GET",
        url: "/api/ai-studio/project-type"
      });
      assert.equal(beforeType.statusCode, 200);
      assert.equal(beforeType.json().projectType.ready, false);
      assert.equal(beforeType.json().projectType.status, "missing");

      const savedType = await app.inject({
        method: "PUT",
        payload: {
          projectType: "jskit"
        },
        url: "/api/ai-studio/project-type"
      });
      assert.equal(savedType.statusCode, 200);
      assert.equal(savedType.json().projectType.ready, true);
      assert.equal(
        await readFile(path.join(targetRoot, ".ai-studio", "project_type"), "utf8"),
        "jskit\n"
      );

      const defaults = await app.inject({
        method: "GET",
        url: "/api/ai-studio/project-config/defaults"
      });
      assert.equal(defaults.statusCode, 200);
      assert.equal(defaults.json().defaults.projectType, "jskit");
      assert.equal(defaults.json().defaults.defaults.github_pr_merge_method, "merge");
      assert.equal(defaults.json().defaults.defaults.enable_recursive_ai_studio_opening, false);

      const savedConfig = await app.inject({
        method: "PUT",
        payload: {
          values: {
            enable_recursive_ai_studio_opening: true,
            github_pr_merge_method: "squash",
            jskit_database_runtime: "mysql",
            jskit_tenancy_mode: "personal",
            recursive_ai_studio_local_jskit_ai_root: ""
          }
        },
        url: "/api/ai-studio/project-config"
      });
      assert.equal(savedConfig.statusCode, 200);
      assert.equal(savedConfig.json().config.ready, true);
      assert.equal(
        await readFile(path.join(targetRoot, ".ai-studio", "config", "github_pr_merge_method"), "utf8"),
        "squash\n"
      );
      assert.equal(
        await readFile(path.join(targetRoot, ".ai-studio", "config", "enable_recursive_ai_studio_opening"), "utf8"),
        "true\n"
      );
    });
  });
});

test("AI Studio session creation returns a setup gate instead of using legacy issue-session routes", async () => {
  await withTemporaryPackageRoot("session-target-app", async (targetRoot) => {
    await withTargetRoot(targetRoot, async (app) => {
      const legacy = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions"
      });
      assert.equal(legacy.statusCode, 404);

      const missingProjectType = await app.inject({
        method: "POST",
        payload: {},
        url: "/api/ai-studio/sessions"
      });
      assert.equal(missingProjectType.statusCode, 400);
      assert.equal(missingProjectType.json().ok, false);
      assert.equal(missingProjectType.json().errors[0].code, "ai_studio_project_type_missing");
    });
  });
});
