import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function withTemporaryGitPackageRoot(packageName, callback) {
  await withTemporaryPackageRoot(packageName, async (targetRoot) => {
    runGit(targetRoot, ["init"]);
    runGit(targetRoot, ["config", "user.name", "Studio Test"]);
    runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
    runGit(targetRoot, ["add", "package.json"]);
    runGit(targetRoot, ["commit", "-m", "Initial commit"]);
    await callback(targetRoot);
  });
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

test("Studio current-app API exposes JSKIT issue sessions from target filesystem state", async () => {
  await withTemporaryGitPackageRoot("session-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const created = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions"
      });

      assert.equal(created.statusCode, 200);
      const createdPayload = created.json();
      assert.equal(createdPayload.ok, true);
      assert.equal(createdPayload.currentStep, "02_worktree_created");

      const list = await app.inject({
        method: "GET",
        url: "/api/studio/current-app/issue-sessions"
      });
      assert.equal(list.statusCode, 200);
      assert.deepEqual(list.json().sessions.map((session) => session.sessionId), [createdPayload.sessionId]);

      const detail = await app.inject({
        method: "GET",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}`
      });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().receipts[0].stepId, "01_session_created");

      const stepped = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/step`,
        payload: {}
      });
      assert.equal(stepped.statusCode, 200);
      assert.equal(stepped.json().currentStep, "03_issue_prompt_rendered");

      const abandoned = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/abandon`,
        payload: {}
      });
      assert.equal(abandoned.statusCode, 200);
      assert.equal(abandoned.json().status, "abandoned");
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

test("Studio issue-session list is read-only and local-only", async () => {
  await withTemporaryGitPackageRoot("session-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const blockedCurrentApp = await app.inject({
        method: "GET",
        url: "/api/studio/current-app",
        headers: {
          host: "example.com"
        }
      });
      assert.equal(blockedCurrentApp.statusCode, 403);
      assert.equal(blockedCurrentApp.json().errors[0].code, "studio_local_request_required");

      const blocked = await app.inject({
        method: "GET",
        url: "/api/studio/current-app/issue-sessions",
        headers: {
          host: "example.com"
        }
      });
      assert.equal(blocked.statusCode, 403);
      assert.equal(blocked.json().errors[0].code, "studio_local_request_required");

      const response = await app.inject({
        method: "GET",
        url: "/api/studio/current-app/issue-sessions"
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().sessions, []);
      await assert.rejects(access(path.join(targetRoot, ".jskit", "sessions")));
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

test("Studio issue-session routes return structured invalid-id failures", async () => {
  await withTemporaryGitPackageRoot("session-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const response = await app.inject({
        method: "GET",
        url: "/api/studio/current-app/issue-sessions/not-valid"
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().ok, false);
      assert.equal(response.json().errors[0].code, "invalid_session_id");
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
