import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";

import { createServer, startServer } from "../../server.js";
import { BROWSER_LIFECYCLE_WEBSOCKET_PATH } from "../../server/lib/browserLifecycle.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";
import { WORKSPACE_API_BASE } from "../../server/lib/workspaceRoutes.js";

async function withTemporaryPackageRoot(packageName, callback) {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-projects-"));
  const slug = "smoke_workspace";
  const root = path.join(projectsRoot, slug);
  await mkdir(root, {
    recursive: true
  });
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
    return await callback(root, {
      apiBase: `/api/app/${slug}`,
      projectsRoot,
      slug
    });
  } finally {
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
}

async function withTargetRoot(_targetRoot, workspace, callback) {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-smoke-"));

  let app;
  try {
    app = await createServer({
      authDataRoot,
      projectsRoot: workspace.projectsRoot
    });
    const setup = await app.inject({
      method: "POST",
      payload: {
        email: "owner@example.com",
        password: "owner-password",
        passwordConfirmation: "owner-password"
      },
      url: "/api/auth/setup-owner"
    });
    assert.equal(setup.statusCode, 200);
    const cookie = setup.headers["set-cookie"];
    const authHeaders = {
      cookie: Array.isArray(cookie) ? cookie[0] : cookie
    };
    return await callback(app, authHeaders, workspace.apiBase);
  } finally {
    if (app) {
      await app.close();
    }
    await rm(authDataRoot, {
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

test("protected API routes require Vibe64 login", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-required-"));
  const app = await createServer({
    authDataRoot
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/vibe64/project-type"
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, "vibe64_auth_required");
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
  }
});

test("browser lifecycle WebSocket requires Vibe64 login", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-ws-"));
  const app = await createServer({
    authDataRoot
  });
  try {
    await app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const address = app.server.address();
    const socketUrl = `ws://127.0.0.1:${address.port}${BROWSER_LIFECYCLE_WEBSOCKET_PATH}`;

    const rejected = await connectWebSocket(socketUrl);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.statusCode, 401);

    const setup = await app.inject({
      method: "POST",
      payload: {
        email: "owner@example.com",
        password: "owner-password",
        passwordConfirmation: "owner-password"
      },
      url: "/api/auth/setup-owner"
    });
    assert.equal(setup.statusCode, 200);
    const cookie = setup.headers["set-cookie"];
    const accepted = await connectWebSocket(socketUrl, {
      headers: {
        Cookie: Array.isArray(cookie) ? cookie[0] : cookie
      }
    });
    try {
      assert.equal(accepted.ok, true);
      assert.equal(accepted.message.type, "browser-lifecycle-state");
    } finally {
      accepted.socket.close();
    }
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
  }
});

test("management workspace API lists and creates slugs without global selection", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-workspaces-"));
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-workspaces-"));
  const app = await createServer({
    authDataRoot,
    projectsRoot
  });
  try {
    const blocked = await app.inject({
      method: "GET",
      url: WORKSPACE_API_BASE
    });
    assert.equal(blocked.statusCode, 401);

    const setup = await app.inject({
      method: "POST",
      payload: {
        email: "owner@example.com",
        password: "owner-password",
        passwordConfirmation: "owner-password"
      },
      url: "/api/auth/setup-owner"
    });
    assert.equal(setup.statusCode, 200);
    const cookie = setup.headers["set-cookie"];
    const authHeaders = {
      cookie: Array.isArray(cookie) ? cookie[0] : cookie
    };

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        slug: "alpha_1"
      },
      url: WORKSPACE_API_BASE
    });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().workspace.workspaceRoot, path.join(projectsRoot, "alpha_1"));
    await access(path.join(projectsRoot, "alpha_1"));

    const secondCreated = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        slug: "beta_2"
      },
      url: WORKSPACE_API_BASE
    });
    assert.equal(secondCreated.statusCode, 200);
    assert.equal(secondCreated.json().workspace.workspaceRoot, path.join(projectsRoot, "beta_2"));

    const invalid = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        slug: "Bad.Slug"
      },
      url: WORKSPACE_API_BASE
    });
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().errors[0].code, "vibe64_invalid_workspace_slug");

    const listed = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: WORKSPACE_API_BASE
    });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().workspaces.map((workspace) => workspace.slug), ["alpha_1", "beta_2"]);

    const projectType = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/app/alpha_1/vibe64/project-type"
    });
    assert.equal(projectType.statusCode, 200);
    assert.equal(projectType.json().projectType.status, "missing");

    const savedAlphaProjectType = await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        projectType: "jskit"
      },
      url: "/api/app/alpha_1/vibe64/project-type"
    });
    assert.equal(savedAlphaProjectType.statusCode, 200);
    assert.equal(savedAlphaProjectType.json().projectType.ready, true);

    const betaProjectType = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/app/beta_2/vibe64/project-type"
    });
    assert.equal(betaProjectType.statusCode, 200);
    assert.equal(betaProjectType.json().projectType.status, "missing");
    await access(path.join(projectsRoot, "alpha_1", ".vibe64", "project_type"));
    await assert.rejects(
      access(path.join(projectsRoot, "beta_2", ".vibe64", "project_type"))
    );
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
});

test("started server publishes management mode as the browser entry URL", async () => {
  const app = await startServer({
    host: "127.0.0.1",
    strictPort: false
  });

  try {
    const url = new URL(app.vibe64Url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/app/manage");
  } finally {
    await app.close();
  }
});

function connectWebSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out waiting for WebSocket ${url}`));
    }, 2000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        statusCode: response.statusCode
      });
    });
    socket.once("message", (rawMessage) => {
      clearTimeout(timeout);
      resolve({
        message: JSON.parse(rawMessage.toString()),
        ok: true,
        socket
      });
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test("current-app route reports the selected target root before project type setup", async () => {
  await withTemporaryPackageRoot("external-target-app", async (targetRoot, workspace) => {
    await withTargetRoot(targetRoot, workspace, async (app, authHeaders, apiBase) => {
      const remoteHost = await app.inject({
        headers: {
          ...authHeaders,
          host: "example.com"
        },
        method: "GET",
        url: `${apiBase}/studio/current-app`
      });
      assert.equal(remoteHost.statusCode, 200);
      assert.equal(remoteHost.json().ok, true);

      const response = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `${apiBase}/studio/current-app`
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
  await withTemporaryPackageRoot("configured-target-app", async (targetRoot, workspace) => {
    await withTargetRoot(targetRoot, workspace, async (app, authHeaders, apiBase) => {
      const beforeType = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `${apiBase}/vibe64/project-type`
      });
      assert.equal(beforeType.statusCode, 200);
      assert.equal(beforeType.json().projectType.ready, false);
      assert.equal(beforeType.json().projectType.status, "missing");

      const savedType = await app.inject({
        headers: authHeaders,
        method: "PUT",
        payload: {
          projectType: "jskit"
        },
        url: `${apiBase}/vibe64/project-type`
      });
      assert.equal(savedType.statusCode, 200);
      assert.equal(savedType.json().projectType.ready, true);
      assert.equal(
        await readFile(path.join(targetRoot, ".vibe64", "project_type"), "utf8"),
        "jskit\n"
      );

      const defaults = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `${apiBase}/vibe64/project-config/defaults`
      });
      assert.equal(defaults.statusCode, 200);
      assert.equal(defaults.json().defaults.projectType, "jskit");
      assert.equal(defaults.json().defaults.defaults.github_pr_merge_method, "merge");

      const savedConfig = await app.inject({
        headers: authHeaders,
        method: "PUT",
        payload: {
          values: {
            github_pr_merge_method: "squash",
            jskit_database_runtime: "mysql"
          }
        },
        url: `${apiBase}/vibe64/project-config`
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
  await withTemporaryPackageRoot("session-target-app", async (targetRoot, workspace) => {
    await withTargetRoot(targetRoot, workspace, async (app, authHeaders, apiBase) => {
      const removedIssueSessionRoute = await app.inject({
        headers: authHeaders,
        method: "POST",
        url: `${apiBase}/studio/current-app/issue-sessions`
      });
      assert.equal(removedIssueSessionRoute.statusCode, 404);

      const missingProjectType = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: {},
        url: `${apiBase}/vibe64/sessions`
      });
      assert.equal(missingProjectType.statusCode, 400);
      assert.equal(missingProjectType.json().ok, false);
      assert.equal(missingProjectType.json().errors[0].code, "vibe64_project_type_missing");
    });
  });
});
