import { normalizeText } from "@local/vibe64-core/server/core";

import { requiredSourceEditorExecutionProfile, resolvedSourceEditorExecutionProfile, runSourceEditorHelperTurn, sourceEditorAgentOperationOptions, sourceEditorExecutionProfileFromFailure, sourceEditorExecutionProfileRequest, sourceEditorExecutionProfileSnapshot } from "./explanationProfile.js";
import { deleteSourceEditorExplanationAgentThread, normalizeSourceEditorExplanation, normalizeSourceEditorExplanationId, normalizeSourceEditorFollowups, normalizeSourceEditorMessages, readSourceEditorExplanationRecord, readStoppedSourceEditorExplanation, removeSourceEditorExplanationCleanupRecord, sourceEditorExplanationMemoryKey, writeSourceEditorExplanation } from "./explanationRecords.js";
import { normalizeSourceEditorLineRange, SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS, sourceEditorExplanationMessageId, sourceEditorLines, sourceEditorSelectionForRange, sourceEditorTextHash } from "./explanationText.js";
import { isPlainObject, readSourceEditorFile, sourceEditorError, sourceEditorErrorResponse } from "./sourceFiles.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./explanationRecords.js").SourceEditorExplanationChats} SourceEditorExplanationChats */

// One streamed assistant turn of a source explanation: its messages, the
// events it emits, the structured answer it parses, and the explanation
// state the stream updates.
const SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS = 180_000;

const SOURCE_EDITOR_EXPLANATION_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    answer: {
      maxLength: SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS,
      minLength: 1,
      type: "string"
    }
  },
  required: ["answer"],
  type: "object"
});

function sourceEditorFollowupThreadError(error = null) {
  const message = normalizeText(error?.message || error?.error);
  if (!/thread/iu.test(message) || /regenerate this explanation/iu.test(message)) {
    return error;
  }
  return sourceEditorError(
    `${message} Regenerate this explanation before asking another follow-up.`,
    normalizeText(error?.code) || "vibe64_source_explanation_agent_thread_unavailable",
    isPlainObject(error?.details) ? error.details : {},
    Number(error?.statusCode) || 409
  );
}

function sourceEditorFailureWithRejectedThread(error = null, rejectedThread = null) {
  if (!normalizeText(rejectedThread?.threadId)) {
    return error;
  }
  let failure = error;
  if (!failure || typeof failure !== "object" || !Object.isExtensible(failure)) {
    const response = sourceEditorErrorResponse(error);
    failure = sourceEditorError(
      response.error || "The agent could not answer this source explanation chat.",
      response.code || "vibe64_source_explanation_agent_failed",
      isPlainObject(response.details) ? response.details : {},
      response.statusCode || 502
    );
  }
  failure.sourceEditorRejectedThread = Object.freeze({
    executionProfile: sourceEditorExecutionProfileSnapshot(rejectedThread.executionProfile),
    threadId: normalizeText(rejectedThread.threadId),
    turnId: normalizeText(rejectedThread.turnId)
  });
  return failure;
}

function sourceEditorStructuredAnswer(value = "", {
  code = "vibe64_source_explanation_agent_invalid",
  maxChars = SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS
} = {}) {
  let envelope = value;
  if (typeof value === "string") {
    try {
      envelope = JSON.parse(value);
    } catch {
      throw sourceEditorError(
        "The assistant returned an invalid structured explanation.",
        code,
        {},
        502
      );
    }
  }
  const keys = isPlainObject(envelope) ? Object.keys(envelope) : [];
  const answer = keys.length === 1 && keys[0] === "answer" && typeof envelope.answer === "string"
    ? envelope.answer.trim()
    : "";
  if (!answer || answer.length > maxChars) {
    throw sourceEditorError(
      "The assistant returned an invalid structured explanation.",
      code,
      { maxChars },
      502
    );
  }
  return answer;
}

async function withSourceEditorExplanationFreshness(context = {}, explanation = {}) {
  const record = normalizeSourceEditorExplanation(explanation);
  try {
    const file = await readSourceEditorFile(context, record.sourceRange.path);
    const range = normalizeSourceEditorLineRange(record.sourceRange, sourceEditorLines(file.text).length);
    const selectedTextHash = sourceEditorTextHash(sourceEditorSelectionForRange(file.text, range));
    const sameFileHash = file.hash === record.sourceRange.fileHash;
    const sameSelectionHash = selectedTextHash === record.sourceRange.selectedTextHash;
    return {
      ...record,
      stale: !sameFileHash || !sameSelectionHash,
      staleReason: sameFileHash && sameSelectionHash
        ? ""
        : (sameSelectionHash ? "The file changed around this explanation." : "The selected code changed.")
    };
  } catch {
    return {
      ...record,
      stale: true,
      staleReason: "The source file is no longer available."
    };
  }
}

/**
 * @param {object} [context]
 * @param {string} [threadId]
 * @param {TerminalsService} terminalService
 * @param {object | null} [executionProfile]
 */
async function cleanupRejectedSourceEditorExplanationThread(
  context = {},
  threadId = "",
  terminalService,
  executionProfile = null
) {
  if (context.assistantHelper) {
    try {
      const result = await deleteSourceEditorExplanationAgentThread(context, { helper: context.assistantHelper }, { terminalService });
      await removeSourceEditorExplanationCleanupRecord(context, context.explanationId);
      context.assistantHelper = null;
      return result;
    } catch (error) {
      return { ok: false, error: normalizeText(error.message) || "Agent chat cleanup failed." };
    }
  }
  try {
    const cleanup = await terminalService.deleteDetachedAgentChatThread(
      context.sessionId || context.session?.sessionId || context.session?.id,
      {
        executionProfile: sourceEditorExecutionProfileSnapshot(executionProfile) ||
          sourceEditorExecutionProfileRequest(),
        threadId
      },
      sourceEditorAgentOperationOptions(context)
    );
    return cleanup?.ok === true
      ? cleanup
      : {
          ...(isPlainObject(cleanup) ? cleanup : {}),
          error: normalizeText(cleanup?.error) || "Agent chat cleanup did not confirm that the thread was deleted.",
          ok: false
        };
  } catch (error) {
    return {
      error: normalizeText(error?.message) || "Agent chat cleanup failed.",
      ok: false
    };
  }
}

function sourceEditorExplanationMessage(role = "", text = "", createdAt = new Date().toISOString(), options = {}) {
  const source = isPlainObject(options) ? options : {};
  return {
    createdAt,
    id: normalizeText(source.id) || sourceEditorExplanationMessageId(),
    role,
    status: normalizeText(source.status || "complete"),
    text: String(text || "")
  };
}

function sourceEditorExplanationMessagesForAppend(explanation = {}) {
  const existing = normalizeSourceEditorMessages(explanation.messages);
  if (existing.length) {
    return existing;
  }
  return normalizeSourceEditorMessages([
    ...(explanation.body
      ? [{
          id: "body",
          role: "assistant",
          text: explanation.body
        }]
      : []),
    ...normalizeSourceEditorFollowups(explanation.followups)
  ]);
}

function sourceEditorClientExplanationId(value = "") {
  if (!normalizeText(value)) {
    return "";
  }
  try {
    return normalizeSourceEditorExplanationId(value);
  } catch {
    return "";
  }
}

function sourceEditorClientMessageId(value = "") {
  const id = normalizeText(value);
  return /^[a-z0-9_-]{1,100}$/u.test(id) ? id : "";
}

function sourceEditorExplanationWithMessage(explanation = {}, messageId = "", patch = {}) {
  const normalizedMessageId = normalizeText(messageId);
  const messages = normalizeSourceEditorMessages(explanation.messages);
  const index = messages.findIndex((message) => message.id === normalizedMessageId);
  if (index === -1) {
    return {
      ...explanation,
      messages
    };
  }
  const nextMessages = [...messages];
  nextMessages[index] = normalizeSourceEditorMessages([{
    ...nextMessages[index],
    ...patch
  }])[0] || nextMessages[index];
  return {
    ...explanation,
    messages: nextMessages
  };
}

function emitSourceEditorExplanationEvent(emit = null, isClosed = null, type = "", payload = {}) {
  if (typeof emit !== "function" || (typeof isClosed === "function" && isClosed())) {
    return;
  }
  emit({
    ...payload,
    type
  });
}

/**
 * @param {object} [context]
 * @param {object} [options]
 * @param {TerminalsService} options.terminalService
 */
async function streamSourceEditorAgentTurn(context = {}, {
  onText = null,
  onExecutionProfile = null,
  onThread = null,
  onTurn = null,
  prompt = "",
  promptLabel = "",
  terminalService,
  threadId = "",
  outputSchema = SOURCE_EDITOR_EXPLANATION_OUTPUT_SCHEMA,
  answerMaxChars = SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS
} = {}) {
  let latestText = "";
  let latestExecutionProfile = null;
  let latestThreadId = normalizeText(threadId);
  let latestTurnId = "";
  let result = null;
  try {
    result = await runSourceEditorHelperTurn(terminalService, context, {
      executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile),
      outputSchema,
      prompt,
      promptLabel,
      threadId,
      timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
    }, sourceEditorAgentOperationOptions(context, {
      async onEvent(event = {}) {
        const eventExecutionProfile = sourceEditorExecutionProfileSnapshot(event.executionProfile);
        if (eventExecutionProfile && !latestExecutionProfile) {
          latestExecutionProfile = eventExecutionProfile;
          await onExecutionProfile?.(eventExecutionProfile);
        }
        if (event.type === "thread") {
          latestThreadId = normalizeText(event.threadId) || latestThreadId;
          await onThread?.({
            replacedThreadId: normalizeText(event.replacedThreadId),
            threadId: latestThreadId
          });
          return;
        }
        if (event.type === "turn") {
          latestThreadId = normalizeText(event.threadId) || latestThreadId;
          latestTurnId = normalizeText(event.turnId) || latestTurnId;
          await onTurn?.({
            status: normalizeText(event.status),
            threadId: latestThreadId,
            turnId: latestTurnId
          });
          return;
        }
        const classification = isPlainObject(event.classification) ? event.classification : {};
        if (!["final_assistant_result", "live_progress"].includes(classification.kind) || !classification.text) {
          return;
        }
        latestText = String(classification.text || "");
        if (classification.kind === 'live_progress') {
          await onText?.({ kind: 'live_progress', text: latestText, threadId: latestThreadId, turnId: latestTurnId });
        }
      }
    }));
    latestThreadId = normalizeText(result?.threadId) || latestThreadId;
    latestTurnId = normalizeText(result?.turnId) || latestTurnId;
    if (result?.ok === false) {
      const failure = threadId ? sourceEditorFollowupThreadError(result) : result;
      throw sourceEditorError(
        failure.error || failure.message || "The agent could not answer this source explanation chat.",
        failure.code || "vibe64_source_explanation_agent_failed",
        failure,
        failure.statusCode || 502
      );
    }
    const executionProfile = requiredSourceEditorExecutionProfile(result?.executionProfile);
    if (!latestExecutionProfile) {
      latestExecutionProfile = executionProfile;
      await onExecutionProfile?.(executionProfile);
    }
    const text = sourceEditorStructuredAnswer(result?.text || latestText, {
      maxChars: answerMaxChars
    });
    await onText?.({
      kind: "final_assistant_result",
      text,
      threadId: latestThreadId,
      turnId: latestTurnId
    });
    return {
      executionProfile,
      replacedThreadId: normalizeText(result.replacedThreadId),
      text,
      threadId: latestThreadId,
      turnId: latestTurnId
    };
  } catch (error) {
    const failureProfile = sourceEditorExecutionProfileFromFailure(error) ||
      sourceEditorExecutionProfileSnapshot(result?.executionProfile) ||
      latestExecutionProfile;
    if (failureProfile && !latestExecutionProfile) {
      latestExecutionProfile = failureProfile;
      await onExecutionProfile?.(failureProfile);
    }
    const failure = sourceEditorFailureWithRejectedThread(
      threadId ? sourceEditorFollowupThreadError(error) : error,
      latestThreadId
        ? {
            executionProfile: latestExecutionProfile,
            threadId: latestThreadId,
            turnId: latestTurnId
          }
        : null
    );
    throw failure;
  }
}

function sourceEditorAgentStreamHandlers({
  assistantMessageId = "",
  currentExplanation = () => ({}),
  emitEvent = () => {},
  remember = async () => {},
  setExplanation = () => {}
} = {}) {
  const updateExplanation = async (patch = {}) => {
    const next = {
      ...currentExplanation(),
      ...patch
    };
    setExplanation(next);
    await remember(patch);
    return next;
  };

  return {
    async onExecutionProfile(executionProfile) {
      await updateExplanation({
        executionProfile,
        model: executionProfile.model
      });
      emitEvent("source-explanation.execution-profile", {
        executionProfile
      });
    },
    async onThread({ threadId }) {
      await updateExplanation({
        agentThreadId: threadId
      });
      emitEvent("source-explanation.thread", {
        threadId
      });
    },
    async onTurn({ threadId, turnId }) {
      await updateExplanation({
        agentThreadId: threadId,
        agentTurnId: turnId
      });
      emitEvent("source-explanation.turn", {
        threadId,
        turnId
      });
    },
    async onText({ text }) {
      const next = sourceEditorExplanationWithMessage(currentExplanation(), assistantMessageId, {
        status: "thinking",
        text
      });
      setExplanation(next);
      await remember({
        messages: next.messages
      });
      emitEvent("source-explanation.message", {
        messageId: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text
      });
    }
  };
}

/**
 * @param {object} [context]
 * @param {object} [initialExplanation]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 */
function createSourceEditorExplanationStreamState(context = {}, initialExplanation = {}, {
  assistantMessageId = "",
  emit = null,
  explanationChats,
  isClosed = null
} = {}) {
  let explanation = initialExplanation;
  let writeQueue = Promise.resolve(explanation);
  const currentExplanation = () => explanation;
  const setExplanation = (value) => {
    explanation = value;
  };
  const remember = (patch = {}) => {
    const stored = explanationChats.get(sourceEditorExplanationMemoryKey(context, explanation.id));
    if (["stopping", "stopped"].includes(stored?.status) && patch.status !== "failed") {
      explanation = stored;
      return Promise.resolve(explanation);
    }
    explanation = normalizeSourceEditorExplanation({
      ...explanation,
      ...patch,
      updatedAt: new Date().toISOString()
    });
    explanationChats.set(
      sourceEditorExplanationMemoryKey(context, explanation.id),
      explanation
    );
    const write = async () => {
      const stopped = await readStoppedSourceEditorExplanation(context, explanation.id, {
        explanationChats
      });
      if (stopped && patch.status !== "failed") {
        explanation = stopped;
        return explanation;
      }
      explanation = await writeSourceEditorExplanation(context, {
        ...explanation,
        ...patch
      }, {
        explanationChats
      });
      return explanation;
    };
    writeQueue = writeQueue.then(write, write);
    return writeQueue;
  };
  const emitEvent = (type, payload = {}) => {
    emitSourceEditorExplanationEvent(emit, isClosed, type, {
      explanation,
      ...payload
    });
  };
  const finish = async (body = "", patch = {}) => {
    explanation = sourceEditorExplanationWithMessage(explanation, assistantMessageId, {
      status: "complete",
      text: body
    });
    explanation = await remember({
      body,
      error: "",
      messages: explanation.messages,
      status: "ready",
      ...patch
    });
    explanation = await withSourceEditorExplanationFreshness(context, explanation);
    emitEvent("source-explanation.finished", {
      explanation
    });
    return explanation;
  };

  return {
    currentExplanation,
    emitEvent,
    finish,
    remember,
    // readable-check: allow setter-seam - not a slot: setExplanation replaces the stream's current explanation
    setExplanation,
    streamHandlers: sourceEditorAgentStreamHandlers({
      assistantMessageId,
      currentExplanation,
      emitEvent,
      remember,
      // readable-check: allow setter-seam - not a slot: setExplanation replaces the stream's current explanation
      setExplanation
    })
  };
}

/**
 * @param {object} [context]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 * @param {TerminalsService} options.terminalService
 */
async function runTrackedSourceEditorAgentTurn(context = {}, {
  assistantMessageId = "",
  currentExplanation = () => ({}),
  emitEvent = () => {},
  explanationChats,
  fallbackError = "Source explanation failed.",
  remember = async () => ({}),
  run = async () => ({}),
  terminalService
} = {}) {
  const finishStoppedExplanation = async (executionProfile = null) => {
    let stopped = await readStoppedSourceEditorExplanation(context, currentExplanation().id, {
      explanationChats
    });
    if (!stopped) {
      return null;
    }
    const profile = sourceEditorExecutionProfileSnapshot(executionProfile) || stopped.executionProfile;
    const message = stopped.messages.findLast((entry) => entry.role === "assistant");
    if (message) stopped = sourceEditorExplanationWithMessage(stopped, message.id, {
      status: "stopped", text: message.text || "Stopped."
    });
    stopped = await writeSourceEditorExplanation(context, { ...stopped,
      ...(profile ? { executionProfile: profile, model: profile.model } : {}),
      agentThreadId: context.assistantHelper?.conversationId || stopped.agentThreadId,
      agentTurnId: context.assistantHelper?.runId || stopped.agentTurnId,
      error: "", status: "stopped"
    }, { explanationChats });
    const explanation = await withSourceEditorExplanationFreshness(context, stopped);
    emitEvent("source-explanation.finished", {
      explanation
    });
    return explanation;
  };

  try {
    const result = await run();
    const stoppedExplanation = await finishStoppedExplanation(result.executionProfile);
    return stoppedExplanation
      ? { explanation: stoppedExplanation, stopped: true }
      : { result, stopped: false };
  } catch (error) {
    const executionProfile = sourceEditorExecutionProfileFromFailure(error) ||
      sourceEditorExecutionProfileSnapshot(currentExplanation().executionProfile);
    const stoppedExplanation = context.signal?.aborted && error?.name !== "AbortError"
      ? null : await finishStoppedExplanation(executionProfile);
    if (stoppedExplanation) {
      return {
        explanation: stoppedExplanation,
        stopped: true
      };
    }
    const rejectedThread = isPlainObject(error?.sourceEditorRejectedThread)
      ? error.sourceEditorRejectedThread
      : null;
    const rejectedThreadId = normalizeText(rejectedThread?.threadId);
    const cleanup = rejectedThreadId
      ? await cleanupRejectedSourceEditorExplanationThread(
          context,
          rejectedThreadId,
          terminalService,
          rejectedThread.executionProfile
        )
      : null;
    const cleanupSucceeded = cleanup?.ok === true;
    const failure = sourceEditorErrorResponse(error);
    const message = normalizeText(failure.error) || fallbackError;
    const failedExplanation = sourceEditorExplanationWithMessage(
      currentExplanation(),
      assistantMessageId,
      {
        status: "failed",
        text: message
      }
    );
    await remember({
      ...(rejectedThreadId
        ? {
            agentThreadId: cleanupSucceeded ? "" : rejectedThreadId,
            agentTurnId: cleanupSucceeded ? "" : normalizeText(rejectedThread?.turnId)
          }
        : {}),
      error: message,
      ...(executionProfile
        ? {
            executionProfile,
            model: executionProfile.model
          }
        : {}),
      messages: failedExplanation.messages,
      status: "failed"
    });
    if (cleanupSucceeded) {
      await removeSourceEditorExplanationCleanupRecord(
        context,
        currentExplanation().id
      );
    }
    emitEvent("source-explanation.failed", {
      code: failure.code,
      error: message,
      statusCode: failure.statusCode
    });
    throw error;
  }
}

/**
 * @param {object} [context]
 * @param {string} [explanationId]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 */
async function readSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats
} = {}) {
  return withSourceEditorExplanationFreshness(
    context,
    await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    })
  );
}

export {
  cleanupRejectedSourceEditorExplanationThread,
  createSourceEditorExplanationStreamState,
  emitSourceEditorExplanationEvent,
  readSourceEditorExplanation,
  runTrackedSourceEditorAgentTurn,
  SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS,
  SOURCE_EDITOR_EXPLANATION_OUTPUT_SCHEMA,
  sourceEditorAgentStreamHandlers,
  sourceEditorClientExplanationId,
  sourceEditorClientMessageId,
  sourceEditorExplanationMessage,
  sourceEditorExplanationMessagesForAppend,
  sourceEditorExplanationWithMessage,
  sourceEditorFailureWithRejectedThread,
  sourceEditorFollowupThreadError,
  sourceEditorStructuredAnswer,
  streamSourceEditorAgentTurn,
  withSourceEditorExplanationFreshness
};
