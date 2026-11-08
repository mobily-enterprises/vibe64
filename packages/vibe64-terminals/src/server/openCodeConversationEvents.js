import { openCodeMessageError as readOpenCodeMessageError } from "@jskit-ai/assistant-core/server/opencode-turn";
import { openCodeModel } from "@jskit-ai/assistant-core/server/opencode-process";
import { VIBE64_AGENT_RUN_STATE, vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { assistantRoutingRequestForMessage } from "./assistantRouting.js";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { captureProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { checkpointSessionTurn } from "./sessionTurnCheckpoint.js";
import { openCodeError } from "./terminalShared.js";
import { openCodeFingerprint } from "./openCodeConversationStorage.js";
import { conversationMessageId, upstreamMessageId, OPENCODE_AGENT_RUN_ID } from "./openCodeConversationPresentation.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").OpenCodeSharedRuntime} OpenCodeSharedRuntime */
/** @typedef {import("./types.js").OpenCodeConversationPresentation} OpenCodeConversationPresentation */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").TrackShutdownWork} TrackShutdownWork */

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
        toText(diagnostic.stderr).slice(0, 1500) || "The command returned no diagnostic output.",
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
  return "OpenCode needs attention: the provider isn't connected, or it rejected its API key, which may have expired or been revoked. [Go to AI Accounts](/app/manage/accounts) to connect it or to replace and verify its key, then return here and send your message again. Saved project changes remain.";
}

function openCodeProviderApiFailureNoticeMessage(failure = "") {
  return `OpenCode could not finish: ${toText(failure)} Saved project changes remain. [Go to AI Accounts](/app/manage/accounts)`;
}

function openCodeFailureNoticeMessage(failure = "") {
  const detail = toText(failure);
  return detail
    ? `OpenCode could not finish.\n\n${detail}\n\nSaved project changes remain.`
    : "OpenCode could not finish. Saved project changes remain.";
}

function openCodeRunRealtimePayload(run = {}) {
  const state = toText(run.state);
  const active = run.active === true || vibe64AgentRunStateIsActive(state);
  const turnState = state === VIBE64_AGENT_RUN_STATE.STARTING
    ? "starting"
    : state === VIBE64_AGENT_RUN_STATE.FINALIZING
      ? "finalizing"
      : active
        ? "active"
        : "idle";
  const threadId = toText(run.threadId);
  const turnId = toText(run.turnId);
  const updatedAt = toText(run.updatedAt);
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
        completedAt: toText(run.finishedAt),
        error: toText(run.error),
        id: turnId,
        phase: active && !run.observationError ? toText(run.phase) : "",
        runState: state,
        startedAt: toText(run.startedAt),
        state: turnState,
        status: run.observationError ? "observation_lost" : state,
        updatedAt
      }
    }
  };
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TrackShutdownWork} dependencies.trackShutdownWork
 * @param {OpenCodeSharedRuntime} dependencies.sharedRuntime
 * @param {OpenCodeConversationPresentation} dependencies.presentation
 */
function createOpenCodeConversationEvents({
  project,
  publishSessionChanged,
  trackShutdownWork,
  sharedRuntime,
  presentation
}) {
  const { turns, temporaryConversations } = sharedRuntime;
  const {
    disposeReasoningSummary,
    publishOpenCodeProgress,
    dropOpenCodeProgress,
    projectReasoning,
    publishConversationTurn
  } = presentation;

  async function writeConversationProjection(context = {}, messages = null, options = {}) {
    return sharedRuntime.writeConversationProjection(context.sessionId, messages, options, {
      store: context.runtime.store,
      messageId: conversationMessageId,
      readError: openCodeMessageError,
      reasoning: (parts, input) => projectReasoning(context, parts, input),
      publishTurn: (turn) => publishConversationTurn(context, turn, "opencode-server-assistant-message"),
      publishStream: (conversationStream) => publishSessionChanged(context.sessionId, {
        payload: { conversationStream },
        reason: "assistant-stream"
      })
    });
  }

  async function writeOpenCodeFailureNotice(context = {}, turn = {}, options = {}) {
    const {
      message = "",
      reason = "opencode-provider-failure"
    } = options;
    const written = await context.runtime.store.writeConversationSystemMessage(context.sessionId, {
      messageId: `${reason}-${openCodeFingerprint(
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
    if (!vibe64AgentRunStateIsActive(state) && turn.id && !context.assistantScope) {
      await checkpointSessionTurn({
        project,
        runtime: context.runtime,
        session: context.session,
        sessionId: context.sessionId,
        outerTurnId: `opencode:${turn.threadId}:${turn.id}`,
        outcome: ["completed", "interrupted", "cancelled"].includes(state) ? state : "failed",
        timestamp: turn.updatedAt || new Date().toISOString(),
        publishSessionChanged,
        trackShutdownWork
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
          observationError: toText(turn.observationError),
          // The next server records a run the shutdown stopped as interrupted.
          stoppedByShutdown: turn.stoppedByShutdown === true,
          phase: vibe64AgentRunStateIsActive(state) && !turn.observationError ? toText(turn.phase) : "",
          model: context.selection.modelId,
          modelProviderId: context.selection.modelProviderId,
          ...(vibe64AgentRunStateIsActive(state)
            ? { finishedAt: "", startedAt: toText(turn.startedAt) }
            : { finishedAt: toText(turn.updatedAt) }),
          state,
          threadId: toText(turn.threadId),
          turnId: toText(turn.id),
          updatedAt: toText(turn.updatedAt)
        }
      }
    ).then((run) => {
      written = run;
      return run;
    });
    const updatedSession = await context.runtime.store.mutateSession(context.sessionId, async () => {
      await write();
      return context.runtime.getSessionWithoutSource(context.sessionId);
    });
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
          threadId: toText(turn.threadId),
          turnId: toText(turn.id),
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

  /**
   * The observation a turn's event stream reports to: the caller's onEvent, plus Main progress when publish is set.
   * @param {object} context
   * @param {(event: object) => unknown} onEvent
   * @param {boolean} publish
   */
  function projectObservation(context, onEvent, publish) {
    return {
      readError: openCodeMessageError,
      async onEvent(summary, target) {
        await onEvent({
          ...summary,
          threadId: target.upstreamSessionId,
          turnId: turns.get(context.key)?.id || ""
        });
        if (publish) publishOpenCodeProgress(context.sessionId, summary);
      },
      failure(error) {
        if (error?.code === "assistant_opencode_observation_lost") error.code = "vibe64_opencode_observation_lost";
      },
      closed() {
        dropOpenCodeProgress(context.sessionId);
      }
    };
  }

  /**
   * The observation of a Main conversation turn, which also publishes its progress.
   * @param {object} context
   * @param {((event: object) => unknown) | null} [onEvent] null or absent when the turn's caller gave no event stream
   */
  function observationProjection(context, onEvent) {
    return projectObservation(context, onEvent ?? doNothing, true);
  }

  /**
   * The observation of a detached chat turn, which publishes no Main progress.
   * @param {object} context
   * @param {(event: object) => unknown} onEvent
   */
  function detachedObservationProjection(context, onEvent) {
    return projectObservation(context, onEvent, false);
  }

  function messageMonitorProjection(context) {
    const projectContext = captureProjectRequestContext();
    return {
      runInContext: operation => runWithProjectRequestContext(projectContext || {}, operation),
      prepare(admitted, options) {
        const previous = context.session?.agentRuns?.find((run) => run.id === OPENCODE_AGENT_RUN_ID && run.turnId === admitted.id);
        const route = assistantRoutingRequestForMessage(context.session?.metadata, (id) => upstreamMessageId(id) === admitted.id);
        const routed = Boolean(route);
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
          readiness: options.eventReady ? {
            timeoutError: openCodeError("vibe64_opencode_events_timeout", "OpenCode's event connection did not become ready. Try sending again.", {}, 504, {
              messageCode: "vibe64_opencode_events_timeout_retry"
            })
          } : undefined,
          finalResponse: {
            get agent() {
              return context.selection.agentId;
            },
            get model() {
              return openCodeModel(context.selection);
            },
            get recoveryMessageId() {
              return upstreamMessageId(`${turn.id}:final-response`);
            },
            readError: openCodeMessageError
          },
          writeRun: (runTurn, state, error) => writeRun(context, runTurn, state, error),
          projectMessages: (messages, input) => writeConversationProjection(context, messages, input),
          async completeResult(completedTurn, { credentialFailure, providerApiFailure, finalState, failure }) {
            if (credentialFailure) {
              failure = openCodeCredentialFailureNoticeMessage();
              await writeOpenCodeFailureNotice(context, completedTurn, {
                message: failure,
                reason: "opencode-credential-failure"
              }).catch((error) => {
                vibe64SessionDebugLog("server.opencode.credential-notice.error", {
                  error: vibe64SessionDebugError(error),
                  sessionId: context.sessionId
                });
              });
            } else if (providerApiFailure && finalState === VIBE64_AGENT_RUN_STATE.FAILED) {
              await writeOpenCodeFailureNotice(context, completedTurn, {
                message: openCodeProviderApiFailureNoticeMessage(failure)
              }).catch((error) => {
                vibe64SessionDebugLog("server.opencode.provider-notice.error", {
                  error: vibe64SessionDebugError(error),
                  sessionId: context.sessionId
                });
              });
            } else if (finalState === VIBE64_AGENT_RUN_STATE.FAILED) {
              await writeOpenCodeFailureNotice(context, completedTurn, {
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
                error: vibe64SessionDebugError(error),
                sessionId: context.sessionId
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

  return Object.freeze({
    writeRun,
    detachedObservationProjection,
    messageMonitorProjection
  });
}

export { createOpenCodeConversationEvents, openCodeMessageError };
