import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { VIBE64_AGENT_EXECUTION_PROFILE_IDS, VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { conversationMessageId, upstreamMessageId } from "./openCodeConversationStorage.js";
import { renewalCleanupContext } from "./sessionRenewalHandover.js";

const OPENCODE_AGENT_RUN_ID = "opencode_server";
const OPENCODE_PROGRESS_PUBLISH_INTERVAL_MS = 1_000;
const OPENCODE_REASONING_HEADLINE_MAX_CHARS = 120;
const OPENCODE_REASONING_SUMMARY_TIMEOUT_MS = 12_000;
const OPENCODE_REASONING_SUMMARY_MAX_INPUT_CHARS = 1_200;
const OPENCODE_REASONING_SUMMARY_MIN_INPUT_CHARS = 40;

function text(value = "") {
  return String(value ?? "").trim();
}

function openCodeReasoningHeadline(value = "") {
  const normalized = String(value ?? "").replace(/\r\n?/gu, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }
  const sentence = normalized.split(/(?<=[.!?])\s+/u)[0] || normalized;
  if (sentence.length <= OPENCODE_REASONING_HEADLINE_MAX_CHARS) {
    return sentence;
  }
  const words = sentence.slice(0, OPENCODE_REASONING_HEADLINE_MAX_CHARS).split(/\s+/u);
  words.pop();
  return words.length ? `${words.join(" ")}…` : sentence;
}

// Product progress summaries and publication use the original native inventory.
function createOpenCodeConversationPresentation({ getAssistantManager, publishSessionChanged, turns, temporaryConversations }) {
  const progressPublishes = new Map();
  const progressPublishedAt = new Map();

  function reasoningSummaryInstruction(value = "") {
    const trimmed = String(value ?? "").trim().slice(0, OPENCODE_REASONING_SUMMARY_MAX_INPUT_CHARS);
    return [
      "Summarize the assistant's private reasoning below as ONE short present-tense sentence",
      "(at most 12 words) describing what it is doing or concluded.",
      "Reply with only that sentence and no quotation marks.",
      "",
      "Reasoning:",
      trimmed
    ].join("\n");
  }

  async function requestReasoningSummary(state, value = "") {
    const agent = getAssistantManager();
    if (!agent || !state.actorKnown) return "";
    const context = state.context;
    for (const previous of temporaryConversations.values()) {
      if (previous.reasoningSummary && previous !== state && previous.context.key === context.key) {
        await disposeReasoningSummary(previous);
      }
    }
    await cleanupReasoningSummary(context);
    const signal = AbortSignal.any([
      state.target.abortController.signal,
      state.abortController.signal,
      AbortSignal.timeout(OPENCODE_REASONING_SUMMARY_TIMEOUT_MS)
    ]);
    signal.throwIfAborted();
    const workflowEngineId = assistantRoutingFromMetadata(context.session.metadata)?.workflowEngineId || context.selection.engineId;
    const decision = await agent.resolveAssistantPurpose({ purpose: "conversation_summary", workflowEngineId }, context);
    if (!decision.available) return "";
    signal.throwIfAborted();
    const id = `reasoning_${randomUUID()}`;
    const root = path.join(context.runtime.stateRoot, "assistant-helpers", id);
    const helper = { selection: decision.effectiveSelection, connectionIdentity: decision.connectionIdentity,
      conversationId: "", runId: "", executionId: "",
      scope: { id, environment: {}, workdir: path.join(root, "workdir"), runtimeRoot: path.join(root, "runtime"),
        stableContext: "Return only a short progress summary of the supplied text. You have no tools or project access." } };
    const retain = () => context.runtime.store.writeAgentRunEvent(context.sessionId, OPENCODE_AGENT_RUN_ID, {
      event: { kind: "reasoning-helper" }, patch: { reasoningSummaryHelper: helper }
    });
    await retain();
    const options = { assistantSelection: helper.selection, vibe64User: context.vibe64User,
      expectedConnectionIdentity: helper.connectionIdentity, signal,
      async onEvent(event) {
        if (event.type === "thread") helper.conversationId = text(event.threadId);
        else if (event.type === "turn") helper.runId = text(event.turnId);
        else if (event.type === "helper-execution") helper.executionId = text(event.executionId);
        else return;
        await retain();
      } };
    let result;
    let failure;
    try {
      await mkdir(helper.scope.workdir, { recursive: true });
      await mkdir(helper.scope.runtimeRoot, { recursive: true });
      const executionProfile = await agent.resolveEphemeralExecutionProfile(helper.scope, {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER, workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.CONVERSATION_SUMMARY
      }, options);
      helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
      await retain();
      result = await agent.runEphemeralChatTurn(helper.scope, {
        executionProfile, prompt: reasoningSummaryInstruction(value), promptLabel: "Summarize progress"
      }, options);
      if (result?.ok !== true) throw new Error(result?.error || "The progress summary did not complete.");
    } catch (error) { failure = error; }
    try { await cleanupReasoningSummary(context); }
    catch (error) { if (failure && error !== failure) error.cause = failure; failure = error; }
    if (failure) throw failure;
    return text(result.text);
  }

  async function cleanupReasoningSummary(context) {
    const agent = getAssistantManager();
    if (!agent) return;
    const renewal = renewalCleanupContext(context.sessionId, context);
    const cleanup = async () => {
      let helper;
      if (renewal) {
        const session = await context.runtime.getSessionForRenewal(context.sessionId, { inspectSource: false });
        renewalCleanupContext(context.sessionId, { ...context, session });
        helper = session.agentRuns?.find(run => run.id === OPENCODE_AGENT_RUN_ID)?.reasoningSummaryHelper;
      } else {
        helper = (await context.runtime.store.readAgentRun(context.sessionId, OPENCODE_AGENT_RUN_ID))?.reasoningSummaryHelper;
      }
      if (!helper) return;
      const root = path.join(context.runtime.stateRoot, "assistant-helpers", helper.scope.id);
      if (!/^reasoning_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(root, "workdir") ||
          helper.scope.runtimeRoot !== path.join(root, "runtime")) throw new Error("The progress summary has invalid cleanup paths.");
      const result = await agent.deleteEphemeralConversation(helper.scope, {
        conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
        ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
      }, { assistantSelection: helper.selection, vibe64User: context.vibe64User });
      if (result?.ok !== true) throw new Error(result?.error || "The progress summary could not be closed.");
      await context.runtime.store.writeAgentRunEvent(context.sessionId, OPENCODE_AGENT_RUN_ID, {
        event: { kind: "reasoning-helper-closed" }, patch: { reasoningSummaryHelper: null }
      });
      await rm(root, { recursive: true, force: true });
    };
    // The existing renewal lease authorizes the same event writer only for this session.
    return renewal
      ? context.runtime.store.mutateSessionForRenewal(context.sessionId, cleanup)
      : cleanup();
  }

  function disposeReasoningSummary(state) {
    if (state.disposal) return state.disposal;
    state.closed = true;
    state.abortController.abort();
    state.disposal = Promise.resolve().then(async () => {
      await state.completion;
      await cleanupReasoningSummary(state.context);
      state.entries.clear();
      temporaryConversations.delete(state.key);
    }).finally(() => { state.disposal = null; });
    return state.disposal;
  }

  function publishOpenCodeProgress(sessionId, summary) {
    const now = Date.now();
    const last = progressPublishedAt.get(sessionId) || 0;
    if (!progressPublishes.has(sessionId) && now - last >= OPENCODE_PROGRESS_PUBLISH_INTERVAL_MS) {
      progressPublishedAt.set(sessionId, now);
      void publishSessionChanged(sessionId, {
        payload: { assistantProgress: summary },
        reason: "opencode-server-progress"
      }).catch(() => {});
      return;
    }
    if (progressPublishes.has(sessionId)) {
      progressPublishes.get(sessionId).summary = summary;
      return;
    }
    const timer = setTimeout(() => {
      const pending = progressPublishes.get(sessionId);
      progressPublishes.delete(sessionId);
      if (pending) {
        progressPublishedAt.set(sessionId, Date.now());
        void publishSessionChanged(sessionId, {
          payload: { assistantProgress: pending.summary },
          reason: "opencode-server-progress"
        }).catch(() => {});
      }
    }, OPENCODE_PROGRESS_PUBLISH_INTERVAL_MS - (now - last));
    progressPublishes.set(sessionId, { summary, timer });
  }

  function dropOpenCodeProgress(sessionId) {
    const pending = progressPublishes.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      progressPublishes.delete(sessionId);
    }
    progressPublishedAt.delete(sessionId);
  }

  async function publishConversationTurn(context = {}, turn = null, reason = "") {
    if (!turn) {
      return;
    }
    await publishSessionChanged(context.sessionId, {
      payload: {
        conversationStream: context.runtime.store.readConversationStream(context.sessionId),
        conversationLogPatch: {
          turn,
          type: "upsert-turn"
        }
      },
      reason
    });
  }

  async function writeReasoningMessage(context, entry, headline) {
    if (entry.writing) return entry.writing;
    if (entry.written || !headline) return;
    entry.writing = Promise.resolve().then(async () => {
      const turn = await context.runtime.store.writeConversationThinkingMessage(context.sessionId, {
        at: entry.at,
        messageId: entry.id,
        text: headline
      });
      entry.written = true;
      if (turn) await publishConversationTurn(context, turn, "opencode-server-reasoning");
    }).finally(() => { entry.writing = null; });
    return entry.writing;
  }

  async function projectReasoning(context, reasoning, { complete = false, flush = false } = {}) {
    const state = turns.get(context.key)?.reasoning;
    if (!state || state.closed) return;
    for (const part of reasoning) {
      const id = conversationMessageId(part.messageId, part.partId, "reasoning");
      let entry = state.entries.get(id);
      if (!entry) {
        entry = { id, at: part.createdAt ? new Date(part.createdAt).toISOString() : "", written: false, queued: false };
        state.entries.set(id, entry);
      }
      entry.value = part.text;
      if (entry.written) continue;
      if (flush) {
        await writeReasoningMessage(context, entry, openCodeReasoningHeadline(entry.value));
        continue;
      }
      const partialHeadline = openCodeReasoningHeadline(entry.value);
      if (entry.queued || !(complete || part.complete || /[.!?…]$/u.test(partialHeadline))) continue;
      entry.queued = true;
      state.completion = state.completion.then(async () => {
        if (state.closed || entry.written) return;
        let headline = "";
        if (text(entry.value).length >= OPENCODE_REASONING_SUMMARY_MIN_INPUT_CHARS) {
          try {
            headline = openCodeReasoningHeadline(await requestReasoningSummary(state, entry.value));
          } catch (error) {
            if (!state.abortController.signal.aborted) {
              vibe64SessionDebugLog("server.opencode.reasoning-summary.error", {
                error: vibe64SessionDebugError(error), sessionId: context.sessionId
              });
            }
          }
        }
        if (!state.closed) {
          await writeReasoningMessage(context, entry, headline || openCodeReasoningHeadline(entry.value));
        }
      }).catch((error) => {
        vibe64SessionDebugLog("server.opencode.reasoning-summary.error", {
          error: vibe64SessionDebugError(error), sessionId: context.sessionId
        });
      });
    }
  }

  return { cleanupReasoningSummary, disposeReasoningSummary, publishOpenCodeProgress,
    dropOpenCodeProgress, projectReasoning, publishConversationTurn };
}

export { createOpenCodeConversationPresentation, conversationMessageId, upstreamMessageId, OPENCODE_AGENT_RUN_ID };
