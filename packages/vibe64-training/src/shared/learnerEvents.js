// Learner-scoped realtime notice for Learning v2. The payload is
// { learnerId, attemptId?, reason }, with reason "learning-mode" (Learn or
// Develop), "lesson" (the lesson in progress started, restarted, resumed,
// finished or was deleted), "steps" (a step result or reader position),
// "practice" (an archived lesson was deleted) or "notes" (teacher notes, no
// attempt). Readers refetch through learning-mode.read, lesson.read,
// learning.read, practice.list or learner-notes.read, which re-authorize the
// request. Hosts deliver it to that learner only.
const VIBE64_TRAINING_LEARNER_CHANGED_EVENT = "vibe64.training.learner.changed";

export { VIBE64_TRAINING_LEARNER_CHANGED_EVENT };
