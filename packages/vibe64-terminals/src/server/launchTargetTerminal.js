import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  commandInvocation,
  vibe64Result,
  launchTargetTerminalNamespace,
  sessionTerminalCwd,
  stableHash
} from "./terminalShared.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  createLaunchPreviewProxyRegistry
} from "./launchPreviewProxy.js";

const LAUNCH_METADATA = Object.freeze({
  href: "launch_target_open_href",
  id: "launch_target_id",
  kind: "launch_target_open_kind",
  label: "launch_target_label",
  openLabel: "launch_target_open_label",
  startedAt: "launch_target_started_at"
});
const MAX_LAUNCH_ACTION_SCAN_LINES = 10;

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

function launchIsReady(metadata = {}) {
  return metadata.launchReady === true || metadata.launchReady === "true";
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
  await store.mutateSession(sessionId, async () => {
    await Promise.all([
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.id, metadata.launchTargetId),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.label, metadata.launchTargetLabel || metadata.launchTargetId),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.kind, openTarget.kind),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.openLabel, openTarget.label),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.href, openTarget.href),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.startedAt, new Date().toISOString())
    ]);
  });
}

async function createLaunchContext(projectService, sessionId) {
  const runtime = await projectService.createRuntime();
  const session = await runtime.getSession(sessionId);
  return {
    config: runtime.projectConfig,
    runtime,
    session,
    store: runtime.store,
    targetRoot: sessionTerminalCwd(session, projectService)
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
  session = {},
  terminal = null,
  previewTarget = null
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  const openTarget = lastLaunchTarget?.openTarget || null;
  const normalizedPreviewTarget = previewTarget && previewTarget.available !== false
    ? previewTarget
    : null;
  return {
    ok: true,
    activeTerminal: terminal ? launchTerminalStatus(terminal, {
      previewTarget: normalizedPreviewTarget
    }) : null,
    launchTargets,
    previewTarget: normalizedPreviewTarget || {
      available: false,
      disabledReason: previewTarget?.disabledReason || "Run a launch target first.",
      href: "",
      kind: "url",
      label: "Preview",
      targetHref: ""
    },
    lastLaunchTarget,
    openTarget: openTarget
      ? {
          ...openTarget,
          available: true,
          disabledReason: "",
          previewHref: normalizedPreviewTarget?.href || ""
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

function launchTerminalIsRunning(terminal = {}) {
  return terminal.status === "running" || terminal.status === "closing";
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
    namespace: launchTargetTerminalNamespace(sessionId)
  });
  return terminals.sort((left, right) => {
    return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
  }).at(-1) || null;
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

function launchActionsChanged(currentActions = [], nextActions = []) {
  return JSON.stringify(currentActions || []) !== JSON.stringify(nextActions || []);
}

async function closeStoppedLaunchTerminals(sessionId = "") {
  const namespace = launchTargetTerminalNamespace(sessionId);
  await Promise.all(listTerminalSessions({
    namespace
  }).filter((terminal) => !launchTerminalIsRunning(terminal)).map((terminal) => {
    return closeTerminalSession(terminal.id, {
      namespace
    });
  }));
}

function readinessMarkerFromSpec(spec = {}) {
  return String(spec.readinessMarker || spec.metadata?.readinessMarker || "").trim();
}

function launchTerminalIsReady(terminalSession = {}, readinessMarker = "") {
  if (!readinessMarker) {
    return true;
  }
  return launchIsReady(terminalSession.metadata || {});
}

async function markLaunchTerminalReady({
  publishSessionChanged = async () => null,
  store,
  sessionId = "",
  terminalSession = {},
  updateMetadata = () => null
} = {}) {
  const readyMetadata = {
    launchReady: true,
    launchReadyAt: new Date().toISOString()
  };
  const updatedSession = updateMetadata(readyMetadata);
  await writeLaunchMetadata(store, sessionId, {
    ...terminalSession,
    metadata: {
      ...(terminalSession.metadata || {}),
      ...readyMetadata,
      ...(updatedSession?.metadata || {})
    }
  });
  await publishSessionChanged(sessionId, {
    reason: "launch-target-ready"
  });
}

function createLaunchTargetTerminalController({
  projectService,
  publishSessionChanged = async () => null
} = {}) {
  const launchPreviewProxies = createLaunchPreviewProxyRegistry();

  async function previewTargetForStatus(sessionId = "", status = {}) {
    const targetHref = String(status.openTarget?.href || "").trim();
    if (!targetHref || status.openTarget?.available === false) {
      return null;
    }
    try {
      return await launchPreviewProxies.ensure(sessionId, targetHref);
    } catch (error) {
      return {
        available: false,
        disabledReason: String(error?.message || error || "Launch preview proxy could not start."),
        href: "",
        kind: "url",
        label: "Preview",
        targetHref
      };
    }
  }

  return Object.freeze({
    async closeAllForSession(sessionId) {
      await launchPreviewProxies.close(sessionId);
      return closeTerminalSessionsForNamespace(launchTargetTerminalNamespace(sessionId));
    },

    async closeTerminal(sessionId, terminalSessionId) {
      await launchPreviewProxies.close(sessionId);
      return closeTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    async launchStatus(sessionId) {
      return vibe64Result(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const status = launchStatusResponse({
          launchTargets: await listLaunchTargets(context),
          session: context.session,
          terminal: latestLaunchTerminal(sessionId)
        });
        const previewTarget = await previewTargetForStatus(sessionId, status);
        return launchStatusResponse({
          launchTargets: status.launchTargets,
          previewTarget,
          session: context.session,
          terminal: latestLaunchTerminal(sessionId)
        });
      });
    },

    async openLaunchTarget(sessionId) {
      return vibe64Result(async () => {
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
      return vibe64Result(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const cwd = sessionTerminalCwd(context.session, projectService);
        if (!cwd) {
          return {
            ok: false,
            error: "Vibe64 launch target root is not available."
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
        await ensureAdapterRuntimeContainers({
          runtime: context.runtime,
          session: context.session,
          target: "launch-target",
          targetRoot: context.targetRoot
        });
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
        const readinessMarker = readinessMarkerFromSpec(spec);
        let launchReadyWritten = false;
        await closeStoppedLaunchTerminals(sessionId);
        const terminalSession = startTerminalSession({
          args: spec.args || [],
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || cwd,
          env: launchEnv,
          maxRunning: 1,
          metadata: {
            ...(spec.metadata || {}),
            attemptedCommand: commandInvocation(spec),
            envHash: launchEnvHash,
            launchTargetId: launchTarget.id,
            launchTargetLabel: launchTarget.label,
            sessionId
          },
          namespace,
          namespaceLimitPrefix: namespace,
          onClose: spec.onClose,
          onStop: spec.onStop,
          onOutput: ({ output, session: runningTerminalSession, updateMetadata }) => {
            const actions = launchActionsFromOutput(output);
            if (actions.length > 0 && launchActionsChanged(runningTerminalSession.metadata?.actions, actions)) {
              updateMetadata({
                actions
              });
            }
            if (!readinessMarker || launchReadyWritten || !String(output || "").includes(readinessMarker)) {
              return;
            }
            launchReadyWritten = true;
            void markLaunchTerminalReady({
              publishSessionChanged,
              store: context.store,
              sessionId,
              terminalSession: runningTerminalSession,
              updateMetadata
            });
          },
          reuseRunning: (runningSession) => {
            return spec.reuseRunning !== false &&
              runningSession.metadata?.envHash === launchEnvHash &&
              runningSession.metadata?.launchTargetId === launchTarget.id;
          }
        });
        if (terminalSession?.ok !== false && launchTerminalIsReady(terminalSession, readinessMarker)) {
          await writeLaunchMetadata(context.store, sessionId, terminalSession);
        }
        return terminalSession;
      });
    },

    async stopTerminal(sessionId, terminalSessionId) {
      await launchPreviewProxies.close(sessionId);
      return stopTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
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
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  LAUNCH_METADATA,
  launchActionsFromOutput,
  createLaunchTargetTerminalController
};
