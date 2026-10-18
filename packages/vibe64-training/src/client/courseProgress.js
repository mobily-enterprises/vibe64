// Display-only course progress joined from the supplied courses.list and
// learning.read projections. It grades nothing and admits no lesson; a lesson's
// saved passes count in every course containing its exact code and hash.

function offered(course, lesson) {
  return course.enabled && course.status === "released" && lesson.status === "published";
}

function lessonStatus(lesson, lessonProgress) {
  const saved = lessonProgress.find(value => value.lessonCode === lesson.code && value.lessonHash === lesson.hash);
  if (saved?.completed) return "completed";
  return saved && (saved.open || saved.passed > 0) ? "in-progress" : "not-started";
}

function courseProgress(course, lessonProgress = [], active = null) {
  const lessons = course.lessons.map(lesson => ({ lesson, status: lessonStatus(lesson, lessonProgress) }));
  const counted = lessons.some(value => value.lesson.required) ? lessons.filter(value => value.lesson.required) : lessons;
  const topics = course.topics.map(topic => ({ ...topic,
    lessons: lessons.filter(value => value.lesson.topicId === topic.topicId && value.lesson.topicRelease === topic.release) }));
  return {
    lessons, topics,
    completed: counted.filter(value => value.status === "completed").length,
    total: counted.length,
    activeHere: Boolean(active && active.pin.course.courseId === course.courseId && active.pin.course.release === course.release),
    next: lessons.find(value => value.status !== "completed" && offered(course, value.lesson))?.lesson || null
  };
}

const statusLabels = Object.freeze({ completed: "Completed", "in-progress": "In progress", "not-started": "Not started" });

// Display label for a course's availability for new lessons.
function courseStatusLabel(course) {
  return !course.enabled ? "Disabled for new lessons" : course.status === "released" ? "Enabled" : "Preview course";
}

export { courseProgress, courseStatusLabel, lessonStatus, offered, statusLabels };
