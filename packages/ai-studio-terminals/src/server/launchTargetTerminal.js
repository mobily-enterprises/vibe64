import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  ensureTargetRuntimeNetwork
} from "../../../../server/lib/aiStudio/runtimeContainers.js";
import {
  aiStudioResult,
  launchTargetTerminalNamespace,
  sessionTerminalCwd
} from "./terminalShared.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";

const LAUNCH_METADATA = Object.freeze({
  href: "launch_target_open_href",
  id: "launch_target_id",
  kind: "launch_target_open_kind",
  label: "launch_target_label",
  openLabel: "launch_target_open_label",
  startedAt: "launch_target_started_at"
});

function normalizeLaunchTargetId(value = "") {
  return String(value || "").trim();
}

function normalizeOpenTarget(value = {}) {
  return {
    href: String(value.href || "").trim(),
    kind: String(value.kind || "url").trim() || "url",
    label: String(value.label || "Open").trim() || "Open"
  };
}

function openTargetFromMetadata(metadata = {}) {
  const href = String(metadata[LAUNCH_METADATA.href] || "").trim();
  if (!href) {
    return null;
  }
  return normalizeOpenTarget({
    href,
    kind: metadata[LAUNCH_METADATA.kind],
    label: metadata[LAUNCH_METADATA.openLabel]
  });
}

function launchTargetFromMetadata(metadata = {}) {
  const id = String(metadata[LAUNCH_METADATA.id] || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    label: String(metadata[LAUNCH_METADATA.label] || id).trim() || id,
    openTarget: openTargetFromMetadata(metadata),
    startedAt: String(metadata[LAUNCH_METADATA.startedAt] || "").trim()
  };
}

async function writeLaunchMetadata(store, sessionId, terminalSession = {}) {
  const metadata = terminalSession.metadata || {};
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  if (!metadata.launchTargetId || !openTarget.href) {
    return;
  }
  await Promise.all([
    store.writeMetadataValue(sessionId, LAUNCH_METADATA.id, metadata.launchTargetId),
    store.writeMetadataValue(sessionId, LAUNCH_METADATA.label, metadata.launchTargetLabel || metadata.launchTargetId),
    store.writeMetadataValue(sessionId, LAUNCH_METADATA.kind, openTarget.kind),
    store.writeMetadataValue(sessionId, LAUNCH_METADATA.openLabel, openTarget.label),
    store.writeMetadataValue(sessionId, LAUNCH_METADATA.href, openTarget.href),
    store.writeMetadataValue(sessionId, LAUNCH_METADATA.startedAt, new Date().toISOString())
  ]);
}

async function createLaunchContext(projectService, sessionId) {
  const runtime = await projectService.createRuntime();
  const session = await runtime.getSession(sessionId);
  return {
    config: runtime.projectConfig,
    runtime,
    session,
    store: runtime.store,
    targetRoot: session.targetRoot || projectService.targetRoot || ""
  };
}

async function listLaunchTargets(context) {
  const targets = await context.runtime.adapter.listLaunchTargets(context);
  return Array.isArray(targets) ? targets : [];
}

function findLaunchTarget(targets = [], launchTargetId = "") {
  const normalizedLaunchTargetId = normalizeLaunchTargetId(launchTargetId);
  return targets.find((target) => target.id === normalizedLaunchTargetId) || null;
}

function launchStatusResponse({
  launchTargets = [],
  session = {}
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  const openTarget = lastLaunchTarget?.openTarget || null;
  return {
    ok: true,
    launchTargets,
    lastLaunchTarget,
    openTarget: openTarget
      ? {
          ...openTarget,
          available: true,
          disabledReason: ""
        }
      : {
          available: false,
          disabledReason: "Run a launch target first.",
          href: "",
          kind: "url",
          label: "Open browser"
        }
  };
}

function createLaunchTargetTerminalController({ projectService } = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(launchTargetTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    async launchStatus(sessionId) {
      return aiStudioResult(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        return launchStatusResponse({
          launchTargets: await listLaunchTargets(context),
          session: context.session
        });
      });
    },

    async openLaunchTarget(sessionId) {
      return aiStudioResult(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const status = launchStatusResponse({
          launchTargets: await listLaunchTargets(context),
          session: context.session
        });
        if (!status.openTarget.available) {
          return {
            ok: false,
            error: status.openTarget.disabledReason
          };
        }
        return {
          ok: true,
          target: status.openTarget
        };
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const cwd = sessionTerminalCwd(context.session, projectService);
        if (!cwd) {
          return {
            ok: false,
            error: "AI Studio launch target root is not available."
          };
        }

        const launchTargets = await listLaunchTargets(context);
        const launchTarget = findLaunchTarget(launchTargets, input.launchTargetId);
        if (!launchTarget) {
          return {
            ok: false,
            error: "Launch target is not available."
          };
        }
        if (launchTarget.available === false) {
          return {
            ok: false,
            error: launchTarget.disabledReason || "Launch target is disabled."
          };
        }

        const spec = await context.runtime.adapter.createLaunchTargetTerminalSpec({
          context: {
            ...context,
            launchTarget
          },
          launchTargetId: launchTarget.id
        });
        if (spec?.ok === false) {
          return {
            ok: false,
            error: spec.message || "Launch target terminal cannot start."
          };
        }

        await ensureTargetRuntimeNetwork(context.targetRoot);
        const namespace = launchTargetTerminalNamespace(sessionId);
        const terminalEnv = await projectTerminalEnvironment({
          projectService,
          runtime: context.runtime,
          session: context.session,
          target: "launch-target",
          targetRoot: context.targetRoot
        });
        const launchEnv = {
          ...terminalEnv,
          ...(spec.env || {})
        };
        const launchEnvHash = terminalEnvironmentFingerprint(launchEnv);
        const terminalSession = startTerminalSession({
          args: spec.args || [],
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || cwd,
          env: launchEnv,
          maxRunning: 1,
          metadata: {
            ...(spec.metadata || {}),
            envHash: launchEnvHash,
            launchTargetId: launchTarget.id,
            launchTargetLabel: launchTarget.label,
            sessionId
          },
          namespace,
          namespaceLimitPrefix: namespace,
          onClose: spec.onClose,
          reuseRunning: (runningSession) => {
            return spec.reuseRunning !== false &&
              runningSession.metadata?.envHash === launchEnvHash &&
              runningSession.metadata?.launchTargetId === launchTarget.id;
          }
        });
        if (terminalSession?.ok !== false) {
          await writeLaunchMetadata(context.store, sessionId, terminalSession);
        }
        return terminalSession;
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  LAUNCH_METADATA,
  createLaunchTargetTerminalController
};
