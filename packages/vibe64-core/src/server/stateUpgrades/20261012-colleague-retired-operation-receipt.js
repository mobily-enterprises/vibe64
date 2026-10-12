export default {
  id: "20261012-colleague-retired-operation-receipt",
  async run({ repairColleagueRetiredOperation, ...context }) {
    if (typeof repairColleagueRetiredOperation !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Colleague retired-operation repair owner is required.");
    }
    await repairColleagueRetiredOperation(context);
  }
};
