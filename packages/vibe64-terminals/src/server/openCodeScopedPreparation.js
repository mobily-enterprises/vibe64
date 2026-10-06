import { randomUUID } from "node:crypto";
import { openCodeDetachedPrompt } from "@jskit-ai/assistant-core/server/opencode-turn";
import { openCodeModel } from "@jskit-ai/assistant-core/server/opencode-process";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { checkpointSessionTurn } from "./sessionTurnCheckpoint.js";
import { conversationMessageId, upstreamMessageId } from "./openCodeConversationStorage.js";
import { openCodeMessageError } from "./openCodeConversationEvents.js";
import { OPENCODE_HELPER_AGENT_ID, OPENCODE_EPHEMERAL_AGENT_ID } from "./opencodeServerProcess.js";
import { openCodeError, openCodeRuntimeFailure as runtimeFailure } from "./terminalShared.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function openCodeExecutionProfile(input = {}) {
  if (!input?.executionProfile) {
    return null;
  }
  const profile = vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile);
  if (profile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER) {
    throw openCodeError(
      "vibe64_opencode_execution_profile_unsupported",
      `OpenCode does not support execution profile ${profile.profileId}.`
    );
  }
  return profile;
}

function openCodeAgent(selection = {}, executionProfile = null, assistantScope = null) {
  if (executionProfile) return OPENCODE_HELPER_AGENT_ID;
  return assistantScope ? OPENCODE_EPHEMERAL_AGENT_ID : text(selection.agentId);
}

function boundedOpenCodeExecutionInput(prompt = "", executionProfile = null) {
  if (!executionProfile) {
    return;
  }
  if (prompt.length > executionProfile.limits.maxInputCharacters) {
    throw openCodeError(
      "vibe64_opencode_execution_input_too_large",
      "The bounded OpenCode helper input exceeded its execution-profile limit.",
      { maximum: executionProfile.limits.maxInputCharacters },
      413
    );
  }
}

function boundedOpenCodeExecutionOutput(result = {}, executionProfile = null) {
  if (
    executionProfile &&
    String(result.text || "").length > executionProfile.limits.maxOutputCharacters
  ) {
    throw openCodeError(
      "vibe64_opencode_execution_output_too_large",
      "The bounded OpenCode helper output exceeded its execution-profile limit.",
      { maximum: executionProfile.limits.maxOutputCharacters },
      502
    );
  }
  return result;
}

function openCodeExecutionTimeout(input = {}, executionProfile = null) {
  const requested = Number(input.timeoutMs);
  const requestedTimeout = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  if (!executionProfile) {
    return requestedTimeout;
  }
  return requestedTimeout
    ? Math.min(requestedTimeout, executionProfile.limits.timeoutMs)
    : executionProfile.limits.timeoutMs;
}

export function createOpenCodeScopedPreparation({
  projectService, contextFor, hostPreparation, events, publishSessionChanged, prepareSessionCleanup
}) {
  const { prepareProcess, sharedRoots, promptContext, writeSessionEnvironmentRegistry } = hostPreparation;
  const { observationProjection } = events;

  async function prepareConversationCreation(sessionId = "", input = {}, options = {}) {
    const context = await contextFor(sessionId, options);
    const executionProfile = openCodeExecutionProfile(input);
    return {
      key: context.key, executionProfile, process: await prepareProcess(context, options),
      get workdir() { return executionProfile ? sharedRoots().workdir : ""; },
      get ephemeral() { return input.ephemeral === true; },
      selection() {
        // The shared process keeps main chat's configuration; only this chat changes model.
        context.selection = options.assistantSelection || context.selection;
        return {
          get agent() { return openCodeAgent(context.selection, executionProfile, context.assistantScope); },
          get model() { return openCodeModel(context.selection, executionProfile); }
        };
      }
    };
  }

  async function prepareDetachedTarget(sessionId = "", input = {}, options = {}, {
    createIfMissing = true
  } = {}) {
    const context = await contextFor(sessionId, options);
    const executionProfile = openCodeExecutionProfile(input);
    return {
      context, key: context.key, executionProfile, process: await prepareProcess(context, options),
      get workdir() { return executionProfile ? sharedRoots().workdir : ""; },
      selection() {
        context.selection = options.assistantSelection || context.selection;
        const agent = openCodeAgent(context.selection, executionProfile, context.assistantScope);
        return {
          conversationId: text(input.conversationId || input.threadId), scoped: Boolean(context.assistantScope), createIfMissing,
          profileChanged: () => openCodeError("vibe64_opencode_execution_profile_changed", "The scoped helper profile changed. Start a new helper.", {}, 409),
          identityRequired: () => openCodeError("vibe64_opencode_conversation_id_required", "OpenCode conversation id is required.", {}, 400),
          input: { agent, get model() { return openCodeModel(context.selection, executionProfile); } },
          registration: {
            executionProfile,
            get promptContext() { return executionProfile ? null : promptContext("temporary", context.assistantScope); },
            onSelected: writeSessionEnvironmentRegistry
          }
        };
      }
    };
  }

  async function prepareExistingDetachedTarget(sessionId = "", input = {}, options = {}) {
    const context = await contextFor(sessionId, options);
    const conversationId = text(input.conversationId || input.threadId);
    if (!conversationId) {
      throw openCodeError(
        "vibe64_opencode_conversation_id_required",
        "OpenCode conversation id is required.",
        {},
        400
      );
    }
    return {
      key: context.key, conversationId, persistent: input.persistent,
      process: () => prepareProcess(context, options),
      readUnavailable: openCodeReadUnavailable,
      readError: openCodeMessageError, projectResult: boundedOpenCodeExecutionOutput,
      messages: {
        readError: openCodeMessageError, messageId: conversationMessageId,
        get inputMessageId() { return input.messageId ? upstreamMessageId(input.messageId) : ""; }
      },
      failure: runtimeFailure, onRemoved: writeSessionEnvironmentRegistry,
      get scoped() { return context.assistantScope; },
      get cleanupAfterDelete() { return context.assistantScope ? prepareSessionCleanup(context.sessionId, context) : null; }
    };
  }

  function openCodeReadUnavailable() {
    return openCodeError(
      "vibe64_opencode_process_not_running",
      "The OpenCode conversation is not connected. Reading it must not start AI infrastructure.",
      {},
      409
    );
  }

  async function prepareDetachedChatTurn(sessionId = "", input = {}, options = {}, {
    waitForCompletion = true
  } = {}) {
    const prompt = openCodeDetachedPrompt(input);
    if (!prompt) {
      throw openCodeError("vibe64_opencode_prompt_empty", "OpenCode prompt input is empty.", {}, 400);
    }
    boundedOpenCodeExecutionInput(prompt, openCodeExecutionProfile(input));
    const prepared = await prepareDetachedTarget(sessionId, input, options);
    const { context, executionProfile } = prepared;
    prepared.failure = runtimeFailure;
    prepared.turn = ({ conversationId, tracked }) => {
      return {
        input: {
          get steer() { return input.steer; },
          get id() { return upstreamMessageId(input.messageId || input.operationId || randomUUID()); },
          get steeringId() { return upstreamMessageId(input.messageId || randomUUID()); },
          get agent() { return openCodeAgent(context.selection, executionProfile, context.assistantScope); },
          get model() { return openCodeModel(context.selection, executionProfile); },
          get prompt() { return { text: prompt }; },
          get attachments() { return input.attachments; },
          get outputSchema() { return input.outputSchema; }
        },
        options: {
          waitForCompletion,
          get signal() { return options.signal; },
          observation: () => observationProjection(context, options.onEvent, false),
          get readiness() { return { timeoutError: openCodeError(
            "vibe64_opencode_events_timeout", "OpenCode's event connection did not become ready.", {}, 504
          ) }; },
          async beforeDispatch() {
            await options.onEvent?.({ threadId: conversationId, type: "thread" });
            await input.onPromptSending?.({ threadId: conversationId });
          },
          get completion() {
            return {
              readError: openCodeMessageError,
              timeoutMs: openCodeExecutionTimeout(input, executionProfile),
              ...(input.persistent && options.routingConversationId ? {
                messageId: conversationMessageId,
                async onMessages(messages, admittedInputId) {
                  for (const message of messages) {
                    await options.onEvent?.({ type: "message", message, threadId: conversationId, turnId: admittedInputId });
                  }
                }
              } : {}),
              projectResult(result) {
                const conversation = boundedOpenCodeExecutionOutput(result, executionProfile);
                return {
                  ...conversation,
                  runId: tracked.inputMessageId,
                  threadId: conversationId,
                  turnId: tracked.inputMessageId
                };
              },
              async afterClose({ stopped, outcome }) {
                if (stopped && !executionProfile && !context.assistantScope) {
                  await checkpointSessionTurn({
                    projectService, runtime: context.runtime, session: context.session, sessionId,
                    outerTurnId: `opencode:${conversationId}:${tracked.inputMessageId}`,
                    outcome, publishSessionChanged
                  });
                }
              }
            };
          },
          onCompletion(completion) {
            if (input.persistent) {
              void completion.then((result) => publishSessionChanged(sessionId, {
                reason: "temporary-agent-turn-idle", payload: { conversationId,
                  temporaryRun: { active: false, state: result.status || "completed", providerTurnId: tracked.inputMessageId } }
              }), () => publishSessionChanged(sessionId, {
                reason: "temporary-agent-turn-idle", payload: { conversationId,
                  temporaryRun: { active: false, state: tracked.interrupted ? "interrupted" : "failed", providerTurnId: tracked.inputMessageId } }
              })).catch(() => {});
            }
          }
        }
      };
    };
    return prepared;
  }

  return { prepareConversationCreation, prepareDetachedChatTurn, prepareExistingDetachedTarget };
}
