import {
  normalizeText
} from "@local/vibe64-core/server/core";

const CODEX_PRODUCT_PROVIDER_ID = "codex";
const CODEX_APP_SERVER_TRANSPORT_ID = "codex_app_server";

function normalizeCodexTurn(result = {}) {
  const turn = result?.codexAgentTurn || {};
  const active = turn?.active === true || result?.active === true;
  const id = normalizeText(turn?.turnId || result?.turnId);
  if (!id && !active) {
    return null;
  }
  return {
    active,
    error: normalizeText(turn?.error),
    id,
    startedAt: normalizeText(turn?.startedAt),
    state: normalizeText(turn?.state),
    status: normalizeText(turn?.status || turn?.state),
    threadId: normalizeText(turn?.threadId || result?.codexThreadId || result?.threadId),
    updatedAt: normalizeText(turn?.updatedAt)
  };
}

function normalizeCodexSessionResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const turn = normalizeCodexTurn(source);
  return {
    ...(normalizeText(source.code) ? { code: normalizeText(source.code) } : {}),
    ...(normalizeText(source.error) ? { error: normalizeText(source.error) } : {}),
    ...(normalizeText(source.deliveryMode) ? { deliveryMode: normalizeText(source.deliveryMode) } : {}),
    delivered: source.delivered === true,
    ...(normalizeText(source.operationOutcome) ? { operationOutcome: normalizeText(source.operationOutcome) } : {}),
    ...(normalizeText(source.reason) ? { reason: normalizeText(source.reason) } : {}),
    connectionReused: typeof source.connectionReused === "boolean" ? source.connectionReused : null,
    identity: source.agentIdentity || null,
    ...(typeof source.interrupted === "boolean" ? { interrupted: source.interrupted } : {}),
    ok: source.ok !== false,
    newTurnRequired: source.newTurnRequired === true,
    refreshRecommended: source.refreshRecommended === true,
    retryable: typeof source.retryable === "boolean" ? source.retryable : null,
    sessionUpdated: source.sessionUpdated === true,
    terminal: source.codexTerminal || null,
    thread: {
      id: normalizeText(
        source.codexThreadId ||
        source.threadId ||
        turn?.threadId
      )
    },
    turn,
    workdir: normalizeText(source.codexWorkdir)
  };
}

function createCodexSessionAgentAdapter({
  controller
} = {}) {
  if (!controller) {
    throw new TypeError("Codex session agent adapter requires a controller.");
  }
  return Object.freeze({
    id: CODEX_PRODUCT_PROVIDER_ID,
    transportId: CODEX_APP_SERVER_TRANSPORT_ID,
    async closeSession({ sessionId }) {
      return controller.closeAllForSession(sessionId);
    },
    async closeProject(_context, input = {}) {
      return controller.closeAllForProject(input);
    },
    async createConversation(context, input = {}) {
      return controller.createConversation(context.sessionId, input);
    },
    async closeTerminal(context, input = {}) {
      return controller.closeTerminal(context.sessionId, input.terminalSessionId);
    },
    async deleteDetachedChatThread(context, input = {}) {
      return controller.deleteDetachedChatThread(context.sessionId, input);
    },
    async deleteConversation(context, input = {}) {
      return controller.deleteConversation(context.sessionId, input);
    },
    async deliverPrompt(context, handoff = {}) {
      return normalizeCodexSessionResult(await controller.injectCodexPrompt(context.sessionId, handoff, {
        agentSettings: context.agentSettings || {},
        lifecycle: context.lifecycle,
        prepareHandoff: context.prepareHandoff,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      }));
    },
    async ensureSession(context) {
      return normalizeCodexSessionResult(await controller.ensureThread(context.sessionId, {
        agentSettings: context.agentSettings || {},
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      }));
    },
    async interruptTurn(context, input = {}) {
      return normalizeCodexSessionResult(await controller.interruptTurn(context.sessionId, input));
    },
    async invalidateRuntimes(_context, input = {}) {
      return controller.invalidateAppServerRuntimes(input);
    },
    async interruptDetachedChatTurn(context, input = {}) {
      return controller.interruptDetachedChatTurn(context.sessionId, input);
    },
    async reconcileSessions(_context, sessions = [], options = {}) {
      return controller.reconcileThreads(sessions, options);
    },
    async sessionState(context) {
      return normalizeCodexSessionResult(await controller.terminalState(context.sessionId));
    },
    async readTerminal(context, input = {}) {
      return controller.readTerminal(context.sessionId, input.terminalSessionId);
    },
    async readConversation(context, input = {}) {
      return controller.readConversation(context.sessionId, input);
    },
    async resizeTerminal(context, input = {}) {
      return controller.resizeTerminal(context.sessionId, input.terminalSessionId, input.size);
    },
    async runDetachedChatTurn(context, input = {}) {
      return controller.runDetachedChatTurn(context.sessionId, input);
    },
    async startTerminal(context, input = {}) {
      return controller.startTerminal(context.sessionId, input);
    },
    async sendMessage(context, input = {}) {
      return normalizeCodexSessionResult(await controller.sendMessage(context.sessionId, input, {
        turnOwnership: context.turnOwnership
      }));
    },
    async startConversationTurn(context, input = {}) {
      return controller.startConversationTurn(context.sessionId, input);
    },
    async stopConversation(context, input = {}) {
      return controller.stopConversation(context.sessionId, input);
    },
    async streamDetachedChatTurn(context, input = {}) {
      return controller.streamDetachedChatTurn(context.sessionId, input, {
        onEvent: context.onEvent
      });
    },
    async waitForConversationTurn(context, input = {}) {
      return controller.waitForConversationTurn(context.sessionId, input, {
        onEvent: context.onEvent
      });
    },
    async subscribeTerminal(context, input = {}) {
      return controller.subscribeTerminal(context.sessionId, input.terminalSessionId, input.subscriber);
    },
    async uploadAttachment(context, input = {}) {
      return controller.uploadAttachment(context.sessionId, input);
    },
    async unsubscribeSessions(_context, sessions = []) {
      return controller.unsubscribeKnownAppServerThreads(sessions);
    },
    async writeTerminal(context, payload = {}) {
      return controller.writeTerminal(
        context.sessionId,
        payload.terminalSessionId,
        payload.data,
        payload.input
      );
    }
  });
}

export {
  CODEX_APP_SERVER_TRANSPORT_ID,
  CODEX_PRODUCT_PROVIDER_ID,
  createCodexSessionAgentAdapter
};
