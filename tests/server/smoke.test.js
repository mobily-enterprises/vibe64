import assert from "node:assert/strict";
import { access, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/hostProfile.js";
import { createServer, resolveListenTarget, startServer } from "../../server.js";
import { loadRuntimeEnvFiles, resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

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
    "JSKIT_REALTIME_DEBUG",
    VIBE64_RUNTIME_NAMESPACE_ENV,
    VIBE64_PROJECTS_ROOT_ENV,
    VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
    VIBE64_SYSTEM_ROOT_ENV,
    "VIBE64_LISTEN_SOCKET"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const envRoot = await mkdtemp(path.join(tmpdir(), "vibe64-runtime-env-"));
  const appEnvFile = path.join(envRoot, ".env");

  try {
    for (const key of keys) {
      delete process.env[key];
    }
    await writeFile(appEnvFile, [
      "HOST=0.0.0.0",
      "PORT=3939",
      `${VIBE64_RUNTIME_NAMESPACE_ENV}=unit-owner`,
      `${VIBE64_PROJECTS_ROOT_ENV}=/tmp/vibe64-file-projects-root`,
      "VIBE64_LISTEN_SOCKET=/tmp/vibe64-file.sock",
      `${VIBE64_SYSTEM_ROOT_ENV}=/tmp/vibe64-file-system-root`,
      "JSKIT_REALTIME_DEBUG=1"
    ].join("\n"), "utf8");

    loadRuntimeEnvFiles({
      appEnvFile
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
    assert.equal(runtimeEnv.JSKIT_REALTIME_DEBUG, "1");
    process.env.JSKIT_REALTIME_DEBUG = "0";
    assert.equal(resolveRuntimeEnv().JSKIT_REALTIME_DEBUG, "0");
    delete process.env.JSKIT_REALTIME_DEBUG;
    assert.equal(resolveRuntimeEnv().JSKIT_REALTIME_DEBUG, undefined);

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

test("started server defaults to Unix socket when PORT is not set", async (t) => {
  const previousPort = process.env.PORT;
  const socketRoot = await mkdtemp(path.join(tmpdir(), "vibe64-listen-socket-"));
  const socketPath = path.join(socketRoot, "server.sock");
  delete process.env.PORT;
  t.after(async () => {
    configureVibe64Host(null);
    await rm(socketRoot, {
      force: true,
      recursive: true
    });
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  });
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
    const socketInfo = await lstat(socketPath);
    assert.equal(socketInfo.mode & 0o777, 0o600, "only this user reaches a local server socket");
  } finally {
    await app.close();
  }

  // A host whose OS users share files through a group keeps its group-readable socket.
  const sharedApp = await startServer({
    hostProfile: { sharedGroupAccess: true },
    listenSocket: socketPath,
    publicOrigin: "https://tonymobily.vibe64.dev",
    startupSlug: "beepollen"
  });
  try {
    assert.equal((await lstat(socketPath)).mode & 0o777, 0o660);
  } finally {
    await sharedApp.close();
  }
});
