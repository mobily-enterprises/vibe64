import { createGitTurnCheckpoint } from "@local/vibe64-execution/server";
import { terminalWorktreePath } from "./terminalShared.js";

// Retain the existing persisted task identity; checkpoints now cover every
// session assistant, including writable temporary conversations.
const SESSION_TURN_CHECKPOINT_TASK_ID = "codex_turn_checkpoint";

async function checkpointSessionTurn({
  projectService, runtime, session, sessionId, outerTurnId, outcome = "completed",
  timestamp = new Date().toISOString(), publishSessionChanged = async () => {},
  createCheckpoint = createGitTurnCheckpoint
}) {
  if (!outerTurnId) return { ok: true, processed: false, reason: "outer_turn_unavailable" };
  runtime ||= await projectService.createRuntime({ inspectSource: false });
  session ||= await runtime.getSession(sessionId, { inspectSource: false });
  let checkpoint;
  let failure = "";
  try {
    checkpoint = await createCheckpoint({
      outerTurnId, outcome, timestamp, sessionId,
      project: typeof projectService.readCurrentProject === "function"
        ? await projectService.readCurrentProject() : projectService.selectedProject || {},
      worktreePath: terminalWorktreePath(session)
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
      checkpointOutcome: outcome,
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
    session: await runtime.getSession(sessionId, { inspectSource: false })
  });
  return { ok: !failure, processed: true, task, ...(failure ? { error: failure } : { checkpoint }) };
}

export { checkpointSessionTurn };
