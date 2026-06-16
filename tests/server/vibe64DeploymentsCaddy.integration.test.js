import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  createCaddyRouteMaterializer
} from "../../packages/vibe64-deployments/src/server/caddyRouteMaterializer.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);
const CADDY_INTEGRATION_ENV = "VIBE64_TEST_CADDY";
const CADDY_IMAGE = "caddy:2";
const TEST_HOSTNAME = "caddy-smoke.example.com";

test("Vibe64 generated Caddy config routes to a published upstream", {
  skip: caddyIntegrationEnabled()
    ? false
    : `Set ${CADDY_INTEGRATION_ENV}=1 to run the Docker/Caddy integration smoke test.`
}, async () => {
  await withTemporaryRoot(async (root) => {
    const upstream = createServer((request, response) => {
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8"
      });
      response.end(`upstream ok ${request.url}`);
    });
    await listen(upstream, 0);
    const upstreamPort = serverPort(upstream);
    const caddyPort = await availablePort();
    const context = deploymentTestContext(root, "beepollen");
    const state = publishedDeploymentState({
      hostname: TEST_HOSTNAME,
      upstreamPort
    });
    const route = await createCaddyRouteMaterializer().materializeProject(context, state);
    const caddyfilePath = path.join(root, "Caddyfile");
    const caddyDataRoot = path.join(root, "caddy-data");
    const caddyConfigRoot = path.join(root, "caddy-config");
    const containerName = dockerContainerName();

    await Promise.all([
      mkdir(caddyDataRoot, {
        recursive: true
      }),
      mkdir(caddyConfigRoot, {
        recursive: true
      }),
      writeFile(caddyfilePath, localCaddyfile({
        caddyPort,
        route
      }), "utf8")
    ]);

    try {
      await dockerRunCaddy({
        caddyConfigRoot,
        caddyDataRoot,
        caddyfilePath,
        containerName,
        root
      });

      const response = await waitFor(async () => {
        return curlResolvedHost({
          hostname: TEST_HOSTNAME,
          pathName: "/probe?from=caddy",
          port: caddyPort
        });
      });
      assert.match(response, /HTTP\/1\.1 200 OK/u);
      assert.match(response, /\r?\nVia: 1\.1 Caddy\r?\n/iu);
      assert.match(response, /upstream ok \/probe\?from=caddy/u);

      const accessLog = await waitFor(async () => {
        const text = await readFile(route.accessLogPath, "utf8");
        assert.match(text, /"status":200/u);
        return text;
      });
      assert.match(accessLog, new RegExp(`"host":"${escapeRegExp(TEST_HOSTNAME)}:${caddyPort}"`, "u"));
      assert.match(accessLog, /"uri":"\/probe\?from=caddy"/u);
    } finally {
      await Promise.all([
        closeServer(upstream),
        dockerRemove(containerName)
      ]);
    }
  });
});

function caddyIntegrationEnabled() {
  return process.env[CADDY_INTEGRATION_ENV] === "1";
}

function deploymentTestContext(root, slug) {
  const projectsRoot = path.join(root, "projects");
  const targetRoot = path.join(projectsRoot, slug);
  return {
    projectLocalRoot: path.join(targetRoot, ".vibe64-local"),
    projectStateRoot: path.join(targetRoot, ".vibe64"),
    projectsRoot,
    slug,
    systemRoot: path.join(projectsRoot, ".vibe64-demon"),
    targetRoot
  };
}

function publishedDeploymentState({
  hostname = TEST_HOSTNAME,
  upstreamPort = 0
} = {}) {
  return {
    currentRelease: {
      container: {
        loopbackBaseUrl: `http://127.0.0.1:${upstreamPort}`
      },
      publicHost: "beepollen.users.vibe64.dev",
      releaseId: "release-caddy-smoke",
      status: "published"
    },
    domains: [
      {
        hostname,
        verificationStatus: "verified"
      }
    ],
    project: {
      slug: "beepollen"
    },
    publicName: {
      publicHost: "beepollen.users.vibe64.dev",
      publicName: "beepollen"
    }
  };
}

function localCaddyfile({
  caddyPort = 0,
  route = {}
} = {}) {
  return [
    "{",
    "  admin off",
    "  auto_https off",
    "}",
    "",
    `import ${route.snippetPath}`,
    "",
    `http://${TEST_HOSTNAME}:${caddyPort} {`,
    `  import vibe64_published_app ${route.target} ${JSON.stringify(route.accessLogPath)}`,
    "}",
    ""
  ].join("\n");
}

async function dockerRunCaddy({
  caddyConfigRoot = "",
  caddyDataRoot = "",
  caddyfilePath = "",
  containerName = "",
  root = ""
} = {}) {
  await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "--network",
    "host",
    ...dockerUserArgs(),
    "-v",
    `${root}:${root}`,
    "-v",
    `${caddyDataRoot}:/data`,
    "-v",
    `${caddyConfigRoot}:/config`,
    "-v",
    `${caddyfilePath}:/etc/caddy/Caddyfile:ro`,
    CADDY_IMAGE,
    "caddy",
    "run",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile"
  ], {
    timeout: 180_000
  });
}

function dockerUserArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return ["--user", `${process.getuid()}:${process.getgid()}`];
}

async function dockerRemove(containerName = "") {
  if (!containerName) {
    return;
  }
  try {
    await execFileAsync("docker", ["rm", "-f", containerName], {
      timeout: 30_000
    });
  } catch {
    // The container may already be gone after a failed start.
  }
}

async function curlResolvedHost({
  hostname = TEST_HOSTNAME,
  pathName = "/",
  port = 0
} = {}) {
  const result = await execFileAsync("curl", [
    "--silent",
    "--show-error",
    "--include",
    "--max-time",
    "5",
    "--resolve",
    `${hostname}:${port}:127.0.0.1`,
    `http://${hostname}:${port}${pathName}`
  ], {
    maxBuffer: 1024 * 1024,
    timeout: 10_000
  });
  return result.stdout;
}

async function availablePort() {
  const server = createServer();
  await listen(server, 0);
  const port = serverPort(server);
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function serverPort(server) {
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  return address.port;
}

async function waitFor(operation, {
  intervalMs = 200,
  timeoutMs = 10_000
} = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
    }
  }
  throw lastError || new Error("Timed out waiting for operation.");
}

function dockerContainerName() {
  return `vibe64-caddy-smoke-${process.pid}-${Date.now()}`;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
