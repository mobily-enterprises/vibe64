// Explicit new writes retain ended attempts; existing single reservations stay
// valid and no historical project, learner record or assessment is converted.
export default {
  id: "20261007-training-attempt-history",
  async run({ report }) {
    report("info", "New training writes may retain explicit ended attempts and an empty active summary while preserving exact-pin evidence. Existing reservations remain unchanged; no application files are converted and no backup is required.");
  }
};
