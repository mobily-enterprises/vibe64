// Training provenance and preparation identity are written only by explicit
// admitted operations. Ordinary projects without provenance and untouched
// reserved attempts remain valid; no historical state is inferred or repaired.
// The ordered ledger prevents an older candidate from accepting this boundary.
export default {
  id: "20261006-training-preparation",
  async run({ report }) {
    report("info", "New training writes may retain immutable project provenance and preparation identity/phases. Existing projects and reservations remain unchanged; no application files are converted and no backup is required.");
  }
};
