// A chat's transcript stops being one record rewritten whole on every message
// (transcript.json, 49-64 ms at 5,000 turns) and becomes a file each message is
// appended to (transcript.jsonl). Each old record becomes the new file's first
// line, unchanged; only after the new file is published does the old one become
// a note the previous release refuses to open, and both are kept in this
// upgrade's backup. A run after one that stopped part way prepares again from
// what the chats hold. Runtime owns the session records and the format; the
// candidate CLI supplies the operation.
export default {
  id: "20261124-chat-transcript-log",
  async run({ upgradeChatTranscriptLogs, ...context }) {
    if (typeof upgradeChatTranscriptLogs !== "function") {
      throw new Error("Use the candidate upgrade-state command; the session record owner is required.");
    }
    await upgradeChatTranscriptLogs(context);
  }
};
