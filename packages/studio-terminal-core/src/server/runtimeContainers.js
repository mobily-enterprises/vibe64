import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  dockerCommand,
  runHostCommand,
  shellQuote
} from "./shellCommands.js";
import {
  STUDIO_DAEMON_PID_LABEL,
  runtimeNamespace,
  studioDockerLabel
} from "./studioRuntimeIdentity.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  managedDatabasePromptServiceFacts
} from "./managedDatabases.js";
import {
  normalizePlainObject
} from "@local/vibe64-core/server/serverResponses";
import {
  targetRuntimeProjectSlug
} from "@local/vibe64-core/server/projectRuntimeIdentity";

const VIBE64_RUNTIME_HOST_ALIAS = "vibe64-host";
const RUNTIME_CONTAINER_KIND = "runtime-container";
const RUNTIME_CONTAINER_KIND_LABEL = studioDockerLabel("kind", RUNTIME_CONTAINER_KIND);
const RUNTIME_NETWORK_KIND = "runtime-network";
const RUNTIME_NETWORK_KIND_LABEL = studioDockerLabel("kind", RUNTIME_NETWORK_KIND);
const DEFAULT_HEALTH_RETRIES = 40;
const DEFAULT_HEALTH_SLEEP_SECONDS = "1.5";
const SECRET_ENV_PATTERN = /(PASSWORD|PASS|TOKEN|SECRET|KEY|CREDENTIAL|DATABASE_URL|DSN)/iu;

function dockerNamePart(value = "runtime") {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "runtime";
}

function dockerVolumePart(value = "runtime") {
  return dockerNamePart(value).replaceAll("-", "_");
}

function runtimeNamespaceNamePart() {
  const namespace = runtimeNamespace();
  return namespace ? dockerNamePart(namespace) : "";
}

function runtimeNamespaceVolumePart() {
  const namespace = runtimeNamespaceNamePart();
  return namespace ? dockerVolumePart(namespace) : "";
}

function runtimeTargetName(targetRoot = "") {
  return targetRuntimeProjectSlug(targetRoot);
}

function runtimeDockerNamePrefix(targetRoot = "") {
  return [
    "vibe64",
    runtimeNamespaceNamePart(),
    dockerNamePart(runtimeTargetName(targetRoot))
  ].filter(Boolean).join("-");
}

function runtimeDockerVolumePrefix(targetRoot = "") {
  return [
    "vibe64",
    runtimeNamespaceVolumePart(),
    dockerVolumePart(runtimeTargetName(targetRoot))
  ].filter(Boolean).join("_");
}

function runtimeNetworkName(targetRoot = "") {
  return [
    runtimeDockerNamePrefix(targetRoot),
    "network"
  ].filter(Boolean).join("-");
}

function runtimeNetworkCreateArgs(targetRoot = "") {
  return [
    "network",
    "create",
    "--label",
    RUNTIME_NETWORK_KIND_LABEL,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    studioDockerLabel("target", runtimeTargetName(targetRoot)),
    runtimeNetworkName(targetRoot)
  ];
}

function runtimeContainerName({
  adapterId = "generic",
  containerId = "runtime",
  targetRoot = ""
} = {}) {
  const adapterPart = dockerNamePart(adapterId);
  const containerPart = dockerNamePart(containerId);
  return [
    runtimeDockerNamePrefix(targetRoot),
    adapterPart,
    ...(containerPart.startsWith(`${adapterPart}-`) ? [containerPart.slice(adapterPart.length + 1)] : [containerPart])
  ].filter(Boolean).join("-");
}

function runtimeVolumeName({
  adapterId = "generic",
  containerId = "runtime",
  targetRoot = "",
  volumeId = "data"
} = {}) {
  const adapterPart = dockerVolumePart(adapterId);
  const containerPart = dockerVolumePart(containerId);
  return [
    runtimeDockerVolumePrefix(targetRoot),
    adapterPart,
    ...(containerPart.startsWith(`${adapterPart}_`) ? [containerPart.slice(adapterPart.length + 1)] : [containerPart]),
    dockerVolumePart(volumeId)
  ].join("_");
}

function normalizeStringArray(value = []) {
  return (Array.isArray(value) ? value : [value])
    .map(normalizeText)
    .filter(Boolean);
}

function normalizeEnv(env = {}) {
  return Object.fromEntries(Object.entries(normalizePlainObject(env))
    .map(([key, value]) => [normalizeText(key), String(value ?? "")])
    .filter(([key]) => key));
}

function normalizeRuntimeContainerPort(port = {}) {
  if (Number.isInteger(port)) {
    return {
      container: port
    };
  }
  const container = Number.parseInt(String(port.container || port.containerPort || ""), 10);
  if (!Number.isInteger(container) || container <= 0) {
    return null;
  }
  const hostPort = Number.parseInt(String(port.hostPort || port.host || ""), 10);
  return {
    container,
    host: normalizeText(port.hostIp || port.ip || "127.0.0.1"),
    hostPort: Number.isInteger(hostPort) && hostPort > 0 ? hostPort : null,
    protocol: normalizeText(port.protocol || "tcp")
  };
}

function normalizeRuntimeContainerVolume(volume = {}) {
  if (typeof volume === "string") {
    return {
      id: dockerNamePart(volume),
      target: normalizeText(volume)
    };
  }
  const target = normalizeText(volume.target || volume.containerPath);
  if (!target) {
    return null;
  }
  return {
    id: dockerNamePart(volume.id || path.basename(target) || "data"),
    readOnly: volume.readOnly === true,
    source: normalizeText(volume.source),
    target
  };
}

function normalizeRuntimeContainerHealth(health = null) {
  if (!health) {
    return null;
  }
  const command = normalizeStringArray(health.command || health.test);
  if (!command.length) {
    return null;
  }
  return {
    command,
    interval: normalizeText(health.interval || "5s"),
    retries: Number.parseInt(String(health.retries || DEFAULT_HEALTH_RETRIES), 10) || DEFAULT_HEALTH_RETRIES,
    sleepSeconds: normalizeText(health.sleepSeconds || DEFAULT_HEALTH_SLEEP_SECONDS),
    timeout: normalizeText(health.timeout || "3s")
  };
}

function normalizeRuntimeContainerReadyCheck(readyCheck = null) {
  if (!readyCheck) {
    return null;
  }
  const command = normalizeStringArray(readyCheck.command);
  if (!command.length) {
    return null;
  }
  return {
    command,
    expected: normalizeText(readyCheck.expected),
    explanation: normalizeText(readyCheck.explanation),
    observed: normalizeText(readyCheck.observed),
    timeout: Number.parseInt(String(readyCheck.timeout || "15000"), 10) || 15_000
  };
}

function normalizeRuntimeContainerDescriptor(descriptor = {}, {
  adapterId = "generic",
  targetRoot = ""
} = {}) {
  const id = dockerNamePart(descriptor.id || descriptor.name);
  const resolvedTargetRoot = path.resolve(targetRoot || process.cwd());
  const descriptorEnv = typeof descriptor.env === "function"
    ? descriptor.env({
        targetRoot: resolvedTargetRoot
      })
    : descriptor.env;
  const aliases = [
    id,
    ...normalizeStringArray(descriptor.aliases || descriptor.alias)
  ].filter((value, index, values) => values.indexOf(value) === index);
  return {
    adapterId,
    aliases,
    checkId: normalizeText(descriptor.checkId || id),
    containerName: normalizeText(descriptor.containerName) || runtimeContainerName({
      adapterId,
      containerId: id,
      targetRoot: resolvedTargetRoot
    }),
    env: normalizeEnv(descriptorEnv),
    expected: normalizeText(descriptor.expected),
    extraDockerArgs: normalizeStringArray(descriptor.extraDockerArgs),
    health: normalizeRuntimeContainerHealth(descriptor.health),
    id,
    image: normalizeText(descriptor.image),
    label: normalizeText(descriptor.label || id),
    notRequiredExplanation: normalizeText(descriptor.notRequiredExplanation),
    ports: (Array.isArray(descriptor.ports) ? descriptor.ports : [])
      .map(normalizeRuntimeContainerPort)
      .filter(Boolean),
    readyCheck: normalizeRuntimeContainerReadyCheck(descriptor.readyCheck),
    readyExplanation: normalizeText(descriptor.readyExplanation),
    required: descriptor.required,
    secretEnv: new Set(normalizeStringArray(descriptor.secretEnv || descriptor.secretEnvKeys)),
    terminalEnv: typeof descriptor.terminalEnv === "function"
      ? descriptor.terminalEnv
      : normalizeEnv(descriptor.terminalEnv),
    targetRoot: resolvedTargetRoot,
    volumes: (Array.isArray(descriptor.volumes) ? descriptor.volumes : [])
      .map(normalizeRuntimeContainerVolume)
      .filter(Boolean)
  };
}

function runtimeContainerIsRequired(descriptor = {}, context = {}) {
  if (typeof descriptor.required === "function") {
    return descriptor.required(context);
  }
  return descriptor.required !== false;
}

function resolvedRuntimeContainerContext(context = {}, targetRoot = "") {
  const resolvedTargetRoot = context.targetRoot || targetRoot;
  return {
    ...context,
    targetRoot: resolvedTargetRoot
  };
}

async function terminalEnvForRuntimeContainerSpec(spec = {}, context = {}) {
  const terminalEnv = typeof spec.terminalEnv === "function"
    ? await spec.terminalEnv({
        ...context,
        runtimeContainer: spec
      })
    : spec.terminalEnv;
  return normalizeEnv(terminalEnv);
}

async function runtimeContainerTerminalEnv(descriptor = {}, {
  adapterId = "generic",
  context = {},
  targetRoot = ""
} = {}) {
  const resolvedContext = resolvedRuntimeContainerContext(context, targetRoot);
  if (!await runtimeContainerIsRequired(descriptor, resolvedContext)) {
    return {};
  }

  const spec = normalizeRuntimeContainerDescriptor(descriptor, {
    adapterId,
    targetRoot: resolvedContext.targetRoot
  });
  return terminalEnvForRuntimeContainerSpec(spec, resolvedContext);
}

async function runtimeContainersTerminalEnv(descriptors = [], {
  adapterId = "generic",
  context = {},
  targetRoot = ""
} = {}) {
  const containers = Array.isArray(descriptors) ? descriptors : [];
  const envEntries = await Promise.all(containers.map((descriptor) => {
    return runtimeContainerTerminalEnv(descriptor, {
      adapterId,
      context,
      targetRoot
    });
  }));
  return Object.assign({}, ...envEntries);
}

async function ensureRuntimeContainers(descriptors = [], {
  adapterId = "generic",
  context = {},
  runCommand = runHostCommand,
  targetRoot = ""
} = {}) {
  const containers = Array.isArray(descriptors) ? descriptors : [];
  const resolvedContext = resolvedRuntimeContainerContext(context, targetRoot);
  const results = [];
  for (const descriptor of containers) {
    if (!await runtimeContainerIsRequired(descriptor, resolvedContext)) {
      continue;
    }
    const spec = normalizeRuntimeContainerDescriptor(descriptor, {
      adapterId,
      targetRoot: resolvedContext.targetRoot
    });
    const script = runtimeContainerStartScript(descriptor, {
      adapterId,
      targetRoot: spec.targetRoot
    });
    const result = await runCommand("bash", ["-lc", script], {
      cwd: spec.targetRoot,
      timeout: 180_000
    });
    results.push({
      id: spec.id,
      label: spec.label,
      result
    });
    if (!result.ok) {
      throw new Error(`${spec.label} could not start before launching the terminal: ${result.output || "no output"}`);
    }
  }
  return results;
}

function shouldMaskEnvKey(spec, key) {
  return spec.secretEnv.has(key) || SECRET_ENV_PATTERN.test(key);
}

function maskedRuntimeContainerEnv(spec, env = {}) {
  return Object.fromEntries(Object.entries(normalizeEnv(env))
    .map(([key, value]) => [key, shouldMaskEnvKey(spec, key) ? "*****" : value]));
}

async function runtimeContainerPromptFacts(descriptors = [], {
  adapterId = "generic",
  context = {},
  targetRoot = ""
} = {}) {
  const containers = Array.isArray(descriptors) ? descriptors : [];
  const resolvedContext = resolvedRuntimeContainerContext(context, targetRoot);

  return Promise.all(containers.map(async (descriptor) => {
    const spec = normalizeRuntimeContainerDescriptor(descriptor, {
      adapterId,
      targetRoot: resolvedContext.targetRoot
    });
    const terminalEnv = await terminalEnvForRuntimeContainerSpec(spec, resolvedContext);
    return {
      aliases: spec.aliases,
      containerName: spec.containerName,
      env: maskedRuntimeContainerEnv(spec, spec.env),
      expected: spec.expected,
      id: spec.id,
      image: spec.image,
      label: spec.label,
      network: runtimeNetworkName(spec.targetRoot),
      notRequiredExplanation: spec.notRequiredExplanation,
      ports: spec.ports,
      readyCheck: spec.readyCheck
        ? {
            expected: spec.readyCheck.expected,
            explanation: spec.readyCheck.explanation
          }
        : null,
      required: await runtimeContainerIsRequired(descriptor, resolvedContext),
      readyExplanation: spec.readyExplanation,
      terminalEnv: maskedRuntimeContainerEnv(spec, terminalEnv),
      volumes: spec.volumes.map((volume) => ({
        readOnly: volume.readOnly,
        target: volume.target
      }))
    };
  }));
}

function runtimeContainerManagedDatabaseRuntime(spec = {}) {
  const searchable = [
    spec.id,
    spec.label,
    spec.image,
    ...Object.keys(spec.env || {})
  ].join(" ").toLowerCase();
  if (searchable.includes("postgres")) {
    return "postgres";
  }
  if (searchable.includes("mariadb")) {
    return "mariadb";
  }
  if (searchable.includes("mysql")) {
    return "mysql";
  }
  return "";
}

async function runtimeContainerManagedServicesPromptFacts(descriptors = [], {
  adapterId = "generic",
  context = {},
  targetRoot = ""
} = {}) {
  const containers = Array.isArray(descriptors) ? descriptors : [];
  const resolvedContext = resolvedRuntimeContainerContext(context, targetRoot);
  const facts = await Promise.all(containers.map(async (descriptor) => {
    const spec = normalizeRuntimeContainerDescriptor(descriptor, {
      adapterId,
      targetRoot: resolvedContext.targetRoot
    });
    if (!await runtimeContainerIsRequired(spec, resolvedContext)) {
      return null;
    }
    const terminalEnv = await terminalEnvForRuntimeContainerSpec(spec, resolvedContext);
    return managedDatabasePromptServiceFacts({
      id: spec.id,
      label: spec.label,
      runtime: runtimeContainerManagedDatabaseRuntime(spec),
      terminalEnv
    });
  }));
  return facts.filter(Boolean);
}

function envDockerArgs(spec, {
  maskSecrets = false
} = {}) {
  return Object.entries(spec.env).flatMap(([key, value]) => {
    const displayValue = maskSecrets && shouldMaskEnvKey(spec, key) ? "*****" : value;
    return [
      "-e",
      `${key}=${displayValue}`
    ];
  });
}

function portDockerArgs(ports = []) {
  return ports.flatMap((port) => {
    if (!port.hostPort) {
      return [];
    }
    const protocol = port.protocol && port.protocol !== "tcp" ? `/${port.protocol}` : "";
    return [
      "-p",
      `${port.host || "127.0.0.1"}:${port.hostPort}:${port.container}${protocol}`
    ];
  });
}

function volumeSource(spec, volume = {}) {
  return volume.source || runtimeVolumeName({
    adapterId: spec.adapterId,
    containerId: spec.id,
    targetRoot: spec.targetRoot,
    volumeId: volume.id
  });
}

function volumeDockerArgs(spec) {
  return spec.volumes.flatMap((volume) => [
    "-v",
    `${volumeSource(spec, volume)}:${volume.target}${volume.readOnly ? ":ro" : ""}`
  ]);
}

function healthCommandString(health = null, {
  maskSecrets = false
} = {}) {
  if (!health?.command?.length) {
    return "";
  }
  return health.command.map((part) => {
    const text = String(part);
    if (!maskSecrets) {
      return shellQuote(text);
    }
    return shellQuote(text.replace(/(-p)(.+)$/u, "$1*****"));
  }).join(" ");
}

function healthDockerArgs(spec, {
  maskSecrets = false
} = {}) {
  if (!spec.health) {
    return [];
  }
  return [
    "--health-cmd",
    healthCommandString(spec.health, {
      maskSecrets
    }),
    "--health-interval",
    spec.health.interval,
    "--health-timeout",
    spec.health.timeout,
    "--health-retries",
    String(spec.health.retries)
  ];
}

function runtimeContainerRunArgs(spec, {
  maskSecrets = false
} = {}) {
  return [
    "run",
    "-d",
    "--name",
    spec.containerName,
    "--network",
    runtimeNetworkName(spec.targetRoot),
    ...spec.aliases.flatMap((alias) => ["--network-alias", alias]),
    "--label",
    RUNTIME_CONTAINER_KIND_LABEL,
    "--label",
    studioDockerLabel("adapter", spec.adapterId),
    "--label",
    studioDockerLabel("runtime-id", spec.id),
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    studioDockerLabel("target", runtimeTargetName(spec.targetRoot)),
    ...envDockerArgs(spec, {
      maskSecrets
    }),
    ...portDockerArgs(spec.ports),
    ...volumeDockerArgs(spec),
    ...healthDockerArgs(spec, {
      maskSecrets
    }),
    ...spec.extraDockerArgs,
    spec.image
  ];
}

function displayCommandLine(command = "", {
  indent = ""
} = {}) {
  return `${indent}printf '%s\\n' ${shellQuote(`$ ${command}`)}`;
}

function volumeCreateLines(spec) {
  return spec.volumes
    .filter((volume) => !volume.source)
    .flatMap((volume) => {
      const volumeName = volumeSource(spec, volume);
      const command = dockerCommand(["volume", "create", volumeName]);
      return [
        displayCommandLine(command),
        `${command} >/dev/null`
      ];
    });
}

function networkConnectLines(spec) {
  return [
    `  if ! docker inspect ${shellQuote(spec.containerName)} --format '{{json .NetworkSettings.Networks}}' | grep -q ${shellQuote(`"${runtimeNetworkName(spec.targetRoot)}"`)}; then`,
    `    docker network connect ${spec.aliases.flatMap((alias) => ["--alias", alias]).map(shellQuote).join(" ")} ${shellQuote(runtimeNetworkName(spec.targetRoot))} ${shellQuote(spec.containerName)} || true`,
    "  fi"
  ];
}

function runtimeContainerCreateLines(spec) {
  return [
    displayCommandLine(dockerCommand(runtimeContainerRunArgs(spec, {
      maskSecrets: true
    })), {
      indent: "  "
    }),
    `  ${dockerCommand(runtimeContainerRunArgs(spec))}`
  ];
}

function waitForRuntimeContainerLines(spec) {
  const retries = spec.health?.retries || DEFAULT_HEALTH_RETRIES;
  const sleepSeconds = spec.health?.sleepSeconds || DEFAULT_HEALTH_SLEEP_SECONDS;
  const statusTemplate = spec.health
    ? "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"
    : "{{.State.Running}}";
  const readyStatus = spec.health ? "healthy" : "true";
  return [
    "runtime_ready=0",
    `for attempt in $(seq 1 ${Number(retries)}); do`,
    `  status="$(docker inspect ${shellQuote(spec.containerName)} --format ${shellQuote(statusTemplate)} 2>/dev/null || true)"`,
    `  if [ "$status" = ${shellQuote(readyStatus)} ]; then`,
    "    runtime_ready=1",
    "    break",
    "  fi",
    `  sleep "\${VIBE64_RUNTIME_CONTAINER_WAIT_SECONDS:-${sleepSeconds}}"`,
    "done",
    "if [ \"$runtime_ready\" != \"1\" ]; then",
    `echo ${shellQuote(`${spec.label} did not become ready in time.`)} >&2`,
    `docker inspect ${shellQuote(spec.containerName)} --format ${shellQuote("{{json .State}}")} || true`,
    "exit 1",
    "fi"
  ];
}

function runtimeContainerReadyCheckLines(spec) {
  if (!spec.readyCheck) {
    return [];
  }
  const timeoutSeconds = Math.max(1, Math.ceil(spec.readyCheck.timeout / 1000));
  const command = dockerCommand([
    "exec",
    spec.containerName,
    ...spec.readyCheck.command
  ]);
  const timedCommand = `timeout ${Number(timeoutSeconds)}s ${command}`;
  return [
    displayCommandLine(command),
    `if ! ${timedCommand}; then`,
    `  echo ${shellQuote(spec.readyCheck.explanation || `${spec.label} readiness check failed.`)} >&2`,
    `  echo ${shellQuote(spec.readyCheck.expected || `${spec.label} should be ready.`)} >&2`,
    "  exit 1",
    "fi"
  ];
}

function runtimeContainerStartScript(descriptor = {}, {
  adapterId = "generic",
  targetRoot = ""
} = {}) {
  const spec = normalizeRuntimeContainerDescriptor(descriptor, {
    adapterId,
    targetRoot
  });
  return [
    "set -e",
    displayCommandLine(`${dockerCommand(runtimeNetworkCreateArgs(spec.targetRoot))} || true`),
    `${dockerCommand(runtimeNetworkCreateArgs(spec.targetRoot))} >/dev/null 2>&1 || true`,
    ...volumeCreateLines(spec),
    `if ! docker inspect ${shellQuote(spec.containerName)} >/dev/null 2>&1; then`,
    ...runtimeContainerCreateLines(spec),
    "else",
    `  if [ "$(docker inspect ${shellQuote(spec.containerName)} --format '{{.State.Running}}')" != "true" ]; then`,
    displayCommandLine(dockerCommand(["start", spec.containerName]), {
      indent: "    "
    }),
    `    if ! docker start ${shellQuote(spec.containerName)}; then`,
    `      echo ${shellQuote(`${spec.label} container could not start. Recreating the container while keeping managed volumes.`)} >&2`,
    `      docker rm -f ${shellQuote(spec.containerName)} >/dev/null`,
    ...runtimeContainerCreateLines(spec).map((line) => `      ${line.trimStart()}`),
    "    fi",
    "  fi",
    ...networkConnectLines(spec),
    "fi",
    ...waitForRuntimeContainerLines(spec),
    ...runtimeContainerReadyCheckLines(spec)
  ].join("\n");
}

function runtimeContainerCommandPreview(descriptor = {}, {
  adapterId = "generic",
  targetRoot = ""
} = {}) {
  const spec = normalizeRuntimeContainerDescriptor(descriptor, {
    adapterId,
    targetRoot
  });
  return [
    `${dockerCommand(runtimeNetworkCreateArgs(spec.targetRoot))} || true`,
    ...spec.volumes
      .filter((volume) => !volume.source)
      .map((volume) => dockerCommand(["volume", "create", volumeSource(spec, volume)])),
    dockerCommand(runtimeContainerRunArgs(spec, {
      maskSecrets: true
    }))
  ].join("\n");
}

function createRuntimeContainerRepair(descriptor = {}, {
  adapterId = "generic",
  targetRoot = ""
} = {}) {
  const spec = normalizeRuntimeContainerDescriptor(descriptor, {
    adapterId,
    targetRoot
  });
  return createDoctorRepair({
    actionId: `start-runtime-container-${spec.id}`,
    autoRun: true,
    command: runtimeContainerCommandPreview(descriptor, {
      adapterId,
      targetRoot
    }),
    kind: "terminal",
    label: `Start ${spec.label}`
  });
}

async function inspectRuntimeContainer(toolkit, spec) {
  const running = await toolkit.runDocker([
    "inspect",
    spec.containerName,
    "--format",
    "{{.State.Running}}"
  ], {
    timeout: 12_000
  });
  if (!running.ok || running.stdout !== "true") {
    return {
      ok: false,
      output: running.output || `${spec.containerName} is not running.`
    };
  }
  if (!spec.health) {
    return {
      ok: true,
      output: `${spec.containerName} is running.`
    };
  }
  const health = await toolkit.runDocker([
    "inspect",
    spec.containerName,
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"
  ], {
    timeout: 12_000
  });
  if (!health.ok || health.stdout !== "healthy") {
    return {
      ok: false,
      output: health.output || `Health status: ${health.stdout || "unknown"}`
    };
  }
  return {
    ok: true,
    output: `${spec.containerName} is healthy.`
  };
}

async function runRuntimeContainerReadyCheck(toolkit, spec) {
  if (!spec.readyCheck) {
    return {
      ok: true,
      output: ""
    };
  }
  return toolkit.runDocker([
    "exec",
    spec.containerName,
    ...spec.readyCheck.command
  ], {
    timeout: spec.readyCheck.timeout
  });
}

function createRuntimeContainerCheck(toolkit, descriptor = {}, {
  adapterId = "generic",
  targetRoot = ""
} = {}) {
  return {
    expected: descriptor.expected || `${descriptor.label || descriptor.id} runtime container is running.`,
    id: descriptor.checkId || descriptor.id,
    label: descriptor.label || descriptor.id,
    async run(context = {}) {
      if (!await runtimeContainerIsRequired(descriptor, context)) {
        return passCheck({
          id: descriptor.checkId || descriptor.id,
          label: descriptor.label || descriptor.id,
          expected: descriptor.expected || `${descriptor.label || descriptor.id} runtime container is available when required.`,
          observed: "This target does not currently require the container.",
          explanation: descriptor.notRequiredExplanation || "Runtime containers are started only when the selected adapter declares that the target needs them."
        });
      }

      const spec = normalizeRuntimeContainerDescriptor(descriptor, {
        adapterId,
        targetRoot: context.targetRoot || targetRoot
      });
      const repair = createRuntimeContainerRepair(descriptor, {
        adapterId,
        targetRoot: spec.targetRoot
      });
      const runtime = await inspectRuntimeContainer(toolkit, spec);
      if (!runtime.ok) {
        return blockedCheck({
          id: spec.checkId,
          label: spec.label,
          expected: descriptor.expected || `${spec.label} container is running and healthy.`,
          observed: runtime.output,
          explanation: descriptor.explanation || "Start the declared runtime container before Studio runs target setup or launch-target commands.",
          repair
        });
      }

      const ready = await runRuntimeContainerReadyCheck(toolkit, spec);
      if (!ready.ok) {
        return blockedCheck({
          id: spec.checkId,
          label: spec.label,
          expected: spec.readyCheck?.expected || `${spec.label} passes its adapter-declared readiness check.`,
          observed: ready.output,
          explanation: spec.readyCheck?.explanation || descriptor.explanation || "The container is running, but its adapter-declared readiness command failed.",
          repair
        });
      }

      return passCheck({
        id: spec.checkId,
        label: spec.label,
        expected: descriptor.expected || `${spec.label} container is running and healthy.`,
        observed: [
          runtime.output,
          ready.output ? (spec.readyCheck?.observed || ready.output) : "",
          `Network: ${runtimeNetworkName(spec.targetRoot)}`,
          `Aliases: ${spec.aliases.join(", ")}`
        ].filter(Boolean).join("\n"),
        explanation: descriptor.readyExplanation || "Vibe64 can attach setup, script, and launch-target containers to this runtime container network."
      });
    }
  };
}

function createRuntimeContainerTerminalAction(toolkit, descriptor = {}, {
  adapterId = "generic",
  targetRoot = ""
} = {}) {
  const spec = normalizeRuntimeContainerDescriptor(descriptor, {
    adapterId,
    targetRoot
  });
  return toolkit.shellTerminalAction({
    actionId: `start-runtime-container-${spec.id}`,
    autoRun: true,
    commandPreview: (context = {}) => runtimeContainerCommandPreview(descriptor, {
      adapterId,
      targetRoot: context.targetRoot || targetRoot
    }),
    cwd: ({ targetRoot: contextTargetRoot = "" } = {}) => contextTargetRoot || targetRoot,
    label: `Start ${spec.label}`,
    script: (context = {}) => runtimeContainerStartScript(descriptor, {
      adapterId,
      targetRoot: context.targetRoot || targetRoot
    })
  });
}

function createRuntimeContainerDoctorEntries(toolkit, descriptors = [], options = {}) {
  const containers = Array.isArray(descriptors) ? descriptors : [];
  return {
    checks: containers.map((descriptor) => createRuntimeContainerCheck(toolkit, descriptor, options)),
    terminalActions: containers.map((descriptor) => createRuntimeContainerTerminalAction(toolkit, descriptor, options))
  };
}

function runtimeContainerNetworkDockerArgs(targetRoot = "", {
  includeHostAlias = true
} = {}) {
  return [
    "--network",
    runtimeNetworkName(targetRoot),
    ...(includeHostAlias ? [
      "--add-host",
      `${VIBE64_RUNTIME_HOST_ALIAS}:host-gateway`
    ] : [])
  ];
}

function targetRuntimeNetworkDockerArgs(targetRoot = "") {
  return runtimeContainerNetworkDockerArgs(targetRoot);
}

function targetRuntimeNetworkEnsureCommand(targetRoot = "") {
  const networkName = runtimeNetworkName(targetRoot);
  const inspectCommand = `${dockerCommand(["network", "inspect", networkName])} >/dev/null 2>&1`;
  return [
    inspectCommand,
    `${dockerCommand(runtimeNetworkCreateArgs(targetRoot))} >/dev/null`,
    inspectCommand
  ].join(" || ");
}

async function ensureTargetRuntimeNetwork(targetRoot = "", {
  runCommand = runHostCommand
} = {}) {
  const networkName = runtimeNetworkName(targetRoot);
  const inspect = await runCommand("docker", ["network", "inspect", networkName], {
    timeout: 5_000
  });
  if (inspect.ok) {
    return networkName;
  }

  const create = await runCommand("docker", runtimeNetworkCreateArgs(targetRoot), {
    timeout: 10_000
  });
  if (create.ok || /already exists/iu.test(create.output)) {
    return networkName;
  }

  throw new Error(`Could not prepare Vibe64 runtime network ${networkName}: ${create.output || inspect.output}`);
}

async function currentDockerContainerId() {
  try {
    await access("/.dockerenv");
  } catch {
    return "";
  }
  try {
    return String(await readFile("/etc/hostname", "utf8")).trim();
  } catch {
    return "";
  }
}

async function currentProcessIsDockerContainer() {
  return Boolean(await currentDockerContainerId());
}

async function ensureCurrentContainerConnectedToRuntimeNetwork(targetRoot = "", {
  runCommand = runHostCommand
} = {}) {
  const containerId = await currentDockerContainerId();
  if (!containerId) {
    return {
      connected: false,
      reason: "not_container"
    };
  }
  const networkName = runtimeNetworkName(targetRoot);
  await ensureTargetRuntimeNetwork(targetRoot, {
    runCommand
  });
  const inspect = await runCommand("docker", [
    "inspect",
    "--format",
    "{{json .NetworkSettings.Networks}}",
    containerId
  ], {
    timeout: 5000
  });
  if (inspect.ok && String(inspect.stdout || inspect.output || "").includes(`"${networkName}"`)) {
    return {
      connected: true,
      containerId,
      networkName
    };
  }
  const connect = await runCommand("docker", [
    "network",
    "connect",
    networkName,
    containerId
  ], {
    timeout: 5000
  });
  if (
    !connect.ok &&
    !/already (?:exists|connected)|is already connected/iu.test(String(connect.output || connect.stderr || ""))
  ) {
    const error = new Error(`Could not connect Studio container to runtime network ${networkName}: ${connect.output || connect.stderr || "docker network connect failed"}`);
    error.code = "vibe64_studio_network_connect_failed";
    throw error;
  }
  return {
    connected: true,
    containerId,
    networkName
  };
}

export {
  VIBE64_RUNTIME_HOST_ALIAS,
  RUNTIME_CONTAINER_KIND,
  RUNTIME_CONTAINER_KIND_LABEL,
  RUNTIME_NETWORK_KIND,
  RUNTIME_NETWORK_KIND_LABEL,
  createRuntimeContainerCheck,
  createRuntimeContainerDoctorEntries,
  createRuntimeContainerRepair,
  createRuntimeContainerTerminalAction,
  currentProcessIsDockerContainer,
  ensureCurrentContainerConnectedToRuntimeNetwork,
  ensureTargetRuntimeNetwork,
  ensureRuntimeContainers,
  normalizeRuntimeContainerDescriptor,
  runtimeDockerNamePrefix,
  runtimeDockerVolumePrefix,
  runtimeContainerManagedServicesPromptFacts,
  runtimeContainerPromptFacts,
  runtimeContainerTerminalEnv,
  runtimeContainerCommandPreview,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs,
  runtimeContainerRunArgs,
  runtimeContainersTerminalEnv,
  runtimeContainerStartScript,
  runtimeNetworkCreateArgs,
  runtimeNetworkName,
  runtimeTargetName,
  runtimeVolumeName,
  targetRuntimeNetworkDockerArgs,
  targetRuntimeNetworkEnsureCommand
};
