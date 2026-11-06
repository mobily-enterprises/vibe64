// Canonical authority reads: the saved branch head of a GitHub remote, the
// managed bare repository or the local project folder.
import { PROJECT_REPOSITORY_MODE_LOCAL_SOURCE } from "@local/vibe64-core/server/projectRepository";
import { githubHttpsRemote } from "./githubRemoteHeads.js";
import {
  deleteOperationRef,
  git,
  gitOutput,
  isGitObjectId,
  rememberCanonicalCommit,
  saveError,
  saveRef
} from "./sessionWorkGit.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Returns the canonical commit read from the remote authority.
 */
async function readRemoteCanonical(runCommand, context, operationId, options) {
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
  const operationRef = saveRef(context, operationId, "canonical");
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${context.branch}:${operationRef}`
    ], options);
    const commit = await gitOutput(runCommand, context, ["rev-parse", "--verify", operationRef], options);
    return rememberCanonicalCommit(runCommand, context, commit, options)
      .then((verified) => ({ canonicalBranch: "", commit: verified }));
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
  }
}

async function assertLocalAuthority(runCommand, context, options) {
  const branch = await gitOutput(runCommand, context, ["branch", "--show-current"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
  if (branch !== context.branch) {
    throw saveError(
      `The project baseline must have ${context.branch} checked out before Save.`,
      "vibe64_session_save_local_branch_mismatch"
    );
  }
  const status = await gitOutput(runCommand, context, ["status", "--porcelain", "--untracked-files=all"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
  if (status) {
    throw saveError(
      "The local project baseline has unsaved work. Save cannot overwrite it.",
      "vibe64_session_save_local_authority_dirty"
    );
  }
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"]) {
    const markerResult = await git(runCommand, context, ["rev-parse", "--verify", "-q", marker], {
      ...options,
      cwd: context.standaloneSourceRoot,
      required: false
    });
    if (markerResult?.ok === true) {
      throw saveError(
        "The local project baseline has an unfinished Git operation.",
        "vibe64_session_save_local_operation_in_progress"
      );
    }
  }
  return gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
}

/**
 * Reads the named branch heads of one authority repository (the GitHub remote,
 * the managed bare repository or the local project folder). A GitHub remote
 * is asked by `readRemoteHeads`, the session's Git actor's in-process ls-refs
 * request (codexGitCommand.js), within the command timeout; any other
 * authority with one `git ls-remote`. Either way it fetches no objects and
 * changes no checkout, so it needs no source lock; a moved head is then read
 * by the ordinary update check.
 */
async function readAuthorityBranchHeads(runCommand, context, branches, options, readRemoteHeads) {
  const refs = [...new Set(branches.map(normalizeText).filter(Boolean))].map((branch) => `refs/heads/${branch}`);
  const listing = readRemoteHeads && githubHttpsRemote(context.remoteUrl)
    ? await readRemoteHeads(context.remoteUrl, refs, { timeoutMs: options?.commandOptions?.timeout })
    : (await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, ...refs], options))
        .split("\n").filter(Boolean).map((line) => {
          const [head, ref] = line.split(/\s+/u);
          return { head, ref };
        });
  const heads = new Map();
  for (const { head, ref } of listing) {
    // An ls-remote pattern also matches a longer ref name ending in it, and an
    // ls-refs prefix one starting with it.
    if (!refs.includes(ref)) continue;
    const branch = ref.slice("refs/heads/".length);
    if (!isGitObjectId(head) || heads.has(branch)) {
      throw saveError("The repository returned invalid branch evidence.", "vibe64_session_update_refs_invalid");
    }
    heads.set(branch, head);
  }
  return heads;
}

async function readCanonical(runCommand, context, operationId, options) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return readRemoteCanonical(runCommand, context, operationId, options);
  }
  const authorityCommit = await assertLocalAuthority(runCommand, context, options);
  const operationRef = saveRef(context, operationId, "canonical");
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      context.standaloneSourceRoot,
      `+refs/heads/${context.branch}:${operationRef}`
    ], options);
    const importedCommit = await gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      operationRef
    ], options);
    if (importedCommit !== authorityCommit) {
      throw saveError(
        "The local project baseline changed while Vibe64 was reading it.",
        "vibe64_session_save_authority_changed_during_read"
      );
    }
    return rememberCanonicalCommit(runCommand, context, importedCommit, options)
      .then((commit) => ({ canonicalBranch: "", commit }));
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
  }
}

export {
  assertLocalAuthority,
  readAuthorityBranchHeads,
  readCanonical
};
