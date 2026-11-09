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

// Values grouped by key, in their order.
function grouped(values, key) {
  const groups = new Map();
  for (const value of values) {
    const group = groups.get(key(value));
    if (group) group.push(value);
    else groups.set(key(value), [value]);
  }
  return groups;
}

const lessonKey = (code, hash) => `${code}\u0000${hash}`;

// A lesson's status from its saved progress for this exact code and hash.
function lessonStatus(saved) {
  if (saved?.completed) return "completed";
  return saved && (saved.open || saved.passed > 0) ? "in-progress" : "not-started";
}

// Display only: when a course update changed a lesson's content, its earlier
// completed version is named by the release of a saved attempt of that version.
function earlierCompletion(lesson, progressByCode, attemptsByLesson) {
  const done = (progressByCode.get(lesson.code) || []).filter(value => value.lessonHash !== lesson.hash && value.completed);
  if (!done.length) return null;
  const releases = done.flatMap(value => (attemptsByLesson.get(lessonKey(value.lessonCode, value.lessonHash)) || [])
    .map(attempt => attempt.pin.course?.release)).filter(Boolean);
  return { release: releases.at(-1) || "" };
}

function courseProgress(course, lessonProgress = [], active = null, history = [], { canTryPreviews = false } = {}) {
  const attempts = [...history, ...(active ? [active] : [])].filter(attempt => attempt?.pin?.lesson);
  const progressByCode = grouped(lessonProgress, value => value.lessonCode);
  const attemptsByLesson = grouped(attempts, attempt => lessonKey(attempt.pin.lesson.code, attempt.pin.lesson.hash));
  const lessons = course.lessons.map(lesson => {
    const saved = progressByCode.get(lesson.code)?.find(value => value.lessonHash === lesson.hash);
    const status = lessonStatus(saved);
    const earlier = status === "completed" ? null : earlierCompletion(lesson, progressByCode, attemptsByLesson);
    // The lesson in progress (open) is resumed, not started; any other lesson starts as a new attempt.
    return { lesson, status, current: Boolean(saved?.open), ...(earlier ? { earlier } : {}) };
  });
  const next = lessons.find(value => value.status !== "completed" && offered(course, value.lesson, canTryPreviews))?.lesson || null;
  const counted = lessons.some(value => value.lesson.required) ? lessons.filter(value => value.lesson.required) : lessons;
  const lessonsByTopic = grouped(lessons, value => lessonKey(value.lesson.topicId, value.lesson.topicRelease));
  const topics = course.topics.map(topic => ({ ...topic, lessons: lessonsByTopic.get(lessonKey(topic.topicId, topic.release)) || [] }));
  return {
    lessons, topics,
    completed: counted.filter(value => value.status === "completed").length,
    total: counted.length,
    activeHere: Boolean(active && active.pin.course.courseId === course.courseId && active.pin.course.release === course.release),
    next
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

// Whether a catalogue or progress field is a non-empty string.
function hasText(value) {
  return typeof value === "string" && value.length > 0;
}

// A count with its word, singular for one: "1 lesson", "3 lessons".
function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export { courseProgress, courseStatusLabel, earlierCompletionLabel, hasText, lessonStatus, offered, plural, previewCourse, previewNote, statusLabels };
