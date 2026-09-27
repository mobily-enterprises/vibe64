// Existing keys were verified through Codex. The optional codexDisabled flag
// records only new explicit connections whose Codex check did not succeed.
// Claude readiness keeps its existing independent, opt-in meaning.
export default {
  id: "20260927-native-provider-readiness",
  async run({ report }) {
    report("info", "Independent provider readiness requires no conversion. Existing keys and verification remain unchanged; new connections may disable Codex while enabling Claude Code. No backups or provider calls are needed.");
  }
};
