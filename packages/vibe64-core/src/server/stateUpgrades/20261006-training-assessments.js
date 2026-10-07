// Optional assessment and resume records are written only by admitted operations.
// Existing schema-1 reservations remain valid without a learning field.
export default {
  id: "20261006-training-assessments",
  async run({ report }) {
    report("info", "New training writes may retain pinned assessment evidence and lesson resume state. Existing reservations remain unchanged; no application files are converted and no backup is required.");
  }
};
