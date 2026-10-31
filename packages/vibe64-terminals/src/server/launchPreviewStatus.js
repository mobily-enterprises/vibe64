// A launched Preview's status: the Preview and open target a launch terminal serves, and the status
// response for an output target.

import { listTerminalSessions } from "@local/vibe64-execution/server/terminalSessions";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { outputTargetTerminalNamespace } from "./terminalShared.js";
import { staleLaunchRecovery } from "./launchRestart.js";
import { previewIdentityCapability } from "./launchPreviewAuth.js";
import {
  clearLaunchMetadata,
  launchAgentHref,
  launchIsReady,
  normalizeOpenTarget,
  outputTargetFromMetadata,
  previewStopState
} from "./outputTargetMetadata.js";
import {
  launchTerminalIsRunning,
  markLaunchTerminalReady,
  normalizeLaunchPreview,
  normalizePreviewRecovery,
  outputTargetCanStart,
  readyLaunchPreview,
  repairLaunchReadinessFromOutput
} from "./launchPreviewReadiness.js";

function outputTargetFromTerminalMetadata(terminal = {}) {
  const source = terminal && typeof terminal === "object" && !Array.isArray(terminal)
    ? terminal
    : {};
  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? source.metadata
    : {};
  const id = String(metadata.outputTargetId || "").trim();
  if (!id) {
    return null;
  }
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  return {
    id,
    outputParameters: metadata.outputParameters || {},
    agentHref: launchAgentHref(metadata),
    label: String(metadata.outputTargetLabel || id).trim() || id,
    openTarget: openTarget.href ? openTarget : null,
    startedAt: String(source.createdAt || "").trim()
  };
}

function outputTargetForPreviewStatus({
  session = {},
  terminal = null
} = {}) {
  const terminalOutputTarget = terminal ? outputTargetFromTerminalMetadata(terminal) : null;
  const sessionOutputTarget = outputTargetFromMetadata(session.metadata || {});
  if (terminalOutputTarget && !terminalOutputTarget.openTarget && sessionOutputTarget?.openTarget) {
    return {
      ...terminalOutputTarget,
      agentHref: terminalOutputTarget.agentHref || sessionOutputTarget.agentHref,
      openTarget: sessionOutputTarget.openTarget,
      startedAt: terminalOutputTarget.startedAt || sessionOutputTarget.startedAt
    };
  }
  return terminalOutputTarget || sessionOutputTarget;
}

function openTargetForPreviewStatus({
  lastOutputTarget = null,
  terminal = null
} = {}) {
  if (lastOutputTarget?.openTarget?.href) {
    return lastOutputTarget.openTarget;
  }
  const terminalOpenTarget = outputTargetFromTerminalMetadata(terminal)?.openTarget || null;
  return terminalOpenTarget?.href ? terminalOpenTarget : null;
}

function previewTargetFromLaunchPreview(preview = {}) {
  const normalizedPreview = normalizeLaunchPreview(preview);
  const recovery = normalizePreviewRecovery(normalizedPreview.recovery);
  const available = ["ready", "stale"].includes(normalizedPreview.state) && Boolean(normalizedPreview.href);
  return {
    available,
    disabledReason: available ? "" : normalizedPreview.message,
    href: available ? normalizedPreview.href : "",
    kind: "url",
    label: "Preview",
    ...(recovery ? { recovery } : {}),
    ...(normalizedPreview.state === "stale" ? { stale: true } : {}),
    targetHref: normalizedPreview.targetHref
  };
}

function openTargetFromLaunchPreview(preview = {}, openTarget = null) {
  const normalizedPreview = normalizeLaunchPreview(preview);
  if (normalizedPreview.state === "project_closed") {
    return {
      available: false,
      disabledReason: "Project is closed.",
      href: "",
      kind: "url",
      label: "Open browser"
    };
  }
  if (!openTarget?.href) {
    return {
      available: false,
      disabledReason: "Run an output target first.",
      href: "",
      kind: "url",
      label: "Open browser"
    };
  }
  return {
    ...normalizeOpenTarget(openTarget),
    available: true,
    disabledReason: "",
    previewHref: ["ready", "stale"].includes(normalizedPreview.state) ? normalizedPreview.href : ""
  };
}

function outputExecutionStatus(terminal = null) {
  if (!terminal) {
    return {
      error: null,
      mode: "",
      presentationKind: "",
      state: "idle",
      targetId: ""
    };
  }
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const outputError = metadata.outputResultError && typeof metadata.outputResultError === "object"
    ? metadata.outputResultError
    : null;
  const running = launchTerminalIsRunning(terminal);
  let state = "stopped";
  if (outputError) state = "failed";
  else if (running) state = launchIsReady(metadata) ? "ready" : "preparing";
  else if (terminal.status === "exited") state = terminal.exitCode === 0 ? "succeeded" : "failed";
  return {
    error: outputError,
    mode: String(metadata.outputMode || ""),
    presentationKind: String(metadata.outputPresentationKind || ""),
    state,
    targetId: String(metadata.outputTargetId || "")
  };
}

function outputStatusResponseFromPreviewStatus({
  outputRuns = [],
  outputTargets = [],
  previewStatus = {},
  previewApplicationIdentities = []
} = {}) {
  const preview = normalizeLaunchPreview(previewStatus.preview || {});
  const previewTarget = previewTargetFromLaunchPreview(preview);
  const normalizedPreviewTarget = previewTarget.available !== false ? previewTarget : null;
  return {
    ok: true,
    activeTerminal: previewStatus.activeTerminal ? launchTerminalStatus(previewStatus.activeTerminal, {
      previewTarget: normalizedPreviewTarget
    }) : null,
    output: outputExecutionStatus(previewStatus.activeTerminal || null),
    outputRuns,
    outputTargets,
    preview,
    previewIdentity: previewIdentityCapability({
      previewApplicationIdentities,
      preview,
      terminal: previewStatus.activeTerminal
    }),
    previewTarget,
    lastOutputTarget: previewStatus.lastOutputTarget || null,
    openTarget: openTargetFromLaunchPreview(preview, previewStatus.openTarget || null)
  };
}

function launchTerminalStatus(terminal = {}, {
  previewTarget = null
} = {}) {
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const actions = launchActionsWithPreviewTarget(metadata.actions, previewTarget);
  return {
    closeError: String(terminal.closeError || ""),
    commandPreview: String(terminal.commandPreview || ""),
    createdAt: String(terminal.createdAt || ""),
    exitCode: terminal.exitCode ?? null,
    id: String(terminal.id || ""),
    metadata: {
      ...metadata,
      actions
    },
    output: String(terminal.output || ""),
    running: launchTerminalIsRunning(terminal),
    status: String(terminal.status || "")
  };
}

function launchActionsWithPreviewTarget(actions = [], previewTarget = null) {
  const entries = Array.isArray(actions) ? actions : [];
  if (!previewTarget?.href || !previewTarget.targetHref) {
    return entries;
  }
  return entries.map((action) => {
    if (String(action?.href || "") !== previewTarget.targetHref) {
      return action;
    }
    return {
      ...action,
      previewHref: previewTarget.href
    };
  });
}

function latestLaunchTerminal(sessionId = "") {
  const terminals = listTerminalSessions({
    namespace: outputTargetTerminalNamespace(sessionId)
  });
  return terminals.sort((left, right) => {
    return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
  }).at(-1) || null;
}

function stoppedLaunchPreviewStatus({
  activeTerminal = null,
  outputTargets = [],
  lastOutputTarget = null,
  openTarget = null
} = {}) {
  const exitCode = activeTerminal?.exitCode ?? null;
  const failed = exitCode !== 0;
  const targetHref = String(openTarget?.href || "").trim();
  return {
    activeTerminal,
    lastOutputTarget,
    openTarget,
    preview: normalizeLaunchPreview({
      canRestart: Boolean(lastOutputTarget?.id || activeTerminal?.metadata?.outputTargetId),
      canShowLog: Boolean(activeTerminal?.id),
      canStart: outputTargetCanStart(outputTargets),
      message: failed
        ? `The preview process exited with code ${exitCode ?? "unknown"}.`
        : "The preview process exited.",
      reason: failed ? "process_exited_nonzero" : "process_exited",
      state: failed ? "failed" : "stopped",
      targetHref,
      terminalId: activeTerminal?.id || ""
    })
  };
}

async function missingLaunchPreviewStatus({
  context = {},
  outputTargets = [],
  openTarget = null,
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const lastOutputTarget = outputTargetFromMetadata(context.session?.metadata || {});
  const recovery = staleLaunchRecovery({
    canRestart: Boolean(lastOutputTarget?.id)
  });
  let metadataCleared = false;
  try {
    metadataCleared = await clearLaunchMetadata(context.store, sessionId);
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.restartReconcile.clearMetadata.error", {
      error: vibe64SessionDebugError(error),
      sessionId,
      sessionSourceRoot: context.sessionSourceRoot
    }, {
      level: "warn"
    });
  }
  if (metadataCleared) {
    await publishSessionChanged(sessionId, {
      projectSlug: context.projectSlug,
      reason: "output-target-stale-cleared"
    });
  }
  vibe64SessionDebugLog("server.outputTargetTerminal.restartReconcile.missingProcess", {
    canRestart: recovery.canRestart,
    outputTargetId: lastOutputTarget?.id || "",
    metadataCleared,
    reason: recovery.reason,
    sessionId,
    targetHref: String(openTarget?.href || lastOutputTarget?.openTarget?.href || "").trim(),
    sessionSourceRoot: context.sessionSourceRoot
  }, {
    level: "warn"
  });
  return {
    activeTerminal: null,
    lastOutputTarget: null,
    openTarget: null,
    preview: normalizeLaunchPreview({
      canRestart: recovery.canRestart,
      canShowLog: false,
      canStart: outputTargetCanStart(outputTargets),
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      reason: recovery.reason,
      recovery,
      state: "failed",
      targetHref: String(openTarget?.href || lastOutputTarget?.openTarget?.href || "").trim(),
      terminalId: ""
    })
  };
}

async function resolveLaunchPreviewStatus({
  context = {},
  launchPreviewProxies = null,
  outputTargets = [],
  markReady = markLaunchTerminalReady,
  options = {},
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const activeTerminal = latestLaunchTerminal(sessionId);
  const initialLastOutputTarget = outputTargetForPreviewStatus({
    session: context.session,
    terminal: activeTerminal
  });
  const initialOpenTarget = openTargetForPreviewStatus({
    lastOutputTarget: initialLastOutputTarget,
    terminal: activeTerminal
  });
  const presentationKind = String(activeTerminal?.metadata?.outputPresentationKind || "").trim();
  if (activeTerminal && presentationKind && presentationKind !== "web") {
    return {
      activeTerminal,
      lastOutputTarget: initialLastOutputTarget,
      openTarget: null,
      preview: normalizeLaunchPreview({
        canRestart: false,
        canShowLog: false,
        canStart: outputTargetCanStart(outputTargets),
        message: presentationKind === "terminal"
          ? "This output runs in the terminal."
          : "This finite output has no web preview.",
        state: "idle",
        terminalId: activeTerminal.id
      })
    };
  }
  if (activeTerminal && launchTerminalIsRunning(activeTerminal)) {
    let terminalForPreview = activeTerminal;
    const targetHref = String(initialOpenTarget?.href || "").trim();
    if (!launchIsReady(activeTerminal.metadata || {})) {
      terminalForPreview = await repairLaunchReadinessFromOutput({
        context,
        markReady,
        publishSessionChanged,
        sessionId,
        terminal: activeTerminal
      }) || activeTerminal;
    }
    if (!launchIsReady(terminalForPreview.metadata || {})) {
      return {
        activeTerminal: terminalForPreview,
        lastOutputTarget: initialLastOutputTarget,
        openTarget: initialOpenTarget,
        preview: normalizeLaunchPreview({
          canRestart: false,
          canShowLog: Boolean(terminalForPreview.id),
          canStart: false,
          message: "Preparing preview.",
          reason: "launch_starting",
          state: "starting",
          targetHref,
          terminalId: terminalForPreview.id
        })
      };
    }
    return readyLaunchPreview({
      activeTerminal: terminalForPreview,
      canShowLog: true,
      context,
      launchPreviewProxies,
      outputTargets,
      lastOutputTarget: outputTargetForPreviewStatus({
        session: context.session,
        terminal: terminalForPreview
      }),
      openTarget: openTargetForPreviewStatus({
        lastOutputTarget: outputTargetForPreviewStatus({
          session: context.session,
          terminal: terminalForPreview
        }),
        terminal: terminalForPreview
      }),
      options,
      sessionId,
      terminal: terminalForPreview
    });
  }
  if (activeTerminal?.status === "exited") {
    return stoppedLaunchPreviewStatus({
      activeTerminal,
      outputTargets,
      lastOutputTarget: initialLastOutputTarget,
      openTarget: initialOpenTarget
    });
  }

  // A saved Stop intentionally has no live process, including after scoped
  // tests or an editor restart. Keep its target and parameters for explicit Start.
  if (initialLastOutputTarget?.id && !previewStopState(context.session?.metadata).stopped) {
    return missingLaunchPreviewStatus({
      context,
      outputTargets,
      openTarget: initialOpenTarget,
      publishSessionChanged,
      sessionId
    });
  }

  return {
    activeTerminal: null,
    lastOutputTarget: initialLastOutputTarget,
    openTarget: initialOpenTarget,
    preview: normalizeLaunchPreview({
      canRestart: Boolean(initialLastOutputTarget?.id),
      canShowLog: false,
      canStart: outputTargetCanStart(outputTargets),
      message: "Run an output target first.",
      state: "idle"
    })
  };
}

export {
  latestLaunchTerminal,
  outputStatusResponseFromPreviewStatus,
  resolveLaunchPreviewStatus
};
