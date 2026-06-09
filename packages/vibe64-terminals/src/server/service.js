import { createCodexTerminalController } from "./codexTerminal.js";
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

const CODEX_AFTER_COMMAND_THREAD_PREP_ENABLED = false;

function createService({
  codexTerminalController = {},
  projectService,
  publishSessionChanged = {}
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }

  const codex = createCodexTerminalController({
    ...codexTerminalController,
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

  return Object.freeze({
    async closeSessionTerminals(sessionId) {
      await Promise.all([
        launchTarget.closeAllForSession(sessionId),
        codex.closeAllForSession(sessionId),
        command.closeAllForSession(sessionId),
        shell.closeAllForSession(sessionId)
      ]);
      return {
        ok: true
      };
    },

    async closeSessionNonCodexTerminals(sessionId) {
      await Promise.all([
        launchTarget.closeAllForSession(sessionId),
        command.closeAllForSession(sessionId),
        shell.closeAllForSession(sessionId)
      ]);
      return {
        ok: true
      };
    },

    closeCodexTerminal(sessionId, terminalSessionId) {
      return codex.closeTerminal(sessionId, terminalSessionId);
    },

    closeGlobalCodexTerminal(terminalSessionId) {
      return codex.closeGlobalTerminal(terminalSessionId);
    },

    closeFixCodexTerminal(jobId, terminalSessionId) {
      return codex.closeFixTerminal(jobId, terminalSessionId);
    },

    closeCommandTerminal(sessionId, terminalSessionId) {
      return command.closeTerminal(sessionId, terminalSessionId);
    },

    closeProjectToolTerminal(toolId, terminalSessionId) {
      return projectTool.closeTerminal(toolId, terminalSessionId);
    },

    closeLaunchTargetTerminal(sessionId, terminalSessionId) {
      return launchTarget.closeTerminal(sessionId, terminalSessionId);
    },

    closeShellTerminal(sessionId, terminalSessionId) {
      return shell.closeTerminal(sessionId, terminalSessionId);
    },

    injectCodexPrompt(sessionId, handoff = {}) {
      return codex.injectCodexPrompt(sessionId, handoff);
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

    stopLaunchTargetTerminal(sessionId, terminalSessionId) {
      return launchTarget.stopTerminal(sessionId, terminalSessionId);
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
