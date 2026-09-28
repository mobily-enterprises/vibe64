export default {
  id: "20260928-completed-discussion-plan",
  async run({ upgradeCompletedDiscussionPlan, ...context }) {
    if (typeof upgradeCompletedDiscussionPlan !== "function") {
      throw new Error("Use the candidate upgrade-state command; the completed-plan repair owner is required.");
    }
    await upgradeCompletedDiscussionPlan(context);
  }
};
