export default {
  id: "20261009-independent-provider-credentials",
  async run({ upgradeIndependentProviderCredentials, ...context }) {
    if (typeof upgradeIndependentProviderCredentials !== "function") {
      throw new Error("Use the candidate upgrade-state command; the independent provider credential owner is required.");
    }
    await upgradeIndependentProviderCredentials(context);
  }
};
