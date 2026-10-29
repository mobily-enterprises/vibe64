// Canonical authority reads and connected-contribution checks. A connected
// contribution's published head is returned as evidence, never stored on context.
import crypto from "node:crypto";
import path from "node:path";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  sessionConnectedContribution
} from "@local/vibe64-core/server/projectRepository";
import { writeGitWorktreeTree } from "@local/vibe64-execution/server";
import {
  canonicalRef,
  commandProject,
  commitIsAncestor,
  deleteOperationRef,
  git,
  gitOutput,
  isGitObjectId,
  observedCanonicalCommit,
  optionalGitOutput,
  rememberCanonicalCommit,
  repositoryContext,
  saveError,
  saveRef,
  text
} from "./sessionWorkGit.js";

// Returns the canonical commit with the authority evidence it was read from.
// For a connected contribution, `contribution` records the published head and
// how the contribution's remote branches were found; it is null otherwise.
async function readRemoteCanonical(runCommand, context, operationId, options) {
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
  let contribution = null;
  let canonicalBranch = "";
  if (context.contribution) {
    const published = await readContributionHead(runCommand, context, options, true);
    contribution = {
      discarded: published.discarded,
      missingPublished: false,
      publishedCommit: published.head,
      remoteAbsent: !published.head
    };
    if (contribution.remoteAbsent) {
      const observed = await optionalGitOutput(runCommand, context,
        ["rev-parse", "--verify", `${canonicalRef(context)}^{commit}`], options);
      const prepared = await gitOutput(runCommand, context,
        ["for-each-ref", "--format=%(refname)", "refs/vibe64/save/"], options);
      if (prepared.split("\n").some(ref => ref.endsWith("/prepared"))) {
        throw saveError("This contribution branch is missing after a push attempt. Inspect its saved work and integration history before resubmitting it.",
          "vibe64_contribution_branch_missing");
      }
      if (context.lastCanonicalCommit === context.contribution.baseCommit &&
          (!observed || observed === context.contribution.baseCommit)) {
        return {
          canonicalBranch: context.contribution.replaces
            ? `vibe64-incoming/${context.contribution.replaces}_discarded`
            : context.contribution.integrationBranch,
          commit: context.contribution.baseCommit,
          contribution
        };
      }
      contribution.missingPublished = true;
    }
  }
  const operationRef = saveRef(context, operationId, "canonical");
  const integrationRef = contribution ? saveRef(context, operationId, "integration") : "";
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${contribution?.missingPublished ? context.contribution.integrationBranch :
        contribution?.discarded ? `${context.branch}_discarded` : context.branch}:${operationRef}`,
      ...(integrationRef ? [`+refs/heads/${context.contribution.integrationBranch}:${integrationRef}`] : [])
    ], options);
    let commit = await gitOutput(runCommand, context, ["rev-parse", "--verify", operationRef], options);
    if (integrationRef) {
      if (!contribution.missingPublished && commit !== contribution.publishedCommit) throw saveError(
        "The contribution branch changed during its authority check. Retry Update or Save.", "vibe64_session_save_update_required");
      const accepted = await gitOutput(runCommand, context, ["rev-parse", "--verify", integrationRef], options);
      // Once the exact published head is integrated, ordinary explicit Update
      // consumes the accepted target. Save still publishes only the incoming ref.
      const integrated = await commitIsAncestor(runCommand, context,
        contribution.missingPublished ? context.baseCommit : commit, accepted, options);
      if ((contribution.discarded || contribution.missingPublished) &&
          (!integrated || context.baseCommit === context.contribution.baseCommit && contribution.missingPublished)) {
        throw saveError("This removed contribution has not been integrated. Preserve its source and inspect its saved work.",
          contribution.discarded ? "vibe64_contribution_discarded" : "vibe64_contribution_branch_missing");
      }
      if (integrated) {
        commit = accepted;
        canonicalBranch = context.contribution.integrationBranch;
      }
    }
    return rememberCanonicalCommit(runCommand, context, commit, options)
      .then((verified) => ({ canonicalBranch, commit: verified, contribution }));
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
    await deleteOperationRef(runCommand, context, integrationRef, options);
  }
}

async function readContributionHead(runCommand, context, options, allowDiscarded = false) {
  const active = `refs/heads/${context.branch}`;
  const discarded = `${active}_discarded`;
  const output = await gitOutput(runCommand, context,
    ["ls-remote", "--heads", context.remoteUrl, active, discarded], options);
  const refs = new Map(output.split("\n").filter(Boolean).map(line => {
    const [commit, ref] = line.split(/\s+/u);
    if (![active, discarded].includes(ref) || !isGitObjectId(commit)) {
      throw saveError("The contribution's remote branches could not be verified.", "vibe64_contribution_refs_invalid");
    }
    return [ref, commit];
  }));
  if (refs.has(discarded) && (!allowDiscarded || refs.has(active))) {
    throw saveError(refs.has(active)
      ? "Both contribution branches exist after an interrupted discard. Resolve that operation before saving."
      : "This contribution was discarded. Preserve its source and submit further work as a new contribution.",
    refs.has(active) ? "vibe64_contribution_discard_incomplete" : "vibe64_contribution_discarded");
  }
  return {
    discarded: refs.has(discarded) && !refs.has(active),
    head: refs.get(active) || (allowDiscarded ? refs.get(discarded) : "") || "",
    remoteAbsent: !refs.has(active) && !refs.has(discarded)
  };
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

// Reads the named branch heads of one authority repository (the GitHub remote,
// the managed bare repository or the local project folder) with one
// `git ls-remote`. It fetches no objects and changes no checkout, so it needs
// no source lock; a moved head is then read by the ordinary update check.
async function readAuthorityBranchHeads(runCommand, context, branches, options) {
  const refs = [...new Set(branches.map(text).filter(Boolean))].map((branch) => `refs/heads/${branch}`);
  const output = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, ...refs], options);
  const heads = new Map();
  for (const line of output.split("\n").filter(Boolean)) {
    const [head, ref] = line.split(/\s+/u);
    // A pattern also matches a longer ref name ending in it.
    if (!refs.includes(ref)) continue;
    if (!isGitObjectId(head) || heads.has(ref)) {
      throw saveError("The repository returned invalid branch evidence.", "vibe64_session_update_refs_invalid");
    }
    heads.set(ref.slice("refs/heads/".length), head);
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
        "vibe64_session_save_authority_advanced"
      );
    }
    return rememberCanonicalCommit(runCommand, context, importedCommit, options)
      .then((commit) => ({ canonicalBranch: "", commit, contribution: null }));
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
  }
}

async function assertConnectedSubmissionsIntegrated(runCommand, context, options) {
  if (!context.connectedSubmissions.length) return;
  if (await gitOutput(runCommand, context, ["rev-parse", "--is-shallow-repository"], options) !== "false") {
    throw saveError("Connected integration requires complete Git history. Prepare a full checkout before saving.",
      "vibe64_connected_integration_unknown");
  }
  for (const { contribution, submittedCommit } of context.connectedSubmissions) {
    const { repository, integrationBranch, id } = contribution;
    const remote = `https://github.com/${repository}.git`;
    const target = `refs/heads/${integrationBranch}`;
    const active = `refs/heads/vibe64-incoming/${id}`;
    const discarded = `${active}_discarded`;
    const details = { repository, integrationBranch, id, submittedCommit };
    const refs = [];
    try {
      const observed = await gitOutput(runCommand, context, ["ls-remote", "--heads", remote, target, active, discarded], options);
      const heads = new Map();
      for (const line of observed.split("\n").filter(Boolean)) {
        const [head, ref] = line.split(/\s+/u);
        if (![target, active, discarded].includes(ref) || heads.has(ref) || !isGitObjectId(head)) {
          throw saveError("The receiving repository returned invalid ref evidence.");
        }
        heads.set(ref, head);
      }
      if (!heads.has(target)) throw saveError("The receiving integration branch is unavailable.");
      if (heads.has(active) && heads.has(discarded)) {
        throw saveError(`${repository} has an interrupted discard. Resolve it in Incoming changes before saving this project.`,
          "vibe64_connected_integration_unresolved", details);
      }
      for (const [remoteRef, head] of heads) {
        refs.push({ remote: remoteRef, head, local: saveRef(context, crypto.randomUUID(), "connected-integration") });
      }
      await git(runCommand, context, ["fetch", "--no-tags", "--no-write-fetch-head", remote,
        ...refs.map(ref => `+${ref.remote}:${ref.local}`)], options);
      if (await gitOutput(runCommand, context, ["rev-parse", "--is-shallow-repository"], options) !== "false") {
        throw saveError("The receiving history is incomplete.");
      }
      for (const ref of refs) {
        if (await gitOutput(runCommand, context, ["rev-parse", "--verify", `${ref.local}^{commit}`], options) !== ref.head) {
          throw saveError("The receiving branches changed during the integration check. Retry Save.");
        }
      }
      // The required revision is retained independently of the branch's current
      // head. Deleted refs and later branch commits cannot substitute for it.
      const remaining = await gitOutput(runCommand, context,
        ["rev-list", "--count", `${heads.get(target)}..${submittedCommit}`], options);
      if (!/^\d+$/u.test(remaining)) throw saveError("The required revision's ancestry is unknown.");
      if (remaining !== "0") {
        const wasDiscarded = heads.has(discarded);
        throw saveError(`${repository} has ${wasDiscarded ? "discarded" : "not merged"} contribution ${id} at ${submittedCommit.slice(0, 12)}. Integrate that revision into ${integrationBranch} before saving this project.`,
          wasDiscarded ? "vibe64_connected_integration_discarded" : "vibe64_connected_integration_pending", details);
      }
      // A deliberate replacement changes the selected source, not the required
      // submitted revision. Prove acceptance against that repository's current
      // authorized source after checking every retained submission above.
      const snapshot = (options.connectedWorkSnapshots || []).find(item =>
        item.contribution.repository === repository && item.contribution.integrationBranch === integrationBranch);
      if (!snapshot || !await commitIsAncestor(runCommand, context, heads.get(target), snapshot.sessionHead, options)) {
        throw saveError(`Update the connected session for ${repository} to incorporate its accepted ${integrationBranch} source before saving this project.`,
          "vibe64_connected_integration_source_update_required", details);
      }
    } catch (error) {
      if (error.code?.startsWith("vibe64_connected_integration_")) throw error;
      throw saveError(`Could not verify contribution ${id} in ${repository}/${integrationBranch}. Check repository access and complete history, then retry Save.`,
        "vibe64_connected_integration_unknown", details);
    } finally {
      for (const ref of refs) await deleteOperationRef(runCommand, context, ref.local, options);
    }
  }
}

function connectedWorkSnapshots(value = []) {
  if (!Array.isArray(value)) throw saveError("Connected source snapshots are unavailable.", "vibe64_connected_source_unavailable");
  return value.map(snapshot => {
    const contribution = sessionConnectedContribution({ metadata: {
      connected_contribution: JSON.stringify(snapshot?.contribution)
    } });
    if (!contribution || typeof snapshot.sessionId !== "string" || !text(snapshot.sessionId) ||
        !path.isAbsolute(text(snapshot.worktreePath)) ||
        [snapshot.baseCommit, snapshot.canonicalCommit, snapshot.sessionHead, snapshot.worktreeTree]
          .some(commit => !isGitObjectId(text(commit)))) {
      throw saveError("The connected source could not be captured. Inspect connected work before saving.",
        "vibe64_connected_source_unavailable");
    }
    return { contribution, sessionId: snapshot.sessionId, worktreePath: text(snapshot.worktreePath),
      baseCommit: snapshot.baseCommit, canonicalCommit: snapshot.canonicalCommit,
      sessionHead: snapshot.sessionHead, worktreeTree: snapshot.worktreeTree };
  });
}

async function assertConnectedWorkSnapshotsUnchanged(runCommand, snapshots, options) {
  for (const snapshot of snapshots) {
    const { contribution } = snapshot;
    const context = repositoryContext({ sessionId: snapshot.sessionId, sourcePath: snapshot.worktreePath, metadata: {
      base_commit: snapshot.baseCommit, canonical_commit: snapshot.canonicalCommit,
      connected_contribution: JSON.stringify(contribution)
    } }, { repositoryMode: PROJECT_REPOSITORY_MODE_GITHUB,
      repository: { defaultBranch: contribution.integrationBranch },
      githubRepository: { fullName: contribution.repository, cloneUrl: `https://github.com/${contribution.repository}.git` }
    });
    try {
      const tree = await writeGitWorktreeTree({ baseCommit: "HEAD", project: commandProject(context, options.project),
        runCommand, worktreePath: context.worktreePath });
      const [head, canonical] = await Promise.all([
        gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], options),
        observedCanonicalCommit(runCommand, context, options)
      ]);
      if (tree !== snapshot.worktreeTree || head !== snapshot.sessionHead || canonical !== snapshot.canonicalCommit) {
        throw saveError(`Connected work in ${contribution.repository} changed during Save. Inspect and save it before retrying Main Save.`,
          "vibe64_connected_save_required", { repository: contribution.repository, sessionId: contribution.id });
      }
    } catch (error) {
      if (error.code === "vibe64_connected_save_required") throw error;
      throw saveError(`Connected work in ${contribution.repository} could not be rechecked. Restore source access and retry Save.`,
        "vibe64_connected_source_unavailable", { repository: contribution.repository, sessionId: contribution.id });
    }
  }
}

export {
  assertConnectedSubmissionsIntegrated,
  assertConnectedWorkSnapshotsUnchanged,
  assertLocalAuthority,
  connectedWorkSnapshots,
  readAuthorityBranchHeads,
  readCanonical,
  readContributionHead
};
