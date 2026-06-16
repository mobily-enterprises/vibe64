import net from "node:net";
import { copyFile, mkdir, readlink, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  gitToolchainMountArgs
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  runHostCommand,
  hostUserIdentityEnvArgs,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  ensureRuntimeContainers,
  ensureTargetRuntimeNetwork,
  runtimeContainersTerminalEnv,
  runtimeDockerNamePrefix,
  runtimeTargetName,
  runtimeNetworkName,
  targetRuntimeNetworkDockerArgs
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  studioDaemonDockerLabels,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const RELEASE_CONTAINER_KIND = "published-release";
const RELEASE_CONTAINER_PORT = 4100;
const RELEASE_RESTART_POLICY = "on-failure:5";
const RELEASE_LOG_MAX_SIZE = "10m";
const RELEASE_LOG_MAX_FILE = "5";
const RELEASE_ARTIFACT_DIR = "artifact";
const RELEASE_WORKSPACE_DIR = "workspace";
const PHASE_TIMEOUT_MS = 10 * 60 * 1000;
const WORKSPACE_SNAPSHOT_EXCLUDED_ROOTS = new Set([
  ".git",
  ".vibe64",
  ".vibe64-local"
]);

function createDeploymentRunner({
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  runCommand = runHostCommand
} = {}) {
  async function runPublishPhase({
    command = {},
    context = {},
    env = {},
    phaseId = "",
    release = {},
    store
  } = {}) {
    if (!command?.command) {
      return phaseSkipped(phaseId);
    }
    const startedAt = new Date().toISOString();
    const result = await runCommand("docker", phaseDockerArgs({
      command,
      context,
      env,
      image,
      phaseId,
      releaseId: release.releaseId
    }), {
      cwd: context.targetRoot,
      timeout: PHASE_TIMEOUT_MS
    });
    await store.writeReleaseLog(context, release.releaseId, phaseId, result.output);
    const phase = phaseResult({
      command,
      phaseId,
      result,
      startedAt
    });
    if (!result.ok) {
      throw phaseError(phase);
    }
    return phase;
  }

  async function startReleaseContainer({
    context = {},
    env = {},
    release = {}
  } = {}) {
    const startedAt = new Date().toISOString();
    const loopbackPort = await allocateLoopbackPort();
    const container = releaseContainerRecord({
      context,
      image,
      loopbackPort,
      release
    });
    const result = await runCommand("docker", releaseContainerDockerArgs({
      container,
      context,
      env,
      image,
      release
    }), {
      cwd: context.targetRoot,
      timeout: 30_000
    });
    if (!result.ok) {
      throw phaseError(phaseResult({
        command: release.serve,
        phaseId: "start",
        result,
        startedAt: new Date().toISOString()
      }));
    }
    return {
      ...container,
      containerId: String(result.stdout || result.output || "").trim(),
      startedAt
    };
  }

  async function healthCheckRelease({
    container = {},
    release = {}
  } = {}) {
    const startedAt = new Date().toISOString();
    const result = await runCommand(process.execPath, [
      "-e",
      httpHealthProbeScript(),
      `${container.loopbackBaseUrl}${healthPath(release.health)}`,
      String(healthTimeoutMs(release.health))
    ], {
      timeout: healthTimeoutMs(release.health)
    });
    const health = {
      checkedAt: new Date().toISOString(),
      ok: result.ok,
      output: result.output,
      path: healthPath(release.health),
      startedAt
    };
    if (!result.ok) {
      throw phaseError({
        exitCode: result.exitCode,
        finishedAt: health.checkedAt,
        id: "health",
        message: result.output || "Release health check failed.",
        ok: false,
        startedAt
      });
    }
    return health;
  }

  async function publish({
    context = {},
    publishPlan = {},
    store
  } = {}) {
    if (publishPlan?.ok === false) {
      throw vibe64Error(
        publishPlan.message || "The selected adapter cannot publish this project.",
        "vibe64_publish_plan_not_ready"
      );
    }
    if (!publishPlan?.serve?.command) {
      throw vibe64Error(
        "The selected adapter did not provide a serve command for publishing.",
        "vibe64_publish_serve_command_missing"
      );
    }

    const {
      manifest,
      releaseRoot
    } = await store.beginRelease(context, {
      publishPlan
    });
    const phases = [];
    let startedContainer = null;
    try {
      await ensureTargetRuntimeNetwork(context.targetRoot, {
        runCommand
      });
      const runtimePhase = await ensureRuntimeServices({
        context,
        publishPlan
      });
      phases.push(runtimePhase);

      const env = await runtimeContainersTerminalEnv(publishPlan.runtimeServices, {
        adapterId: publishPlan.adapterId,
        context,
        targetRoot: context.targetRoot
      });

      for (const phase of [
        {
          command: publishPlan.build,
          id: "build"
        },
        {
          command: publishPlan.migrate,
          id: "migrate"
        }
      ]) {
        const result = await runPublishPhase({
          command: phase.command,
          context,
          env,
          phaseId: phase.id,
          release: manifest,
          store
        });
        phases.push(result);
      }

      const snapshot = await createReleaseWorkspaceSnapshot({
        context,
        releaseRoot
      });
      await store.writeReleaseLog(context, manifest.releaseId, "artifact", snapshot.phase.message);
      phases.push(snapshot.phase);
      const runtimeRelease = await store.updateRelease(context, manifest.releaseId, {
        artifact: snapshot.artifact
      });

      startedContainer = await startReleaseContainer({
        context,
        env,
        release: runtimeRelease
      });
      await store.writeReleaseLog(context, manifest.releaseId, "start", startedContainer.containerId);
      phases.push({
        finishedAt: new Date().toISOString(),
        id: "start",
        message: `Started ${startedContainer.containerName}.`,
        ok: true,
        startedAt: startedContainer.startedAt
      });
      const health = await healthCheckRelease({
        container: startedContainer,
        release: runtimeRelease
      });
      await store.writeReleaseLog(context, manifest.releaseId, "health", health.output);
      phases.push({
        finishedAt: health.checkedAt,
        id: "health",
        message: health.output || "Release health check passed.",
        ok: true,
        startedAt: health.startedAt
      });

      return store.publishRelease(context, manifest.releaseId, {
        container: startedContainer,
        health,
        phases
      });
    } catch (error) {
      const cleanupPhase = await cleanupStartedReleaseContainer({
        container: startedContainer,
        context
      });
      if (cleanupPhase) {
        phases.push(cleanupPhase);
        await store.writeReleaseLog(context, manifest.releaseId, "cleanup", cleanupPhase.message);
      }
      await store.failRelease(context, manifest.releaseId, {
        error: failedReleaseMessage(error, cleanupPhase),
        phases
      });
      throw error;
    }
  }

  async function createReleaseWorkspaceSnapshot({
    context = {},
    releaseRoot = ""
  } = {}) {
    const startedAt = new Date().toISOString();
    const sourceRoot = path.resolve(String(context.targetRoot || ""));
    const artifactRoot = path.join(requiredPath(releaseRoot, "releaseRoot"), RELEASE_ARTIFACT_DIR);
    const workspacePath = path.join(artifactRoot, RELEASE_WORKSPACE_DIR);
    await rm(workspacePath, {
      force: true,
      recursive: true
    });
    await mkdir(artifactRoot, {
      recursive: true
    });
    await copyWorkspaceSnapshot(sourceRoot, workspacePath);
    return {
      artifact: {
        kind: "workspace-snapshot",
        path: path.relative(releaseRoot, workspacePath),
        sourceRoot,
        workspacePath
      },
      phase: {
        command: "copy workspace snapshot",
        finishedAt: new Date().toISOString(),
        id: "artifact",
        message: `Copied release workspace to ${workspacePath}.`,
        ok: true,
        startedAt
      }
    };
  }

  async function cleanupStartedReleaseContainer({
    container = null,
    context = {}
  } = {}) {
    if (!container?.containerName) {
      return null;
    }
    const startedAt = new Date().toISOString();
    const result = await runCommand("docker", [
      "rm",
      "-f",
      container.containerName
    ], {
      cwd: context.targetRoot,
      timeout: 30_000
    });
    return phaseResult({
      command: {
        command: `docker rm -f ${container.containerName}`
      },
      phaseId: "cleanup",
      result,
      startedAt
    });
  }

  async function ensureRuntimeServices({
    context = {},
    publishPlan = {}
  } = {}) {
    const startedAt = new Date().toISOString();
    const results = await ensureRuntimeContainers(publishPlan.runtimeServices, {
      adapterId: publishPlan.adapterId,
      context,
      runCommand,
      targetRoot: context.targetRoot
    });
    return {
      finishedAt: new Date().toISOString(),
      id: "runtime_services",
      message: results.length ? "Runtime services are ready." : "No runtime services required.",
      ok: true,
      resultCount: results.length,
      startedAt
    };
  }

  return Object.freeze({
    publish
  });
}

function phaseSkipped(phaseId = "") {
  const now = new Date().toISOString();
  return {
    finishedAt: now,
    id: phaseId,
    message: "Phase not required by adapter publish plan.",
    ok: true,
    skipped: true,
    startedAt: now
  };
}

function phaseResult({
  command = {},
  phaseId = "",
  result = {},
  startedAt = ""
} = {}) {
  return {
    command: command.command || "",
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    id: phaseId,
    message: result.output || "",
    ok: result.ok === true,
    startedAt
  };
}

function phaseError(phase = {}) {
  const error = vibe64Error(
    phase.message || `Deployment phase failed: ${phase.id || "unknown"}.`,
    "vibe64_deployment_phase_failed"
  );
  error.phase = phase;
  return error;
}

function failedReleaseMessage(error, cleanupPhase = null) {
  const message = String(error?.message || error || "Deployment failed.");
  if (!cleanupPhase || cleanupPhase.ok === true) {
    return message;
  }
  return `${message}\nRelease container cleanup failed: ${cleanupPhase.message || "unknown error"}`;
}

function requiredPath(value = "", label = "path") {
  const pathValue = String(value || "").trim();
  if (!pathValue) {
    throw vibe64Error(`Deployment release requires ${label}.`, "vibe64_deployment_path_missing");
  }
  return pathValue;
}

function envDockerArgs(env = {}) {
  return Object.entries(env && typeof env === "object" && !Array.isArray(env) ? env : {})
    .filter(([key]) => normalizeText(key))
    .flatMap(([key, value]) => ["-e", `${normalizeText(key)}=${String(value ?? "")}`]);
}

function baseRunLabels({
  context = {},
  releaseId = ""
} = {}) {
  return [
    studioDockerLabel("kind", RELEASE_CONTAINER_KIND),
    studioDockerLabel("target", runtimeTargetName(context.targetRoot)),
    studioDockerLabel("release", releaseId),
    ...studioDaemonDockerLabels()
  ];
}

function phaseContainerName({
  context = {},
  phaseId = "",
  releaseId = ""
} = {}) {
  return [
    runtimeDockerNamePrefix(context.targetRoot),
    "publish",
    releaseId,
    phaseId
  ].filter(Boolean).join("-");
}

function phaseDockerArgs({
  command = {},
  context = {},
  env = {},
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  phaseId = "",
  releaseId = ""
} = {}) {
  const networkArgs = command.networkEnv === true
    ? targetRuntimeNetworkDockerArgs(context.targetRoot)
    : [];
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "--rm",
    "--name",
    phaseContainerName({
      context,
      phaseId,
      releaseId
    }),
    ...baseRunLabels({
      context,
      releaseId
    }).flatMap((label) => ["--label", label]),
    ...networkArgs,
    ...gitToolchainMountArgs(context.targetRoot),
    "-v",
    `${path.resolve(context.targetRoot)}:/workspace`,
    "-v",
    `${path.resolve(context.targetRoot)}:${path.resolve(context.targetRoot)}`,
    ...hostUserIdentityEnvArgs(),
    ...envDockerArgs(command.networkEnv === true ? env : {}),
    "-w",
    "/workspace",
    image,
    "bash",
    "-lc",
    command.command
  ];
}

function releaseContainerName({
  context = {},
  release = {}
} = {}) {
  return [
    runtimeDockerNamePrefix(context.targetRoot),
    "release",
    release.releaseId
  ].filter(Boolean).join("-");
}

function releaseContainerRecord({
  context = {},
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  loopbackPort = 0,
  release = {}
} = {}) {
  const containerName = releaseContainerName({
    context,
    release
  });
  const hostPort = normalizePort(loopbackPort);
  return {
    containerId: "",
    containerName,
    image,
    internalBaseUrl: `http://${containerName}:${RELEASE_CONTAINER_PORT}`,
    internalHealthUrl: `http://${containerName}:${RELEASE_CONTAINER_PORT}${healthPath(release.health)}`,
    internalHost: containerName,
    internalPort: RELEASE_CONTAINER_PORT,
    loopbackBaseUrl: `http://127.0.0.1:${hostPort}`,
    loopbackHealthUrl: `http://127.0.0.1:${hostPort}${healthPath(release.health)}`,
    loopbackPort: hostPort,
    loopbackProxyTarget: `127.0.0.1:${hostPort}`,
    network: runtimeNetworkName(context.targetRoot),
    restartPolicy: RELEASE_RESTART_POLICY
  };
}

function releaseContainerDockerArgs({
  container = {},
  context = {},
  env = {},
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  release = {}
} = {}) {
  const serveCommand = release.serve?.command || "";
  const workspacePath = releaseWorkspacePath(release);
  return [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
    "-d",
    "--name",
    container.containerName,
    "--restart",
    RELEASE_RESTART_POLICY,
    "--log-driver",
    "json-file",
    "--log-opt",
    `max-size=${RELEASE_LOG_MAX_SIZE}`,
    "--log-opt",
    `max-file=${RELEASE_LOG_MAX_FILE}`,
    "-p",
    `${container.loopbackProxyTarget}:${RELEASE_CONTAINER_PORT}`,
    ...baseRunLabels({
      context,
      releaseId: release.releaseId
    }).flatMap((label) => ["--label", label]),
    ...targetRuntimeNetworkDockerArgs(context.targetRoot),
    "-v",
    `${workspacePath}:/workspace`,
    "-e",
    "HOST=0.0.0.0",
    "-e",
    `PORT=${RELEASE_CONTAINER_PORT}`,
    ...envDockerArgs(env),
    ...hostUserIdentityEnvArgs(),
    "-w",
    "/workspace",
    image,
    "bash",
    "-lc",
    releaseStartupScript(serveCommand)
  ];
}

function releaseWorkspacePath(release = {}) {
  const workspacePath = String(release.artifact?.workspacePath || "").trim();
  if (!workspacePath) {
    throw vibe64Error(
      "Deployment release requires a workspace artifact before the app container can start.",
      "vibe64_deployment_artifact_workspace_missing"
    );
  }
  return path.resolve(workspacePath);
}

function includeWorkspaceSnapshotPath(sourceRoot = "", sourcePath = "") {
  const relativePath = path.relative(sourceRoot, sourcePath);
  if (!relativePath) {
    return true;
  }
  const [rootName] = relativePath.split(path.sep);
  return !WORKSPACE_SNAPSHOT_EXCLUDED_ROOTS.has(rootName);
}

async function copyWorkspaceSnapshot(sourceRoot = "", workspacePath = "") {
  await mkdir(workspacePath, {
    recursive: true
  });
  await copyWorkspaceEntries(path.resolve(sourceRoot), path.resolve(workspacePath), "");
}

async function copyWorkspaceEntries(sourceRoot = "", workspaceRoot = "", relativeDir = "") {
  const sourceDir = path.join(sourceRoot, relativeDir);
  const targetDir = path.join(workspaceRoot, relativeDir);
  await mkdir(targetDir, {
    recursive: true
  });
  const entries = await readdir(sourceDir, {
    withFileTypes: true
  });
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(workspaceRoot, relativePath);
    if (!includeWorkspaceSnapshotPath(sourceRoot, sourcePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyWorkspaceEntries(sourceRoot, workspaceRoot, relativePath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      await symlink(await readlink(sourcePath), targetPath);
      continue;
    }
    if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

function healthPath(health = {}) {
  const pathValue = normalizeText(health?.path || "/") || "/";
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

async function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = Number(address?.port);
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(normalizePort(port));
        } catch (normalizeError) {
          reject(normalizeError);
        }
      });
    });
  });
}

function normalizePort(value = 0) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    throw vibe64Error("Deployment release requires a valid loopback port.", "vibe64_deployment_loopback_port_invalid");
  }
  return port;
}

function healthTimeoutMs(health = {}) {
  return Math.max(1000, Number.parseInt(String(health?.timeoutMs || "30000"), 10) || 30000);
}

function httpHealthProbeScript() {
  return [
    "const href = process.argv[1];",
    "const timeoutMs = Number.parseInt(process.argv[2] || '30000', 10) || 30000;",
    "const deadline = Date.now() + timeoutMs;",
    "async function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }",
    "async function probe() {",
    "  while (Date.now() < deadline) {",
    "    try {",
    "      const response = await fetch(href, { redirect: 'manual' });",
    "      if (response.status < 500) { console.log(`ready ${response.status}`); return; }",
    "    } catch {}",
    "    await sleep(500);",
    "  }",
    "  console.error(`unhealthy ${href}`);",
    "  process.exit(1);",
    "}",
    "probe();"
  ].join("\n");
}

function releaseStartupScript(command = "") {
  const serveCommand = [
    "set -e",
    "export HOST=${HOST:-0.0.0.0}",
    `export PORT=${shellQuote(String(RELEASE_CONTAINER_PORT))}`,
    command
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${VIBE64_HOST_UID:-}\" ] && [ -n \"${VIBE64_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$VIBE64_HOST_UID:$VIBE64_HOST_GID\" /tmp/studio-home",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$VIBE64_HOST_UID" --regid "$VIBE64_HOST_GID" $docker_group_args env HOME=/tmp/studio-home bash -lc ${shellQuote(serveCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home bash -lc ${shellQuote(serveCommand)}`
  ].join("\n");
}

export {
  RELEASE_CONTAINER_PORT,
  RELEASE_LOG_MAX_FILE,
  RELEASE_LOG_MAX_SIZE,
  RELEASE_RESTART_POLICY,
  allocateLoopbackPort,
  createDeploymentRunner,
  releaseContainerDockerArgs
};
