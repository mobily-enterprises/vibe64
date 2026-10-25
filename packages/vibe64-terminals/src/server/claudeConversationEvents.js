import { VIBE64_AGENT_RUN_STATE as RUN } from "@local/vibe64-runtime/server";
import { VIBE64_ASSISTANT_ENGINE_IDS, VIBE64_ASSISTANT_TRANSPORT_IDS } from "@local/vibe64-runtime/shared";
import { checkpointSessionTurn } from "./sessionTurnCheckpoint.js";
import { claudeConversationError as error } from "./terminalShared.js";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { normalizeText as text } from "@local/vibe64-core/server/core";

const ENGINE = VIBE64_ASSISTANT_ENGINE_IDS.CLAUDE;
const TRANSPORT = VIBE64_ASSISTANT_TRANSPORT_IDS.CLAUDE_STREAM_JSON;
const now = () => new Date().toISOString();

// The native owner emits once; Vibe64 persists and publishes its existing effects.
function createClaudeConversationEvents({ projectService, storage, messagePolicy, owner, accountQueries, publishSessionChanged, logger }) {
  const { save } = storage;
  const { snapshot } = owner;

  async function publishRun(entry, { state, active, message }) {
    if (!entry.main || entry.renewal) {
      if (!active && entry.persistent && !entry.profile && !entry.context.assistantScope && !entry.renewal) {
        await publishSessionChanged(entry.context.sessionId, { reason: "temporary-agent-turn-idle", payload: {
          conversationId: entry.id, temporaryRun: { active: false, state, providerTurnId: entry.turn.id }
        } });
      }
      return;
    }
    const { runtime, sessionId, selection } = entry.context;
    // The client applies a turn overlay only with the session revision this
    // write produced; without it the working state waits for a later refresh.
    const { run, revision } = await runtime.store.mutateSession(sessionId, async () => ({ sessionId,
      run: await runtime.store.writeAgentRunEvent(sessionId, TRANSPORT, {
        event: { kind: `claude-${state}`, state, message },
        patch: { engineId: ENGINE, state, error: message, phase: entry.turn.phase, observationError: entry.observationError || "",
          model: selection.modelId, modelProviderId: selection.modelProviderId, threadId: entry.id,
          turnId: entry.turn.id, startedAt: entry.turn.startedAt, finishedAt: active ? "" : now(), updatedAt: now() }
      }) }));
    await publishSessionChanged(sessionId, {
      session: { sessionId, revision },
      reason: active ? "claude-stream-turn-active" : "claude-stream-turn-idle",
      payload: {
        ...(!active ? { conversationStream: runtime.store.clearConversationStream(sessionId) } : {}),
        agentRun: { ...run, active, provider: ENGINE, providerInterface: TRANSPORT,
          providerThreadId: entry.id, providerTurnId: entry.turn.id },
        agentSession: { providerId: ENGINE, transportId: TRANSPORT, thread: { id: entry.id },
          turn: { ...snapshot(entry), runState: state, state: active ? "active" : "idle" } }
      }
    });
  }

  async function publishMessage(entry, message) {
    if (!entry.main || entry.renewal) return;
    const { runtime, sessionId } = entry.context;
    const outputId = text(message.outputId) || message.id;
    if (!message.complete) {
      if (message.role !== "assistant") return;
      const conversationStream = runtime.store.updateConversationStream(sessionId, {
        turnId: entry.turn?.id, messageId: message.id, outputId, text: message.text
      });
      await publishSessionChanged(sessionId, { reason: "assistant-stream", payload: { conversationStream } });
      return;
    }
    if (!text(message.text)) return;
    const writer = message.role === "thinking" ? "writeConversationThinkingMessage"
      : message.role === "commentary" ? "writeConversationCommentaryMessage" : "writeConversationAssistantMessage";
    const turn = await runtime.store[writer](sessionId, { messageId: message.id, outputId, text: message.text,
      ...(message.data === undefined ? {} : { data: message.data }) });
    runtime.store.completeConversationStreamMessage(sessionId, outputId);
    await publishSessionChanged(sessionId, { reason: "claude-stream-message", payload: {
      conversationLogPatch: { type: "upsert-turn", turn },
      conversationStream: runtime.store.readConversationStream(sessionId)
    } });
    return turn;
  }

  async function receiveTurnEvent(entry, event) {
    if (["state", "continued", "execution", "stop-unconfirmed", "diagnostic"].includes(event.type)) {
      // Only normalized lifecycle facts belong in operator logs. Native frames
      // contain prompts, replies, tool arguments and account data.
      try {
        logOperationalEvent(logger, event.type === "stop-unconfirmed" || event.stage === "steering_failed" ? "warn" : "info", {
          component: "vibe64.claude", event: "vibe64.claude.lifecycle", stage: event.stage || event.type,
          sessionId: entry.context.sessionId, conversationId: entry.id, turnId: entry.turn?.id,
          executionId: event.executionId || entry.executionId, state: event.state, active: event.active,
          source: event.source, nativeEvent: event.nativeEvent, status: event.status, terminalReason: event.terminalReason,
          pendingCommands: event.pendingCommands, backgroundTasks: event.backgroundTasks
        }, "Claude conversation lifecycle.");
      } catch { /* Diagnostic sinks cannot interrupt native work. */ }
    }
    if (event.type === "save") return save(entry);
    if (event.type === "state") return publishRun(entry, event);
    if (event.type === "goal-updated") return publishSessionChanged(entry.context.sessionId, { reason: "claude-goal" });
    if (event.type === "stop-unconfirmed") {
      if (entry.turn) await publishRun(entry, { state: entry.turn.state, active: entry.turn.active, message: entry.observationError });
      throw error(entry.observationError, "vibe64_claude_stop_unconfirmed");
    }
    if (event.type === "execution") {
      const ctx = event.context;
      if (ctx.assistantScope) await ctx.onEvent?.({ type: "helper-execution", conversationId: entry.id, executionId: event.executionId });
      return;
    }
    if (event.type === "message-metadata") return messagePolicy.messageMetadata(entry, event);
    if (event.type === "admit-message") return messagePolicy.admitMessage(entry, event);
    if (event.type === "provider-event") {
      await entry.onEvent?.({ ...event, providerId: ENGINE, threadId: entry.id, turnId: entry.turn?.id || "" });
    } else if (event.type === "provider-update") {
      if (entry.main) {
        if (event.change === "usage") accountQueries.invalidateUsage();
        await publishSessionChanged(entry.context.sessionId, {
          reason: event.change === "goal" ? "claude-goal" : "claude-plan-usage"
        });
      }
    } else if (event.type === "admitted") {
      if (entry.main && event.userEcho) await publishSessionChanged(entry.context.sessionId, { reason: "claude-goal" });
    } else if (event.type === "message") {
      if (entry.persistent && !entry.main && !entry.profile && !entry.renewal && entry.context.routingConversationId) {
        await entry.onEvent?.({ ...event, threadId: entry.id, turnId: entry.turn?.id || "" });
      }
      return publishMessage(entry, event.message);
    } else if (event.type === "message-complete") {
      if (entry.main && !entry.renewal) entry.context.runtime.store.completeConversationStreamMessage(entry.context.sessionId, event.messageId);
    } else if (event.type === "text" || event.type === "thinking") {
      await entry.onEvent?.({ ...event, threadId: entry.id });
    }
  }

  return function onEvent(entry, event) {
    if (event.type === "admit-message" && messagePolicy.skipAdmission(entry, event)) return;
    if (event.type !== "before-state") return receiveTurnEvent(entry, event);
    if (!event.active && entry.turn.active && !entry.context.assistantScope && !entry.profile && !entry.renewal) {
      const runtime = entry.context.runtime;
      return checkpointSessionTurn({
        projectService, runtime, session: entry.context.session,
        sessionId: entry.context.sessionId, outerTurnId: `claude:${entry.id}:${entry.turn.id}`,
        outcome: [RUN.COMPLETED, RUN.INTERRUPTED, RUN.CANCELLED].includes(event.state) ? event.state : "failed",
        publishSessionChanged
      });
    }
  };
}

export { createClaudeConversationEvents };
