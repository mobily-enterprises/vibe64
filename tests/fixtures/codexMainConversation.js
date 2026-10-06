import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createSessionConversationBinding, prepareSessionConversationRenewal, prepareSessionConversationRenewalProof, prepareSessionConversationDisposal, prepareSessionConversationReadiness, prepareProjectConversationCleanup, prepareConversationRuntimeInvalidation, prepareConversationReconciliation, prepareConversationSubscriptionReset, prepareSessionConversationStorage, prepareSessionConversationActivity } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import { createCodexDetachedConversationView } from "./codexDetachedConversation.js";
import {
  codexAppServerFrozenTurnInterruptResponse,
  codexAppServerMessageDisplayText,
  codexAppServerMessageText
} from "@jskit-ai/assistant-core/server/codex-turn";
import { inspectCodexAppServerMessageAdmission } from "@jskit-ai/assistant-core/server/codex-provider";
import { createCodexSessionRegistration } from "../../packages/vibe64-terminals/src/server/service.js";
import { withCodexState } from "../../packages/vibe64-terminals/src/server/codexConversationStorage.js";
import { codexTerminalNamespace, vibe64Result } from "../../packages/vibe64-terminals/src/server/terminalShared.js";

// Preserve the original native-controller test boundary. Ordinary application
// admission and delivery are exercised separately by the real common-runtime
// and service cases in the same file. These aliases use the same native owners.
export function createCodexTerminalController(options = {}) {
  const { nativeTestContext, ...controllerOptions } = options;
  const registration = createCodexSessionRegistration(controllerOptions);
  const { provider } = registration;
  // Preserve only the test's original low-level view over actual named owners.
  const controller = {
    ...registration.terminals,
    ...registration.attachments,
    ...registration.catalog,
    assistantAccess: registration.accounts.assistantAccess,
    prepareConversationHost: provider.prepareConversationHost,
    startTerminal: (sessionId, input = {}) => provider.startTerminal({ sessionId }, input),
    releaseRenewalPredecessorAttachments: (sessionId, options = {}) =>
      provider.releaseRenewalPredecessorAttachments({ ...options, sessionId }, options)
  };
  const conversations = createConversationRuntime({
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { conversation: ({ id, context, input, options, operation }) => {
      if (operation === "inspectTemporaryActivity") return prepareSessionConversationActivity(provider, id, context);
      if (operation === "releaseRenewalPredecessorProcessExitProof" || operation === "releaseRenewalSuccessorProcessExitProof") {
        return prepareSessionConversationRenewalProof(provider, id, context, input, operation);
      }
      if (!operation && context.nativeTestConversationId) return (async () => {
        const { namespace, native } = await controller.prepareConversationHost(id, context.nativeTestOptions, "scoped");
        return { sessionId: id, engine: provider.id, namespace: `${namespace}\0${context.nativeTestConversationId}`,
          native: { ...native, scoped: {
            conversationId: context.nativeTestConversationId, context: context.nativeTestOptions
          } } };
      })();
      if (operation === "listNativeConversationStorage" || operation === "retireConversationHistory") {
        return prepareSessionConversationStorage(provider, id, context, input);
      }
      if (operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation") {
        return (async () => {
          const { native } = await controller.prepareConversationHost(id, context.nativeTestOptions, "detachedCleanup");
          return { sessionId: id, engine: provider.id, native, input, context: context.nativeTestOptions };
        })();
      }
      if (operation === "reconcileSessions") return prepareConversationReconciliation(provider, context, input, options);
      if (operation === "unsubscribeSessions") return prepareConversationSubscriptionReset(provider, context, input);
      if (operation === "invalidateRuntimes") return prepareConversationRuntimeInvalidation(provider, context, input);
      if (operation === "closeProject") return prepareProjectConversationCleanup(provider, context, input);
      if (operation === "generateRenewalHandover" || operation === "seedRenewalHandover") {
        return prepareSessionConversationRenewal(provider, id, context, input);
      }
      if (operation === "ensure") return prepareSessionConversationReadiness(provider, id, context);
      if (operation !== "dispose") throw new Error("This fixture runtime only dispatches native lifecycle operations.");
      return prepareSessionConversationDisposal(provider, id, context, input);
    } }
  });
  async function binding(sessionId, current = {}) {
    const runtime = current.runtime || await options.projectService.createRuntime({ inspectSource: false });
    return createSessionConversationBinding(provider, sessionId, { ...current, runtime });
  }
  async function scopedOperation(method, nativeMethod, sessionId, input = {}, current = {}) {
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId.trim() : "";
    if (typeof sessionId !== "string" || !sessionId.trim() || !conversationId) {
      // Missing/malformed identity is an original native-owner contract. Do not
      // invent an id or replace its distinct result envelopes with open errors.
      const { native } = await controller.prepareConversationHost(sessionId, current, "scoped");
      return native.runOwner[nativeMethod](sessionId, input, current);
    }
    const conversation = await conversations.open({ id: sessionId, representation: "native",
      context: { ...current, sessionId, nativeTestConversationId: conversationId, nativeTestOptions: current } });
    return conversation[method](input);
  }
  function nativeValue(result) {
    return Object.hasOwn(result, "session") ? withCodexState(result.value, result.session) : result.value;
  }
  return {
    ...controller,
    conversationProvider: provider,
    ...createCodexDetachedConversationView({ provider, options: controllerOptions, nativeTestContext }),
    releaseRenewalPredecessorProcessExitProof(sessionId, current = {}) {
      return conversations.releaseNativeRenewalPredecessorProcessExitProof({ id: sessionId, context: current, input: current });
    },
    releaseRenewalSuccessorProcessExitProof(sessionId, current = {}) {
      return conversations.releaseNativeRenewalSuccessorProcessExitProof({ id: sessionId, context: current, input: current });
    },
    hasActiveTemporaryConversation(sessionId) {
      return conversations.inspectNativeTemporaryActivity({ id: sessionId, context: { sessionId } });
    },
    startConversationTurn: (sessionId, input = {}, current = {}) =>
      scopedOperation("send", "startConversationTurn", sessionId, input, current),
    readConversation: (sessionId, input = {}, current = {}) =>
      scopedOperation("read", "readConversation", sessionId, input, current),
    waitForConversationTurn: (sessionId, input = {}, current = {}) =>
      scopedOperation("wait", "waitForConversationTurn", sessionId, input, current),
    stopConversation: (sessionId, input = {}, current = {}) =>
      scopedOperation("cancel", "stopConversation", sessionId, input, current),
    deleteConversation: (sessionId, input = {}, current = {}) =>
      scopedOperation("dispose", "deleteConversation", sessionId, input, current),
    listNativeConversationStorage(sessionId, binding, current = {}) {
      return conversations.listNativeConversationStorage({ id: sessionId, context: { ...current, sessionId }, binding });
    },
    retireConversationHistory(sessionId, binding, current = {}) {
      return conversations.retireNativeConversationHistory({ id: sessionId, context: { ...current, sessionId }, binding });
    },
    deleteDetachedChatThread(sessionId, input = {}, current = {}) {
      return conversations.deleteNativeDetachedConversation({
        id: sessionId, context: { sessionId, nativeTestOptions: current }, input
      });
    },
    interruptDetachedChatTurn(sessionId, input = {}, current = {}) {
      return conversations.interruptNativeDetachedConversation({
        id: sessionId, context: { sessionId, nativeTestOptions: current }, input
      });
    },
    generateSessionRenewalHandover(sessionId, input = {}, current = {}) {
      return vibe64Result(() => conversations.generateNativeRenewalHandover({
        id: sessionId, context: { ...current, sessionId }, input
      }));
    },
    seedSessionRenewalHandover(sessionId, input = {}, current = {}) {
      return vibe64Result(() => conversations.seedNativeRenewalHandover({
        id: sessionId, context: { ...current, sessionId }, input
      }));
    },
    reconcileThreads(sessions = [], options = {}) {
      return provider.projectConversationResult("reconcileSessions", () => conversations.reconcileNativeSessions({
        context: { providerId: provider.id, transportId: provider.transportId }, sessions, options
      }));
    },
    unsubscribeKnownAppServerThreads(sessions = []) {
      return provider.projectConversationResult("unsubscribeSessions", () => conversations.unsubscribeNativeSessions({
        context: { providerId: provider.id, transportId: provider.transportId }, sessions
      }));
    },
    invalidateAppServerRuntimes(input = {}) {
      return provider.projectConversationResult("invalidateRuntimes", () => conversations.invalidateNativeRuntimes({
        context: { providerId: provider.id, transportId: provider.transportId }, input
      }));
    },
    closeAllForProject(input = {}) {
      return provider.projectConversationResult("closeProject", () => conversations.closeNativeProject({
        context: { providerId: provider.id, transportId: provider.transportId }, input
      }));
    },
    async closeAllForSession(sessionId, current = {}) {
      const id = String(sessionId || "").trim();
      const disposed = await conversations.disposeNative({
        namespace: codexTerminalNamespace(id), sessionId: id,
        context: { ...current, sessionId: id }, options: current
      });
      return disposed.result;
    },
    ensureThread(sessionId) {
      return vibe64Result(() => conversations.ensureNativeConversation({
        id: sessionId, context: { sessionId }
      }));
    },
    async createConversation(sessionId, input = {}, current = {}) {
      const { native } = await controller.prepareConversationHost(sessionId, current, "create");
      return native.runOwner.createConversation(sessionId, input, current);
    },
    async sendMessage(sessionId, input = {}, current = {}) {
      const { native } = await binding(sessionId, current);
      const messageId = String(input?.messageId || "").trim();
      return native.runOwner.withMessageDelivery(sessionId, messageId, {
        attachments: input?.displayAttachments,
        turnMetadata: input?.turnMetadata,
        text: codexAppServerMessageDisplayText(input, codexAppServerMessageText(input)),
        actorContext: input?.vibe64User || null
      }, () => vibe64Result(async () => nativeValue(await native.runOwner.dispatchMessage(sessionId, input, {
        ...current, actorContext: input?.vibe64User || null
      }, native.messagePreparation))));
    },
    interruptTurn(sessionId, input = {}) {
      return vibe64Result(async () => {
        const { native } = await binding(sessionId);
        const admission = native.admission();
        if (admission.ok === false) return codexAppServerFrozenTurnInterruptResponse({
          threadId: input.threadId || input.codexSessionId,
          turnId: input.turnId || input.codexTurnId
        });
        try {
          const context = await native.controlPreparation({}, input);
          if (context.ok === false) return context;
          return nativeValue(await native.runOwner.interruptTurn(sessionId, input, native.runOwner.controlContext(sessionId, context)));
        } finally { admission.release(); }
      });
    },
    inspectMessageAdmission(sessionId, input = {}, current = {}) {
      return vibe64Result(async () => {
        const messageId = String(input.messageId || "").trim();
        const threadId = String(input.threadId || "").trim();
        if (!messageId || !threadId) return { ok: false, code: "vibe64_codex_admission_identity_required",
          error: "Admission inspection requires the message ID and original assistant thread." };
        const { native } = await binding(sessionId, current);
        const prepared = await native.inspectionPreparation({ messageId, threadId }, current);
        if (prepared.ok === false) return prepared;
        const context = await native.runOwner.conversationContext(sessionId, {}, prepared);
        if (context.ok === false) return context;
        return inspectCodexAppServerMessageAdmission({ provider: context.provider, threadId, messageId });
      });
    },
    async readGoal(sessionId, current = {}) {
      const { namespace, native } = await binding(sessionId, current);
      const context = await native.readGoalContext(current);
      if (context.ok === false) return { status: "unavailable", goal: null };
      return native.providerOwner.readSessionGoal(namespace, context.threadId);
    },
    async updateGoal(sessionId, input = {}, current = {}) {
      const { native } = await binding(sessionId, current);
      const invalid = native.runOwner.validateGoalInput(input);
      if (invalid) return invalid;
      const admission = native.admission();
      if (admission.ok === false) return admission;
      try {
        return await native.runOwner.updateGoal(sessionId, input, {
          context: await native.runOwner.prepareGoalContext(sessionId, current, native.goalPreparation),
          prepareConversation: () => native.runOwner.prepareGoalContext(sessionId, current, native.goalPreparation, { prepareThread: true })
        });
      } finally { admission.release(); }
    },
    terminalState(sessionId, current = {}) {
      return vibe64Result(async () => (await (await binding(sessionId, current)).read()).nativeResult);
    }
  };
}
