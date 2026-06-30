import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  runtimeTargetName
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  STUDIO_DAEMON_ID_LABEL,
  studioDockerLabel
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const execFileAsync = promisify(execFile);

const CODEX_TERMINAL_CONTAINER_KIND_LABEL = studioDockerLabel("kind", "codex-terminal");
const CODEX_TERMINAL_SESSION_LABEL = studioDockerLabel("session");
const CODEX_TERMINAL_TERMINAL_LABEL = studioDockerLabel("terminal");
const CODEX_TERMINAL_TARGET_LABEL = studioDockerLabel("target");

function dockerLabelFilter(label = "") {
  const normalized = normalizeText(label);
  return normalized ? ["--filter", `label=${normalized}`] : [];
}

function parseCodexTerminalContainerRows(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => {
      const [id = "", terminalId = "", name = "", status = "", createdAt = ""] = line.split("\t");
      const normalizedId = normalizeText(id);
      if (!normalizedId) {
        return null;
      }
      return {
        id: normalizedId,
        terminalId: normalizeText(terminalId),
        ...(normalizeText(name) ? { name: normalizeText(name) } : {}),
        ...(normalizeText(status) ? { status: normalizeText(status) } : {}),
        ...(normalizeText(createdAt) ? { createdAt: normalizeText(createdAt) } : {})
      };
    })
    .filter(Boolean);
}

function dockerContainerRemovalAlreadySettled(error = {}) {
  return /No such container|removal of container .* is already in progress/iu.test(String(error?.stderr || error?.message || error || ""));
}

async function listCodexTerminalContainers({
  daemonId = "",
  execFileImpl = execFileAsync,
  runningOnly = false,
  sessionId = "",
  targetRoot = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const targetName = runtimeTargetName(targetRoot);
  if (!normalizedSessionId || !targetName) {
    return [];
  }
  const result = await execFileImpl("docker", [
    "ps",
    ...(runningOnly ? [] : ["-a"]),
    ...dockerLabelFilter(CODEX_TERMINAL_CONTAINER_KIND_LABEL),
    ...dockerLabelFilter(`${CODEX_TERMINAL_SESSION_LABEL}=${normalizedSessionId}`),
    ...dockerLabelFilter(`${CODEX_TERMINAL_TARGET_LABEL}=${targetName}`),
    ...dockerLabelFilter(daemonId ? `${STUDIO_DAEMON_ID_LABEL}=${daemonId}` : ""),
    "--format",
    `{{.ID}}\t{{.Label "${CODEX_TERMINAL_TERMINAL_LABEL}"}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}`
  ], {
    maxBuffer: 1024 * 1024,
    timeout: 10000
  });
  return parseCodexTerminalContainerRows(result.stdout);
}

async function listRunningCodexTerminalContainers(options = {}) {
  return listCodexTerminalContainers({
    ...options,
    runningOnly: true
  });
}

async function removeCodexTerminalContainers({
  exceptTerminalIds = [],
  terminalIds = [],
  ...options
} = {}) {
  const execFileImpl = options.execFileImpl || execFileAsync;
  const preservedTerminalIds = new Set((Array.isArray(exceptTerminalIds) ? exceptTerminalIds : [])
    .map(normalizeText)
    .filter(Boolean));
  const selectedTerminalIds = new Set((Array.isArray(terminalIds) ? terminalIds : [])
    .map(normalizeText)
    .filter(Boolean));
  const containerIds = (await listCodexTerminalContainers(options))
    .filter((container) => !preservedTerminalIds.has(container.terminalId))
    .filter((container) => selectedTerminalIds.size < 1 || selectedTerminalIds.has(container.terminalId))
    .map((container) => container.id);
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
      if (!dockerContainerRemovalAlreadySettled(error)) {
        throw error;
      }
      removedContainerIds.push(containerId);
    }
  }
  return removedContainerIds;
}

export {
  CODEX_TERMINAL_CONTAINER_KIND_LABEL,
  listCodexTerminalContainers,
  listRunningCodexTerminalContainers,
  removeCodexTerminalContainers
};
