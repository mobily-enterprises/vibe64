import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function commitMinimalReadyJskitApp(targetRoot) {
  await mkdir(path.join(targetRoot, ".jskit"), { recursive: true });
  await mkdir(path.join(targetRoot, "config"), { recursive: true });
  await mkdir(path.join(targetRoot, "src"), { recursive: true });
  await mkdir(path.join(targetRoot, "packages"), { recursive: true });
  await writeFile(path.join(targetRoot, ".jskit", "lock.json"), JSON.stringify({ packages: [] }, null, 2));
  await writeFile(path.join(targetRoot, "config", "public.js"), "export default {};\n");
  await writeFile(path.join(targetRoot, "src", ".gitkeep"), "");
  await writeFile(path.join(targetRoot, "packages", ".gitkeep"), "");
  runGit(targetRoot, ["add", ".jskit/lock.json", "config/public.js", "src/.gitkeep", "packages/.gitkeep"]);
  runGit(targetRoot, ["commit", "-m", "Add minimal JSKIT app markers"]);
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
    await commitMinimalReadyJskitApp(targetRoot);
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
      const firstSteps = createdPayload.stepDefinitions
        .slice()
        .sort((left, right) => left.index - right.index)
        .slice(0, 5);
      assert.equal(createdPayload.ok, true);
      assert.equal(createdPayload.currentStep, firstSteps[1].id);
      assert.equal(createdPayload.currentStepAction.stepId, firstSteps[1].id);

      const list = await app.inject({
        method: "GET",
        url: "/api/studio/current-app/issue-sessions"
      });
      assert.equal(list.statusCode, 200);
      assert.equal(Array.isArray(list.json().stepDefinitions), true);
      assert.deepEqual(list.json().sessions.map((session) => session.sessionId), [createdPayload.sessionId]);

      const detail = await app.inject({
        method: "GET",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}`
      });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().receipts[0].stepId, firstSteps[0].id);

      const worktreeCreated = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/step`,
        payload: {}
      });
      assert.equal(worktreeCreated.statusCode, 200);
      assert.equal(worktreeCreated.json().currentStep, firstSteps[2].id);
      assert.equal(worktreeCreated.json().currentStepAction.input.type, "none");

      const dependenciesInstalled = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/step`,
        payload: {}
      });
      assert.equal(dependenciesInstalled.statusCode, 200);
      assert.equal(dependenciesInstalled.json().currentStep, firstSteps[3].id);
      assert.equal(dependenciesInstalled.json().currentStepAction.input.name, "prompt");
      await writeFile(path.join(dependenciesInstalled.json().worktree, "session-ui.txt"), "review me\n", "utf8");

      const diff = await app.inject({
        method: "GET",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/diff`
      });
      assert.equal(diff.statusCode, 200);
      assert.equal(diff.json().hasChanges, true);
      assert.match(diff.json().gitStatus, /\?\? session-ui\.txt/);
      assert.match(diff.json().untrackedDiff, /session-ui\.txt/);

      const prompted = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/step`,
        payload: {
          prompt: "Add session UI"
        }
      });
      assert.equal(prompted.statusCode, 200);
      assert.equal(prompted.json().currentStep, firstSteps[4].id);
      assert.equal(prompted.json().currentStepAction.input.fields[0].name, "issueTitle");
      assert.equal(prompted.json().currentStepAction.input.fields[1].name, "issue");
      assert.equal(prompted.json().codex.responseContract.fields[0].field, "issueTitle");
      assert.equal(prompted.json().codex.responseContract.fields[1].field, "issue");
      assert.equal(prompted.json().codex.mode, "inject_prompt");

      const rewound = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/rewind`,
        payload: {
          stepId: "dependencies_installed"
        }
      });
      assert.equal(rewound.statusCode, 200);
      assert.equal(rewound.json().ok, true);
      assert.equal(rewound.json().currentStep, "dependencies_installed");
      assert.equal(rewound.json().dependencyInstall.installed, false);
      assert.deepEqual(rewound.json().completedSteps, ["session_created", "worktree_created"]);

      const abandoned = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${createdPayload.sessionId}/abandon`,
        payload: {}
      });
      assert.equal(abandoned.statusCode, 200);
      assert.equal(abandoned.json().status, "abandoned");

      const listedAfterAbandon = await app.inject({
        method: "GET",
        url: "/api/studio/current-app/issue-sessions"
      });
      assert.equal(listedAfterAbandon.statusCode, 200);
      assert.equal(
        listedAfterAbandon.json().sessions.some((session) => session.sessionId === createdPayload.sessionId),
        false
      );
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

test("Studio issue-session creation is capped at three active sessions", async () => {
  await withTemporaryGitPackageRoot("session-limit-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      for (let index = 0; index < 3; index += 1) {
        const created = await app.inject({
          method: "POST",
          url: "/api/studio/current-app/issue-sessions",
          payload: {}
        });
        assert.equal(created.statusCode, 200);
        assert.equal(created.json().ok, true);
      }

      const blocked = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions",
        payload: {}
      });
      assert.equal(blocked.statusCode, 200);
      assert.equal(blocked.json().ok, false);
      assert.equal(blocked.json().errors[0].code, "open_session_limit");
      assert.equal(blocked.json().limits.openSessionCount, 3);
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

test("Studio issue sessions persist Codex thread ids in session state", async () => {
  await withTemporaryGitPackageRoot("session-codex-thread-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const created = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions",
        payload: {}
      });
      assert.equal(created.statusCode, 200);
      const sessionId = created.json().sessionId;

      const saved = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-thread`,
        payload: {
          threadId: "019e1575-2458-7b93-bf9d-e7d7ffd49ad2"
        }
      });
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.json().codexThreadId, "019e1575-2458-7b93-bf9d-e7d7ffd49ad2");

      const persisted = await readFile(
        path.join(targetRoot, ".jskit", "sessions", "active", sessionId, "codex_thread_id"),
        "utf8"
      );
      assert.equal(persisted, "019e1575-2458-7b93-bf9d-e7d7ffd49ad2\n");

      const rejected = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-thread`,
        payload: {
          threadId: "../not-a-thread"
        }
      });
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.json().ok, false);

      const rejectedVersion = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-thread`,
        payload: {
          threadId: "v0.130.0"
        }
      });
      assert.equal(rejectedVersion.statusCode, 400);
      assert.equal(rejectedVersion.json().ok, false);
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

test("Studio issue sessions persist Codex prompt handoff as plain session values", async () => {
  await withTemporaryGitPackageRoot("session-codex-prompt-handoff-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const created = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions",
        payload: {}
      });
      assert.equal(created.statusCode, 200);
      const sessionId = created.json().sessionId;
      const signature = `${sessionId}:::abc123:42`;

      const saved = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-prompt-handoff`,
        payload: {
          outputStart: "17",
          signature
        }
      });
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.json().codexPromptHandoffOutputStart, 17);
      assert.equal(saved.json().codexPromptHandoffSignature, signature);

      assert.equal(
        await readFile(path.join(targetRoot, ".jskit", "sessions", "active", sessionId, "codex_prompt_handoff_signature"), "utf8"),
        `${signature}\n`
      );
      assert.equal(
        await readFile(path.join(targetRoot, ".jskit", "sessions", "active", sessionId, "codex_prompt_handoff_output_start"), "utf8"),
        "17\n"
      );

      const inspected = await app.inject({
        method: "GET",
        url: `/api/studio/current-app/issue-sessions/${sessionId}`
      });
      assert.equal(inspected.statusCode, 200);
      assert.equal(inspected.json().codexPromptHandoffOutputStart, 17);
      assert.equal(inspected.json().codexPromptHandoffSignature, signature);

      const rejected = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-prompt-handoff`,
        payload: {
          outputStart: "1",
          signature: "other-session:::abc123:42"
        }
      });
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.json().ok, false);
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

test("Studio issue sessions upload temporary Codex attachments outside the target app", async () => {
  await withTemporaryGitPackageRoot("session-attachment-target-app", async (targetRoot) => {
    const previousTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
    process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;

    let app;
    try {
      app = await createServer();
      const created = await app.inject({
        method: "POST",
        url: "/api/studio/current-app/issue-sessions",
        payload: {}
      });
      assert.equal(created.statusCode, 200);
      const sessionId = created.json().sessionId;

      const blocked = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-attachments`,
        payload: {
          dataBase64: Buffer.from("hello").toString("base64"),
          fileName: "mockup.png"
        }
      });
      assert.equal(blocked.statusCode, 400);
      assert.equal(blocked.json().ok, false);

      const stepped = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/step`,
        payload: {}
      });
      assert.equal(stepped.statusCode, 200);
      assert.equal(stepped.json().worktreeReady, true);

      const uploaded = await app.inject({
        method: "POST",
        url: `/api/studio/current-app/issue-sessions/${sessionId}/codex-attachments`,
        payload: {
          contentType: "image/png",
          dataBase64: Buffer.from("hello").toString("base64"),
          fileName: "../mockup image.png"
        }
      });
      assert.equal(uploaded.statusCode, 200);
      assert.equal(uploaded.json().ok, true);
      assert.equal(uploaded.json().fileName, "mockup image.png");
      assert.equal(uploaded.json().size, 5);
      assert.match(uploaded.json().containerPath, /^\/studio-attachments\//);
      assert.doesNotMatch(uploaded.json().containerPath, /\.\./);
      await assert.rejects(access(path.join(targetRoot, "mockup image.png")));
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
  assert.equal(payload.checks.some((check) => check.id === "ripgrep"), true);
  assert.equal(payload.checks.some((check) => check.id === "playwright"), true);
  assert.equal(payload.checks.some((check) => check.id === "gh-auth"), true);
  assert.equal(payload.checks.some((check) => check.id === "codex-auth"), true);
  assert.equal(payload.checks.some((check) => check.id === "mysql-database"), false);

  await app.close();
});
