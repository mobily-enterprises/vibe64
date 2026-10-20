import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "../shared/learnerEvents.js";
import { learnerIdentity } from "./learnerState.js";

// Publishes vibe64.training.learner.changed after a step result, reader
// position or practice project change. The event goes to every connected
// client like the session notices; each host's realtime authorization admits
// it only for the learner it names (Online: realtimeAuthorization.js). A
// notification failure never changes or repeats the saved operation.
function createTrainingLearnerChangedPublisher(events) {
  if (typeof events?.publish !== "function") return null;
  return async function publishLearnerChanged({ actor, attemptId, reason = "" } = {}) {
    const learnerId = learnerIdentity(actor).id;
    try {
      await events.publish(Object.freeze({
        type: "entity.changed", source: "vibe64", entity: "training-learner", operation: "updated",
        entityId: attemptId, scope: Object.freeze({ kind: "global", id: null }),
        occurredAt: new Date().toISOString(),
        realtime: Object.freeze({
          audience: "all_clients",
          event: VIBE64_TRAINING_LEARNER_CHANGED_EVENT,
          payload: Object.freeze({ learnerId, attemptId, ...(reason ? { reason } : {}) })
        })
      }));
    } catch { /* The saved change stands; readers reconcile on their next read. */ }
  };
}

export { VIBE64_TRAINING_LEARNER_CHANGED_EVENT, createTrainingLearnerChangedPublisher };
