// New question admission writes retain observed delivery and answer association.
// Missing historical provenance stays missing; no saved record is converted.
export default {
  id: "20261007-training-question-admission",
  async run({ report }) {
    report("info", "New training question writes may retain assistance and issued revision, native prepared/delivered question metadata with actual saved output identity, and canonical user question snapshots with delivery identity. Existing learner, message and turn bytes remain unchanged; missing historical facts are ungraded, no application files are converted and no backup is required.");
  }
};
