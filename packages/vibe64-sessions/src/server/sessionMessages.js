import crypto from "node:crypto";
import { currentRequestIsPracticeProject } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { isAssistantRoutingOwner } from "@local/vibe64-runtime/shared/assistantRouting";
import { createMainChatApprovals } from "./mainChatApprovals.js";
import { sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-project/server/types").PublishProjectChanged} PublishProjectChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {ReturnType<typeof import("./mainConversationAuthority.js").createMainConversationAuthority>["mainBrowserAuthority"]} MainBrowserAuthority */

function messageText(input) {
  return normalizeText(input.message);
}

/**
 * What people send a session's assistant: a message, sent now or held for
 * the workspace owner's approval, an interrupted turn, and the integration
 * setup a turn asked for.
 * @param {object} dependencies
 * @param {MainBrowserAuthority} dependencies.mainBrowserAuthority
 * @param {ProjectService} dependencies.project
 * @param {PublishProjectChanged} dependencies.publishProjectChanged
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {SourceEditorService} dependencies.sourceEditor
 * @param {TerminalsService} dependencies.terminals
 */
function createSessionMessages({
  mainBrowserAuthority,
  project,
  publishProjectChanged,
  publishSessionChanged,
  setupRunner,
  sourceEditor,
  terminals
}) {
  const mainChatApprovals = createMainChatApprovals({
    project,
    terminals,
    publishSessionChanged,
    publishProjectChanged,
    deliver: sendAgentMessage
  });

  async function sendAgentMessage(sessionId, input, options = {}) {
    const request = messageText(input);
    if (!request) {
      return {
        code: "vibe64_agent_message_input_required",
        error: "Assistant messages require text.",
        ok: false
      };
    }
    // A team member's main-chat message waits for the owner's approval,
    // except in their own lesson, which runs on the team setup.
    const vibe64User = trustedAssistantUser(input);
    if (vibe64User && !isAssistantRoutingOwner(vibe64User) && !currentRequestIsPracticeProject()) {
      return {
        ...await mainChatApprovals.enqueue(sessionId, {
          message: request,
          messageId: normalizeText(input.messageId),
          attachmentIds: input.attachmentIds || []
        }, { vibe64User }),
        sessionId
      };
    }
    const startedAt = Date.now();
    const messageId = normalizeText(input.messageId) || crypto.randomUUID();
    // A message sent while idle cleanup closes the project, or after it closed
    // it, waits for that Close and opens the project again before delivery. A
    // project that cannot open leaves the message visibly unsent.
    try {
      await terminals.openProjectRuntime({ reason: "chat-message" });
    } catch (error) {
      return {
        code: error?.code || "vibe64_project_open_failed",
        error: `The project could not open, so the message was not sent. ${error?.message || ""}`.trim(),
        messageId,
        ok: false,
        sessionId
      };
    }
    await setupRunner.wait(sessionId);
    const runtime = await project.createRuntimeWithoutSource();
    vibe64SessionDebugLog("server.sessions.sendAgentMessage.dispatching", {
      durationMs: Date.now() - startedAt,
      messageId,
      sessionId
    });
    const { messageSource, ...message } = input;
    try {
      const result = await terminals.sendAgentMessage(sessionId, {
        ...message,
        ...(messageSource === "lesson" ? { turnMetadata: { source: "lesson" } } : {}),
        messageId,
        message: request
      }, {
        ...(options.browserAuthority ? { browserAuthority: options.browserAuthority } : {}),
        runtime,
        vibe64User
      });
      const accepted = result?.ok !== false;
      await publishSessionChanged(sessionId, {
        originId: normalizeText(input.originId),
        reason: accepted
          ? "session-agent-message-accepted"
          : "session-agent-message-failed",
        session: await runtime.getSessionWithoutSource(sessionId)
      });
      return {
        ...result,
        messageId,
        ok: accepted,
        sessionId
      };
    } catch (error) {
      vibe64SessionDebugLog("server.sessions.sendAgentMessage.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  function readMainChatApprovals(sessionId, input) {
    return mainChatApprovals.read(sessionId, { vibe64User: trustedAssistantUser(input) });
  }

  function editMainChatApproval(sessionId, approvalId, input) {
    return mainChatApprovals.edit(sessionId, approvalId, input, { vibe64User: trustedAssistantUser(input) });
  }

  function withdrawMainChatApproval(sessionId, approvalId, input) {
    return mainChatApprovals.withdraw(sessionId, approvalId, input, { vibe64User: trustedAssistantUser(input) });
  }

  function declineMainChatApproval(sessionId, approvalId, input) {
    return mainChatApprovals.decline(sessionId, approvalId, input, { vibe64User: trustedAssistantUser(input) });
  }

  function approveMainChatApproval(sessionId, approvalId, input, options) {
    return mainChatApprovals.approve(sessionId, approvalId, input, {
      vibe64User: trustedAssistantUser(input),
      browserAuthority: options.browserAuthority || null
    });
  }

  async function interruptAgentTurn(sessionId, input) {
    return sessionResult(async () => {
      const result = await terminals.interruptAgentTurn(sessionId, input, {
        runtime: await project.createRuntimeWithoutSource()
      });
      if (result?.ok !== false) {
        await publishSessionChanged(sessionId, {
          originId: normalizeText(input.originId),
          reason: "session-agent-turn-interrupted"
        });
      }
      return result;
    }, "Vibe64 could not interrupt the assistant.");
  }

  async function resumeIntegrationContinuation(sessionId, input) {
    return sessionResult(async () => {
      await setupRunner.wait(sessionId);
      const runtime = await project.createRuntimeWithoutSource();
      const result = await terminals.resumeIntegrationContinuation(sessionId, {
        turnId: input.turnId,
        requestId: input.requestId
      }, {
        runtime,
        vibe64User: trustedAssistantUser(input),
        readIntegrationConfiguration: () => sourceEditor.readIntegrations({ sessionId })
      });
      await publishSessionChanged(sessionId, {
        reason: "integration-setup-completed",
        session: null
      });
      return { ...result, sessionId, turnId: input.turnId };
    });
  }

  async function skipIntegrationSetupRequest(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const integrationSetup = await runtime.store.skipIntegrationSetupRequest(sessionId, {
        turnId: input.turnId,
        requestId: input.requestId
      });
      await publishSessionChanged(sessionId, {
        reason: "integration-setup-skipped",
        session: null
      });
      return { ok: true, sessionId, turnId: input.turnId, integrationSetup };
    });
  }

  /**
   * A person's Main chat send. The message is the input without the session
   * it is sent to; it carries the person's browser conversation authority.
   * @param {{ sessionId: string }} input
   * @param {object} context
   */
  function sendMainChatMessage({ sessionId, ...message }, context) {
    return sendAgentMessage(sessionId, message, { browserAuthority: mainBrowserAuthority(sessionId, context) });
  }

  /**
   * An approved message is the owner's own Main chat send.
   * @param {{ sessionId: string, approvalId: string }} input
   * @param {object} context
   */
  function approveMainChatMessage(input, context) {
    return approveMainChatApproval(
      input.sessionId,
      input.approvalId,
      input,
      { browserAuthority: mainBrowserAuthority(input.sessionId, context) }
    );
  }

  return Object.freeze({
    approveMainChatApproval,
    approveMainChatMessage,
    declineMainChatApproval,
    editMainChatApproval,
    interruptAgentTurn,
    readMainChatApprovals,
    resumeIntegrationContinuation,
    sendAgentMessage,
    sendMainChatMessage,
    skipIntegrationSetupRequest,
    withdrawMainChatApproval
  });
}

export { createSessionMessages };
