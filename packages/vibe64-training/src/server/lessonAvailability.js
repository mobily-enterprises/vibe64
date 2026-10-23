import { lessonAvailable, lessonStepAvailable } from "../shared/learningVocabulary.js";

// Who is learning, as the availability rule sees them.
const learningViewer = actor => ({ owner: actor?.role === "owner" });

// The steps of an installed reader lesson (beats parsed) available to this
// actor here; completion counts only these.
function availableStepIds(lesson, actor) {
  const viewer = learningViewer(actor);
  return new Set((lesson.steps || []).filter(step => lessonStepAvailable(step, { viewer })).map(step => step.id));
}

function lessonAvailableTo(lesson, actor) {
  return lessonAvailable(lesson.steps || [], { viewer: learningViewer(actor) });
}

export { availableStepIds, learningViewer, lessonAvailableTo };
