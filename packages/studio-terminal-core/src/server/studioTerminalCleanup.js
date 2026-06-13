import { execFile } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  STUDIO_DAEMON_ID_LABEL,
  STUDIO_DAEMON_PID_LABEL,
  normalizeDaemonId,
  studioDaemonId,
  studioDockerLabel
} from "./studioRuntimeIdentity.js";
import {
  RUNTIME_NETWORK_KIND
} from "./runtimeContainers.js";

const execFileAsync = promisify(execFile);
const STUDIO_TOOLCHAIN_CONTAINER_LABEL = studioDockerLabel("kind", "toolchain");
const STUDIO_CODEX_CONTAINER_LABEL = studioDockerLabel("kind", "codex-terminal");
const STUDIO_CODEX_APP_SERVER_CONTAINER_LABEL = studioDockerLabel("kind", "codex-app-server");
const STUDIO_TARGET_SCRIPT_CONTAINER_LABEL = studioDockerLabel("kind", "target-script-terminal");
const STUDIO_LAUNCH_TARGET_CONTAINER_LABEL = studioDockerLabel("kind", "launch-target-terminal");
const STALE_PROCESS_GRACE_MS = 500;
const MISSING_DOCKER_LABEL_VALUE = "<no value>";

function logCleanup(logger, level, data, message) {
  const log = logger?.[level];
  if (typeof log === "function") {
    log.call(logger, data, message);
  }
}

function parseProcessRows(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3]
      };
    })
    .filter(Boolean);
}

function isStudioToolchainDockerRun(command = "") {
  const normalizedCommand = String(command || "");
  return /\bdocker\s+run\b/u.test(normalizedCommand) &&
    normalizedCommand.includes(STUDIO_TOOLCHAIN_CONTAINER_LABEL) &&
    daemonOwnershipFromStudioCommand(normalizedCommand).daemonPid > 0;
}

function normalizeProcessId(value = "") {
  const pid = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function daemonPidFromStudioToolchainCommand(command = "") {
  const labelPattern = escapeRegExp(STUDIO_DAEMON_PID_LABEL);
  const match = new RegExp(`(?:^|\\s)--label(?:=|\\s+)${labelPattern}=(\\d+)(?:\\s|$)`, "u")
    .exec(String(command || ""));
  return normalizeProcessId(match?.[1]);
}

function daemonIdFromStudioCommand(command = "") {
  const labelPattern = escapeRegExp(STUDIO_DAEMON_ID_LABEL);
  const match = new RegExp(`(?:^|\\s)--label(?:=|\\s+)${labelPattern}=([^\\s]+)(?:\\s|$)`, "u")
    .exec(String(command || ""));
  return normalizeDaemonId(match?.[1]);
}

function daemonOwnershipFromStudioCommand(command = "") {
  return {
    daemonId: daemonIdFromStudioCommand(command),
    daemonPid: daemonPidFromStudioToolchainCommand(command)
  };
}

function defaultProcessCommand(pid) {
  if (process.platform !== "linux") {
    return null;
  }
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replace(/\0/gu, " ")
      .trim();
  } catch {
    return null;
  }
}

function defaultProcessCwd(pid) {
  if (process.platform !== "linux") {
    return "";
  }
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

function defaultReadPackageManifest(cwd = "") {
  return JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
}

function isVibe64PackageRoot(cwd = "", {
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  const normalizedCwd = String(cwd || "").trim();
  if (!normalizedCwd) {
    return false;
  }
  try {
    const manifest = readPackageManifestImpl(normalizedCwd);
    return String(manifest?.name || "") === "vibe64";
  } catch {
    return false;
  }
}

function isLikelyStudioServerCommand(command = "") {
  return /(?:^|\s)(?:\.\/)?bin\/server\.js(?:\s|$)/u.test(String(command || ""));
}

function isLikelyStudioDaemonCommand(command = "", {
  cwd = "",
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  const normalizedCommand = String(command || "").toLowerCase();
  if (normalizedCommand.includes("vibe64")) {
    return true;
  }
  return isLikelyStudioServerCommand(command) && isVibe64PackageRoot(cwd, {
    readPackageManifestImpl
  });
}

function processStillExists(pid, killImpl) {
  try {
    killImpl(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function studioDaemonProcessStillExists(pid, {
  killImpl = process.kill,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  if (!processStillExists(pid, killImpl)) {
    return false;
  }
  const command = typeof processCommandImpl === "function"
    ? processCommandImpl(pid)
    : null;
  if (command === null || command === undefined) {
    return true;
  }
  const cwd = typeof processCwdImpl === "function"
    ? processCwdImpl(pid)
    : "";
  return isLikelyStudioDaemonCommand(command, {
    cwd,
    readPackageManifestImpl
  });
}

function isStaleDaemonOwnership({
  daemonId = "",
  daemonPid = 0
} = {}, {
  currentDaemonId = studioDaemonId(),
  currentPid = process.pid,
  killImpl = process.kill,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  const normalizedDaemonPid = normalizeProcessId(daemonPid);
  const normalizedDaemonId = normalizeDaemonId(daemonId);
  const normalizedCurrentDaemonId = normalizeDaemonId(currentDaemonId);
  if (normalizedDaemonId && normalizedDaemonId === normalizedCurrentDaemonId) {
    return false;
  }
  if (normalizedDaemonPid === currentPid) {
    return false;
  }
  if (normalizedDaemonPid) {
    return !studioDaemonProcessStillExists(normalizedDaemonPid, {
      killImpl,
      processCommandImpl,
      processCwdImpl,
      readPackageManifestImpl
    });
  }
  return Boolean(normalizedDaemonId && normalizedDaemonId !== normalizedCurrentDaemonId);
}

function selectDescendantProcessIds(processes = [], rootPids = []) {
  const childrenByParent = new Map();
  for (const entry of processes) {
    if (!childrenByParent.has(entry.ppid)) {
      childrenByParent.set(entry.ppid, []);
    }
    childrenByParent.get(entry.ppid).push(entry.pid);
  }

  const selected = new Set(rootPids);
  const queue = [...rootPids];
  while (queue.length) {
    const parentPid = queue.shift();
    for (const childPid of childrenByParent.get(parentPid) || []) {
      if (selected.has(childPid)) {
        continue;
      }
      selected.add(childPid);
      queue.push(childPid);
    }
  }

  return [...selected]
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .sort((left, right) => right - left);
}

function selectStaleStudioToolchainProcessIds(processes = [], {
  currentDaemonId = studioDaemonId(),
  currentPid = process.pid,
  killImpl = process.kill,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  const rootPids = processes
    .filter((entry) =>
      entry.pid !== currentPid &&
      isStudioToolchainDockerRun(entry.command) &&
      isStaleDaemonOwnership(daemonOwnershipFromStudioCommand(entry.command), {
        currentDaemonId,
        currentPid,
        killImpl,
        processCommandImpl,
        processCwdImpl,
        readPackageManifestImpl
      })
    )
    .map((entry) => entry.pid);
  return selectDescendantProcessIds(processes, rootPids)
    .filter((pid) => pid !== currentPid);
}

function parseDockerContainerRows(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return null;
      }
      const [id, rawDaemonPid = "", rawDaemonId = ""] = trimmedLine.split("\t");
      return {
        daemonId: rawDaemonId === MISSING_DOCKER_LABEL_VALUE ? "" : normalizeDaemonId(rawDaemonId),
        daemonPid: rawDaemonPid === MISSING_DOCKER_LABEL_VALUE ? 0 : normalizeProcessId(rawDaemonPid),
        id: String(id || "").trim()
      };
    })
    .filter((entry) => entry?.id);
}

function selectStaleStudioContainerIds(containers = [], {
  currentDaemonId = studioDaemonId(),
  currentPid = process.pid,
  killImpl = process.kill,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  return containers
    .filter((container) => isStaleDaemonOwnership(container, {
      currentDaemonId,
      currentPid,
      killImpl,
      processCommandImpl,
      processCwdImpl,
      readPackageManifestImpl
    }))
    .map((container) => container.id);
}

function parseDockerNetworkRows(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return null;
      }
      const [id = "", name = "", kind = "", rawDaemonPid = "", rawDaemonId = ""] = trimmedLine.split("\t");
      return {
        daemonId: rawDaemonId === MISSING_DOCKER_LABEL_VALUE ? "" : normalizeDaemonId(rawDaemonId),
        daemonPid: rawDaemonPid === MISSING_DOCKER_LABEL_VALUE ? 0 : normalizeProcessId(rawDaemonPid),
        id: id.trim(),
        kind: kind === MISSING_DOCKER_LABEL_VALUE ? "" : kind.trim(),
        name: name.trim()
      };
    })
    .filter((entry) => entry?.id && entry?.name);
}

function isStudioRuntimeNetwork(network = {}) {
  return network.kind === RUNTIME_NETWORK_KIND;
}

function shouldRemoveStudioRuntimeNetwork(network = {}, {
  currentDaemonId = studioDaemonId(),
  currentPid = process.pid,
  killImpl = process.kill,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  return network.kind === RUNTIME_NETWORK_KIND &&
    isStaleDaemonOwnership(network, {
      currentDaemonId,
      currentPid,
      killImpl,
      processCommandImpl,
      processCwdImpl,
      readPackageManifestImpl
    });
}

function networkContainersFromInspect(output = "") {
  try {
    const containers = JSON.parse(String(output || "{}"));
    return containers && typeof containers === "object" ? Object.keys(containers) : [];
  } catch {
    return ["unknown"];
  }
}

function dockerContainerRemovalAlreadySettled(error) {
  const message = String(error?.stderr || error?.message || error || "").toLowerCase();
  return message.includes("no such container") ||
    message.includes("is already in progress");
}

async function listStudioRuntimeNetworks(execFileImpl = execFileAsync) {
  const result = await execFileImpl("docker", [
    "network",
    "ls",
    "--format",
    `{{.ID}}\t{{.Name}}\t{{.Label "${studioDockerLabel("kind")}"}}\t{{.Label "${STUDIO_DAEMON_PID_LABEL}"}}\t{{.Label "${STUDIO_DAEMON_ID_LABEL}"}}`
  ], {
    maxBuffer: 1024 * 1024,
    timeout: 10000
  });
  return parseDockerNetworkRows(result.stdout)
    .filter(isStudioRuntimeNetwork);
}

async function networkIsUnused(networkId, execFileImpl = execFileAsync) {
  const result = await execFileImpl("docker", [
    "network",
    "inspect",
    networkId,
    "--format",
    "{{json .Containers}}"
  ], {
    maxBuffer: 1024 * 1024,
    timeout: 10000
  });
  return networkContainersFromInspect(result.stdout).length === 0;
}

async function removeUnusedStudioRuntimeNetworks({
  currentDaemonId = studioDaemonId(),
  currentPid = process.pid,
  execFileImpl = execFileAsync,
  killImpl = process.kill,
  logger = null,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  let networks = [];
  try {
    networks = await listStudioRuntimeNetworks(execFileImpl);
  } catch (error) {
    logCleanup(logger, "debug", {
      error: String(error?.message || error)
    }, "Skipping Studio runtime network startup cleanup.");
    return [];
  }

  const removedNetworks = [];
  for (const network of networks) {
    if (!shouldRemoveStudioRuntimeNetwork(network, {
      currentDaemonId,
      currentPid,
      killImpl,
      processCommandImpl,
      processCwdImpl,
      readPackageManifestImpl
    })) {
      continue;
    }
    let unused = false;
    try {
      unused = await networkIsUnused(network.id, execFileImpl);
    } catch (error) {
      logCleanup(logger, "debug", {
        error: String(error?.message || error),
        network: network.name
      }, "Skipping Studio runtime network because it could not be inspected.");
      continue;
    }
    if (!unused) {
      continue;
    }
    try {
      await execFileImpl("docker", ["network", "rm", network.id], {
        maxBuffer: 1024 * 1024,
        timeout: 10000
      });
      removedNetworks.push(network.name);
    } catch (error) {
      logCleanup(logger, "debug", {
        error: String(error?.message || error),
        network: network.name
      }, "Skipping Studio runtime network because Docker refused to remove it.");
    }
  }
  return removedNetworks;
}

async function listStudioContainers(execFileImpl = execFileAsync) {
  const containers = new Map();
  for (const label of [
    STUDIO_CODEX_APP_SERVER_CONTAINER_LABEL,
    STUDIO_CODEX_CONTAINER_LABEL,
    STUDIO_TARGET_SCRIPT_CONTAINER_LABEL,
    STUDIO_TOOLCHAIN_CONTAINER_LABEL,
    STUDIO_LAUNCH_TARGET_CONTAINER_LABEL
  ]) {
    const result = await execFileImpl("docker", [
      "ps",
      "-a",
      "--filter",
      `label=${label}`,
      "--format",
      `{{.ID}}\t{{.Label "${STUDIO_DAEMON_PID_LABEL}"}}\t{{.Label "${STUDIO_DAEMON_ID_LABEL}"}}`
    ], {
      maxBuffer: 1024 * 1024,
      timeout: 10000
    });
    for (const container of parseDockerContainerRows(result.stdout)) {
      const existing = containers.get(container.id);
      containers.set(container.id, {
        ...container,
        daemonId: existing?.daemonId || container.daemonId,
        daemonPid: existing?.daemonPid || container.daemonPid
      });
    }
  }
  return [...containers.values()];
}

async function listStudioContainerIds(execFileImpl = execFileAsync) {
  return (await listStudioContainers(execFileImpl)).map((container) => container.id);
}

async function removeStaleStudioContainers({
  currentDaemonId = studioDaemonId(),
  currentPid = process.pid,
  execFileImpl = execFileAsync,
  killImpl = process.kill,
  logger = null,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  let containers = [];
  try {
    containers = await listStudioContainers(execFileImpl);
  } catch (error) {
    logCleanup(logger, "debug", {
      error: String(error?.message || error)
    }, "Skipping Studio terminal container startup cleanup.");
    return [];
  }

  const containerIds = selectStaleStudioContainerIds(containers, {
    currentDaemonId,
    currentPid,
    killImpl,
    processCommandImpl,
    processCwdImpl,
    readPackageManifestImpl
  });
  if (!containerIds.length) {
    return [];
  }

  try {
    await execFileImpl("docker", ["rm", "-f", ...containerIds], {
      maxBuffer: 1024 * 1024,
      timeout: 30000
    });
    return containerIds;
  } catch (error) {
    if (containerIds.length === 1 && dockerContainerRemovalAlreadySettled(error)) {
      return containerIds;
    }
    logCleanup(logger, "debug", {
      error: String(error?.message || error)
    }, "Retrying Studio terminal container cleanup one container at a time.");
  }

  const removedContainerIds = [];
  for (const containerId of containerIds) {
    try {
      await execFileImpl("docker", ["rm", "-f", containerId], {
        maxBuffer: 1024 * 1024,
        timeout: 30000
      });
      removedContainerIds.push(containerId);
    } catch (error) {
      if (dockerContainerRemovalAlreadySettled(error)) {
        removedContainerIds.push(containerId);
        continue;
      }
      logCleanup(logger, "debug", {
        containerId,
        error: String(error?.message || error)
      }, "Skipping stale Studio terminal container because Docker refused to remove it.");
    }
  }
  return removedContainerIds;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function terminateProcesses(processIds = [], {
  graceMs = STALE_PROCESS_GRACE_MS,
  killImpl = process.kill
} = {}) {
  const uniqueProcessIds = [...new Set(processIds)]
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  for (const pid of uniqueProcessIds) {
    try {
      killImpl(pid, "SIGTERM");
    } catch {
      // Process already exited or is not ours.
    }
  }

  if (uniqueProcessIds.length && graceMs > 0) {
    await delay(graceMs);
  }

  for (const pid of uniqueProcessIds) {
    if (!processStillExists(pid, killImpl)) {
      continue;
    }
    try {
      killImpl(pid, "SIGKILL");
    } catch {
      // Process already exited or is not ours.
    }
  }

  return uniqueProcessIds;
}

async function cleanupStaleStudioTerminals({
  execFileImpl = execFileAsync,
  graceMs = STALE_PROCESS_GRACE_MS,
  killImpl = process.kill,
  logger = null,
  platform = process.platform,
  processCommandImpl = defaultProcessCommand,
  processCwdImpl = defaultProcessCwd,
  readPackageManifestImpl = defaultReadPackageManifest
} = {}) {
  const currentDaemonId = studioDaemonId();
  const removedContainers = await removeStaleStudioContainers({
    currentDaemonId,
    currentPid: process.pid,
    execFileImpl,
    killImpl,
    logger,
    processCommandImpl,
    processCwdImpl,
    readPackageManifestImpl
  });
  const removedRuntimeNetworks = await removeUnusedStudioRuntimeNetworks({
    currentDaemonId,
    currentPid: process.pid,
    execFileImpl,
    killImpl,
    logger,
    processCommandImpl,
    processCwdImpl,
    readPackageManifestImpl
  });

  let terminatedProcesses = [];
  if (platform !== "win32") {
    try {
      const result = await execFileImpl("ps", ["-eo", "pid=,ppid=,args="], {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 10000
      });
      terminatedProcesses = await terminateProcesses(
        selectStaleStudioToolchainProcessIds(parseProcessRows(result.stdout), {
          currentDaemonId,
          currentPid: process.pid,
          killImpl,
          processCommandImpl,
          processCwdImpl,
          readPackageManifestImpl
        }),
        {
          graceMs,
          killImpl
        }
      );
    } catch (error) {
      logCleanup(logger, "debug", {
        error: String(error?.message || error)
      }, "Skipping Studio toolchain process startup cleanup.");
    }
  }

  if (removedContainers.length || removedRuntimeNetworks.length || terminatedProcesses.length) {
    logCleanup(logger, "warn", {
      removedContainers,
      removedRuntimeNetworks,
      terminatedProcesses
    }, "Cleaned up stale Studio runtime resources on startup.");
  }

  return {
    removedContainers,
    removedRuntimeNetworks,
    terminatedProcesses
  };
}

export {
  cleanupStaleStudioTerminals,
  daemonPidFromStudioToolchainCommand,
  isStudioToolchainDockerRun,
  listStudioContainerIds,
  parseDockerNetworkRows,
  parseDockerContainerRows,
  parseProcessRows,
  removeUnusedStudioRuntimeNetworks,
  selectDescendantProcessIds,
  selectStaleStudioContainerIds,
  selectStaleStudioToolchainProcessIds
};
