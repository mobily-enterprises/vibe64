// Codex homes drop the plugin and app catalogues Codex synced before Vibe64
// launched it without them, and a removed provider connection's home also drops
// its diagnostic logs and temporary files. Saved Codex state is kept.
export default {
  id: "20261029-codex-unused-caches",
  async run({ removeUnusedCodexCaches, ...context }) {
    if (typeof removeUnusedCodexCaches !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Codex cache owner is required.");
    }
    await removeUnusedCodexCaches(context);
  }
};
