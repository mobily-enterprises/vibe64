// Training refusal codes and limits that Learning clients recognise. The
// server raises them; clients compare against these same values.

// lesson.start's refusal while a different lesson is in progress.
const TRAINING_LESSON_IN_PROGRESS_CODE = "VIBE64_TRAINING_LESSON_IN_PROGRESS";
// A lesson's practice project could not be prepared because the learner has
// no usable AI yet (its saved preparation failure, and the start's refusal).
const TRAINING_PRACTICE_AI_REQUIRED_CODE = "VIBE64_TRAINING_PRACTICE_AI_REQUIRED";
// A learner-notes write whose expected revision is no longer current.
const TRAINING_NOTES_CHANGED_CODE = "VIBE64_TRAINING_NOTES_CHANGED";
// Learner notes (contract C7): one short teacher summary, never a transcript.
const LEARNER_NOTES_MAX_CHARS = 4000;

export { LEARNER_NOTES_MAX_CHARS, TRAINING_LESSON_IN_PROGRESS_CODE, TRAINING_NOTES_CHANGED_CODE, TRAINING_PRACTICE_AI_REQUIRED_CODE };
