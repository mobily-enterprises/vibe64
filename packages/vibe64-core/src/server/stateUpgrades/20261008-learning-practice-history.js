export default {
  id: "20261008-learning-practice-history",
  async run({ upgradeLearningPracticeHistory, ...context }) {
    if (typeof upgradeLearningPracticeHistory !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its Training practice history upgrade owner is required.");
    }
    await upgradeLearningPracticeHistory(context);
  }
};
