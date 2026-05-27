import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer, startServer } from "../../server.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

async function withTemporaryPackageRoot(packageName, callback) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-target-"));
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
  const previousTargetRoot = process.env.VIBE64_TARGET_ROOT;
  process.env.VIBE64_TARGET_ROOT = targetRoot;

  let app;
  try {
    app = await createServer();
    return await callback(app);
  } finally {
    if (app) {
      await app.close();
    }
    if (previousTargetRoot == null) {
      delete process.env.VIBE64_TARGET_ROOT;
    } else {
      process.env.VIBE64_TARGET_ROOT = previousTargetRoot;
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

test("started server publishes home as the browser entry URL", async () => {
  const app = await startServer({
    host: "127.0.0.1",
    strictPort: false
  });

  try {
    const url = new URL(app.vibe64Url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/home");
  } finally {
    await app.close();
  }
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

test("Vibe64 project routes persist project type and plain-file config", async () => {
  await withTemporaryPackageRoot("configured-target-app", async (targetRoot) => {
    await withTargetRoot(targetRoot, async (app) => {
      const beforeType = await app.inject({
        method: "GET",
        url: "/api/vibe64/project-type"
      });
      assert.equal(beforeType.statusCode, 200);
      assert.equal(beforeType.json().projectType.ready, false);
      assert.equal(beforeType.json().projectType.status, "missing");

      const savedType = await app.inject({
        method: "PUT",
        payload: {
          projectType: "jskit"
        },
        url: "/api/vibe64/project-type"
      });
      assert.equal(savedType.statusCode, 200);
      assert.equal(savedType.json().projectType.ready, true);
      assert.equal(
        await readFile(path.join(targetRoot, ".vibe64", "project_type"), "utf8"),
        "jskit\n"
      );

      const defaults = await app.inject({
        method: "GET",
        url: "/api/vibe64/project-config/defaults"
      });
      assert.equal(defaults.statusCode, 200);
      assert.equal(defaults.json().defaults.projectType, "jskit");
      assert.equal(defaults.json().defaults.defaults.github_pr_merge_method, "merge");

      const savedConfig = await app.inject({
        method: "PUT",
        payload: {
          values: {
            github_pr_merge_method: "squash",
            jskit_database_runtime: "mysql"
          }
        },
        url: "/api/vibe64/project-config"
      });
      assert.equal(savedConfig.statusCode, 200);
      assert.equal(savedConfig.json().config.ready, true);
      assert.equal(
        await readFile(path.join(targetRoot, ".vibe64", "config", "github_pr_merge_method"), "utf8"),
        "squash\n"
      );
    });
  });
});

test("Vibe64 session creation returns a setup gate and removed issue-session routes stay unavailable", async () => {
  await withTemporaryPackageRoot("session-target-app", async (targetRoot) => {
    await withTargetRoot(targetRoot, async (app) => {
      const removedIssueSessionRoute = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions"
      });
      assert.equal(removedIssueSessionRoute.statusCode, 404);

      const missingProjectType = await app.inject({
        method: "POST",
        payload: {},
        url: "/api/vibe64/sessions"
      });
      assert.equal(missingProjectType.statusCode, 400);
      assert.equal(missingProjectType.json().ok, false);
      assert.equal(missingProjectType.json().errors[0].code, "vibe64_project_type_missing");
    });
  });
});
