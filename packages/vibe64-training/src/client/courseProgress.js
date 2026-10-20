// Display-only course progress joined from the supplied courses.list and
// learning.read projections. It grades nothing and admits no lesson; a lesson's
// saved passes count in every course containing its exact code and hash.

// An enabled preview course is offered only to a person whom courses.list
// reports may try previews (the workspace owner); the server enforces it.
function offered(course, lesson, canTryPreviews = false) {
  return course.enabled && (course.status === "released" || canTryPreviews) && lesson.status === "published";
}

function previewCourse(course) {
  return course.enabled && course.status !== "released";
}

const previewNote = "Preview — the workspace owner can try it; it becomes startable when released.";

function lessonStatus(lesson, lessonProgress) {
  const saved = lessonProgress.find(value => value.lessonCode === lesson.code && value.lessonHash === lesson.hash);
  if (saved?.completed) return "completed";
  return saved && (saved.open || saved.passed > 0) ? "in-progress" : "not-started";
}

// Display only: when a course update changed a lesson's content, its earlier
// completed version is named by the release of a saved attempt of that version.
function earlierCompletion(lesson, lessonProgress, attempts) {
  const done = lessonProgress.filter(value => value.lessonCode === lesson.code && value.lessonHash !== lesson.hash && value.completed);
  if (!done.length) return null;
  const releases = done.flatMap(value => attempts.filter(attempt => attempt?.pin?.lesson?.code === value.lessonCode &&
    attempt.pin.lesson.hash === value.lessonHash).map(attempt => attempt.pin.course?.release)).filter(Boolean);
  return { release: releases.at(-1) || "" };
}

// A lesson left before (not completed): Continue lesson starts a new attempt of
// its latest ended attempt, in the same practice project, instead of Start.
function leftAttempt(lesson, history) {
  return history.findLast(attempt => attempt?.ended && attempt.pin?.lesson?.code === lesson.code &&
    attempt.pin.lesson.hash === lesson.hash) || null;
}

function courseProgress(course, lessonProgress = [], active = null, history = [], { canTryPreviews = false } = {}) {
  const attempts = [...history, ...(active ? [active] : [])];
  const lessons = course.lessons.map(lesson => {
    const status = lessonStatus(lesson, lessonProgress);
    const earlier = status === "completed" ? null : earlierCompletion(lesson, lessonProgress, attempts);
    const continueFrom = status === "completed" ? null : leftAttempt(lesson, history);
    return { lesson, status, ...(earlier ? { earlier } : {}), ...(continueFrom ? { continueFrom } : {}) };
  });
  const nextEntry = lessons.find(value => value.status !== "completed" && offered(course, value.lesson, canTryPreviews)) || null;
  const next = nextEntry?.lesson || null;
  const counted = lessons.some(value => value.lesson.required) ? lessons.filter(value => value.lesson.required) : lessons;
  const topics = course.topics.map(topic => ({ ...topic,
    lessons: lessons.filter(value => value.lesson.topicId === topic.topicId && value.lesson.topicRelease === topic.release) }));
  return {
    lessons, topics,
    completed: counted.filter(value => value.status === "completed").length,
    total: counted.length,
    activeHere: Boolean(active && active.pin.course.courseId === course.courseId && active.pin.course.release === course.release),
    next,
    // The next lesson was left before: the course's main button continues it.
    continueFrom: nextEntry?.continueFrom || null
  };
}

const statusLabels = Object.freeze({ completed: "Completed", "in-progress": "In progress", "not-started": "Not started" });

// Display label for a course's availability for new lessons.
function courseStatusLabel(course) {
  return !course.enabled ? "Disabled for new lessons" : course.status === "released" ? "Enabled" : "Preview course";
}

// Display label for a lesson completed in an earlier release whose content changed since.
function earlierCompletionLabel(earlier) {
  return earlier ? `Completed in ${earlier.release || "an earlier release"} · updated since` : "";
}

export { courseProgress, courseStatusLabel, earlierCompletionLabel, lessonStatus, offered, previewCourse, previewNote, statusLabels };
