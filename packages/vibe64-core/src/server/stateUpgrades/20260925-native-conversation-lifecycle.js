// The optional replacement journal is created only by an explicit host action.
// Existing changeover records, histories and archives retain their exact bytes:
// absence means no replacement, not an old shape needing a lazy conversion.
// Recording this release boundary prevents an older executable's upgrade runner
// from accepting state after a replacement has been started by the new release.
export default {
  id: "20260925-native-conversation-lifecycle",
  async run({ report }) {
    report("info", "Optional native replacement journals require no conversion of existing state. No application files or native histories are changed; no backup is required.");
  }
};
