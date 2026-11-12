// Only a step that succeeded can say what the inputs it read held.
export default {
  id: "20261113-workspace-prepared-steps",
  async run({ report }) {
    report("info", "Workspace preparation now records, for each Workspace setup step that names the files it reads (`from`), a digest of its command and of what those files held when it last succeeded; a later preparation that is not Prepare workspace skips that step while both are unchanged and the session's resources are the ones it ran on. Existing setup records remain unchanged: a session without step records runs every step at its next preparation, as before, and records them from then on. No step record is inferred and no application files require backup.");
  }
};
