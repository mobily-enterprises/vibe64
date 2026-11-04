import { createGitTurnCheckpointAsOneJob } from "@local/vibe64-execution/server";
import { codexAppServerTurnState } from "@jskit-ai/assistant-core/server/codex-turn";
import { normalizeVibe64AgentRunState } from "@local/vibe64-runtime/server/sessionStore";
import { CODEX_TURN_OUTCOME } from "./codexTurnOutcomeNotice.js";
import { learningSessionExecutionRoot } from "./mainConversationContext.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */

// The persisted task identity keeps its Codex name; checkpoints cover every
// session assistant, including writable AI task conversations.
const SESSION_TURN_CHECKPOINT_TASK_ID = "codex_turn_checkpoint";

async function checkpointSessionTurn({
  project,
  runtime,
  session,
  sessionId,
  outerTurnId,
  outcome = "completed",
  timestamp = new Date().toISOString(),
  publishSessionChanged,
  createCheckpoint = createGitTurnCheckpointAsOneJob
}) {
  if (!outerTurnId) return { ok: true, processed: false, reason: "outer_turn_unavailable" };
  runtime ||= await project.createRuntimeWithoutSource();
  session ||= await runtime.getSessionWithoutSource(sessionId);
  const learningRoot = await learningSessionExecutionRoot(runtime, sessionId, { allowClosing: true });
  if (learningRoot) {
    return {
      ok: true,
      processed: false,
      reason: "learning_session_no_git_checkpoint",
      checkpoint: { applicable: false, outerTurnId, outcome }
    };
  }
  let checkpoint;
  let failure = "";
  try {
    checkpoint = await createCheckpoint({
      outerTurnId,
      outcome,
      timestamp,
      sessionId,
      project: await project.readCurrentProject(),
      worktreePath: sessionSourcePath(session)
    });
  } catch (error) {
    failure = error.message || "A recovery checkpoint could not be created.";
  }
  const status = failure ? "failed" : "ready";
  const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_TURN_CHECKPOINT_TASK_ID, {
    event: {
      kind: failure ? "checkpoint-failed" : checkpoint.created ? "checkpoint-created" : "checkpoint-confirmed",
      message: failure
    },
    patch: {
      ...(checkpoint ? { checkpointCommit: checkpoint.commit } : {}),
      checkpointOutcome: checkpoint?.outcome || outcome,
      checkpointTurnId: outerTurnId,
      error: failure,
      status
    },
    shouldWrite({ previous }) {
      return previous.checkpointTurnId !== outerTurnId || previous.error !== failure ||
        previous.status !== status ||
        (checkpoint && previous.checkpointCommit !== checkpoint.commit);
    }
  });
  await publishSessionChanged(sessionId, {
    reason: failure ? "session-turn-checkpoint-failed" : "session-turn-checkpoint-updated",
    session: await runtime.getSessionWithoutSource(sessionId)
  });
  return { ok: !failure, processed: true, task, ...(failure ? { error: failure } : { checkpoint }) };
}

/**
 * Preserve the original Codex Main and temporary checkpoint projections.
 * The native owner still decides when the existing callback is invoked.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 */
function createCodexSessionTurnCheckpoint({ project, publishSessionChanged }) {
  function checkpointOutcomeForCodexTurn(status = "", turnOutcome = "") {
    const normalizedTurnOutcome = normalizeText(turnOutcome);
    if (normalizedTurnOutcome === CODEX_TURN_OUTCOME.USER_CANCELLED) {
      return "cancelled";
    }
    if (normalizedTurnOutcome === CODEX_TURN_OUTCOME.SERVICE_RESTART) {
      return "interrupted";
    }
    if (normalizedTurnOutcome === CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE) {
      return "failed";
    }
    const normalizedStatus = normalizeText(status);
    if (normalizedStatus === "interrupted") {
      return "interrupted";
    }
    if (normalizedStatus === "completed") {
      return "completed";
    }
    return "failed";
  }

  async function checkpointCodexAppServerTurn(sessionId = "", options = {}) {
    const {
      status = "completed",
      turnOutcome = "",
      outerTurnId: conversationOuterTurnId = "",
      threadId = "",
      turnId = ""
    } = options;
    if (conversationOuterTurnId) {
      await checkpointSessionTurn({
        project,
        sessionId,
        outerTurnId: conversationOuterTurnId,
        outcome: checkpointOutcomeForCodexTurn(status, turnOutcome),
        publishSessionChanged
      });
      return publishSessionChanged(sessionId, {
        reason: "temporary-agent-turn-idle",
        payload: {
          conversationId: threadId,
          temporaryRun: { active: false, state: status, providerTurnId: turnId }
        }
      });
    }
    const normalizedSessionId = normalizeText(sessionId);
    const runtime = await project.createRuntimeWithoutSource();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = codexAppServerTurnState(session, normalizeVibe64AgentRunState);
    const outerTurnId = normalizeText(turn.outerTurnId);
    return checkpointSessionTurn({
      project,
      runtime,
      session,
      sessionId: normalizedSessionId,
      outerTurnId,
      outcome: checkpointOutcomeForCodexTurn(status, turnOutcome),
      timestamp: normalizeText(turn.completedAt || turn.updatedAt),
      publishSessionChanged
    });
  }

  return checkpointCodexAppServerTurn;
}

export { checkpointSessionTurn, createCodexSessionTurnCheckpoint };
