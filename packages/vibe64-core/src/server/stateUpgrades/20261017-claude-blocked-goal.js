// Only a structured Block operation records this state; no historical prose or
// inactivity is interpreted as a blocker.
export default {
  id: "20261017-claude-blocked-goal",
  async run({ report }) {
    report("info", "New Claude Block operations retain the exact goal and reason in the existing conversation record and disarm its native checker before another input. Existing records and native histories remain unchanged; no historical blocker is inferred and no application-file backups are needed.");
  }
};
