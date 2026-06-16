import path from "node:path";

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
const PHASE_TIMEOUT_MS = 10 * 60 * 1000;

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
    const container = releaseContainerRecord({
      context,
      image,
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
    const result = await runCommand("docker", [
      "exec",
      container.containerName,
      "node",
      "-e",
      httpHealthProbeScript(),
      `http://127.0.0.1:${RELEASE_CONTAINER_PORT}${healthPath(release.health)}`,
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
      manifest
    } = await store.beginRelease(context, {
      publishPlan
    });
    const phases = [];
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

      const container = await startReleaseContainer({
        context,
        env,
        release: manifest
      });
      await store.writeReleaseLog(context, manifest.releaseId, "start", container.containerId);
      phases.push({
        finishedAt: new Date().toISOString(),
        id: "start",
        message: `Started ${container.containerName}.`,
        ok: true,
        startedAt: container.startedAt
      });
      const health = await healthCheckRelease({
        container,
        release: manifest
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
        container,
        health,
        phases
      });
    } catch (error) {
      await store.failRelease(context, manifest.releaseId, {
        error: String(error?.message || error || "Deployment failed."),
        phases
      });
      throw error;
    }
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
  release = {}
} = {}) {
  const containerName = releaseContainerName({
    context,
    release
  });
  return {
    containerId: "",
    containerName,
    image,
    internalBaseUrl: `http://${containerName}:${RELEASE_CONTAINER_PORT}`,
    internalHealthUrl: `http://${containerName}:${RELEASE_CONTAINER_PORT}${healthPath(release.health)}`,
    internalHost: containerName,
    internalPort: RELEASE_CONTAINER_PORT,
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
    ...baseRunLabels({
      context,
      releaseId: release.releaseId
    }).flatMap((label) => ["--label", label]),
    ...targetRuntimeNetworkDockerArgs(context.targetRoot),
    ...gitToolchainMountArgs(context.targetRoot),
    "-v",
    `${path.resolve(context.targetRoot)}:/workspace`,
    "-v",
    `${path.resolve(context.targetRoot)}:${path.resolve(context.targetRoot)}`,
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

function healthPath(health = {}) {
  const pathValue = normalizeText(health?.path || "/") || "/";
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
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
  createDeploymentRunner,
  releaseContainerDockerArgs
};
