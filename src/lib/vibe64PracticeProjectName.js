// A practice project keeps its address slug (training-<attempt id>), but people
// see it by its lesson: "Practice: <lesson title>", or the lesson code from its
// training marker while the title is unknown. Every place that names a project
// (headers, project lists, Learning's Practice section) uses this one rule.
const PRACTICE_SLUG_PATTERN = /^training-[a-f0-9]{32}$/u;

function isPracticeProjectSlug(slug = "") {
  return PRACTICE_SLUG_PATTERN.test(String(slug || ""));
}

function practiceProjectName({ lessonTitle = "", lessonCode = "" } = {}) {
  const lesson = String(lessonTitle || "").trim() || String(lessonCode || "").trim();
  return lesson ? `Practice: ${lesson}` : "Practice project";
}

// `project` is a listed project ({ slug, practice? }). A practice slug without
// its listed record (a local practice project, or before the listing loads) is
// still named as practice rather than by its raw slug.
function projectDisplayName(project = null, { lessonTitle = "" } = {}) {
  const slug = String(project?.slug || "");
  if (!project?.practice && !isPracticeProjectSlug(slug)) return slug;
  return practiceProjectName({ lessonTitle, lessonCode: project?.practice?.lessonCode });
}

// Lesson titles come from courses.list (exact lesson code and content hash).
function lessonTitleFromCourses(courses = [], { code = "", hash = "" } = {}) {
  if (!code || !Array.isArray(courses)) return "";
  for (const course of courses) {
    for (const lesson of Array.isArray(course?.lessons) ? course.lessons : []) {
      if (lesson?.code === code && (!hash || lesson.hash === hash) && typeof lesson.title === "string") return lesson.title;
    }
  }
  return "";
}

export { isPracticeProjectSlug, lessonTitleFromCourses, practiceProjectName, projectDisplayName };
