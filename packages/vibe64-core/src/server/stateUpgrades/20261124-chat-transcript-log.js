// A chat's transcript stops being one record rewritten whole on every message
// (transcript.json, 49-64 ms at 5,000 turns) and becomes a file each message is
// appended to (transcript.jsonl). Each old record becomes the new file's first
// line, unchanged; the old file is removed only after the new one is published,
// and both are kept in this upgrade's backup. Runtime owns the session records
// and the format; the candidate CLI supplies the operation.
export default {
  id: "20261124-chat-transcript-log",
  async run({ upgradeChatTranscriptLogs, ...context }) {
    if (typeof upgradeChatTranscriptLogs !== "function") {
      throw new Error("Use the candidate upgrade-state command; the session record owner is required.");
    }
    await upgradeChatTranscriptLogs(context);
  }
};
