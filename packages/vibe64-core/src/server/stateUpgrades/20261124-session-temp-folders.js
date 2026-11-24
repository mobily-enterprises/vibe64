// A session's temporary folder moved from `tmp` beside its source to a short
// folder in the editor's own TMPDIR, so a Unix socket made below it fits the
// 107 bytes a socket's path holds. Each session's old folder is removed with
// the throwaway files in it; nothing is backed up, as archive keeps no copy of
// them either. Runtime owns the session records; the candidate CLI supplies the
// operation.
export default {
  id: "20261124-session-temp-folders",
  async run({ removeOldSessionTempFolders, ...context }) {
    if (typeof removeOldSessionTempFolders !== "function") {
      throw new Error("Use the candidate upgrade-state command; the session record owner is required.");
    }
    await removeOldSessionTempFolders(context);
  }
};
