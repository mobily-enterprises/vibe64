import { createGitTurnCheckpointAsOneJob, runVibe64Command } from "@local/vibe64-execution/server";
import { codexAppServerTurnState } from "@jskit-ai/assistant-core/server/codex-turn";
import { normalizeVibe64AgentRunState } from "@local/vibe64-runtime/server/sessionStore";
import { CODEX_TURN_OUTCOME } from "./codexTurnOutcomeNotice.js";
import { learningSessionExecutionRoot } from "./mainConversationContext.js";
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").TrackShutdownWork} TrackShutdownWork */

// The persisted task identity keeps its Codex name; checkpoints cover every
// session assistant, including writable temporary conversations.
const SESSION_TURN_CHECKPOINT_TASK_ID = "codex_turn_checkpoint";

/**
 * A turn's recovery checkpoint and its task record. Once begun it is shutdown work: it writes the
 * session's source and records, so the server's close waits for it.
 * @param {{ trackShutdownWork: TrackShutdownWork } & Parameters<typeof checkpointTurn>[0]} turn
 */
function checkpointSessionTurn({ trackShutdownWork, ...turn }) {
  return trackShutdownWork(checkpointTurn(turn));
}

async function checkpointTurn({
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
    const currentProject = await project.readCurrentProject();
    checkpoint = await createCheckpoint({
      outerTurnId,
      outcome,
      timestamp,
      sessionId,
      project: currentProject,
      runCommand: runVibe64Command,
      worktreePath: sessionSourcePath(session)
    });
    // Each connected copy keeps the same turn's checkpoint in its own repository.
    for (const copy of sessionConnectedCopies(session)) {
      await createCheckpoint({
        outerTurnId, outcome, timestamp, sessionId, project: currentProject, runCommand: runVibe64Command, worktreePath: copy.path
      });
    }
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

/**
 * Preserve the original Codex Main and temporary checkpoint projections.
 * The native owner still decides when the existing callback is invoked.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TrackShutdownWork} dependencies.trackShutdownWork
 */
function createCodexSessionTurnCheckpoint({ project, publishSessionChanged, trackShutdownWork }) {
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
        publishSessionChanged,
        trackShutdownWork
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
      publishSessionChanged,
      trackShutdownWork
    });
  }

  return checkpointCodexAppServerTurn;
}

/**
 * The chat's run a previous server's shutdown stopped, as its assistant's read
 * takes it. The read that records the run ended makes the checkpoint that
 * shutdown left owed, once.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TrackShutdownWork} dependencies.trackShutdownWork
 * @param {{ runtime?: object | null, session?: object | null, sessionId: string }} context
 * @param {{ runId: string, checkpointTurnId?: string, routingConversationId: string, outcome?: string } | undefined} stop
 */
function shutdownStoppedRun({ project, publishSessionChanged, trackShutdownWork }, context, stop) {
  if (!stop?.runId) return null;
  return {
    runId: stop.runId,
    async ended() {
      if (!stop.checkpointTurnId) return;
      const runtime = context.runtime || await project.createRuntimeWithoutSource();
      await checkpointSessionTurn({
        project,
        runtime,
        session: context.session,
        sessionId: context.sessionId,
        outerTurnId: stop.checkpointTurnId,
        outcome: stop.outcome || "interrupted",
        publishSessionChanged,
        trackShutdownWork
      });
      await runtime.store.writeSessionConversation(context.sessionId, stop.routingConversationId, {
        stoppedByShutdown: { runId: stop.runId, routingConversationId: stop.routingConversationId }
      });
    }
  };
}

/**
 * A temporary chat's Codex turn that the server's shutdown stops, or that ends
 * while the server stops, leaves its checkpoint to the next server: the chat's
 * record holds it until that server's read makes it. Made at shutdown, a Git
 * snapshot would hold the shutdown up.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 */
function createCodexDeferredTurnCheckpoint({ project }) {
  return async function deferCodexAppServerTurnCheckpoint(sessionId = "", options = {}) {
    const { status = "completed", turnOutcome = "", outerTurnId = "", threadId = "", turnId = "" } = options;
    const runtime = await project.createRuntimeWithoutSource();
    const record = (await runtime.store.listSessionConversations(sessionId))
      .find(conversation => conversation.providerConversationId === threadId);
    if (!record) return;
    await runtime.store.writeSessionConversation(sessionId, record.conversationId, {
      stoppedByShutdown: {
        runId: turnId,
        checkpointTurnId: outerTurnId,
        routingConversationId: record.conversationId,
        outcome: checkpointOutcomeForCodexTurn(status, turnOutcome)
      }
    });
  };
}

export { checkpointSessionTurn, createCodexDeferredTurnCheckpoint, createCodexSessionTurnCheckpoint, shutdownStoppedRun };
