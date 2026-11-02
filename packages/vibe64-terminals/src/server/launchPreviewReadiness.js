// Whether a launched Preview is ready: its readiness marker in the terminal output, marking the terminal
// ready, and the Preview proxy it serves through.
import { AppError } from "@jskit-ai/kernel/server/runtime";

import stripAnsi from "strip-ansi";
import { readTerminalSession, updateTerminalSessionMetadata } from "@local/vibe64-execution/server/terminalSessions";
import { vibe64SessionDebugDurationMs, vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { outputTargetTerminalNamespace } from "./terminalShared.js";
import { readPreviewLocatorSource } from "./previewLocator.js";
import { LAUNCH_RESTART_REASON_SOURCE_CHANGED, launchRestartRecoveryForTerminal } from "./launchRestart.js";
import { previewEditorOrigin, previewPublicOriginForLaunch } from "./previewPublicOrigin.js";
import { previewAuthForLaunchTerminal, previewIdentityCommandRunnerForLaunchTerminal } from "./launchPreviewAuth.js";
import { clearLaunchMetadataForTerminal, launchIsReady, writeLaunchMetadata } from "./outputTargetMetadata.js";

function normalizePreviewRecovery(recovery = null) {
  return recovery && typeof recovery === "object" && !Array.isArray(recovery) ? recovery : null;
}

function outputTargetCanStart(outputTargets = []) {
  return Array.isArray(outputTargets) && outputTargets.some((target) => target?.available !== false);
}

function normalizeLaunchPreview({
  canRestart = false,
  canShowLog = false,
  canStart = false,
  href = "",
  message = "",
  reason = "",
  recovery = null,
  state = "idle",
  targetHref = "",
  terminalId = ""
} = {}) {
  const normalizedState = [
    "idle",
    "starting",
    "ready",
    "stale",
    "stopped",
    "failed",
    "project_closed"
  ].includes(state) ? state : "idle";
  const fallbackMessage = normalizedState === "idle"
    ? "Run an output target first."
    : normalizedState === "ready"
      ? "Preview is ready."
      : normalizedState === "stale"
        ? "Server-side app files changed after this preview started."
        : normalizedState === "starting"
          ? "Preparing preview."
          : normalizedState === "project_closed"
            ? "Project is closed."
            : "Preview could not be opened.";
  return {
    canRestart: Boolean(canRestart),
    canShowLog: Boolean(canShowLog),
    canStart: Boolean(canStart),
    href: String(href || "").trim(),
    message: String(message || fallbackMessage).trim() || fallbackMessage,
    reason: String(reason || "").trim(),
    recovery: normalizePreviewRecovery(recovery),
    state: normalizedState,
    targetHref: String(targetHref || "").trim(),
    terminalId: String(terminalId || "").trim()
  };
}

function launchTerminalIsRunning(terminal = {}) {
  return terminal.status === "running" || terminal.status === "closing";
}

function launchReadinessMarkerLineSeen(output = "", readinessMarker = "") {
  const marker = String(readinessMarker || "").trim();
  if (!marker) {
    return false;
  }
  return stripAnsi(String(output || ""))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .some((line) => {
      const text = line.trim().replace(/^[\s\u2800-\u28FF]+|[\s\u2800-\u28FF]+$/gu, "");
      return text === marker;
    });
}

function readinessMarkerFromSpec(spec = {}) {
  return String(spec.readinessMarker || spec.metadata?.readinessMarker || "").trim();
}

async function markLaunchTerminalReady({
  namespace = "",
  projectSlug = "",
  publishSessionChanged,
  source = "marker",
  store,
  sessionId = "",
  terminalSession = {},
  updateMetadata
}) {
  const terminalSessionId = String(terminalSession.id || "").trim();
  const currentTerminal = readTerminalSession(terminalSessionId, {
    namespace
  });
  if (!launchTerminalIsRunning(currentTerminal)) {
    vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.processExited", {
      exitCode: currentTerminal?.exitCode ?? null,
      sessionId,
      status: String(currentTerminal?.status || "missing"),
      terminalSessionId
    }, {
      level: "warn"
    });
    return {
      ready: false,
      terminal: currentTerminal,
      transitioned: false
    };
  }
  if (launchIsReady(currentTerminal.metadata || {})) {
    return {
      ready: true,
      terminal: currentTerminal,
      transitioned: false
    };
  }
  const readyMetadata = {
    launchReady: true,
    launchReadyAt: new Date().toISOString(),
    launchReadySource: String(source || "marker")
  };
  const readyTerminal = {
    ...currentTerminal,
    metadata: {
      ...(terminalSession.metadata || {}),
      ...(currentTerminal.metadata || {}),
      ...readyMetadata
    }
  };
  await writeLaunchMetadata(store, sessionId, readyTerminal);
  const runningTerminal = readTerminalSession(terminalSessionId, {
    namespace
  });
  if (!launchTerminalIsRunning(runningTerminal)) {
    await clearLaunchMetadataForTerminal(store, sessionId, terminalSessionId);
    return {
      ready: false,
      terminal: runningTerminal,
      transitioned: false
    };
  }
  const updatedSession = updateMetadata(readyMetadata);
  const updatedTerminal = readTerminalSession(terminalSessionId, {
    namespace
  }) || updatedSession || readyTerminal;
  await publishSessionChanged(sessionId, {
    projectSlug,
    reason: "output-target-ready"
  });
  vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.ready", {
    source: readyMetadata.launchReadySource,
    sessionId,
    terminalSessionId
  });
  return {
    ready: true,
    terminal: updatedTerminal,
    transitioned: true
  };
}

async function repairLaunchReadinessFromOutput({
  context = {},
  markReady = markLaunchTerminalReady,
  publishSessionChanged,
  sessionId = "",
  terminal = null
} = {}) {
  const terminalSessionId = String(terminal?.id || "").trim();
  const readinessMarker = readinessMarkerFromSpec(terminal?.metadata || {});
  if (
    !terminalSessionId ||
    !readinessMarker ||
    !launchTerminalIsRunning(terminal) ||
    launchIsReady(terminal?.metadata || {}) ||
    !launchReadinessMarkerLineSeen(terminal?.output, readinessMarker)
  ) {
    return null;
  }
  const startedAtMs = Date.now();
  try {
    const result = await markReady({
      namespace: outputTargetTerminalNamespace(sessionId),
      projectSlug: context.projectSlug,
      publishSessionChanged,
      source: "marker-repair",
      store: context.store,
      sessionId,
      terminalSession: terminal,
      updateMetadata: (metadata) => updateTerminalSessionMetadata(terminalSessionId, metadata, {
        namespace: outputTargetTerminalNamespace(sessionId)
      })
    });
    return result?.ready ? result.terminal || terminal : null;
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.repairError", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      readinessMarker,
      sessionId,
      terminalSessionId
    }, {
      level: "warn"
    });
    return null;
  }
}

async function readyLaunchPreview({
  activeTerminal = null,
  canShowLog = false,
  context = {},
  launchPreviewProxies = null,
  outputTargets = [],
  lastOutputTarget = null,
  openTarget = null,
  options = {},
  sessionId = "",
  terminal = null
} = {}) {
  const targetHref = String(openTarget?.href || "").trim();
  const terminalSessionId = String(terminal?.id || "").trim();
  if (!targetHref) {
    return {
      activeTerminal,
      lastOutputTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastOutputTarget?.id),
        canShowLog,
        canStart: outputTargetCanStart(outputTargets),
        message: "Output target URL is missing.",
        reason: "missing_target_href",
        state: "failed",
        terminalId: terminalSessionId
      })
    };
  }
  try {
    const previewTarget = await ensureLaunchPreviewProxy({
      context,
      launchPreviewProxies,
      options,
      sessionId,
      targetHref,
      terminal
    });
    const restartRecovery = await launchRestartRecoveryForTerminal({
      context,
      terminal
    });
    const stale = Boolean(restartRecovery);
    return {
      activeTerminal,
      lastOutputTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastOutputTarget?.id || terminal?.metadata?.outputTargetId),
        canShowLog,
        canStart: false,
        href: previewTarget.href,
        message: stale
          ? "Server-side app files changed after this preview started."
          : "Preview is ready.",
        reason: stale ? (restartRecovery.reason || LAUNCH_RESTART_REASON_SOURCE_CHANGED) : "",
        recovery: restartRecovery,
        state: stale ? "stale" : "ready",
        targetHref,
        terminalId: terminalSessionId
      })
    };
  } catch (error) {
    return {
      activeTerminal,
      lastOutputTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastOutputTarget?.id || terminal?.metadata?.outputTargetId),
        canShowLog,
        canStart: outputTargetCanStart(outputTargets),
        message: String(error?.message || error || "Launch preview proxy could not start."),
        reason: "preview_proxy_unavailable",
        state: "failed",
        targetHref,
        terminalId: terminalSessionId
      })
    };
  }
}

async function ensureLaunchPreviewProxy({
  context = {},
  launchPreviewProxies,
  options = {},
  previewPublicOrigin = "",
  sessionId = "",
  targetHref = "",
  terminal = null
}) {
  return launchPreviewProxies.ensure({
    locatorSource: await readPreviewLocatorSource(context.session),
    editorOrigin: previewEditorOrigin({
      editorOrigin: options.editorOrigin,
      env: options.env,
      publicHost: options.publicHost,
      publicProtocol: options.publicProtocol
    }),
    executePreviewIdentityCommand: terminal?.metadata?.previewIdentity
      ? async ({ selection }) => {
        const runner = previewIdentityCommandRunnerForLaunchTerminal({
          context,
          runCommand: options.runCommand,
          targetHref,
          terminal
        });
        if (!runner) {
          throw new AppError(409, "Application preview identity command is unavailable. Restart the preview.", {
            code: "vibe64_preview_identity_command_unavailable"
          });
        }
        return runner(selection);
      }
      : null,
    previewPublicOrigin: String(
      previewPublicOrigin ||
      terminal?.metadata?.previewPublicOrigin ||
      previewPublicOriginForLaunch({
        env: options.env,
        previewPublicDomain: options.previewPublicDomain,
        publicHost: options.publicHost,
        publicProtocol: options.publicProtocol,
        publicUserDomain: options.publicUserDomain,
        sessionId
      })
    ).trim(),
    previewAuth: previewAuthForLaunchTerminal(terminal, {
      sessionId,
      targetHref
    }),
    sessionId,
    targetHref,
    terminalSessionId: String(terminal?.id || "").trim()
  }, targetHref);
}

export {
  ensureLaunchPreviewProxy,
  launchReadinessMarkerLineSeen,
  launchTerminalIsRunning,
  markLaunchTerminalReady,
  normalizeLaunchPreview,
  normalizePreviewRecovery,
  outputTargetCanStart,
  readinessMarkerFromSpec,
  readyLaunchPreview,
  repairLaunchReadinessFromOutput
};
