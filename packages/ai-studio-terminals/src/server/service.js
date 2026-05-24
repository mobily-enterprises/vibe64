import { createCodexTerminalController } from "./codexTerminal.js";
import { createCommandTerminalController } from "./commandTerminal.js";
import { createLaunchTargetTerminalController } from "./launchTargetTerminal.js";
import { createShellTerminalController } from "./shellTerminal.js";

function createService({
  projectService,
  publishSessionChanged = {}
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  const codex = createCodexTerminalController({
    projectService,
    publishPromptInjected: publishSessionChanged.codexPrompt,
    publishSessionChanged: publishSessionChanged.codexTerminal
  });
  const command = createCommandTerminalController({
    projectService,
    publishSessionChanged: publishSessionChanged.commandTerminal
  });
  const launchTarget = createLaunchTargetTerminalController({
    projectService,
    publishSessionChanged: publishSessionChanged.launchTarget
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

    closeCommandTerminal(sessionId, terminalSessionId) {
      return command.closeTerminal(sessionId, terminalSessionId);
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

    readCodexTerminal(sessionId, terminalSessionId) {
      return codex.readTerminal(sessionId, terminalSessionId);
    },

    readCommandTerminal(sessionId, terminalSessionId) {
      return command.readTerminal(sessionId, terminalSessionId);
    },

    readLaunchTargetTerminal(sessionId, terminalSessionId) {
      return launchTarget.readTerminal(sessionId, terminalSessionId);
    },

    readShellTerminal(sessionId, terminalSessionId) {
      return shell.readTerminal(sessionId, terminalSessionId);
    },

    launchTargetStatus(sessionId) {
      return launchTarget.launchStatus(sessionId);
    },

    openLaunchTarget(sessionId) {
      return launchTarget.openLaunchTarget(sessionId);
    },

    startCodexTerminal(sessionId) {
      return codex.startTerminal(sessionId);
    },

    startCommandTerminal(sessionId, input = {}) {
      return command.startTerminal(sessionId, input);
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

    subscribeCommandTerminal(sessionId, terminalSessionId, subscriber) {
      return command.subscribeTerminal(sessionId, terminalSessionId, subscriber);
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

    resizeCodexTerminal(sessionId, terminalSessionId, size) {
      return codex.resizeTerminal(sessionId, terminalSessionId, size);
    },

    writeCommandTerminal(sessionId, terminalSessionId, data) {
      return command.writeTerminal(sessionId, terminalSessionId, data);
    },

    resizeCommandTerminal(sessionId, terminalSessionId, size) {
      return command.resizeTerminal(sessionId, terminalSessionId, size);
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
