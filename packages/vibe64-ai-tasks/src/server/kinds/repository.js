/** What every repository repair tells the AI: Vibe64 owns Git, the AI edits files. */
const REPOSITORY_GIT_BOUNDARY = [
  "Vibe64 owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not push. Resolve only by editing the conflicting working-tree files; Vibe64 owns applying and verifying the repository operation.",
  "Preserve the intended behavior of both the latest saved work and this session. Do not hand-edit generated Genesis maps; Vibe64 regenerates its derived artifacts. A clean index after rollback is not proof that the conflict is resolved."
].join("\n");

const conflictCount = count => `${count} ${count === 1 ? "file" : "files"}`;

export {
  REPOSITORY_GIT_BOUNDARY,
  conflictCount
};
