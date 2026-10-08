import { openCodeMessageError as readOpenCodeMessageError } from "@jskit-ai/assistant-core/server/opencode-turn";
import { openCodeModel, openCodeConversationAgent } from "@jskit-ai/assistant-core/server/opencode-process";
import { VIBE64_AGENT_RUN_STATE, vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { checkpointSessionTurn } from "./sessionTurnCheckpoint.js";
import { openCodeError } from "./terminalShared.js";
import { openCodeFingerprint as fingerprint } from "./opencodeServerProcess.js";
import { conversationMessageId, upstreamMessageId, OPENCODE_AGENT_RUN_ID } from "./openCodeConversationPresentation.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function openCodeMessageError(message = {}) {
  const failure = readOpenCodeMessageError(message);
  const hook = /GENESIS_HOOK_FAILURE (\{[^\n]*\})/u.exec(failure);
  if (hook) {
    try {
      const diagnostic = JSON.parse(hook[1]);
      const scope = ["session", "turn"].includes(diagnostic.scope) ? diagnostic.scope : "context";
      const seconds = Number.isFinite(diagnostic.elapsedMs) ? (diagnostic.elapsedMs / 1000).toFixed(1) : "unknown";
      let reason = "failed";
      if (diagnostic.outcome === "timeout") reason = "timed out";
      else if (diagnostic.outcome === "unavailable") reason = "could not start because the Genesis executable was unavailable";
      const detail = [
        diagnostic.code != null ? `exit/code ${String(diagnostic.code).slice(0, 60)}` : "",
        diagnostic.signal ? `signal ${String(diagnostic.signal).slice(0, 30)}` : ""
      ].filter(Boolean).join(", ");
      return [
        `Project guidance could not load: the Genesis ${scope} hook ${reason} after ${seconds}s${detail ? ` (${detail})` : ""}.`,
        text(diagnostic.stderr).slice(0, 1500) || "The command returned no diagnostic output.",
        "The assistant stopped before it could continue. Check the project's Genesis hook and installed runtime, then send your message again."
      ].join("\n\n");
    } catch {
      // Preserve the ordinary provider failure when no valid hook diagnostic exists.
    }
  }
  if (/Command failed: genesis hook (?:turn|session)\b/u.test(failure)) {
    return "Project guidance could not load: the Genesis hook command failed. This hook version did not report an exit code, termination signal or stderr, so a timeout is unconfirmed. Update the project's Genesis guidance adapter and check the installed runtime, then send your message again.";
  }
  return failure;
}

function openCodeCredentialFailureNoticeMessage() {
  return "OpenCode needs attention: the selected provider rejected its API key, which may have expired or been revoked. [Open AI Accounts](/app/manage/accounts) to replace and verify the key, then return here and send your message again. Saved project changes remain.";
}

function openCodeProviderApiFailureNoticeMessage(failure = "") {
  return `OpenCode could not finish: ${text(failure)} Saved project changes remain. [Manage AI accounts](/app/manage/accounts)`;
}

function openCodeFailureNoticeMessage(failure = "") {
  const detail = text(failure);
  return detail
    ? `OpenCode could not finish.\n\n${detail}\n\nSaved project changes remain.`
    : "OpenCode could not finish. Saved project changes remain.";
}

function openCodeRunRealtimePayload(run = {}) {
  const state = text(run.state);
  const active = run.active === true || vibe64AgentRunStateIsActive(state);
  const turnState = state === VIBE64_AGENT_RUN_STATE.STARTING
    ? "starting"
    : state === VIBE64_AGENT_RUN_STATE.FINALIZING
      ? "finalizing"
      : active
        ? "active"
        : "idle";
  const threadId = text(run.threadId);
  const turnId = text(run.turnId);
  const updatedAt = text(run.updatedAt);
  return {
    agentRun: {
      active,
      id: OPENCODE_AGENT_RUN_ID,
      provider: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      providerInterface: OPENCODE_AGENT_RUN_ID,
      providerStatus: run.observationError ? "observation_lost" : state,
      providerThreadId: threadId,
      providerTurnId: turnId,
      state,
      updatedAt
    },
    agentSession: {
      providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      thread: {
        id: threadId
      },
      transportId: OPENCODE_AGENT_RUN_ID,
      turn: {
        active,
        completedAt: text(run.finishedAt),
        error: text(run.error),
        id: turnId,
        phase: active && !run.observationError ? text(run.phase) : "",
        runState: state,
        startedAt: text(run.startedAt),
        state: turnState,
        status: run.observationError ? "observation_lost" : state,
        updatedAt
      }
    }
  };
}

function createOpenCodeConversationEvents({ projectService, publishSessionChanged, sharedRuntime, presentation }) {
  const { turns, temporaryConversations } = sharedRuntime;
  const { disposeReasoningSummary, publishOpenCodeProgress, dropOpenCodeProgress,
    projectReasoning, publishConversationTurn } = presentation;

  async function writeConversationProjection(context = {}, messages = null, options = {}) {
    return sharedRuntime.writeConversationProjection(context.sessionId, messages, options, {
      store: context.runtime.store,
      messageId: conversationMessageId,
      ...(context.runtime.learningScope && context.runtime.learningTeaching
        ? { outputId: conversationMessageId } : {}),
      readError: openCodeMessageError,
      reasoning: (parts, input) => projectReasoning(context, parts, input),
      publishTurn: (turn) => publishConversationTurn(context, turn, "opencode-server-assistant-message"),
      publishStream: (conversationStream) => publishSessionChanged(context.sessionId, {
        payload: { conversationStream },
        reason: "assistant-stream"
      })
    });
  }

  async function writeOpenCodeFailureNotice(context = {}, turn = {}, {
    message = "",
    reason = "opencode-provider-failure"
  } = {}) {
    if (typeof context.runtime.store?.writeConversationSystemMessage !== "function") {
      return null;
    }
    const written = await context.runtime.store.writeConversationSystemMessage(context.sessionId, {
      messageId: `${reason}-${fingerprint(
        context.sessionId,
        turn.threadId,
        turn.id,
        turn.startedAt
      )}`,
      text: message
    });
    await publishConversationTurn(context, written, reason);
    return written;
  }

  async function writeRun(context = {}, turn = {}, state = VIBE64_AGENT_RUN_STATE.ACTIVE, error = "") {
    if (typeof context.runtime.store?.writeAgentRunEvent !== "function") {
      return null;
    }
    if (!vibe64AgentRunStateIsActive(state) && turn.id && !context.assistantScope) {
      await checkpointSessionTurn({
        projectService, runtime: context.runtime, session: context.session, sessionId: context.sessionId,
        outerTurnId: `opencode:${turn.threadId}:${turn.id}`,
        outcome: ["completed", "interrupted", "cancelled"].includes(state) ? state : "failed",
        timestamp: turn.updatedAt || new Date().toISOString(), publishSessionChanged,
        ...(context.runtime.learningScope && context.runtime.learningTeaching && turns.get(context.key) === turn
          ? { nativeTurn: { threadId: turn.threadId, turnId: turn.id, active: turn.active,
            outerTurnId: `opencode:${turn.threadId}:${turn.id}` } } : {})
      });
    }
    let written = null;
    const write = () => context.runtime.store.writeAgentRunEvent(
      context.sessionId,
      OPENCODE_AGENT_RUN_ID,
      {
        event: {
          kind: `opencode-${state}`,
          message: error,
          state
        },
        patch: {
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          ...(Object.hasOwn(turn, "submittedBy") ? { submittedBy: turn.submittedBy } : {}),
          error,
          observationError: text(turn.observationError),
          phase: vibe64AgentRunStateIsActive(state) && !turn.observationError ? text(turn.phase) : "",
          model: context.selection.modelId,
          modelProviderId: context.selection.modelProviderId,
          ...(vibe64AgentRunStateIsActive(state)
            ? { finishedAt: "", startedAt: text(turn.startedAt) }
            : { finishedAt: text(turn.updatedAt) }),
          state,
          threadId: text(turn.threadId),
          turnId: text(turn.id),
          updatedAt: text(turn.updatedAt)
        }
      }
    ).then((run) => {
      written = run;
      return run;
    });
    const updatedSession = (
      typeof context.runtime.store.mutateSession === "function" &&
      typeof context.runtime.getSession === "function"
    )
      ? await context.runtime.store.mutateSession(context.sessionId, async () => {
          await write();
          return context.runtime.getSession(context.sessionId, { inspectSource: false });
        })
      : (await write(), context.session);
    await publishSessionChanged(context.sessionId, {
      payload: {
        ...(!vibe64AgentRunStateIsActive(state)
          ? { conversationStream: context.runtime.store.clearConversationStream(context.sessionId) }
          : {}),
        ...openCodeRunRealtimePayload(written || {
          active: vibe64AgentRunStateIsActive(state),
          error,
          id: OPENCODE_AGENT_RUN_ID,
          state,
          threadId: text(turn.threadId),
          turnId: text(turn.id),
          updatedAt: new Date().toISOString()
        })
      },
      reason: vibe64AgentRunStateIsActive(state)
        ? "opencode-server-turn-active"
        : "opencode-server-turn-idle",
      session: updatedSession
    });
    return written;
  }

  function observationProjection(context = {}, onEvent = null, publish = true) {
    return {
      readError: openCodeMessageError,
      async onEvent(summary, target) {
        if (typeof onEvent === "function") {
          await onEvent({
            ...summary,
            threadId: target.upstreamSessionId,
            turnId: turns.get(context.key)?.id || ""
          });
        }
        if (publish) publishOpenCodeProgress(context.sessionId, summary);
      },
      failure(error) {
        if (error?.code === "assistant_opencode_observation_lost") error.code = "vibe64_opencode_observation_lost";
      },
      closed() { dropOpenCodeProgress(context.sessionId); }
    };
  }

  function messageMonitorProjection(context, applicationTools) {
    return {
      prepare(admitted, options) {
        const previous = context.session?.agentRuns?.find((run) => run.id === OPENCODE_AGENT_RUN_ID && run.turnId === admitted.id);
        const route = JSON.parse(context.session?.metadata?.assistant_routing_request || "null");
        const routed = route && [route.messageId, route.reviewMessageId].filter(Boolean).some((id) => upstreamMessageId(id) === admitted.id);
        const actorKnown = !admitted.restored || Object.hasOwn(previous || {}, "submittedBy") || routed;
        const actor = Object.hasOwn(previous || {}, "submittedBy") ? previous.submittedBy : routed ? route.submittedBy : options.vibe64User;
        const submittedBy = actor ? Object.fromEntries(["id", "username", "role"].filter((key) => actor[key] !== undefined)
          .map((key) => [key, actor[key]])) : null;
        return { actorKnown, submittedBy, fields: actorKnown ? { submittedBy } : {} };
      },
      create(target, turn, { actorKnown, submittedBy }, options) {
        const reasoning = {
          abortController: new AbortController(),
          actorKnown,
          closed: false,
          completion: Promise.resolve(),
          context: { ...context, vibe64User: submittedBy },
          entries: new Map(),
          key: `${context.key}\0reasoning:${turn.id}`,
          reasoningSummary: true,
          target
        };
        turn.reasoning = reasoning;
        temporaryConversations.set(reasoning.key, reasoning);
        return {
          observation: () => observationProjection(context, options.onEvent),
          eventReady: options.eventReady,
          readiness: options.eventReady ? { timeoutError: openCodeError(
            "vibe64_opencode_events_timeout", "OpenCode's event connection did not become ready. Try sending again.", {}, 504
          ) } : undefined,
          finalResponse: {
            get agent() { return context.runtime.learningScope && context.runtime.learningTeaching && applicationTools
              ? openCodeConversationAgent({ tools: true }) : context.selection.agentId; },
            get model() { return openCodeModel(context.selection); },
            get recoveryMessageId() { return upstreamMessageId(`${turn.id}:final-response`); },
            readError: openCodeMessageError
          },
          writeRun: (turn, state, error) => writeRun(context, turn, state, error),
          projectMessages: (messages, input) => writeConversationProjection(context, messages, input),
          async completeResult(turn, { credentialFailure, providerApiFailure, finalState, failure }) {
            if (credentialFailure) {
              failure = openCodeCredentialFailureNoticeMessage();
              await writeOpenCodeFailureNotice(context, turn, {
                message: failure,
                reason: "opencode-credential-failure"
              }).catch((error) => {
                vibe64SessionDebugLog("server.opencode.credential-notice.error", {
                  error: vibe64SessionDebugError(error),
                  sessionId: context.sessionId
                });
              });
            } else if (providerApiFailure && finalState === VIBE64_AGENT_RUN_STATE.FAILED) {
              await writeOpenCodeFailureNotice(context, turn, {
                message: openCodeProviderApiFailureNoticeMessage(failure)
              }).catch((error) => {
                vibe64SessionDebugLog("server.opencode.provider-notice.error", {
                  error: vibe64SessionDebugError(error),
                  sessionId: context.sessionId
                });
              });
            } else if (finalState === VIBE64_AGENT_RUN_STATE.FAILED) {
              await writeOpenCodeFailureNotice(context, turn, {
                message: openCodeFailureNoticeMessage(failure)
              }).catch((error) => {
                vibe64SessionDebugLog("server.opencode.failure-notice.error", {
                  error: vibe64SessionDebugError(error),
                  sessionId: context.sessionId
                });
              });
            }
            return failure;
          },
          onRetired() {
            void disposeReasoningSummary(reasoning).catch((error) => {
              vibe64SessionDebugLog("server.opencode.reasoning-cleanup.error", {
                error: vibe64SessionDebugError(error), sessionId: context.sessionId
              });
            });
          }
        };
      },
      onError(error) {
        vibe64SessionDebugLog("server.opencode.turn.error", {
          error: vibe64SessionDebugError(error),
          sessionId: context.sessionId
        });
      }
    };
  }

  return { writeRun, observationProjection, messageMonitorProjection };
}

export { createOpenCodeConversationEvents, openCodeMessageError };
