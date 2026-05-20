import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  removeDockerContainer
} from "../../../../server/lib/containerRuntime.js";
import {
  ensureTargetRuntimeNetwork
} from "../../../../server/lib/aiStudio/runtimeContainers.js";
import {
  studioUserStartupScript
} from "../../../../server/lib/studioToolHome.js";
import {
  aiStudioResult,
  commandTerminalNamespace,
  normalizePlainObject,
  pathInsideOrEqual,
  stableHash,
  terminalTargetRoot
} from "./terminalShared.js";
import {
  COMMAND_RESULT_ENV,
  createCommandResultFileSync,
  readCommandResultFile,
  removeCommandResultFile
} from "./commandTerminalResults.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  resolveTerminalToolchainImage
} from "./terminalToolchainImage.js";
import {
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function commandTerminalContainerName({
  sessionId = "",
  terminalId = ""
} = {}) {
  return `ai-studio-command-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function resolveCommandWorkdir(targetRoot = "", cwd = "") {
  const normalizedCwd = String(cwd || "").trim();
  if (!normalizedCwd) {
    return targetRoot;
  }
  return path.isAbsolute(normalizedCwd)
    ? path.resolve(normalizedCwd)
    : path.resolve(targetRoot, normalizedCwd);
}

function commandTerminalArgs({
  args = [],
  command = "",
  containerName = "",
  env = {},
  image,
  mounts = [],
  resultFile = {},
  sessionId = "",
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      studioUserStartupScript([command, ...args])
    ],
    containerName,
    env,
    image,
    kind: "command-terminal",
    mounts: [
      {
        source: resultFile.directory,
        target: resultFile.directory
      },
      ...mounts
    ],
    sessionId,
    targetRoot,
    terminalId,
    workdir
  });
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
  const commandResult = completed ? await readCommandResultFile(resultFile.path) : {
    facts: {}
  };
  const resultApplication = completed ? await applySuccessFacts({
    action,
    facts: commandResult.facts || {},
    input,
    runtime,
    session,
    spec
  }) : {
    deleteMetadata: [],
    metadata: {}
  };
  const metadata = completed ? resultApplication.metadata : {};
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
    await Promise.all(resultApplication.deleteMetadata.map((name) => {
      return runtime.store.deleteMetadataValue(session.sessionId, name);
    }));
    await Promise.all(Object.entries(metadata).map(([name, value]) => {
      return runtime.store.writeMetadataValue(session.sessionId, name, value);
    }));
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

function normalizeMetadataMap(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata || {}).map(([name, value]) => [
    String(name || "").trim(),
    String(value || "").trim()
  ]).filter(([name]) => Boolean(name)));
}

function normalizeDeleteMetadata(names = []) {
  return Array.from(new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)));
}

async function applySuccessFacts({
  action = {},
  facts = {},
  input = {},
  runtime,
  session = {},
  spec = {}
} = {}) {
  const factApplication = typeof spec.applySuccessFacts === "function"
    ? await spec.applySuccessFacts({
        action,
        facts,
        input,
        runtime,
        session
      })
    : {};
  return {
    deleteMetadata: normalizeDeleteMetadata(factApplication.deleteMetadata),
    metadata: {
      ...normalizeMetadataMap(spec.successMetadata),
      ...normalizeMetadataMap(factApplication.metadata)
    }
  };
}

function createCommandTerminalController({
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  projectService,
  removeContainer = removeDockerContainer,
  resolveToolchainImage = resolveTerminalToolchainImage,
  startTerminal = startTerminalSession
} = {}) {
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
        const targetRoot = terminalTargetRoot(session, projectService);
        if (!targetRoot) {
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

        const workdir = resolveCommandWorkdir(targetRoot, spec.cwd);
        if (!pathInsideOrEqual(targetRoot, workdir)) {
          return {
            ok: false,
            error: "AI Studio command workdir is outside the target root."
          };
        }

        const imageResult = await resolveToolchainImage({
          runtime,
          session,
          target: "command",
          targetRoot
        });
        if (imageResult.ok === false) {
          return imageResult;
        }

        await ensureRuntimeNetwork(targetRoot);
        await ensureAdapterRuntimeContainers({
          runtime,
          session,
          target: "command",
          targetRoot
        });
        const terminalEnv = await projectTerminalEnvironment({
          projectService,
          runtime,
          session,
          target: "command",
          targetRoot
        });
        const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
        const namespace = commandTerminalNamespace(sessionId);
        let resultFile = null;
        const commandResultFile = () => {
          if (!resultFile) {
            resultFile = createCommandResultFileSync();
          }
          return resultFile;
        };
        return startTerminal({
          args: (terminalContext) => {
            const activeResultFile = commandResultFile();
            const specEnv = typeof spec.env === "function" ? spec.env(terminalContext) : spec.env || {};
            return commandTerminalArgs({
              args: spec.args || [],
              command: spec.command,
              containerName: commandTerminalContainerName({
                sessionId,
                terminalId: terminalContext.id
              }),
              env: {
                ...terminalEnv,
                ...specEnv,
                [COMMAND_RESULT_ENV]: activeResultFile.path
              },
              image: imageResult.image,
              mounts: Array.isArray(spec.mounts) ? spec.mounts : [],
              resultFile: activeResultFile,
              sessionId,
              targetRoot,
              terminalId: terminalContext.id,
              workdir
            });
          },
          command: "docker",
          commandPreview: spec.commandPreview,
          cwd: workdir,
          maxRunning: 1,
          metadata: {
            actionId: action.id,
            actionLabel: action.label,
            cwd: workdir,
            envHash: terminalEnvHash,
            image: imageResult.image,
            imageLabel: imageResult.label,
            sessionId
          },
          namespace,
          namespaceLimitPrefix: namespace,
          onClose: async ({ exitCode, id }) => {
            const activeResultFile = resultFile || {};
            try {
              await writeActionTerminalResult({
                action,
                exitCode,
                input: commandInput,
                resultFile: activeResultFile,
                runtime,
                session,
                spec
              });
            } finally {
              await Promise.all([
                removeCommandResultFile(activeResultFile),
                removeContainer(commandTerminalContainerName({
                  sessionId,
                  terminalId: id
                }))
              ]);
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

export {
  commandTerminalArgs,
  commandTerminalContainerName,
  createCommandTerminalController
};
