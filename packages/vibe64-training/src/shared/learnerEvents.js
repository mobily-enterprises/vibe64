// Learner-scoped realtime notice for Learning v2. The payload names only the
// learner and attempt that changed; readers refetch through lesson.read or
// learning.read, which re-authorize the request. Hosts deliver it to that
// learner only.
const VIBE64_TRAINING_LEARNER_CHANGED_EVENT = "vibe64.training.learner.changed";

export { VIBE64_TRAINING_LEARNER_CHANGED_EVENT };
