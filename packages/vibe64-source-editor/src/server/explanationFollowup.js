import { normalizeText } from "@local/vibe64-core/server/core";

import { SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE, sourceEditorExecutionProfileSnapshot } from "./explanationProfile.js";
import { writeSourceEditorExplanation } from "./explanationRecords.js";
import {
  createSourceEditorExplanationStreamState,
  readSourceEditorExplanation,
  runTrackedSourceEditorAgentTurn,
  sourceEditorClientMessageId,
  sourceEditorExplanationMessage,
  sourceEditorExplanationMessagesForAppend,
  streamSourceEditorAgentTurn
} from "./explanationStream.js";
import {
  SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS,
  sourceEditorExplanationFollowupMessage,
  sourceEditorExplanationFollowupPrompt,
  sourceEditorExplanationMessageId,
  sourceEditorExplanationSummary
} from "./explanationText.js";
import { sourceEditorError } from "./sourceFiles.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./explanationRecords.js").SourceEditorExplanationChats} SourceEditorExplanationChats */

// A follow-up question on a source explanation, answered in the helper
// thread that explained it.
const SOURCE_EDITOR_FOLLOWUP_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    answer: {
      maxLength: SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS,
      minLength: 1,
      type: "string"
    }
  },
  required: ["answer"],
  type: "object"
});

function sourceEditorHelperFollowupThread(explanation = {}) {
  const agentThreadId = normalizeText(explanation.agentThreadId);
  const executionProfile = sourceEditorExecutionProfileSnapshot(explanation.executionProfile);
  if (
    !executionProfile ||
    executionProfile.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    executionProfile.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId
  ) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. Only a verified low-cost source-explanation conversation can be continued.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      409
    );
  }
  if (normalizeText(explanation.status) === "failed") {
    throw sourceEditorError(
      "Regenerate this explanation before asking another follow-up. Its previous assistant turn failed, so Vibe64 will not reuse that conversation.",
      "vibe64_source_explanation_agent_thread_failed",
      {},
      409
    );
  }
  if (!agentThreadId && normalizeText(explanation.engine) === "agent-cache") {
    return "";
  }
  if (!agentThreadId) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. It was created before source explanation chat was available.",
      "vibe64_source_explanation_agent_thread_missing",
      {},
      409
    );
  }
  return agentThreadId;
}

/**
 * @param {object} [context]
 * @param {object} [input]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 * @param {TerminalsService} options.terminalService
 */
async function streamSourceEditorExplanationFollowup(context = {}, input = {}, options = {}) {
  const {
    emit = null,
    explanationChats,
    explanationTurns,
    isClosed = null,
    terminalService
  } = options;
  const message = sourceEditorExplanationFollowupMessage(input.message);
  const baseExplanation = await readSourceEditorExplanation(context, input.explanationId, {
    explanationChats
  });
  const agentThreadId = sourceEditorHelperFollowupThread(baseExplanation);
  const createdAt = new Date().toISOString();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const explanation = {
    ...baseExplanation,
    agentSettings: null,
    agentTurnId: "",
    messages: [
      ...sourceEditorExplanationMessagesForAppend(baseExplanation),
      sourceEditorExplanationMessage("user", message, createdAt, {
        id: userMessageId
      }),
      sourceEditorExplanationMessage("assistant", "", createdAt, {
        id: assistantMessageId,
        status: "thinking"
      })
    ],
    error: "",
    ownerOriginId: baseExplanation.ownerOriginId || input.originId,
    status: "running"
  };

  const stream = createSourceEditorExplanationStreamState(context, explanation, {
    assistantMessageId,
    emit,
    explanationChats,
    explanationTurns,
    isClosed
  });

  stream.setExplanation(await writeSourceEditorExplanation(context, explanation, {
    explanationChats
  }));
  stream.emitEvent("source-explanation.followup.started", {
    assistantMessageId,
    userMessageId
  });

  const trackedTurn = await runTrackedSourceEditorAgentTurn(context, {
    assistantMessageId,
    currentExplanation: stream.currentExplanation,
    emitEvent: stream.emitEvent,
    explanationChats,
    fallbackError: "Source explanation follow-up failed.",
    remember: stream.remember,
    terminalService,
    run: () => streamSourceEditorAgentTurn(context, {
      answerMaxChars: SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS,
      outputSchema: SOURCE_EDITOR_FOLLOWUP_OUTPUT_SCHEMA,
      prompt: sourceEditorExplanationFollowupPrompt(baseExplanation, message),
      promptLabel: "Source code explanation follow-up",
      terminalService,
      threadId: agentThreadId,
      ...stream.streamHandlers
    })
  });
  if (trackedTurn.stopped) {
    return trackedTurn.explanation;
  }
  const result = trackedTurn.result;

  const nextFollowups = [
    ...baseExplanation.followups,
    {
      createdAt,
      id: userMessageId,
      role: "user",
      text: message
    },
    {
      createdAt: new Date().toISOString(),
      id: assistantMessageId,
      role: "assistant",
      text: result.text
    }
  ];
  return await stream.finish(result.text, {
    agentThreadId: result.threadId || stream.currentExplanation().agentThreadId,
    agentTurnId: result.turnId || stream.currentExplanation().agentTurnId,
    executionProfile: result.executionProfile,
    followups: nextFollowups,
    model: result.executionProfile.model,
    summary: sourceEditorExplanationSummary(result.text)
  });
}

export {
  SOURCE_EDITOR_FOLLOWUP_OUTPUT_SCHEMA,
  sourceEditorHelperFollowupThread,
  streamSourceEditorExplanationFollowup
};
