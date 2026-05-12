import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STUDIO_CODEX_CONTAINER_LABEL = "jskit-ai-studio.kind=codex-terminal";
const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const STALE_PROCESS_GRACE_MS = 500;

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
    normalizedCommand.includes(TOOLCHAIN_IMAGE);
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

function selectStaleStudioToolchainProcessIds(processes = [], currentPid = process.pid) {
  const rootPids = processes
    .filter((entry) => entry.pid !== currentPid && isStudioToolchainDockerRun(entry.command))
    .map((entry) => entry.pid);
  return selectDescendantProcessIds(processes, rootPids)
    .filter((pid) => pid !== currentPid);
}

async function listStudioCodexContainerIds(execFileImpl = execFileAsync) {
  const result = await execFileImpl("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=${STUDIO_CODEX_CONTAINER_LABEL}`
  ], {
    maxBuffer: 1024 * 1024,
    timeout: 10000
  });
  return String(result.stdout || "")
    .split(/\s+/u)
    .map((id) => id.trim())
    .filter(Boolean);
}

async function removeStudioCodexContainers({
  execFileImpl = execFileAsync,
  logger = null
} = {}) {
  let containerIds = [];
  try {
    containerIds = await listStudioCodexContainerIds(execFileImpl);
  } catch (error) {
    logCleanup(logger, "debug", {
      error: String(error?.message || error)
    }, "Skipping Studio Codex container startup cleanup.");
    return [];
  }

  if (!containerIds.length) {
    return [];
  }

  await execFileImpl("docker", ["rm", "-f", ...containerIds], {
    maxBuffer: 1024 * 1024,
    timeout: 30000
  });
  return containerIds;
}

function processStillExists(pid, killImpl) {
  try {
    killImpl(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  const removedContainers = await removeStudioCodexContainers({
    execFileImpl,
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
        selectStaleStudioToolchainProcessIds(parseProcessRows(result.stdout)),
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
  isStudioToolchainDockerRun,
  parseProcessRows,
  selectDescendantProcessIds,
  selectStaleStudioToolchainProcessIds
};
