import { isDeepStrictEqual } from "node:util";
import stripAnsi from "strip-ansi";
import { closeTerminalSession, listTerminalSessions } from "@local/vibe64-execution/server/terminalSessions";
import { stableHash } from "@local/vibe64-execution/server";
import { outputTargetTerminalNamespace } from "./terminalShared.js";
import { normalizedRuntimeRequirements } from "./vibe64OutputTargets.js";
import { launchIsReady } from "./outputTargetMetadata.js";
import { launchTerminalIsRunning } from "./launchPreviewReadiness.js";

// The launch terminals of a session: their execution kind, the actions they
// print, which running terminal a launch reuses, the environment it runs
// with, and the cleanup of superseded and stopped terminals.

const MAX_LAUNCH_ACTION_SCAN_LINES = 10;

function previewRuntimesForSpec(spec = {}) {
  return normalizedRuntimeRequirements([
    "git",
    ...(Array.isArray(spec.runtimes) ? spec.runtimes : [])
  ]);
}

function outputTargetExecutionDescriptor(outputTarget = {}, spec = {}) {
  const presentationKind = String(spec.metadata?.outputPresentationKind || "").trim();
  const outputMode = String(spec.metadata?.outputMode || "").trim();
  return {
    kind: presentationKind === "web"
      ? "preview"
      : outputMode === "finite"
        ? "job"
        : "terminal",
    label: String(outputTarget.label || spec.metadata?.outputTargetLabel || "Output target").trim()
  };
}

function firstLaunchOutputLines(output = "") {
  return stripAnsi(String(output || ""))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .slice(0, MAX_LAUNCH_ACTION_SCAN_LINES)
    .map((line) => line.trim())
    .filter(Boolean);
}

function launchActionFromLine(line = "") {
  const match = String(line || "").match(/(?:^|\s)action:(?:url:)?(https?:\/\/\S+)/u);
  if (!match) {
    return null;
  }

  const href = match[1].replace(/[),.;]+$/u, "");
  let label = "Open";
  try {
    const url = new URL(href);
    label = url.host || label;
  } catch {
    return null;
  }

  return {
    href,
    id: `url-${stableHash(href)}`,
    kind: "url",
    label
  };
}

function launchActionsFromOutput(output = "") {
  const actionMap = new Map();
  for (const line of firstLaunchOutputLines(output)) {
    const action = launchActionFromLine(line);
    if (action) {
      actionMap.set(action.id, action);
    }
  }
  return [...actionMap.values()];
}

function launchActionsChanged(currentActions, nextActions) {
  return JSON.stringify(currentActions || []) !== JSON.stringify(nextActions || []);
}

async function closeStoppedLaunchTerminals(sessionId = "") {
  const namespace = outputTargetTerminalNamespace(sessionId);
  await Promise.all(listTerminalSessions({
    namespace
  }).filter((terminal) => !launchTerminalIsRunning(terminal)).map((terminal) => {
    return closeTerminalSession(terminal.id, {
      namespace
    });
  }));
}

function releaseLaunchSpecReservation(spec) {
  // readable-check: allow method-probe - optional operation: only a spec that reserved a port carries its release
  if (typeof spec.releasePortReservation !== "function") {
    return;
  }
  try {
    spec.releasePortReservation();
  } catch {
    // Reservation release is best-effort cleanup for failed or reused launches.
  }
}

function launchTerminalIsReady(terminalSession = {}, readinessMarker = "") {
  if (!readinessMarker) {
    return true;
  }
  return launchIsReady(terminalSession.metadata || {});
}

function launchTerminalCanBeReused(runningSession = {}, options = {}) {
  const {
    launchEnvHash = "",
    outputTargetId = "",
    spec = {}
  } = options;
  return spec.reuseRunning !== false &&
    runningSession.metadata?.envHash === launchEnvHash &&
    runningSession.metadata?.outputTargetId === outputTargetId &&
    isDeepStrictEqual(runningSession.metadata?.outputParameters || {}, spec.metadata?.outputParameters || {});
}

function reusableLaunchTerminal(sessionId = "", options = {}) {
  const {
    launchEnvHash = "",
    outputTargetId = "",
    namespace = outputTargetTerminalNamespace(sessionId),
    spec = {}
  } = options;
  return listTerminalSessions({
    namespace,
    runningOnly: true
  }).find((terminal) => launchTerminalCanBeReused(terminal, {
    launchEnvHash,
    outputTargetId,
    spec
  })) || null;
}

function launchSpecEnvironment(specEnv, input = {}) {
  // readable-check: allow method-probe - input validation: a launch spec's env is a record or a function of the terminal input
  const value = typeof specEnv === "function"
    ? specEnv(input)
    : specEnv;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function launchSpecAllowedRoots(spec = {}) {
  return (Array.isArray(spec.allowedRoots) ? spec.allowedRoots : [])
    .map((root) => String(root || "").trim())
    .filter(Boolean);
}

function composeLaunchTerminalEnvironment({
  envBase = null,
  hashBase = null,
  terminalEnv = {},
  specEnv
}) {
  const resolvedEnvBase = envBase && typeof envBase === "object" && !Array.isArray(envBase)
    ? envBase
    : terminalEnv;
  const resolvedHashBase = hashBase && typeof hashBase === "object" && !Array.isArray(hashBase)
    ? hashBase
    : terminalEnv;
  const staticSpecEnv = launchSpecEnvironment(specEnv, {
    id: "",
    namespace: "",
    fingerprint: true
  });
  const hashEnv = {
    ...resolvedHashBase,
    ...staticSpecEnv
  };
  // A function env stays a function, so the command resolves it per terminal.
  // readable-check: allow method-probe - input validation: a launch spec's env is a record or a function of the terminal input
  const env = typeof specEnv === "function"
    ? (input = {}) => ({
        ...resolvedEnvBase,
        ...launchSpecEnvironment(specEnv, input)
      })
    : {
        ...resolvedEnvBase,
        ...staticSpecEnv
      };
  return {
    env,
    hashEnv
  };
}

async function cleanupSupersededLaunchTerminals({
  launchPreviewProxies,
  namespace = "",
  reusableTerminal = null,
  sessionId = ""
} = {}) {
  const preservedTerminalIds = reusableTerminal?.id ? [String(reusableTerminal.id)] : [];
  const preservedTerminalIdSet = new Set(preservedTerminalIds);
  let closed = 0;
  for (const terminal of listTerminalSessions({ namespace })) {
    if (!terminal.id || preservedTerminalIdSet.has(terminal.id)) {
      continue;
    }
    const result = await closeTerminalSession(terminal.id, {
      namespace
    });
    if (result.closed) {
      closed += 1;
    }
  }
  if (!preservedTerminalIds.length) {
    await launchPreviewProxies.close({
      sessionId
    });
  }
  return {
    closed
  };
}

export {
  previewRuntimesForSpec,
  outputTargetExecutionDescriptor,
  launchActionsFromOutput,
  launchActionsChanged,
  closeStoppedLaunchTerminals,
  releaseLaunchSpecReservation,
  launchTerminalIsReady,
  reusableLaunchTerminal,
  launchSpecEnvironment,
  launchSpecAllowedRoots,
  composeLaunchTerminalEnvironment,
  cleanupSupersededLaunchTerminals
};
