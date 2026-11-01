// Publishes a prepared save: its commit, the push to the project's repository, the verified GitHub
// mirror, and reconciling the session with what was published.

import path from "node:path";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT
} from "@local/vibe64-core/server/projectRepository";
import { githubMirrorRefreshInvocation, writeGitWorktreeTree } from "@local/vibe64-execution/server";
import {
  commandProject,
  commitTree,
  git,
  gitOutput,
  output,
  rememberCanonicalCommit,
  saveCommand,
  saveError
} from "./sessionWorkGit.js";
import { trimmedText } from "./trimmedText.js";
import {
  assertConnectedSubmissionsIntegrated,
  assertConnectedWorkSnapshotsUnchanged,
  assertLocalAuthority,
  readContributionHead
} from "./sessionWorkAuthority.js";

async function createSaveCommit(runCommand, context, {
  canonicalCommit,
  commandOptions,
  mergedTree,
  message,
  project
}) {
  const subject = trimmedText(message);
  if (!subject) {
    throw saveError(
      "Save requires an assistant-generated commit subject.",
      "vibe64_session_save_message_required"
    );
  }
  return gitOutput(runCommand, context, [
    "commit-tree",
    mergedTree,
    "-p",
    canonicalCommit
  ], {
    commandOptions,
    input: `${subject}\n`,
    project
  });
}

async function publishSaveCommit(runCommand, context, { canonicalCommit, contributionAuthority, saveCommit }, options) {
  await assertConnectedSubmissionsIntegrated(runCommand, context, options);
  if (context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    const current = await assertLocalAuthority(runCommand, context, options);
    if (current !== canonicalCommit) {
      throw saveError(
        "The local project baseline advanced during Save.",
        "vibe64_session_save_authority_advanced"
      );
    }
    await git(runCommand, context, ["fetch", context.worktreePath, saveCommit], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    await assertConnectedWorkSnapshotsUnchanged(runCommand, options.connectedWorkSnapshots || [], options);
    // readable-check: allow optional-call - input validation: a caller's optional publication-attempt observer
    options.onPublicationAttempt?.();
    await git(runCommand, context, ["merge", "--ff-only", saveCommit], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    const verified = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    await rememberCanonicalCommit(runCommand, context, verified, options);
    return verified;
  }
  const pushArgs = ["push"];
  const expectedRemoteCommit = context.contribution
    ? contributionAuthority.publishedCommit
    : canonicalCommit;
  if (context.contribution) {
    if (contributionAuthority.missingPublished) throw saveError(
      "This contribution branch was removed after it was pushed. Preserve its source and submit further work as a new contribution.",
      "vibe64_contribution_branch_missing");
    const expected = contributionAuthority.remoteAbsent ? "" : contributionAuthority.publishedCommit;
    if ((await readContributionHead(runCommand, context, options)).head !== expected) {
      throw saveError("The contribution branch changed while Save was preparing. Inspect it before trying again.",
        "vibe64_session_save_update_required");
    }
    // The prepared commit descends from the observed head. The exact lease also
    // prevents ordinary push from recreating a ref removed by a racing discard.
    pushArgs.push(`--force-with-lease=refs/heads/${context.branch}:${expected}`);
  }
  if (context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    pushArgs.push("--push-option=vibe64-atomic");
  }
  pushArgs.push("origin", `${saveCommit}:refs/heads/${context.branch}`);
  let pushed;
  // This is a final read, not a lock on receiving repositories. It catches
  // changes during preparation without claiming exclusion after this check.
  await assertConnectedWorkSnapshotsUnchanged(runCommand, options.connectedWorkSnapshots || [], options);
  // readable-check: allow optional-call - input validation: a caller's optional publication-attempt observer
  options.onPublicationAttempt?.();
  try {
    pushed = await git(runCommand, context, pushArgs, { ...options, required: false });
  } catch (error) {
    // A transport exception does not establish whether the remote accepted it.
    pushed = { ok: false, code: error.code, error: error.message };
  }
  let verified;
  try {
    const remote = context.contribution ? (await readContributionHead(runCommand, context, options)).head : await gitOutput(
      runCommand, context, ["ls-remote", "--heads", "origin", `refs/heads/${context.branch}`], options
    );
    verified = remote.split(/\s+/u)[0] || "";
  } catch (error) {
    if (["vibe64_contribution_discarded", "vibe64_contribution_discard_incomplete"].includes(error.code)) throw error;
    throw saveError(
      `Save publication could not be confirmed. Inspect work to recover the prepared commit before retrying. ${trimmedText(error.message)}`,
      "vibe64_session_save_publication_unknown"
    );
  }
  if (verified === saveCommit) {
    // Exact remote evidence also confirms a push whose acknowledgement was lost.
    // Continue through the original reconciliation path without publishing again.
    await rememberCanonicalCommit(runCommand, context, verified, options);
    return verified;
  }
  if (pushed?.ok !== true) {
    if (verified && verified !== expectedRemoteCommit) {
      throw saveError(
        "The saved branch changed while Save was pushing your changes. Update this session, then save again.",
        "vibe64_session_save_update_required",
        {
          canonicalCommit: verified,
          reconciledCommit: canonicalCommit,
          updateRequired: true
        }
      );
    }
    const reason = trimmedText(pushed?.stderr || pushed?.stdout || pushed?.output || pushed?.error) || "Git Save publication failed.";
    if (context.mode === PROJECT_REPOSITORY_MODE_GITHUB && /changes must be made through a pull request/iu.test(reason)) {
      throw saveError(
        `GitHub requires a pull request to update ${context.branch}. Your work remains in this session.\n\n${reason}`,
        "vibe64_pull_request_required"
      );
    }
    throw saveError(
      reason,
      trimmedText(pushed?.code) || "vibe64_session_save_git_failed"
    );
  }
  throw saveError(
    "Canonical repository verification did not return the commit Vibe64 pushed.",
    "vibe64_session_save_verification_failed"
  );
}

/**
 * The saved-but-stale clone cache result that a later session or Save retries.
 */
function retryableMirrorMaintenance(context, verifiedCommit, code, reason, attempted) {
  return {
    attempted,
    branch: context.branch,
    code,
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason,
    retryable: true,
    status: "retryable",
    verifiedCommit
  };
}

async function refreshVerifiedGithubMirror(
  runCommand,
  context,
  verifiedCommit,
  { commandOptions = {}, project = {} } = {}
) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    };
  }
  const mirrorPath = context.githubMirrorPath;
  const retryable = (code, reason) => retryableMirrorMaintenance(context, verifiedCommit, code, reason, Boolean(mirrorPath));
  if (!mirrorPath && context.githubMirrorOptional) {
    return { attempted: false, kind: "none", retryable: false, status: "not_applicable" };
  }
  if (!mirrorPath || !path.isAbsolute(mirrorPath)) {
    return retryable(
      "vibe64_session_save_github_mirror_missing",
      "configuration_missing"
    );
  }

  try {
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath,
      remoteUrl: context.remoteUrl
    });
    const refresh = await saveCommand(runCommand, context, command, args, {
      additionalAllowedRoots: [mirrorPath],
      commandOptions,
      project
    });
    if (refresh?.ok !== true) {
      return retryable(
        trimmedText(refresh?.code) || "vibe64_session_save_github_mirror_refresh_failed",
        "refresh_failed"
      );
    }
    const localOptions = {
      additionalAllowedRoots: [mirrorPath],
      commandOptions,
      project,
      required: false
    };
    const [mirrorCommitResult, mirrorOriginResult] = await Promise.all([
      git(runCommand, context, [
        "--git-dir", mirrorPath,
        "rev-parse", "--verify", `refs/heads/${context.branch}^{commit}`
      ], localOptions),
      git(runCommand, context, [
        "--git-dir", mirrorPath,
        "remote", "get-url", "origin"
      ], localOptions)
    ]);
    const mirrorCommit = mirrorCommitResult?.ok === true ? output(mirrorCommitResult) : "";
    const mirrorOrigin = mirrorOriginResult?.ok === true ? output(mirrorOriginResult) : "";
    if (mirrorCommit !== verifiedCommit || mirrorOrigin !== context.remoteUrl) {
      return {
        ...retryable(
          "vibe64_session_save_github_mirror_verification_failed",
          "verification_failed"
        ),
        mirrorCommit
      };
    }
    return {
      attempted: true,
      branch: context.branch,
      kind: "github_mirror",
      mirrorCommit,
      retryable: false,
      status: "current",
      verifiedCommit
    };
  } catch {
    return retryable(
      "vibe64_session_save_github_mirror_refresh_failed",
      "refresh_interrupted"
    );
  }
}

async function reconcileSession(runCommand, context, {
  checkpointCommit,
  checkpointTree,
  commandOptions,
  project,
  saveCommit,
  sessionHead = ""
}) {
  const [currentTree, oldHead, saveTree] = await Promise.all([
    writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    }),
    gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }),
    commitTree(runCommand, context, saveCommit, {
      commandOptions,
      project
    })
  ]);
  if (oldHead === saveCommit) {
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  }
  if (sessionHead && oldHead !== sessionHead) {
    return {
      currentTree,
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
  const preserveLaterWork = currentTree !== checkpointTree && currentTree !== saveTree;
  const oldIndexTree = await gitOutput(runCommand, context, ["write-tree"], {
    commandOptions,
    project
  });
  try {
    if (preserveLaterWork) {
      await git(runCommand, context, ["read-tree", checkpointCommit], {
        commandOptions,
        project
      });
      await git(runCommand, context, ["read-tree", "-m", "-u", checkpointCommit, saveCommit], {
        commandOptions,
        project
      });
    } else {
      await git(runCommand, context, ["read-tree", "--reset", "-u", saveCommit], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["update-ref", "HEAD", saveCommit, oldHead], {
      commandOptions,
      project
    });
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  } catch (error) {
    if (!preserveLaterWork) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    return {
      currentTree,
      error: trimmedText(error?.message || error),
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
}

export {
  createSaveCommit,
  publishSaveCommit,
  reconcileSession,
  refreshVerifiedGithubMirror,
  retryableMirrorMaintenance
};
