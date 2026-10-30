// Existing session checkouts drop the stale local copy of the branch they
// cloned (usually main) under the Git proof new sessions use, and record the
// outcome as source creation does. Terminals owns that proof and the session
// checkouts; the candidate CLI supplies the operation.
export default {
  id: "20261030-cloned-default-branch",
  async run({ removeSessionClonedDefaultBranches, ...context }) {
    if (typeof removeSessionClonedDefaultBranches !== "function") {
      throw new Error("Use the candidate upgrade-state command; the session source owner is required.");
    }
    await removeSessionClonedDefaultBranches(context);
  }
};
