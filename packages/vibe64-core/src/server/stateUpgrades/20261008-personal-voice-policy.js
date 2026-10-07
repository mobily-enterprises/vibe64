export default {
  id: "20261008-personal-voice-policy",
  async run({ report }) {
    report("info", "New personal voice writes may retain readAloud for both assistant targets and optional coding narration flags. Existing schema-1 avatar/voice profiles remain unchanged until an explicit preference write; no application files are read or converted and no backup is required.");
  }
};
