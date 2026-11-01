import { nativeConversationBindings } from "./nativeConversationRetirement.js";
import { manageWorkPlan, readWorkPlanPage } from "./assistantWorkPlan.js";
import {
  assistantRoutingGoalFromMetadata,
  assistantRoutingRequestFromMetadata,
  assistantRoutingStatusIsPending
} from "@local/vibe64-runtime/shared/assistantRouting";
import { replaceNativeConversation, requireCompletedConversationRewind } from "./assistantChangeover.js";
import path from "node:path";
import { vibe64Result } from "./terminalShared.js";
import { assertProjectEffectAdmission } from "@local/vibe64-core/server/projectRequestContext";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { defineSessionRenewalHandoverText, sessionRenewalManualHandoverTemplate } from "./sessionRenewalHandover.js";
import { AGENT_WRITE_WAIT_MS, runSessionRenewalOperation } from "./serviceSessionAccess.js";
import { sessionHasActiveAgentRun } from "./serviceSessionRecords.js";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("./types.js").SessionAttachments} SessionAttachments */

function ephemeralInput(input = {}) {
  return { ...input, ephemeral: input.persistent !== true };
}

/**
 * A session's stored and side conversations: native conversation storage and history retirement,
 * conversation replacement, ephemeral and detached chats, renewal handovers, attachments, the work
 * plan, and the renewal idle check.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {ConversationRuntime} dependencies.mainConversations
 * @param {ProjectService} dependencies.project
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {SessionAttachments} dependencies.sessionAttachments
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetup
 */
function createServiceAgentConversations({
  sessionAccess,
  assistantContext,
  mainConversations,
  project,
  publishAgentSessionChanged,
  sessionAgent,
  sessionAttachments,
  workspaceSetup
}) {
  function changeSessionWorkPlan(sessionId, operation, input) {
    const restoring = operation === "restore";
    return vibe64Result(() => sessionAccess.runMainAgentWrite(sessionId, {}, async (context) => {
      const request = assistantRoutingRequestFromMetadata(context.session.metadata);
      if (sessionHasActiveAgentRun(context.session) || assistantRoutingStatusIsPending(request) ||
          request?.status === "working" && request.workflow) {
        return {
          ok: false,
          error: "Wait for the assistant and its review to finish before " +
            (restoring ? "making a plan current." : "archiving the plan.")
        };
      }
      const result = await manageWorkPlan(context, restoring
        ? { operation: "reopen", archiveId: input.archiveId }
        : {
            operation: "archive",
            expectedRevision: input.expectedRevision,
            expectedProgressRevision: input.expectedProgressRevision
          }, "user");
      if (restoring) result.notice = "The archived plan is now current and active. Ask in chat to continue its work.";
      await publishAgentSessionChanged(sessionId, { reason: "work-plan-changed", payload: { planNotice: result.notice } });
      return { ok: true, sessionId, ...result };
    }, { operation: operation + "-work-plan" }));
  }

  async function listAgentConversationStorage(sessionId, options = {}) {
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    // A summary names an archived session's status without extracting it.
    const summary = await runtime.store.readSessionSummary(sessionId);
    if (summary.status === VIBE64_SESSION_STATUS.ARCHIVED) {
      return runtime.store.withArchivedSession(sessionId, (archived) => nativeConversationBindings(archived));
    }
    return sessionAccess.runMainAgentWrite(sessionId, { ...options, runtime }, ({ session }) =>
      nativeConversationBindings(session, { retiredOnly: true }), { operation: "inspect-native-storage" });
  }

  async function scanAgentConversationStorage(sessionId, options = {}) {
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    const session = options.session || await runtime.store.readSession(sessionId);
    const bindings = nativeConversationBindings(session);
    const scopes = new Map();
    for (const binding of bindings) {
      if (!path.isAbsolute(binding.workdir || "")) throw new Error("Native storage ownership has no saved absolute directory.");
      const scope = { engineId: binding.engineId, modelProviderId: binding.modelProviderId || "", workdir: binding.workdir };
      scopes.set(JSON.stringify(scope), scope);
    }
    const conversations = [];
    for (const scope of scopes.values()) {
      const rows = await sessionAgent.listNativeConversationStorage(sessionId, scope, { ...options, runtime, session });
      for (const row of rows) {
        const tracked = bindings.some((binding) => binding.engineId === row.engineId &&
          binding.conversationId === row.conversationId);
        conversations.push({ ...row, tracked, discoveredIn: scope });
      }
    }
    return { scopes: [...scopes.values()], conversations };
  }

  async function retireAgentConversationHistory(sessionId, input = {}, options = {}) {
    // readable-check: allow method-probe - input validation: retirement requires the caller's preservation callback
    if (typeof options.beforeDelete !== "function") throw new TypeError("Native retirement requires a host preservation callback.");
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    const retire = async (session, archived, publishArtifacts) => {
      if (!archived && (session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(session) ||
          sessionHasActiveAgentRun(session) || workspaceSetup.isRunning(sessionId))) {
        throw new Error("Native history retirement requires an idle open session or a finalized archive.");
      }
      const bindings = nativeConversationBindings(session, { retiredOnly: !archived });
      let binding = bindings.find((candidate) =>
        candidate.engineId === input.engineId && candidate.conversationId === input.conversationId);
      // Native /new and forks may have no Vibe64 binding. Only a finalized
      // archive can nominate an additional native id in an exact saved scope.
      // The provider re-reads its real directory; the host must still prove
      // exclusivity against every live project/session and preserve its text.
      if (!binding && archived && input.discoveredIn) {
        const scope = bindings.find((entry) => entry.engineId === input.engineId &&
          entry.engineId === input.discoveredIn.engineId && entry.workdir === input.discoveredIn.workdir &&
          (entry.modelProviderId || "") === input.discoveredIn.modelProviderId);
        if (scope) binding = { ...scope, conversationId: input.conversationId, discovered: true };
      }
      if (!binding) throw new Error("The requested native conversation is not an archived binding or accepted predecessor.");
      const currentBindings = archived ? [] : nativeConversationBindings(session).filter((entry) => !entry.retired);
      const currentIds = new Set(currentBindings.map((entry) => entry.conversationId));
      const result = await sessionAgent.retireConversationHistory(sessionId, binding, {
        ...options,
        runtime,
        session,
        beforeDelete: async (inventory) => {
          if (inventory.conversations.some((entry) => currentIds.has(entry.conversationId))) {
            throw new Error("Native deletion would include a current Vibe64 conversation.");
          }
          return options.beforeDelete({ ...inventory, session, archived, ...(publishArtifacts ? { publishArtifacts } : {}) });
        }
      });
      if (!archived && result?.ok === true) {
        const state = JSON.parse(await runtime.store.readMetadataValue(sessionId, "assistant_changeover"));
        state.retiredConversations = state.retiredConversations.filter((entry) =>
          entry.conversationId !== binding.conversationId || entry.assistantSelection.engineId !== binding.engineId);
        await runtime.store.writeMetadataValue(sessionId, "assistant_changeover", JSON.stringify(state));
      }
      return result;
    };
    // A host already working in the finalized archive passes it in, so the
    // archive is extracted once for all of that host's work.
    if (options.archivedSession) {
      const { session, publishArtifacts } = options.archivedSession;
      if (session?.sessionId !== sessionId || session.status !== VIBE64_SESSION_STATUS.ARCHIVED ||
          typeof publishArtifacts !== "function") {
        throw new TypeError("Native retirement in an open archive requires that archived session and its publication.");
      }
      return retire(session, true, publishArtifacts);
    }
    // A summary names an archived session's status without extracting it.
    const summary = await runtime.store.readSessionSummary(sessionId);
    if (summary.status === VIBE64_SESSION_STATUS.ARCHIVED) {
      return runtime.store.withArchivedSession(sessionId, (archived, { publishArtifacts }) => retire(archived, true, publishArtifacts), {
        beforeWork: options.beforeArchiveWork
      });
    }
    return sessionAccess.runMainAgentWrite(
      sessionId,
      { ...options, runtime },
      ({ session }) => retire(session, false),
      { operation: "retire-native-history" }
    );
  }

  function replaceAgentConversation(sessionId, input = {}, options = {}) {
    return sessionAccess.runMainAgentWrite(sessionId, options, async (context) => {
      const fail = (message) => {
        throw Object.assign(new Error(message), {
          code: "vibe64_conversation_replacement_unavailable",
          statusCode: 409
        });
      };
      if (context.session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(context.session) ||
          sessionHasActiveAgentRun(context.session) || workspaceSetup.isRunning(sessionId)) {
        fail("Native context can be replaced only in an idle, open session.");
      }
      await sessionAgent.requireAssistantAccess(sessionId, context);
      const conversations = await context.runtime.store.listSessionConversations(sessionId);
      for (const metadata of [context.session.metadata, ...conversations.map((record) => record.routingMetadata || {})]) {
        const routing = assistantRoutingRequestFromMetadata(metadata);
        if (assistantRoutingStatusIsPending(routing) || routing?.helper) fail("Finish pending routing and helper cleanup first.");
      }
      const saved = JSON.parse(context.session.metadata.assistant_changeover || "null");
      if (saved?.replacement?.status !== "preparing") {
        requireCompletedConversationRewind(context.session);
        const goal = await sessionAgent.readGoal(sessionId, context);
        if (!["available", "unsupported"].includes(goal?.status) ||
            goal?.goal && !["complete", "completed", "cancelled"].includes(goal.goal.status)) {
          fail("Finish the native goal before replacing its conversation.");
        }
        const pinnedGoal = assistantRoutingGoalFromMetadata(context.session.metadata);
        if (pinnedGoal && !["complete", "completed", "cancelled"].includes(pinnedGoal.status)) fail("Finish the routed goal first.");
        const native = await sessionAgent.sessionState(sessionId, context);
        if (native?.ok === false || native?.turn?.active || native?.terminal?.status === "running") {
          fail("Stop native work and close its terminal before replacing context.");
        }
        const temporary = await sessionAgent.hasActiveTemporaryConversation(sessionId, {}, context);
        if (temporary?.ok === false || temporary?.active) fail("Finish temporary assistant work before replacing native context.");
      }
      const conversation = await mainConversations.open({ id: sessionId, context: { ...context, sessionId }, representation: "native" });
      const result = await replaceNativeConversation(sessionId, input, context, sessionAgent, conversation);
      await publishAgentSessionChanged(sessionId, { reason: "native-conversation-replaced" });
      return result;
    }, { operation: "replace-agent-conversation" });
  }

  function createEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
    return sessionAgent.createEphemeralConversation(scope, ephemeralInput(input), options);
  }

  function resolveEphemeralAgentExecutionProfile(scope = {}, input = {}, options = {}) {
    return sessionAgent.resolveEphemeralExecutionProfile(scope, input, options);
  }

  function runEphemeralAgentChatTurn(scope = {}, input = {}, options = {}) {
    return sessionAgent.runEphemeralChatTurn(scope, input, options);
  }

  function deleteEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
    return sessionAgent.deleteEphemeralConversation(scope, ephemeralInput(input), options);
  }

  async function runDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
    assertProjectEffectAdmission();
    if (input.executionProfile) {
      return sessionAgent.runDetachedChatTurn(
        sessionId,
        input,
        await assistantContext.assistantSessionOptions(sessionId, options)
      );
    }
    return sessionAccess.runMainAgentWrite(sessionId, options, (context) => (
      sessionAgent.runDetachedChatTurn(sessionId, input, context)
    ), { operation: "run-temporary-chat" });
  }

  async function streamDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
    assertProjectEffectAdmission();
    if (input.executionProfile) {
      return sessionAgent.streamDetachedChatTurn(
        sessionId,
        input,
        await assistantContext.assistantSessionOptions(sessionId, options)
      );
    }
    return sessionAccess.runMainAgentWrite(sessionId, options, (context) => (
      sessionAgent.streamDetachedChatTurn(sessionId, input, context)
    ), { operation: "stream-temporary-chat" });
  }

  function deleteDetachedAgentChatThread(sessionId, input = {}, options = {}) {
    return sessionAgent.deleteDetachedChatThread(sessionId, input, options);
  }

  function generateSessionRenewalHandover(sessionId, input = {}, options = {}) {
    return sessionAccess.runMainAgentWrite(sessionId, options, (context) => (
      runSessionRenewalOperation(
        input,
        options,
        context,
        (trustedInput, trustedContext) => sessionAgent.generateSessionRenewalHandover(
          sessionId,
          trustedInput,
          trustedContext
        ),
        () => context.runtime.getSessionWithoutSource(sessionId)
      )
    ), { operation: "generate-renewal-handover" });
  }

  function createSessionRenewalManualHandoverTemplate(input = {}) {
    return sessionRenewalManualHandoverTemplate(input);
  }

  function seedSessionRenewalHandover(sessionId, input = {}, options = {}) {
    return sessionAccess.runHiddenSessionRenewalAgentWrite(
      sessionId,
      input,
      options,
      (trustedInput, context) => sessionAgent.seedSessionRenewalHandover(
        sessionId,
        trustedInput,
        context
      )
    );
  }

  function validateSessionRenewalHandover(handover = "", options = {}) {
    const {
      source = null
    } = options;
    return defineSessionRenewalHandoverText(handover, {
      requireStructure: true,
      source
    });
  }

  function interruptDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
    return sessionAgent.interruptDetachedChatTurn(sessionId, input, options);
  }

  function readSessionWorkPlan(sessionId, input) {
    return vibe64Result(async () => ({
      ok: true,
      sessionId,
      ...await readWorkPlanPage(await assistantContext.assistantSessionOptions(sessionId), input)
    }));
  }

  function archiveSessionWorkPlan(sessionId, input) {
    return changeSessionWorkPlan(sessionId, "archive", input);
  }

  function restoreSessionWorkPlan(sessionId, input) {
    return changeSessionWorkPlan(sessionId, "restore", input);
  }

  async function assertSessionRenewalIdle(sessionId, options = {}) {
    const { runtime, session } = await sessionAccess.sessionContext(sessionId, options);
    const records = await runtime.store.listSessionConversations(sessionId);
    const requests = [session.metadata, ...records.map((record) => record.routingMetadata || {})]
      .map(assistantRoutingRequestFromMetadata);
    if (requests.some((request) => assistantRoutingStatusIsPending(request) || request?.helper)) {
      throw Object.assign(new Error("Finish or cancel pending chat routing and reviews before renewing this session."), {
        code: "vibe64_assistant_routing_pending",
        retryable: true
      });
    }
    const conversation = await sessionAgent.hasActiveTemporaryConversation(
      sessionId,
      {},
      {
        ...options,
        runtime,
        session
      }
    );
    if (conversation?.active === true) {
      const error = new Error(
        "Wait for the temporary assistant task to finish before renewing this session."
      );
      error.code = "vibe64_session_renewal_temporary_ai_active";
      error.retryable = true;
      throw error;
    }
    return {
      idle: true,
      ok: true
    };
  }

  function readEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
    return sessionAgent.readEphemeralConversation(scope, ephemeralInput(input), options);
  }

  function startEphemeralAgentConversationTurn(scope = {}, input = {}, options = {}) {
    return sessionAgent.startEphemeralConversationTurn(scope, ephemeralInput(input), options);
  }

  function stopEphemeralAgentConversation(scope = {}, input = {}, options = {}) {
    return sessionAgent.stopEphemeralConversation(scope, ephemeralInput(input), options);
  }

  function uploadAgentAttachment(sessionId, input = {}, options = {}) {
    return sessionAccess.runMainAgentWrite(sessionId, options, (context) => (
      sessionAgent.uploadAttachment(sessionId, input, context)
    ), { operation: "upload-agent-attachment", waitMs: AGENT_WRITE_WAIT_MS });
  }

  function readAgentAttachment(sessionId, attachmentId) {
    return sessionAttachments.readAttachment({ sessionId }, attachmentId);
  }

  function deleteAgentAttachment(sessionId, input = {}, options = {}) {
    return sessionAccess.runMainAgentWrite(sessionId, options, (context) => (
      sessionAgent.deleteAttachment(sessionId, input, context)
    ), { operation: "delete-agent-attachment" });
  }

  function waitForEphemeralAgentConversationTurn(scope = {}, input = {}, options = {}) {
    return sessionAgent.waitForEphemeralConversationTurn(scope, ephemeralInput(input), options);
  }

  return Object.freeze({
    archiveSessionWorkPlan,
    assertSessionRenewalIdle,
    createEphemeralAgentConversation,
    createSessionRenewalManualHandoverTemplate,
    deleteAgentAttachment,
    deleteDetachedAgentChatThread,
    deleteEphemeralAgentConversation,
    generateSessionRenewalHandover,
    interruptDetachedAgentChatTurn,
    listAgentConversationStorage,
    readAgentAttachment,
    readEphemeralAgentConversation,
    readSessionWorkPlan,
    replaceAgentConversation,
    resolveEphemeralAgentExecutionProfile,
    restoreSessionWorkPlan,
    retireAgentConversationHistory,
    runDetachedAgentChatTurn,
    runEphemeralAgentChatTurn,
    scanAgentConversationStorage,
    seedSessionRenewalHandover,
    startEphemeralAgentConversationTurn,
    stopEphemeralAgentConversation,
    streamDetachedAgentChatTurn,
    uploadAgentAttachment,
    validateSessionRenewalHandover,
    waitForEphemeralAgentConversationTurn
  });
}

export {
  createServiceAgentConversations
};
