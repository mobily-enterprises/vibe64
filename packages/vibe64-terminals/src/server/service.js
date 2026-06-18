import { createCodexTerminalController } from "./codexTerminal.js";
import process from "node:process";
import {
  createCommandTerminalController,
  createProjectToolTerminalController
} from "./commandTerminal.js";
import { createLaunchTargetTerminalController } from "./launchTargetTerminal.js";
import { createShellTerminalController } from "./shellTerminal.js";
import {
  projectToolFailureFixPrompt,
  sessionTerminalFailureFixPrompt
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import {
  terminalTargetRoot,
  terminalWorktreePath
} from "./terminalShared.js";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  codexProviderContext
} from "@local/studio-terminal-core/server/providerHomes";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

const CODEX_AFTER_COMMAND_THREAD_PREP_ENABLED = false;

function truthyEnvFlag(value = "") {
  return /^(1|true|yes|on)$/iu.test(String(value || "").trim());
}

function selfTargetCodexAppServerProviderOptions({
  codexTerminalController = {},
  env = process.env
} = {}) {
  const existing = {
    ...(codexTerminalController.codexAppServerProviderOptions || {})
  };
  if (
    truthyEnvFlag(env[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV]) &&
    existing.useDocker === undefined
  ) {
    existing.useDocker = false;
  }
  return existing;
}

function codexToolHomeSourceFromEnv(env = process.env) {
  const context = codexProviderContext({
    providerHomesRoot: String(env[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "")
  });
  return context?.ok === true ? context.toolHomeSource : "";
}

async function closeTerminalControllerForSession({
  controller,
  eventPrefix = "server.terminals.closeSessionTerminals",
  label = "",
  sessionId = ""
} = {}) {
  if (typeof controller?.closeAllForSession !== "function") {
    return {
      closed: 0,
      ok: true
    };
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog(`${eventPrefix}.controller.start`, {
    controller: label,
    sessionId
  });
  try {
    const result = await controller.closeAllForSession(sessionId);
    vibe64SessionDebugLog(`${eventPrefix}.controller.done`, {
      closed: Number(result?.closed || 0),
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      ok: result?.ok !== false,
      sessionId
    });
    return result;
  } catch (error) {
    vibe64SessionDebugLog(`${eventPrefix}.controller.error`, {
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId
    });
    throw error;
  }
}

async function closeTerminalControllersForSession(sessionId = "", controllers = [], {
  eventPrefix = "server.terminals.closeSessionTerminals"
} = {}) {
  let closed = 0;
  for (const entry of controllers) {
    const result = await closeTerminalControllerForSession({
      ...entry,
      eventPrefix,
      sessionId
    });
    closed += Number(result?.closed || 0);
  }
  return {
    closed,
    ok: true
  };
}

function createService({
  codexTerminalController = {},
  env = process.env,
  projectService,
  publishSessionChanged = {}
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }

  const codex = createCodexTerminalController({
    ...codexTerminalController,
    codexAppServerProviderOptions: selfTargetCodexAppServerProviderOptions({
      codexTerminalController,
      env
    }),
    codexToolHomeRequired: codexTerminalController.codexToolHomeRequired ?? true,
    codexToolHomeSource: codexTerminalController.codexToolHomeSource || codexToolHomeSourceFromEnv(env),
    projectService,
    publishPromptInjected: publishSessionChanged.codexPrompt,
    publishSessionChanged: publishSessionChanged.codexTerminal
  });
  const command = createCommandTerminalController({
    afterSuccessfulCommand: async ({ metadata = {}, session = {} } = {}) => {
      if (!CODEX_AFTER_COMMAND_THREAD_PREP_ENABLED) {
        return;
      }
      if (!String(metadata.worktree_path || "").trim()) {
        return;
      }
      const result = await codex.ensureThread(session.sessionId);
      if (result?.ok === false) {
        throw new Error(result.error || "Vibe64 Codex terminal could not be prepared.");
      }
    },
    env,
    projectService,
    publishSessionChanged: publishSessionChanged.commandTerminal
  });
  const launchTarget = createLaunchTargetTerminalController({
    projectService,
    publishSessionChanged: publishSessionChanged.launchTarget
  });
  const projectTool = createProjectToolTerminalController({
    projectService
  });
  const shell = createShellTerminalController({
    projectService
  });

  async function publishTerminalSessionChanged(kind = "", sessionId = "", reason = "") {
    const publisher = publishSessionChanged?.[kind];
    if (typeof publisher !== "function" || !String(sessionId || "").trim()) {
      return null;
    }
    return publisher(sessionId, {
      reason
    });
  }

  return Object.freeze({
    async closeSessionTerminals(sessionId) {
      return closeTerminalControllersForSession(sessionId, [
        { controller: launchTarget, label: "launchTarget" },
        { controller: codex, label: "codex" },
        { controller: command, label: "command" },
        { controller: shell, label: "shell" }
      ]);
    },

    async closeSessionNonCodexTerminals(sessionId) {
      return closeTerminalControllersForSession(sessionId, [
        { controller: launchTarget, label: "launchTarget" },
        { controller: command, label: "command" },
        { controller: shell, label: "shell" }
      ], {
        eventPrefix: "server.terminals.closeSessionNonCodexTerminals"
      });
    },

    async closeCodexTerminal(sessionId, terminalSessionId) {
      const result = await codex.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("codexTerminalClosed", sessionId, "codex-terminal-closed");
      return result;
    },

    closeGlobalCodexTerminal(terminalSessionId) {
      return codex.closeGlobalTerminal(terminalSessionId);
    },

    closeFixCodexTerminal(jobId, terminalSessionId) {
      return codex.closeFixTerminal(jobId, terminalSessionId);
    },

    async closeCommandTerminal(sessionId, terminalSessionId) {
      const result = await command.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("commandTerminalClosed", sessionId, "command-terminal-closed");
      return result;
    },

    closeProjectToolTerminal(toolId, terminalSessionId) {
      return projectTool.closeTerminal(toolId, terminalSessionId);
    },

    async closeLaunchTargetTerminal(sessionId, terminalSessionId) {
      const result = await launchTarget.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("launchTargetClosed", sessionId, "launch-target-closed");
      return result;
    },

    async closeShellTerminal(sessionId, terminalSessionId) {
      const result = await shell.closeTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("shellTerminalClosed", sessionId, "shell-terminal-closed");
      return result;
    },

    injectCodexPrompt(sessionId, handoff = {}, options = {}) {
      return codex.injectCodexPrompt(sessionId, handoff, options);
    },

    interruptCodexTurn(sessionId) {
      return codex.interruptTurn(sessionId);
    },

    injectGlobalCodexPrompt(handoff = {}) {
      return codex.injectGlobalCodexPrompt(handoff);
    },

    ensureCodexThread(sessionId) {
      return codex.ensureThread(sessionId);
    },

    reconcileCodexThreads(sessions = [], options = {}) {
      return codex.reconcileThreads(sessions, options);
    },

    async reconcileOpenCodexThreads(options = {}) {
      const runtime = await projectService.createRuntime();
      const sessions = await runtime.listSessionSummaries({
        archive: ""
      });
      const openSessions = sessions.filter((session) => String(session.status || "") === "active");
      return codex.reconcileThreads(openSessions, options);
    },

    codexTerminalState(sessionId) {
      return codex.terminalState(sessionId);
    },

    globalCodexTerminalState() {
      return codex.globalTerminalState();
    },

    readGlobalCodexTerminal(terminalSessionId) {
      return codex.readGlobalTerminal(terminalSessionId);
    },

    readFixCodexTerminal(jobId, terminalSessionId) {
      return codex.readFixTerminal(jobId, terminalSessionId);
    },

    readCodexTerminal(sessionId, terminalSessionId) {
      return codex.readTerminal(sessionId, terminalSessionId);
    },

    readCommandTerminal(sessionId, terminalSessionId) {
      return command.readTerminal(sessionId, terminalSessionId);
    },

    readProjectToolTerminal(toolId, terminalSessionId) {
      return projectTool.readTerminal(toolId, terminalSessionId);
    },

    readLaunchTargetTerminal(sessionId, terminalSessionId) {
      return launchTarget.readTerminal(sessionId, terminalSessionId);
    },

    readShellTerminal(sessionId, terminalSessionId) {
      return shell.readTerminal(sessionId, terminalSessionId);
    },

    launchTargetStatus(sessionId, options = {}) {
      return launchTarget.launchStatus(sessionId, options);
    },

    openLaunchTarget(sessionId) {
      return launchTarget.openLaunchTarget(sessionId);
    },

    startCodexTerminal(sessionId) {
      return codex.startTerminal(sessionId);
    },

    startGlobalCodexTerminal() {
      return codex.startGlobalTerminal();
    },

    async startProjectToolFixJob(toolId, input = {}) {
      const targetRoot = terminalTargetRoot({}, projectService);
      return codex.startFixJob({
        prompt: projectToolFailureFixPrompt({
          ...input,
          targetRoot,
          toolId: input.toolId || toolId,
          toolLabel: input.toolLabel || input.actionLabel
        }),
        scope: "project",
        subject: input.toolLabel || input.actionLabel || toolId,
        targetRoot
      });
    },

    async startSessionTerminalFixJob(sessionId, input = {}) {
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(sessionId);
      const targetRoot = terminalTargetRoot(session, projectService);
      const worktreePath = terminalWorktreePath(session);
      return codex.startFixJob({
        prompt: sessionTerminalFailureFixPrompt({
          ...input,
          currentStep: input.currentStep || session.currentStep || "",
          sessionId: input.sessionId || sessionId,
          stepStatus: input.stepStatus || session.stepMachine?.status || "",
          targetRoot,
          worktreePath
        }),
        scope: "session",
        sessionRoot: session.sessionRoot || "",
        subject: input.actionLabel || input.launchTargetLabel || input.actionId || input.launchTargetId || sessionId,
        targetRoot,
        workdir: worktreePath || targetRoot
      });
    },

    reportFixCodexJob(jobId, input = {}) {
      return codex.reportFixJob(jobId, input);
    },

    startCommandTerminal(sessionId, input = {}) {
      return command.startTerminal(sessionId, input);
    },

    async runProjectTool(toolId, input = {}) {
      const run = await projectService.prepareProjectToolRun(toolId, input);
      if (run?.ok === false) {
        return run;
      }
      if (run.type === "prompt") {
        return codex.injectGlobalCodexPrompt({
          prompt: run.prompt
        });
      }
      return projectTool.startPreparedRun(toolId, run);
    },

    startLaunchTargetTerminal(sessionId, input = {}) {
      return launchTarget.startTerminal(sessionId, input);
    },

    async stopLaunchTargetTerminal(sessionId, terminalSessionId) {
      const result = await launchTarget.stopTerminal(sessionId, terminalSessionId);
      await publishTerminalSessionChanged("launchTargetStopped", sessionId, "launch-target-stopped");
      return result;
    },

    startShellTerminal(sessionId, input = {}) {
      return shell.startTerminal(sessionId, input);
    },

    subscribeCodexTerminal(sessionId, terminalSessionId, subscriber) {
      return codex.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeGlobalCodexTerminal(terminalSessionId, subscriber) {
      return codex.subscribeGlobalTerminal(terminalSessionId, subscriber);
    },

    subscribeFixCodexTerminal(jobId, terminalSessionId, subscriber) {
      return codex.subscribeFixTerminal(jobId, terminalSessionId, subscriber);
    },

    subscribeCommandTerminal(sessionId, terminalSessionId, subscriber) {
      return command.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeProjectToolTerminal(toolId, terminalSessionId, subscriber) {
      return projectTool.subscribeTerminal(toolId, terminalSessionId, subscriber);
    },

    subscribeLaunchTargetTerminal(sessionId, terminalSessionId, subscriber) {
      return launchTarget.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeShellTerminal(sessionId, terminalSessionId, subscriber) {
      return shell.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    uploadCodexAttachment(sessionId, input = {}) {
      return codex.uploadAttachment(sessionId, input);
    },

    writeCodexTerminal(sessionId, terminalSessionId, data) {
      return codex.writeTerminal(sessionId, terminalSessionId, data);
    },

    writeGlobalCodexTerminal(terminalSessionId, data) {
      return codex.writeGlobalTerminal(terminalSessionId, data);
    },

    writeFixCodexTerminal(jobId, terminalSessionId, data) {
      return codex.writeFixTerminal(jobId, terminalSessionId, data);
    },

    resizeCodexTerminal(sessionId, terminalSessionId, size) {
      return codex.resizeTerminal(sessionId, terminalSessionId, size);
    },

    resizeGlobalCodexTerminal(terminalSessionId, size) {
      return codex.resizeGlobalTerminal(terminalSessionId, size);
    },

    resizeFixCodexTerminal(jobId, terminalSessionId, size) {
      return codex.resizeFixTerminal(jobId, terminalSessionId, size);
    },

    writeCommandTerminal(sessionId, terminalSessionId, data) {
      return command.writeTerminal(sessionId, terminalSessionId, data);
    },

    writeProjectToolTerminal(toolId, terminalSessionId, data) {
      return projectTool.writeTerminal(toolId, terminalSessionId, data);
    },

    resizeCommandTerminal(sessionId, terminalSessionId, size) {
      return command.resizeTerminal(sessionId, terminalSessionId, size);
    },

    resizeProjectToolTerminal(toolId, terminalSessionId, size) {
      return projectTool.resizeTerminal(toolId, terminalSessionId, size);
    },

    writeLaunchTargetTerminal(sessionId, terminalSessionId, data) {
      return launchTarget.writeTerminal(sessionId, terminalSessionId, data);
    },

    resizeLaunchTargetTerminal(sessionId, terminalSessionId, size) {
      return launchTarget.resizeTerminal(sessionId, terminalSessionId, size);
    },

    writeShellTerminal(sessionId, terminalSessionId, data) {
      return shell.writeTerminal(sessionId, terminalSessionId, data);
    },

    resizeShellTerminal(sessionId, terminalSessionId, size) {
      return shell.resizeTerminal(sessionId, terminalSessionId, size);
    }
  });
}

export { createService };
