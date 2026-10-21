import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "../shared/learnerEvents.js";
import { learnerIdentity } from "./learnerState.js";

// Publishes vibe64.training.learner.changed with its reason (see
// shared/learnerEvents.js): "learning-mode" after a switch between Learn and
// Develop, "lesson" after a lesson starts, restarts, resumes, finishes or is
// deleted, "steps" after a step result or reader position, "practice" after
// an archived lesson is deleted and "notes" after a teacher notes change
// (the last two without an attempt). The event goes to every connected
// client like the session notices; each host's realtime authorization admits
// it only for the learner it names. A notification failure never changes or
// repeats the saved operation.
function createTrainingLearnerChangedPublisher(events) {
  if (typeof events?.publish !== "function") return null;
  return async function publishLearnerChanged({ actor, attemptId, reason = "" } = {}) {
    const learnerId = learnerIdentity(actor).id;
    try {
      await events.publish(Object.freeze({
        type: "entity.changed", source: "vibe64", entity: "training-learner", operation: "updated",
        entityId: attemptId || (reason === "notes" ? "teacher-notes" : reason || "learner"), scope: Object.freeze({ kind: "global", id: null }),
        occurredAt: new Date().toISOString(),
        realtime: Object.freeze({
          audience: "all_clients",
          event: VIBE64_TRAINING_LEARNER_CHANGED_EVENT,
          payload: Object.freeze({ learnerId, ...(attemptId ? { attemptId } : {}), ...(reason ? { reason } : {}) })
        })
      }));
    } catch { /* The saved change stands; readers reconcile on their next read. */ }
  };
}

export { createTrainingLearnerChangedPublisher };
