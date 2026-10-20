// A practice project keeps its address slug (training-<attempt id>), but people
// see it by its lesson: "Practice: <lesson title>", or the lesson code while the
// title is unknown. Every place that names a project
// (headers, project lists, Learning's Practice section) uses this one rule.
const PRACTICE_SLUG_PATTERN = /^training-[a-f0-9]{32}$/u;

function isPracticeProjectSlug(slug = "") {
  return PRACTICE_SLUG_PATTERN.test(String(slug || ""));
}

function practiceProjectName({ lessonTitle = "", lessonCode = "" } = {}) {
  const lesson = String(lessonTitle || "").trim() || String(lessonCode || "").trim();
  return lesson ? `Practice: ${lesson}` : "Practice project";
}

// `project` is a listed project ({ slug }). A practice slug is named as
// practice (by its lesson title when known) rather than by its raw slug; every
// other slug is shown as it is.
function projectDisplayName(project = null, { lessonTitle = "" } = {}) {
  const slug = String(project?.slug || "");
  return isPracticeProjectSlug(slug) ? practiceProjectName({ lessonTitle }) : slug;
}

export { isPracticeProjectSlug, practiceProjectName, projectDisplayName };
