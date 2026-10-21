import path from "node:path";

// Learning v2: practice projects live in the learning space and old Learning
// data is disposable. Training retires every v1-marked practice project and the
// learners' attempt state, code ledgers and source-less stores (moves only);
// Colleague retires its learning-task watches and keeps each conversation as
// its person's Develop thread. Each owner has its own backup root.
// Normal projects are never read beyond their names.
export default {
  id: "20261022-learning-space-reset",
  async run({ resetLearningForLearningSpace, retireColleagueLearningWatches, backupRoot, ...context }) {
    if (typeof resetLearningForLearningSpace !== "function" || typeof retireColleagueLearningWatches !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Training learning-space reset and Colleague watch owners are required.");
    }
    await resetLearningForLearningSpace({ ...context, backupRoot: path.join(backupRoot, "training") });
    await retireColleagueLearningWatches({ ...context, backupRoot: path.join(backupRoot, "colleague") });
  }
};
