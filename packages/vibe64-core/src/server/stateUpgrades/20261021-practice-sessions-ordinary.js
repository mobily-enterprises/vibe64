import path from "node:path";

// Learning v2: a lesson's practice project is an ordinary project. Its
// training-<attemptId> sessions lose their learning_session binding, the
// source-less teacher's saved learning-* stores retire into this backup and
// Colleague's learning-task watches retire. Each owner backs up and resumes
// its own files under this upgrade's backup root.
export default {
  id: "20261021-practice-sessions-ordinary",
  async run({ upgradeLearningPracticeSessionsOrdinary, retireColleagueLearningWatches, backupRoot, ...context }) {
    if (typeof upgradeLearningPracticeSessionsOrdinary !== "function" || typeof retireColleagueLearningWatches !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Training practice-session and Colleague watch owners are required.");
    }
    await upgradeLearningPracticeSessionsOrdinary({ ...context, backupRoot: path.join(backupRoot, "training") });
    await retireColleagueLearningWatches({ ...context, backupRoot: path.join(backupRoot, "colleague") });
  }
};
