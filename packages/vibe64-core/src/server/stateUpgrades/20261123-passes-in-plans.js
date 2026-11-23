// A plan's passes live in its Passes section: saved routing requests move to
// schema version 7 without their list of after-plan passes (passChain), and a
// request still at one of those passes finishes without replaying anything.
// Terminals owns the conversion; the candidate CLI supplies the operation.
export default {
  id: "20261123-passes-in-plans",
  async run({ upgradePassesInPlans, ...context }) {
    if (typeof upgradePassesInPlans !== "function") {
      throw new Error("Use the candidate upgrade-state command; the passes-in-plans owner is required.");
    }
    await upgradePassesInPlans(context);
  }
};
