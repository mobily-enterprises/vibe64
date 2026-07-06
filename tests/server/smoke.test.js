import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { createServer, resolveListenTarget, startServer } from "../../server.js";
import { loadRuntimeEnvFiles, resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

async function withTemporaryPackageRoot(packageName, callback) {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-projects-"));
  const slug = "smoke_project";
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

async function withTargetRoot(targetRoot, projectFixture, callback) {
  const systemRoot = await mkdtemp(path.join(tmpdir(), "vibe64-demon-smoke-"));

  let app;
  try {
    app = await createServer({
      projectsRoot: projectFixture.projectsRoot,
      systemRoot,
      targetRoot
    });
    return await callback(app, {}, projectFixture.apiBase, systemRoot);
  } finally {
    if (app) {
      await app.close();
    }
    await rm(systemRoot, {
      force: true,
      recursive: true
    });
  }
}

test("server defaults to loopback host", () => {
  const previousHost = process.env.HOST;
  const previousPort = process.env.PORT;
  delete process.env.HOST;
  delete process.env.PORT;
  try {
    assert.equal(resolveRuntimeEnv().HOST, "127.0.0.1");
    assert.equal(resolveRuntimeEnv().PORT, null);
    assert.equal(resolveListenTarget().transport, "socket");
  } finally {
    if (previousHost == null) {
      delete process.env.HOST;
    } else {
      process.env.HOST = previousHost;
    }
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

test("runtime env files load broadly while runtime config stays explicit", async () => {
  const keys = [
    "HOST",
    "PORT",
    VIBE64_RUNTIME_NAMESPACE_ENV,
    VIBE64_PROJECTS_ROOT_ENV,
    VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
    VIBE64_SYSTEM_ROOT_ENV,
    "VIBE64_LISTEN_SOCKET"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const envRoot = await mkdtemp(path.join(tmpdir(), "vibe64-runtime-env-"));
  const appEnvFile = path.join(envRoot, ".env");
  const hostEnvFile = path.join(envRoot, "vibe64.env");

  try {
    for (const key of keys) {
      delete process.env[key];
    }
    await writeFile(appEnvFile, [
      "HOST=0.0.0.0",
      "PORT=3939",
      `${VIBE64_RUNTIME_NAMESPACE_ENV}=unit-owner`,
      `${VIBE64_PROJECTS_ROOT_ENV}=/tmp/vibe64-file-projects-root`,
      "VIBE64_LISTEN_SOCKET=/tmp/vibe64-file.sock"
    ].join("\n"), "utf8");
    await writeFile(hostEnvFile, [
      `${VIBE64_SYSTEM_ROOT_ENV}=/tmp/vibe64-file-system-root`
    ].join("\n"), "utf8");

    loadRuntimeEnvFiles({
      appEnvFile,
      hostEnvFile
    });

    assert.equal(process.env.HOST, "0.0.0.0");
    assert.equal(process.env.PORT, "3939");
    assert.equal(process.env[VIBE64_PROJECTS_ROOT_ENV], "/tmp/vibe64-file-projects-root");
    assert.equal(process.env[VIBE64_SYSTEM_ROOT_ENV], "/tmp/vibe64-file-system-root");
    assert.equal(process.env.VIBE64_LISTEN_SOCKET, "/tmp/vibe64-file.sock");

    const runtimeEnv = resolveRuntimeEnv();
    assert.equal(runtimeEnv.HOST, "0.0.0.0");
    assert.equal(runtimeEnv.PORT, 3939);
    assert.equal(runtimeEnv[VIBE64_PROJECTS_ROOT_ENV], "/tmp/vibe64-file-projects-root");
    assert.equal(runtimeEnv[VIBE64_SYSTEM_ROOT_ENV], undefined);
    assert.equal(runtimeEnv.VIBE64_LISTEN_SOCKET, undefined);

    process.env[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV] = "1";
    const selfTargetRuntimeEnv = resolveRuntimeEnv();
    assert.equal(selfTargetRuntimeEnv[VIBE64_SYSTEM_ROOT_ENV], "/tmp/vibe64-file-system-root");
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(envRoot, {
      force: true,
      recursive: true
    });
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

test("local single-folder server redirects /app to the startup project route", async () => {
  const targetRoot = await mkdtemp(path.join(tmpdir(), "vibe64-local-target-"));
  const systemRoot = await mkdtemp(path.join(tmpdir(), "vibe64-local-system-"));
  const app = await createServer({
    runtimeMode: "local",
    startupSlug: "local-target",
    systemRoot,
    targetRoot
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/app?from=test"
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/app/project/local-target?from=test");
  } finally {
    await app.close();
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
    await rm(systemRoot, {
      force: true,
      recursive: true
    });
  }
});

test("composed server does not redirect /app through local startup routing", async () => {
  const systemRoot = await mkdtemp(path.join(tmpdir(), "vibe64-composed-system-"));
  const app = await createServer({
    runtimeProfile: Object.freeze({
      authRequired: false,
      local: false,
      mode: "composed",
      projectCatalogEnabled: true,
      singleTargetRoot: ""
    }),
    startupSlug: "local-target",
    systemRoot
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/app"
    });

    assert.notEqual(response.statusCode, 302);
    assert.notEqual(response.headers.location, "/app/project/local-target");
  } finally {
    await app.close();
    await rm(systemRoot, {
      force: true,
      recursive: true
    });
  }
});

test("started server publishes the local app entry URL", async () => {
  const app = await startServer({
    host: "127.0.0.1",
    port: 0,
    strictPort: false
  });

  try {
    const url = new URL(app.vibe64Url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/app");
  } finally {
    await app.close();
  }
});

test("started server defaults to Unix socket when PORT is not set", async () => {
  const previousPort = process.env.PORT;
  const socketRoot = await mkdtemp(path.join(tmpdir(), "vibe64-listen-socket-"));
  const socketPath = path.join(socketRoot, "server.sock");
  delete process.env.PORT;
  const app = await startServer({
    listenSocket: socketPath,
    publicOrigin: "https://tonymobily.vibe64.dev",
    startupSlug: "beepollen"
  });

  try {
    assert.equal(app.vibe64Listen.transport, "socket");
    assert.equal(app.vibe64Listen.socketPath, socketPath);
    assert.equal(app.vibe64Url, "https://tonymobily.vibe64.dev/app/project/beepollen");
    await access(socketPath);
  } finally {
    await app.close();
    await rm(socketRoot, {
      force: true,
      recursive: true
    });
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
test("current-app route reports the selected target root before project type is selected", async () => {
  await withTemporaryPackageRoot("external-target-app", async (targetRoot, projectFixture) => {
    await withTargetRoot(targetRoot , projectFixture, async (app, authHeaders, apiBase) => {
      const remoteHost = await app.inject({
        headers: {
          ...authHeaders,
          host: "example.com"
        },
        method: "GET",
        url: `${apiBase}/studio/current-app`
      });
      assert.equal(remoteHost.statusCode, 403);

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
  await withTemporaryPackageRoot("configured-target-app", async (targetRoot, projectFixture) => {
    await withTargetRoot(targetRoot , projectFixture, async (app, authHeaders, apiBase) => {
      const stateRoot = path.join(targetRoot, ".vibe64");
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
        await readFile(path.join(stateRoot, "project_type"), "utf8"),
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
      assert.equal(
        defaults.json().defaults.fields.some((field) => field.id === "deploy_production_command"),
        false
      );
      assert.equal(
        defaults.json().defaults.fields.some((field) => field.id === "deploy_staging_command"),
        false
      );

      const savedConfig = await app.inject({
        headers: authHeaders,
        method: "PUT",
        payload: {
          values: {
            github_pr_merge_method: "rebase",
            jskit_database_runtime: "mysql"
          }
        },
        url: `${apiBase}/vibe64/project-config`
      });
      assert.equal(savedConfig.statusCode, 200);
      assert.equal(savedConfig.json().config.ready, true);
      assert.equal(
        await readFile(path.join(stateRoot, "config", "github_pr_merge_method"), "utf8"),
        "rebase\n"
      );
      assert.equal(
        await readFile(path.join(stateRoot, "config", "jskit_database_runtime"), "utf8"),
        "mysql\n"
      );
      assert.deepEqual(
        savedConfig.json().config.runtimeLock.selected.services.map((entry) => entry.id),
        ["mysql-8.0"]
      );
      const runtimeLock = JSON.parse(await readFile(path.join(stateRoot, "runtime.lock.json"), "utf8"));
      assert.equal(runtimeLock.adapter.id, "jskit");
      assert.equal(runtimeLock.project.projectType, "jskit");
      assert.deepEqual(runtimeLock.selected.tools.map((entry) => entry.id), ["nodejs-22"]);
      assert.deepEqual(runtimeLock.selected.services.map((entry) => entry.id), ["mysql-8.0"]);
    });
  });
});

test("Vibe64 session creation returns a setup gate and removed issue-session routes stay unavailable", async () => {
  await withTemporaryPackageRoot("session-target-app", async (targetRoot, projectFixture) => {
    await withTargetRoot(targetRoot , projectFixture, async (app, authHeaders, apiBase) => {
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
