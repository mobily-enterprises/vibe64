// Whether a connected copy still holds exactly what its registry published at the locked version,
// for the types whose registry publishes a Git commit (Go modules: a tag or a pseudo-version's commit;
// Composer: the commit composer.lock names). The copy's working tree, committed or not, is compared
// with that commit; untracked files count as changes.

/**
 * @param {object} input
 * @param {string} input.sourceDir the connected copy
 * @param {string} input.revision the published commit, tag or commit prefix
 * @param {((request: object) => Promise<object>) | null} input.runCommand null where nothing may run (true / false need Git)
 * @returns {Promise<boolean | null>} true when the copy differs, false when it is that commit, null when Vibe64 cannot tell
 *   (no command runner, or the copy does not hold the published commit)
 */
async function copyDiffersFromRevision({ sourceDir, revision, runCommand }) {
  if (!runCommand || !revision) return null;
  const git = args => runCommand({ command: "git", args, cwd: sourceDir, timeout: 60_000 });
  const commit = await git(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]);
  if (commit?.ok !== true) return null;
  const published = String(commit.stdout || "").trim();
  const diff = await git(["diff", "--quiet", published, "--"]);
  // `git diff --quiet` exits 1 for a difference; anything else is a failure to tell.
  if (diff?.ok !== true && Number(diff?.exitCode) !== 1) return null;
  if (diff?.ok !== true) return true;
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (untracked?.ok !== true) return null;
  return String(untracked.stdout || "").length > 0;
}

export { copyDiffersFromRevision };
