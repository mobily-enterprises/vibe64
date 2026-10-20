// Version 2 lessons write separate per-learner step-progress.json and
// reader.json records, step-keyed code ledgers, and up to 32 retained attempts.
// Older records stay valid unchanged; an older registry refuses this ledger.
export default {
  id: "20261020-training-step-progress",
  async run({ inspectTrainingStepProgress, ...context }) {
    if (typeof inspectTrainingStepProgress !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its Training step progress preflight owner is required.");
    }
    await inspectTrainingStepProgress({ systemRoot: context.systemRoot, report: context.report });
    context.report("info", "New lesson writes may add per-learner step-progress.json and reader.json, step-keyed code ledgers and up to 32 retained attempts. Existing learner records remain byte-for-byte unchanged; nothing is converted and no application-file backup is required.");
  }
};
