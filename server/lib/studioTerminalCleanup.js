import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import {
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_TOOLCHAIN_IMAGE,
  studioDockerLabel
} from "./studioRuntimeIdentity.js";

const execFileAsync = promisify(execFile);
const STUDIO_CODEX_CONTAINER_LABEL = studioDockerLabel("kind", "codex-terminal");
const STUDIO_TARGET_SCRIPT_CONTAINER_LABEL = studioDockerLabel("kind", "target-script-terminal");
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
    normalizedCommand.includes(STUDIO_TOOLCHAIN_IMAGE);
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

function processStillExists(pid, killImpl) {
  try {
    killImpl(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isStaleDaemonPid(daemonPid, {
  currentPid = process.pid,
  killImpl = process.kill
} = {}) {
  const normalizedDaemonPid = normalizeProcessId(daemonPid);
  if (!normalizedDaemonPid || normalizedDaemonPid === currentPid) {
    return false;
  }
  return !processStillExists(normalizedDaemonPid, killImpl);
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
  currentPid = process.pid,
  killImpl = process.kill
} = {}) {
  const rootPids = processes
    .filter((entry) =>
      entry.pid !== currentPid &&
      isStudioToolchainDockerRun(entry.command) &&
      isStaleDaemonPid(daemonPidFromStudioToolchainCommand(entry.command), {
        currentPid,
        killImpl
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
      const [id, rawDaemonPid = ""] = trimmedLine.split("\t");
      return {
        daemonPid: rawDaemonPid === MISSING_DOCKER_LABEL_VALUE ? 0 : normalizeProcessId(rawDaemonPid),
        id: String(id || "").trim()
      };
    })
    .filter((entry) => entry?.id);
}

function selectStaleStudioContainerIds(containers = [], {
  currentPid = process.pid,
  killImpl = process.kill
} = {}) {
  return containers
    .filter((container) => isStaleDaemonPid(container.daemonPid, {
      currentPid,
      killImpl
    }))
    .map((container) => container.id);
}

async function listStudioContainers(execFileImpl = execFileAsync) {
  const containers = new Map();
  for (const label of [STUDIO_CODEX_CONTAINER_LABEL, STUDIO_TARGET_SCRIPT_CONTAINER_LABEL]) {
    const result = await execFileImpl("docker", [
      "ps",
      "-a",
      "--filter",
      `label=${label}`,
      "--format",
      `{{.ID}}\t{{.Label "${STUDIO_DAEMON_PID_LABEL}"}}`
    ], {
      maxBuffer: 1024 * 1024,
      timeout: 10000
    });
    for (const container of parseDockerContainerRows(result.stdout)) {
      const existing = containers.get(container.id);
      containers.set(container.id, {
        ...container,
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
  currentPid = process.pid,
  execFileImpl = execFileAsync,
  killImpl = process.kill,
  logger = null
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
    currentPid,
    killImpl
  });
  if (!containerIds.length) {
    return [];
  }

  await execFileImpl("docker", ["rm", "-f", ...containerIds], {
    maxBuffer: 1024 * 1024,
    timeout: 30000
  });
  return containerIds;
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
  platform = process.platform
} = {}) {
  const removedContainers = await removeStaleStudioContainers({
    currentPid: process.pid,
    execFileImpl,
    killImpl,
    logger
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
          currentPid: process.pid,
          killImpl
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

  if (removedContainers.length || terminatedProcesses.length) {
    logCleanup(logger, "warn", {
      removedContainers,
      terminatedProcesses
    }, "Cleaned up stale Studio terminal processes on startup.");
  }

  return {
    removedContainers,
    terminatedProcesses
  };
}

export {
  cleanupStaleStudioTerminals,
  daemonPidFromStudioToolchainCommand,
  isStudioToolchainDockerRun,
  listStudioContainerIds,
  parseDockerContainerRows,
  parseProcessRows,
  selectDescendantProcessIds,
  selectStaleStudioContainerIds,
  selectStaleStudioToolchainProcessIds
};
