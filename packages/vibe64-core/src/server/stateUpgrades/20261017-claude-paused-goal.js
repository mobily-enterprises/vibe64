// Only an explicit Pause records a resumable native goal; old process inactivity
// is not evidence of a human Pause and must never be converted into one.
export default {
  id: "20261017-claude-paused-goal",
  async run({ report }) {
    report("info", "New Claude Pause operations retain the exact goal in the existing conversation record and disarm its native checker before another input. Existing records and native histories remain unchanged; no old pause is inferred and no application-file backups are needed.");
  }
};
