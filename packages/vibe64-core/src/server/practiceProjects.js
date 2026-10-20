// Practice projects are ordinary projects whose immutable record carries the
// saved Learning `training` marker. These helpers derive their presentation and
// ownership facts from that marker; they never read or change saved progress.

function practiceLearnerKey(actor = null) {
  const id = String(actor?.uid ?? actor?.username ?? "");
  return id ? Buffer.from(id).toString("base64url") : "";
}

// The record field is actor-agnostic. `mine` is added only where the current
// actor is known (a listing or projection), never stored.
function projectPracticeFromTraining(training = null) {
  if (!training) return null;
  return Object.freeze({
    learnerKey: String(training.learnerKey || ""),
    attemptId: String(training.attemptId || "")
  });
}

function projectPracticeForActor(project = null, actor = null) {
  if (!project?.practice) return project;
  const key = practiceLearnerKey(actor);
  return {
    ...project,
    practice: {
      learnerKey: project.practice.learnerKey,
      attemptId: project.practice.attemptId,
      mine: Boolean(key) && key === project.practice.learnerKey
    }
  };
}

// A practice project belongs to its learner. The workspace owner keeps access
// for support; every other person is refused, whatever its repository mode.
function practiceProjectAccessBlock(project = null, user = null) {
  if (!project?.practice || user?.role === "owner") return null;
  const key = practiceLearnerKey(user);
  if (key && key === project.practice.learnerKey) return null;
  return {
    code: "vibe64_practice_project_private",
    message: "This practice project belongs to another learner.",
    statusCode: 403
  };
}

function practiceProjectAttemptId(slug = "") {
  const hex = /^training-([a-f0-9]{32})$/u.exec(String(slug || ""))?.[1];
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : "";
}

export {
  practiceLearnerKey,
  practiceProjectAccessBlock,
  practiceProjectAttemptId,
  projectPracticeForActor,
  projectPracticeFromTraining
};
