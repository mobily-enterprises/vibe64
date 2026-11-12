// Only a completed preparation can say which tree its steps prepared.
export default {
  id: "20261112-workspace-prepared-tree",
  async run({ report }) {
    report("info", "Successful workspace preparation now records the tree it prepared (commits, digests of uncommitted changes and recipe), and an Update keeps that record so preparing the same tree again runs no step. Existing setup records remain unchanged; a session without the record runs its declared recipe after its next Update, as before, and records the tree from then on. No prepared tree is inferred and no application files require backup.");
  }
};
