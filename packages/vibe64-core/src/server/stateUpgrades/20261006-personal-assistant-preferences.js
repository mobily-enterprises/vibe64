// The hosted assistant-settings owner writes personal profiles only on explicit
// authenticated changes. Legacy shared settings remain untouched; absent profiles
// use declared defaults without historical conversion or read-time writes.
export default {
  id: "20261006-personal-assistant-preferences",
  async run({ report }) {
    report("info", "New personal assistant preferences use versioned colleague/coding profiles in the private assistant-preferences namespace. Legacy shared settings remain unchanged; no application files are converted and no backup is required.");
  }
};
