// Only a completed setup can establish which resources its commands prepared.
export default {
  id: "20261016-workspace-resource-identity",
  async run({ report }) {
    report("info", "Successful workspace preparation now records its resource identity. Existing setup records remain unchanged; missing identity requires the declared recipe to run once before resource recovery can reuse it. No historical resource identity is inferred and no application files require backup.");
  }
};
