import {
  VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileRequest,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { OPENCODE_EXPECTED_VERSION } from "../../opencodeServerProcess.js";

const OPENCODE_ECONOMY_PROFILE_REVISION =
  `opencode-${OPENCODE_EXPECTED_VERSION}-selected-model-tool-free-v1`;
const OPENCODE_ECONOMY_WORKLOAD_LIMITS = VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS;

function openCodeExecutionProfileError(code, message, details = {}) {
  return new Vibe64AgentExecutionProfileError(code, message, details);
}

function resolveOpenCodeEconomyExecutionProfile(context = {}, request = {}) {
  const executionProfile = defineVibe64AgentExecutionProfileRequest(request);
  if (executionProfile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY) {
    throw openCodeExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.PROFILE_UNKNOWN,
      `OpenCode does not provide execution profile ${executionProfile.profileId}.`,
      { profileId: executionProfile.profileId }
    );
  }
  const limits = OPENCODE_ECONOMY_WORKLOAD_LIMITS[executionProfile.workloadId];
  if (!limits) {
    throw openCodeExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.WORKLOAD_UNSUPPORTED,
      `OpenCode economy does not support workload ${executionProfile.workloadId}.`,
      { workloadId: executionProfile.workloadId }
    );
  }
  const selection = context.assistantSelection || {};
  const economyModelId = String(context.assistantAccess?.economyModelId || "").trim();
  if (
    selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE ||
    !String(selection.modelProviderId || "").trim() ||
    !economyModelId
  ) {
    throw openCodeExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "The selected OpenCode endpoint has no configured helper model."
    );
  }
  const thinking = "";
  return defineVibe64AgentExecutionProfileResolution({
    ...executionProfile,
    limits,
    model: economyModelId,
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    },
    providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    request: {
      allowProviderModelFallback: false,
      reasoning: Boolean(thinking),
      summary: false
    },
    revision: OPENCODE_ECONOMY_PROFILE_REVISION,
    thinking
  });
}

function emitOpenCodeExecutionProfile(context = {}, executionProfile = null) {
  if (!executionProfile) {
    return null;
  }
  const snapshot = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
  context.onEvent?.({
    executionProfile: snapshot,
    type: "execution-profile"
  });
  return snapshot;
}

function unsupportedOperation(operation = "operation") {
  return {
    code: "vibe64_opencode_operation_unsupported",
    error: `OpenCode does not support the Vibe64 ${operation} operation yet.`,
    ok: false,
    retryable: false
  };
}

function createOpenCodeSessionAgentProvider({ controller } = {}) {
  if (!controller) {
    throw new TypeError("OpenCode session agent providers require a controller.");
  }
  return Object.freeze({
    executionProfiles: Object.freeze([
      VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY
    ]),
    id: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.OPENCODE_SERVER,
    async capabilities(context, input = {}) {
      return controller.capabilities(input, context);
    },
    async closeProject(_context, input = {}) {
      return controller.closeAllForProject(input);
    },
    async closeSession(context) {
      return controller.closeAllForSession(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async closeTerminal(context, input = {}) {
      return controller.closeTerminal(context.sessionId, input.terminalSessionId);
    },
    async createConversation(context, input = {}) {
      return controller.createConversation(context.sessionId, input, {
        assistantScope: context.assistantScope,
        assistantSelection: context.assistantSelection,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async deleteConversation(context, input = {}) {
      return controller.deleteConversation(context.sessionId, input, {
        assistantScope: context.assistantScope,
        assistantSelection: context.assistantSelection,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async deleteDetachedChatThread(context, input = {}) {
      return controller.deleteConversation(context.sessionId, {
        conversationId: input.threadId || input.conversationId
      }, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async describeProvider(context) {
      return controller.describeProvider(context.sessionId, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async ensureSession(context) {
      return controller.ensureSession(context.sessionId, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async generateSessionRenewalHandover(context, input = {}) {
      return controller.generateSessionRenewalHandover(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async hasActiveTemporaryConversation(context) {
      return {
        active: controller.hasActiveTemporaryConversation(context.sessionId),
        ok: true
      };
    },
    async interruptDetachedChatTurn(context, input = {}) {
      return controller.stopConversation(context.sessionId, {
        conversationId: input.threadId || input.conversationId
      }, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async interruptTurn(context, input = {}) {
      return controller.interruptTurn(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async invalidateRuntimes(_context, input = {}) {
      return controller.invalidateRuntimes(input);
    },
    async readConversation(context, input = {}) {
      return controller.readConversation(context.sessionId, input, {
        assistantScope: context.assistantScope,
        assistantSelection: context.assistantSelection,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async readTerminal(context, input = {}) {
      return controller.readTerminal(context.sessionId, input.terminalSessionId);
    },
    async reconcileSessions(_context, sessions = [], options = {}) {
      return controller.reconcileSessions(sessions, options);
    },
    async releaseRenewalPredecessorAttachments() {
      return { ok: true, released: 0 };
    },
    async releaseRenewalPredecessorProcessExitProof(context) {
      const closed = await controller.closeAllForSession(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
      const released = controller.releaseProcessExitProof(context.sessionId);
      return {
        ...closed,
        ...released,
        ok: closed.ok !== false && released.ok !== false
      };
    },
    async releaseRenewalSuccessorProcessExitProof(context) {
      return controller.releaseProcessExitProof(context.sessionId);
    },
    async resizeTerminal(context, input = {}) {
      return controller.resizeTerminal(context.sessionId, input.terminalSessionId, input.size);
    },
    resolveExecutionProfile(context, input = {}) {
      return resolveOpenCodeEconomyExecutionProfile(context, input);
    },
    async runDetachedChatTurn(context, input = {}) {
      const executionProfile = emitOpenCodeExecutionProfile(context, input.executionProfile);
      const result = await controller.runDetachedChatTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
      return executionProfile ? { ...result, executionProfile } : result;
    },
    async seedSessionRenewalHandover(context, input = {}) {
      return controller.seedSessionRenewalHandover(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async inspectMessageAdmission(context, input = {}) {
      return controller.inspectMessageAdmission(context.sessionId, {
        messageId: input.messageId,
        threadId: input.threadId
      }, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async sendMessage(context, input = {}) {
      return controller.sendMessage(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        turnOwnership: context.turnOwnership,
        vibe64User: context.vibe64User
      });
    },
    async sessionState(context) {
      return controller.sessionState(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async startConversationTurn(context, input = {}) {
      return controller.startConversationTurn(context.sessionId, input, {
        assistantScope: context.assistantScope,
        assistantSelection: context.assistantSelection,
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async startTerminal(context, input = {}) {
      return controller.startTerminal(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async stopConversation(context, input = {}) {
      return controller.stopConversation(context.sessionId, input, {
        assistantScope: context.assistantScope,
        assistantSelection: context.assistantSelection,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async streamDetachedChatTurn(context, input = {}) {
      const executionProfile = emitOpenCodeExecutionProfile(context, input.executionProfile);
      const result = await controller.streamDetachedChatTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
      return executionProfile ? { ...result, executionProfile } : result;
    },
    async subscribeTerminal(context, input = {}) {
      return controller.subscribeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.subscriber
      );
    },
    async unsubscribeSessions() {
      return { ok: true };
    },
    async waitForConversationTurn(context, input = {}) {
      return controller.waitForConversationTurn(context.sessionId, input, {
        assistantScope: context.assistantScope,
        assistantSelection: context.assistantSelection,
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async writeTerminal(context, input = {}) {
      return controller.writeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.data,
        input.input,
        {
          runtime: context.runtime,
          session: context.session,
          vibe64User: context.vibe64User
        }
      );
    }
  });
}

export {
  OPENCODE_ECONOMY_PROFILE_REVISION,
  OPENCODE_ECONOMY_WORKLOAD_LIMITS,
  createOpenCodeSessionAgentProvider,
  resolveOpenCodeEconomyExecutionProfile,
  unsupportedOperation
};
