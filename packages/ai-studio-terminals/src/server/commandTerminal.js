import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  aiStudioResult,
  commandTerminalNamespace,
  normalizePlainObject
} from "./terminalShared.js";
import {
  COMMAND_RESULT_ENV,
  createCommandResultFile,
  readCommandResultFile,
  removeCommandResultFile
} from "./commandTerminalResults.js";

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function terminalCwd(session = {}, projectService = {}) {
  return String(session.targetRoot || projectService.targetRoot || "").trim();
}

async function writeActionTerminalResult({
  action = {},
  exitCode,
  input = {},
  resultFile = {},
  runtime,
  session = {},
  spec = {}
} = {}) {
  const completed = exitCode === 0;
  const resultEffects = completed ? await readCommandResultFile(resultFile.path) : {
    deleteMetadata: [],
    metadata: {}
  };
  const metadata = completed ? {
    ...(spec.successMetadata || {}),
    ...resultEffects.metadata
  } : {};
  const message = completed
    ? spec.successMessage || `${action.label || action.id} completed.`
    : spec.failureMessage || `${action.label || action.id} failed with exit code ${exitCode}.`;
  const actionResult = await runtime.store.writeActionResult(
    session.sessionId,
    action.id,
    {
      actionLabel: action.label,
      actionType: action.type,
      artifacts: {},
      input,
      message,
      metadata,
      status: completed ? "completed" : "blocked",
      stepId: session.currentStep
    }
  );
  if (completed) {
    await Promise.all([
      ...resultEffects.deleteMetadata.map((name) => {
        return runtime.store.deleteMetadataValue(session.sessionId, name);
      }),
      ...Object.entries(metadata).map(([name, value]) => {
        return runtime.store.writeMetadataValue(session.sessionId, name, value);
      })
    ]);
  }
  await runtime.store.appendCommandLogEntry(session.sessionId, {
    actionId: action.id,
    actionLabel: action.label,
    actionType: action.type,
    kind: "terminal-action",
    status: actionResult.status,
    stepId: session.currentStep
  });
}

function createCommandTerminalController({ projectService } = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(commandTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const actionId = String(input?.actionId || "").trim();
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const action = actionById(session, actionId);
        if (!action) {
          return {
            ok: false,
            error: `Action ${actionId || "(empty)"} is not available on this AI Studio step.`
          };
        }
        if (action.type !== "command") {
          return {
            ok: false,
            error: `Action ${action.label || action.id} does not run in the command terminal.`
          };
        }
        if (action.enabled !== true) {
          return {
            ok: false,
            error: action.disabledReason || `Action ${action.label || action.id} is disabled.`
          };
        }
        const cwd = terminalCwd(session, projectService);
        if (!cwd) {
          return {
            ok: false,
            error: "AI Studio command target root is not available."
          };
        }

        const commandInput = normalizePlainObject(input?.input);
        const spec = await runtime.adapter.createCommandTerminalSpec(action.id, {
          action,
          config: runtime.projectConfig,
          input: commandInput,
          runtime,
          session,
          store: runtime.store
        });
        if (spec?.ok === false) {
          return {
            ok: false,
            error: spec.message || `Command ${action.label || action.id} cannot start.`
          };
        }

        const namespace = commandTerminalNamespace(sessionId);
        const projectConfigEnv = typeof projectService.projectConfigEnvironment === "function"
          ? await projectService.projectConfigEnvironment()
          : {};
        const resultFile = await createCommandResultFile();
        return startTerminalSession({
          args: spec.args || [],
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || cwd,
          env: (terminalContext) => ({
            ...projectConfigEnv,
            ...(typeof spec.env === "function" ? spec.env(terminalContext) : spec.env || {}),
            [COMMAND_RESULT_ENV]: resultFile.path
          }),
          maxRunning: 1,
          metadata: {
            actionId: action.id,
            actionLabel: action.label,
            sessionId
          },
          namespace,
          namespaceLimitPrefix: namespace,
          onClose: async ({ exitCode }) => {
            try {
              await writeActionTerminalResult({
                action,
                exitCode,
                input: commandInput,
                resultFile,
                runtime,
                session,
                spec
              });
            } finally {
              await removeCommandResultFile(resultFile);
            }
          },
          reuseRunning: true
        });
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: commandTerminalNamespace(sessionId)
      });
    }
  });
}

export { createCommandTerminalController };
