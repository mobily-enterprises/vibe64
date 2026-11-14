// Passes run only after a completed plan: each chat's finishing switches become
// the passes ticked to run after a plan (Review and Security pass always, Data
// and Quality pass added, Deslop and the UI pass as their switch was, none
// deeply), Automatically save changes is kept, and saved routing requests move
// to schema version 6 without replaying anything. Terminals owns the conversion;
// the candidate CLI supplies the operation.
export default {
  id: "20261114-after-plan-passes",
  async run({ upgradeAfterPlanPasses, ...context }) {
    if (typeof upgradeAfterPlanPasses !== "function") {
      throw new Error("Use the candidate upgrade-state command; the after-plan passes owner is required.");
    }
    await upgradeAfterPlanPasses(context);
  }
};
