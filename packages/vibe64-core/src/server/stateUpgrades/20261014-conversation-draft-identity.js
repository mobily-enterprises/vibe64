// Draft identity is prospective. Historical conversations have no revision;
// their saved draft is retained until a new, identified draft is submitted.
// No historical provider or message identity can be inferred safely.
export default {
  id: "20261014-conversation-draft-identity",
  async run({ report }) {
    report("info", "New temporary-chat drafts retain a write revision and admitted-submission revision. Historical drafts remain unchanged; no application files are converted or backed up.");
  }
};
